import Foundation
import NodeMobile

let entry = CommandLine.arguments[1]
NodeRuntimeThread.start {
  let stackBytes = pthread_get_stacksize_np(pthread_self())
  print("Node thread stack: \(stackBytes) bytes")
  precondition(stackBytes >= 4 * 1024 * 1024)
  let values = ["node", entry]
  let storage: [UnsafeMutablePointer<CChar>] = values.map { strdup($0)! }
  var argv = storage.map { Optional($0) } + [nil]
  let result = node_start(Int32(storage.count), &argv)
  storage.forEach { free($0) }
  exit(result)
}
dispatchMain()
