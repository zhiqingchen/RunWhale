import Foundation
import UIKit

/// Process-owned: survives React bridge reloads and never relies on JS timers.
final class NodeBackgroundLifecycle {
  private let hostInfo: () -> String?
  private let requestTransportRecovery: (Int) throws -> String?
  private var observers: [NSObjectProtocol] = []
  private var task: UIBackgroundTaskIdentifier = .invalid
  private var revision = 0
  private var wasBackgrounded = false
  private var continuedProcessing: AnyObject?

  init(hostInfo: @escaping () -> String?, requestTransportRecovery: @escaping (Int) throws -> String?) {
    self.hostInfo = hostInfo
    self.requestTransportRecovery = requestTransportRecovery
  }

  func start() {
    dispatchPrecondition(condition: .onQueue(.main))
    guard observers.isEmpty else { return }
    let center = NotificationCenter.default
    observers = [
      center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.begin() },
      center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in self?.background() },
      center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.foreground() },
    ]
  }

  func beginContinuedTask(copy: [String: String], completion: @escaping (String?) -> Void) {
    if #available(iOS 26.0, *) {
      if continuedProcessing == nil {
        continuedProcessing = NodeContinuedProcessing { [weak self] method, params, callback in
          guard let self else { callback(nil); return }
          self.request(method, params: params, completion: callback)
        }
      }
      (continuedProcessing as? NodeContinuedProcessing)?.begin(copy: copy, completion: completion)
    } else { completion(nil) }
  }

  private func begin() {
    guard task == .invalid, hostInfo() != nil else { return }
    task = UIApplication.shared.beginBackgroundTask(withName: "Save Agent progress") { [weak self] in
      guard let self else { return }
      // The normal allowance reserves time for draining and persistence. This
      // handler is only a final best effort; checkpoints are already periodic.
      self.sendBackground(graceMs: 0)
      self.end()
    }
  }

  private func background() {
    wasBackgrounded = true
    begin()
    let remaining = UIApplication.shared.backgroundTimeRemaining
    let seconds = task == .invalid ? 0 : min(20, max(0, remaining - 8))
    sendBackground(graceMs: seconds * 1000)
  }

  private func sendBackground(graceMs: Double) {
    revision += 1
    let currentRevision = revision
    request("host.background", params: ["revision": currentRevision, "graceMs": graceMs]) { [weak self] _ in
      guard let self, self.revision == currentRevision else { return }
      self.end()
    }
  }

  private func foreground() {
    revision += 1
    if wasBackgrounded {
      wasBackgrounded = false
      // iOS can reclaim a suspended app's listening socket. Recovery must reach
      // Node without depending on the HTTP listener that needs to be replaced.
      _ = try? requestTransportRecovery(revision)
    } else {
      request("host.foreground", params: ["revision": revision]) { _ in }
    }
    end()
  }

  func recoverTransport() throws -> String? {
    dispatchPrecondition(condition: .onQueue(.main))
    guard UIApplication.shared.applicationState == .active else { return nil }
    revision += 1
    return try requestTransportRecovery(revision)
  }

  private func end() {
    guard task != .invalid else { return }
    UIApplication.shared.endBackgroundTask(task)
    task = .invalid
  }

  private func request(_ method: String, params: [String: Any], completion: @escaping ([String: Any]?) -> Void) {
    guard let info = hostInfo(), let data = info.data(using: .utf8),
      let host = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let port = host["port"] as? Int, (1...65535).contains(port),
      let token = host["token"] as? String, !token.isEmpty,
      let url = URL(string: "http://127.0.0.1:\(port)/rpc") else { completion(nil); return }
    let timeout: TimeInterval = method.hasPrefix("host.continued.") ? 3 : 30
    var request = URLRequest(url: url, timeoutInterval: timeout)
    request.httpMethod = "POST"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: [
      "v": 1, "type": "request", "id": UUID().uuidString,
      "method": method, "params": params, "timeoutMs": Int(timeout * 1000),
    ])
    URLSession.shared.dataTask(with: request) { data, _, _ in
      let envelope = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
      let result = envelope?["ok"] as? Bool == true ? envelope?["result"] as? [String: Any] : nil
      DispatchQueue.main.async { completion(result) }
    }.resume()
  }
}
