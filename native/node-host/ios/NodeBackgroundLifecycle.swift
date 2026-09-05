import Foundation
import UIKit

/// Process-owned: survives React bridge reloads and never relies on JS timers.
final class NodeBackgroundLifecycle {
  private let hostInfo: () -> String?
  private var observers: [NSObjectProtocol] = []
  private var task: UIBackgroundTaskIdentifier = .invalid
  private var revision = 0

  init(hostInfo: @escaping () -> String?) { self.hostInfo = hostInfo }

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
    begin()
    let remaining = UIApplication.shared.backgroundTimeRemaining
    let seconds = task == .invalid ? 0 : min(20, max(0, remaining - 8))
    sendBackground(graceMs: seconds * 1000)
  }

  private func sendBackground(graceMs: Double) {
    revision += 1
    let currentRevision = revision
    request("host.background", params: ["revision": currentRevision, "graceMs": graceMs]) { [weak self] in
      guard let self, self.revision == currentRevision else { return }
      self.end()
    }
  }

  private func foreground() {
    revision += 1
    request("host.foreground", params: ["revision": revision]) {}
    end()
  }

  private func end() {
    guard task != .invalid else { return }
    UIApplication.shared.endBackgroundTask(task)
    task = .invalid
  }

  private func request(_ method: String, params: [String: Any], completion: @escaping () -> Void) {
    guard let info = hostInfo(), let data = info.data(using: .utf8),
      let host = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let port = host["port"] as? Int, (1...65535).contains(port),
      let token = host["token"] as? String, !token.isEmpty,
      let url = URL(string: "http://127.0.0.1:\(port)/rpc") else { completion(); return }
    var request = URLRequest(url: url, timeoutInterval: 30)
    request.httpMethod = "POST"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: [
      "v": 1, "type": "request", "id": UUID().uuidString,
      "method": method, "params": params, "timeoutMs": 30000,
    ])
    URLSession.shared.dataTask(with: request) { _, _, _ in
      DispatchQueue.main.async { completion() }
    }.resume()
  }
}
