import BackgroundTasks
import Foundation
import OSLog
import UIKit

typealias NodeLifecycleRequest = (String, [String: Any], @escaping ([String: Any]?) -> Void) -> Void

/// One user-initiated execution, owned by the native process rather than the React bridge.
@available(iOS 26.0, *)
final class NodeContinuedProcessing {
  private final class Job {
    let id: String
    let copy: [String: String]
    let startedAt = Date()
    var lastContact = Date()
    var task: BGContinuedProcessingTask?
    var polling = false
    init(id: String, copy: [String: String]) { self.id = id; self.copy = copy }
  }

  private let logger = Logger(subsystem: "app.runwhale.nodehost", category: "BackgroundAgent")
  private let request: NodeLifecycleRequest
  private var job: Job?
  private var timer: DispatchSourceTimer?

  init(request: @escaping NodeLifecycleRequest) { self.request = request }

  func begin(copy: [String: String], completion: @escaping (String?) -> Void) {
    dispatchPrecondition(condition: .onQueue(.main))
    guard job == nil, UIApplication.shared.applicationState == .active,
      let bundle = Bundle.main.bundleIdentifier else { completion(nil); return }
    let next = Job(id: "\(bundle).agent.\(UUID().uuidString)", copy: copy)
    job = next
    request("host.continued.prepare", ["id": next.id]) { [weak self] result in
      guard let self, self.job === next else { completion(nil); return }
      guard result?["prepared"] as? Bool == true,
        UIApplication.shared.applicationState == .active else {
        self.finish(next, reason: "preparation-unavailable")
        completion(nil)
        return
      }
      // Register each concrete identifier once. Info.plist permits the .agent.* suffix.
      let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: next.id, using: .main) { [weak self, weak next] task in
        guard let self, let next, self.job === next,
          let continued = task as? BGContinuedProcessingTask else {
          task.setTaskCompleted(success: false)
          return
        }
        next.task = continued
        // Agent work has no known step count. Report actual completed steps without
        // inventing a percentage or advancing progress on a heartbeat.
        continued.progress.totalUnitCount = -1
        continued.progress.completedUnitCount = 0
        continued.expirationHandler = { [weak self, weak next] in
          DispatchQueue.main.async {
            guard let self, let next else { return }
            self.finish(next, reason: "expired", pause: true)
          }
        }
        self.poll(next)
      }
      guard registered else {
        self.finish(next, reason: "registration-failed")
        completion(nil)
        return
      }
      let submission = BGContinuedProcessingTaskRequest(
        identifier: next.id,
        title: copy["title"] ?? "RunWhale Agent",
        subtitle: copy["working"] ?? "Working…"
      )
      submission.strategy = .fail
      do {
        try BGTaskScheduler.shared.submit(submission)
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now(), repeating: .seconds(1))
        timer.setEventHandler { [weak self, weak next] in
          guard let self, let next else { return }
          self.poll(next)
        }
        self.timer = timer
        timer.resume()
        completion(next.id)
      } catch {
        // Codes are sufficient for scheduling failures; never log task content.
        self.logger.error("Background submission failed: code=\((error as NSError).code)")
        self.finish(next, reason: "submission-failed")
        completion(nil)
      }
    }
  }

  private func poll(_ current: Job) {
    guard job === current, !current.polling else { return }
    // A submission may fail to deliver a handler. Foreground work still runs.
    if current.task == nil && Date().timeIntervalSince(current.startedAt) > 8 {
      finish(current, reason: "delivery-timeout")
      return
    }
    current.polling = true
    request("host.continued.status", ["id": current.id, "granted": current.task != nil]) { [weak self, weak current] result in
      guard let self, let current, self.job === current else { return }
      current.polling = false
      guard let state = result?["state"] as? String else {
        // Foreground recovery replaces the localhost listener. Allow that brief
        // transport handoff without treating it as a user cancellation.
        if Date().timeIntervalSince(current.lastContact) > 8 {
          self.finish(current, reason: "transport-lost", pause: current.task != nil)
        }
        return
      }
      current.lastContact = Date()
      let steps = (result?["completedSteps"] as? NSNumber)?.int64Value ?? 0
      if state == "pending" && Date().timeIntervalSince(current.startedAt) > 8 {
        self.finish(current, reason: "admission-timeout")
        return
      }
      switch state {
      case "pending", "running":
        if let task = current.task {
          task.progress.completedUnitCount = max(task.progress.completedUnitCount, steps)
          let subtitle = steps == 0 ? current.copy["working"] ?? "Working…"
            : (current.copy["steps"] ?? "{count} steps completed").replacingOccurrences(of: "{count}", with: String(steps))
          if task.subtitle != subtitle { task.updateTitle(task.title, subtitle: subtitle) }
        }
      case "completed":
        if let task = current.task {
          task.progress.totalUnitCount = max(1, steps)
          task.progress.completedUnitCount = task.progress.totalUnitCount
        }
        self.finish(current, reason: "completed", success: true)
      case "saving":
        if let task = current.task { task.updateTitle(task.title, subtitle: current.copy["saving"] ?? "Saving progress…") }
      case "waiting":
        if let task = current.task { task.updateTitle(task.title, subtitle: current.copy["waiting"] ?? "Open RunWhale to continue") }
        // Node reports waiting only after the session is durably paused.
        // This background segment has finished its handoff; the Agent session
        // remains paused and is never relabeled as a completed user request.
        self.finish(current, reason: "saved-for-foreground", success: true)
      default:
        self.finish(current, reason: state == "failed" ? "agent-failed" : "stopped")
      }
    }
  }

  private func finish(_ current: Job, reason: String, success: Bool = false, pause: Bool = false) {
    guard job === current else { return }
    logger.notice("Background execution ended: reason=\(reason, privacy: .public), success=\(success), elapsed=\(Int(Date().timeIntervalSince(current.startedAt)))s")
    job = nil
    timer?.cancel()
    timer = nil
    current.task?.expirationHandler = nil
    // Request a pause before surrendering execution time. Node checkpoints
    // throughout the run; expiration itself cannot guarantee time for a final save.
    var params: [String: Any] = ["id": current.id, "pause": pause]
    if pause { params["reason"] = reason == "transport-lost" ? "transport-lost" : "expired" }
    request("host.continued.end", params) { _ in }
    if let task = current.task { task.setTaskCompleted(success: success) }
    else { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: current.id) }
  }
}
