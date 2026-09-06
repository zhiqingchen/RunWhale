import Foundation

enum NodeRuntimeThread {
  static func start(_ work: @escaping @Sendable () -> Void) {
    let thread = Thread(block: work)
    thread.name = "com.runwhale.nodehost.24.19"
    thread.qualityOfService = .userInitiated
    // V8's default ARM64 stack budget is 984 KiB. A GCD worker can have
    // only 512 KiB, hitting its guard page before V8 can throw RangeError.
    // Reserve room for that budget plus Node, native calls, and signal frames.
    thread.stackSize = 4 * 1024 * 1024
    thread.start()
  }
}
