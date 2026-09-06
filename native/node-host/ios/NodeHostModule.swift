import CryptoKit
import ExpoModulesCore
import Foundation
import UIKit

public final class NodeHostModule: Module {
  // Expo recreates module instances when the React Native bridge reloads, but
  // node_start is process-wide and may only be called once. Keep its lifecycle
  // outside the bridge so a development reload reconnects to the existing host.
  private static let sharedRuntime = NodeRuntime()
  private static let backgroundLifecycle = NodeBackgroundLifecycle(
    hostInfo: { try? sharedRuntime.readHostInfo() },
    requestTransportRecovery: { try sharedRuntime.requestTransportRecovery(revision: $0) }
  )
  private let runtime = NodeHostModule.sharedRuntime
  private let nativePreviewLaunchState = NativePreviewLaunchState()
  private let stateListenerID = UUID()

  public func definition() -> ModuleDefinition {
    Name("RunWhaleNodeHost")
    Events("onNodeState", "onNodeLog", "onNativePreviewAction")

    View(NativePreviewHostView.self) {}

    OnCreate {
      DispatchQueue.main.async { NodeHostModule.backgroundLifecycle.start() }
      self.runtime.setOnStateListener(id: self.stateListenerID) { [weak self] snapshot in
        DispatchQueue.main.async { [weak self] in
          self?.sendEvent("onNodeState", snapshot.dictionary.merging(["timestamp": Date().timeIntervalSince1970 * 1000]) { first, _ in first })
        }
      }
    }
    OnDestroy {
      self.runtime.removeStateListener(id: self.stateListenerID)
    }
    Function("snapshot") { self.runtime.snapshot.dictionary }
    Function("runtimeRoot") { try self.runtime.runtimeRoot().path }
    Function("readHostInfo") { try self.runtime.readHostInfo() }
    Function("takeNativePreviewDiagnostic") {
      RunWhaleTakeNativePreviewDiagnostic()
    }
    AsyncFunction("start") { (projectRoot: String, entry: String) in
      self.runtime.start(projectRoot: projectRoot, entry: entry).dictionary
    }
    AsyncFunction("startBundled") {
      try self.runtime.startBundled().dictionary
    }
    AsyncFunction("recoverTransport") {
      try NodeHostModule.backgroundLifecycle.recoverTransport()
    }.runOnQueue(.main)
    AsyncFunction("stop") { (port: Int?, token: String?) in
      self.runtime.requestStop(port: port, token: token).dictionary
    }
    Function("cancelNativePreviewOpen") { (requestId: String) in
      self.nativePreviewLaunchState.cancel(requestId: requestId)
    }
    AsyncFunction("openNativePreview") { (bundleUrl: URL, requestId: String, projectId: String, promise: Promise) in
      guard isValidNativePreviewBundleURL(bundleUrl) else {
        promise.reject(nativePreviewFailure(
          stage: "preflight",
          code: "invalid_bundle_url",
          message: "Native Preview only accepts a token-protected localhost bundle"
        ))
        return
      }
      guard isValidNativePreviewProjectIdentifier(projectId) else {
        promise.reject(nativePreviewFailure(
          stage: "preflight",
          code: "invalid_project_id",
          message: "Native Preview requires a valid project identifier."
        ))
        return
      }
      guard !requestId.isEmpty else {
        promise.reject(NativePreviewException("Native Preview requires a request identifier."))
        return
      }
      let launchState = self.nativePreviewLaunchState
      guard let launchToken = launchState.begin(requestId: requestId) else {
        promise.reject(NativePreviewException("Another Native Preview launch is still in progress."))
        return
      }
      _ = RunWhaleTakeNativePreviewDiagnostic()
      let bundleRequest = NativePreviewBundleRequest()
      let settlement = NativePreviewPromiseSettlement {
        launchState.finish(launchToken)
      }
      let cancelLaunch = {
        bundleRequest.cancel()
        settlement.once { promise.reject(NativePreviewException("Native Preview launch was cancelled.")) }
      }
      guard launchState.addCancellationHandler(for: launchToken, cancelLaunch) else {
        cancelLaunch()
        return
      }
      bundleRequest.start(url: bundleUrl) { [weak self] result in
        switch result {
        case .failure(.cancelled):
          settlement.once { promise.reject(NativePreviewException("Native Preview launch was cancelled.")) }
        case let .failure(failure):
          settlement.once {
            promise.reject(nativePreviewFailure(
              stage: "preflight",
              code: failure.code,
              message: failure.message
            ))
          }
        case let .success(data):
          guard launchState.isCurrent(launchToken) else { return }
          let cache = FileManager.default.temporaryDirectory.appendingPathComponent("runwhale-native-preview.bundle")
          do {
            try data.write(to: cache, options: .atomic)
          } catch {
            settlement.once {
              promise.reject(nativePreviewFailure(
                stage: "preflight",
                code: "bundle_cache_failed",
                message: "Native Preview could not cache the verified bundle."
              ))
            }
            return
          }
          guard launchState.isCurrent(launchToken) else { return }
          let sourceIdentifier = nativePreviewSourceIdentifier(bundleUrl: bundleUrl, data: data)
          DispatchQueue.main.async {
            guard launchState.isCurrent(launchToken) else { return }
            guard let presenter = self?.appContext?.utilities?.currentViewController() else {
              settlement.once {
                promise.reject(nativePreviewFailure(
                  stage: "presentation",
                  code: "presenter_unavailable",
                  message: "Current view controller is unavailable."
                ))
              }
              return
            }
            // Run the exact bounded artifact that passed validation. This keeps
            // the tokenized Metro URL out of the Preview runtime and avoids a
            // second network fetch during the initial reliability path.
            let controller = RunWhaleCreateNativePreviewController(
              cache,
              sourceIdentifier,
              projectId,
              {
                settlement.once { promise.resolve(["opened": true]) }
              },
              { message in
                settlement.once { promise.reject(NativePreviewException(message)) }
              },
              { [weak self] action, message in
                var event = ["action": action]
                if let message { event["message"] = message }
                self?.sendEvent("onNativePreviewAction", event)
              }
            )
            let cancelPresentation = {
              RunWhaleCancelNativePreviewController(controller)
              settlement.once { promise.reject(NativePreviewException("Native Preview launch was cancelled.")) }
            }
            guard launchState.addCancellationHandler(for: launchToken, cancelPresentation) else {
              cancelPresentation()
              return
            }
            guard launchState.isCurrent(launchToken) else { return }
            RunWhalePresentNativePreviewController(controller, presenter)
          }
        }
      }
    }
  }
}

private func isValidNativePreviewProjectIdentifier(_ projectId: String) -> Bool {
  projectId.range(
    of: #"^[a-z0-9][a-z0-9-]{1,62}$"#,
    options: .regularExpression
  ) != nil
}

private final class NativePreviewException: GenericException<String>, @unchecked Sendable {
  override var reason: String { param }
}

private func nativePreviewSourceIdentifier(bundleUrl: URL, data: Data) -> String {
  var digest = SHA256()
  // Each preview.run receives a fresh tokenized URL and must rebuild even when
  // Metro emits byte-for-byte identical JavaScript. Reopening the same URL and
  // bundle keeps this identifier stable so the existing controller is reused.
  digest.update(data: Data(bundleUrl.absoluteString.utf8))
  digest.update(data: Data([0]))
  digest.update(data: data)
  return digest.finalize().map { String(format: "%02x", $0) }.joined()
}

private func nativePreviewFailure(stage: String, code: String, message: String) -> NativePreviewException {
  NativePreviewException(RunWhaleRecordNativePreviewDiagnostic(stage, code, message))
}

private final class NativePreviewPromiseSettlement: @unchecked Sendable {
  private let lock = NSLock()
  private let onSettle: () -> Void
  private var settled = false

  init(onSettle: @escaping () -> Void) {
    self.onSettle = onSettle
  }

  func once(_ action: () -> Void) {
    lock.lock()
    guard !settled else {
      lock.unlock()
      return
    }
    settled = true
    lock.unlock()
    onSettle()
    action()
  }
}

private final class NodeRuntime: @unchecked Sendable {
  private static let relaunchRequired =
    "Embedded Node stopped and cannot restart inside the current app process. Fully close and reopen RunWhale."

  struct Snapshot {
    let state: String
    let nodeVersion: String?
    let lastError: String?

    var dictionary: [String: Any?] {
      ["state": state, "nodeVersion": nodeVersion, "lastError": lastError]
    }
  }

  private let lock = NSLock()
  private let bundleLock = NSLock()
  private var current = Snapshot(state: "stopped", nodeVersion: nil, lastError: nil)
  private var didStart = false
  private var stateListener: (id: UUID, callback: @Sendable (Snapshot) -> Void)?

  var snapshot: Snapshot { lock.withLock { current } }

  func setOnStateListener(id: UUID, _ listener: @escaping @Sendable (Snapshot) -> Void) {
    lock.withLock { stateListener = (id, listener) }
  }

  func removeStateListener(id: UUID) {
    lock.withLock {
      if stateListener?.id == id { stateListener = nil }
    }
  }

  func start(projectRoot: String, entry: String) -> Snapshot {
    lock.lock()
    if current.state == "starting" || current.state == "running" {
      let state = current
      lock.unlock()
      return state
    }
    if didStart {
      let failed = Snapshot(state: "failed", nodeVersion: "24.19.0", lastError: Self.relaunchRequired)
      current = failed
      let listener = stateListener?.callback
      lock.unlock()
      listener?(failed)
      return failed
    }
    didStart = true
    let starting = Snapshot(state: "starting", nodeVersion: "24.19.0", lastError: nil)
    current = starting
    let listener = stateListener?.callback
    lock.unlock()
    listener?(starting)
    NodeRuntimeThread.start { [weak self] in
      guard let self else { return }
      self.publish(Snapshot(state: "running", nodeVersion: "24.19.0", lastError: nil))
      FileManager.default.changeCurrentDirectoryPath(projectRoot)
      let values = ["node", entry, projectRoot, URL(fileURLWithPath: projectRoot).appendingPathComponent("node_modules").path]
      let storage: [UnsafeMutablePointer<CChar>] = values.map { value in
        guard let pointer = strdup(value) else {
          preconditionFailure("Unable to allocate embedded Node argv")
        }
        return pointer
      }
      defer { storage.forEach { free($0) } }
      var argv = storage.map { $0 }
      let result = RunWhaleNodeStart(Int32(argv.count), &argv)
      let detail = result == 0
        ? Self.relaunchRequired
        : "Node exited with code \(result). \(Self.relaunchRequired)"
      self.publish(Snapshot(
        state: "failed",
        nodeVersion: "24.19.0",
        lastError: detail
      ))
    }
    return starting
  }

  func runtimeRoot() throws -> URL {
    let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let root = base.appendingPathComponent("runwhale-runtime", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: root.appendingPathComponent(".runwhale", isDirectory: true), withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: root.appendingPathComponent("node_modules", isDirectory: true), withIntermediateDirectories: true)
    return root
  }

  func startBundled() throws -> Snapshot {
    bundleLock.lock()
    defer { bundleLock.unlock() }
    let state = snapshot
    if state.state != "stopped" { return state }
    let root = try runtimeRoot()
    try? FileManager.default.removeItem(at: root.appendingPathComponent(".runwhale/host.json"))
    try? FileManager.default.removeItem(at: root.appendingPathComponent(".runwhale/transport-recovery.json"))
    let entry = root.appendingPathComponent("runwhale-runtime.mjs")
    let assets = [
      ("runwhale-runtime", "mjs", 1, "Bundled Node runtime is missing"),
      ("runwhale-agent-runtime", "mjs", 7, "Bundled Agent runtime is missing"),
      ("runwhale-task-worker", "mjs", 3, "Bundled Node task worker is missing"),
      ("runwhale-package-worker", "mjs", 4, "Bundled npm worker is missing"),
      ("worker", "cjs", 6, "Bundled TypeScript code worker is missing"),
      ("runwhale-module-store", "tgz", 2, "Bundled module store is missing"),
      ("runwhale-npm", "tgz", 5, "Bundled npm archive is missing"),
    ]
    let resourceBundle = Bundle(for: NodeHostModule.self)
    let bundledAssets = try assets.map { name, fileExtension, errorCode, errorMessage in
      guard let resource = resourceBundle.url(forResource: name, withExtension: fileExtension) else {
        throw NSError(domain: "RunWhaleNodeHost", code: errorCode, userInfo: [NSLocalizedDescriptionKey: errorMessage])
      }
      let values = try resource.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
      let identity = "\(name).\(fileExtension):\(values.fileSize ?? -1):\(values.contentModificationDate?.timeIntervalSince1970 ?? 0)"
      return (name: name, fileExtension: fileExtension, resource: resource, identity: identity)
    }
    let buildVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "development"
    let bundleVersion = ([buildVersion] + bundledAssets.map(\.identity)).joined(separator: "\n") + "\n"
    let bundleVersionFile = root.appendingPathComponent(".runwhale-bundle-version")
    let installedBundleVersion = try? String(contentsOf: bundleVersionFile, encoding: .utf8)
    let bundledAssetsReady = installedBundleVersion == bundleVersion && bundledAssets.allSatisfy { asset in
      FileManager.default.fileExists(atPath: root.appendingPathComponent("\(asset.name).\(asset.fileExtension)").path)
    }
    if !bundledAssetsReady {
      for asset in bundledAssets {
        let destination = root.appendingPathComponent("\(asset.name).\(asset.fileExtension)")
        let temporary = root.appendingPathComponent("\(asset.name).\(asset.fileExtension).tmp")
        try? FileManager.default.removeItem(at: temporary)
        try FileManager.default.copyItem(at: asset.resource, to: temporary)
        if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
        try FileManager.default.moveItem(at: temporary, to: destination)
      }
      try bundleVersion.write(to: bundleVersionFile, atomically: true, encoding: .utf8)
    }
    return start(projectRoot: root.path, entry: entry.path)
  }

  func readHostInfo() throws -> String? {
    let file = try runtimeRoot().appendingPathComponent(".runwhale/host.json")
    return try? String(contentsOf: file, encoding: .utf8)
  }

  func requestTransportRecovery(revision: Int) throws -> String? {
    guard snapshot.state == "running" else { return nil }
    let id = UUID().uuidString
    let file = try runtimeRoot().appendingPathComponent(".runwhale/transport-recovery.json")
    let data = try JSONSerialization.data(withJSONObject: ["id": id, "revision": revision])
    try data.write(to: file, options: .atomic)
    return id
  }

  func requestStop(port: Int?, token: String?) -> Snapshot {
    guard snapshot.state == "running", let port, let token, !token.isEmpty else { return snapshot }
    publish(Snapshot(state: "stopping", nodeVersion: "24.19.0", lastError: nil))
    var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/__runwhale/stop")!)
    request.httpMethod = "POST"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    URLSession.shared.dataTask(with: request).resume()
    return snapshot
  }

  private func publish(_ value: Snapshot) {
    let listener = lock.withLock {
      current = value
      return stateListener?.callback
    }
    listener?(value)
  }
}
