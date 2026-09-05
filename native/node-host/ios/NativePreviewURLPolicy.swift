import Foundation

let nativePreviewMaxBundleBytes = 48 * 1024 * 1024

func isValidNativePreviewBundleURL(_ url: URL) -> Bool {
  guard
    let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
    components.scheme == "http",
    components.host == "127.0.0.1",
    components.percentEncodedHost == "127.0.0.1",
    let port = components.port,
    (1...65_535).contains(port),
    components.percentEncodedUser == nil,
    components.percentEncodedPassword == nil,
    components.percentEncodedFragment == nil,
    let query = components.percentEncodedQuery
  else {
    return false
  }

  return query.range(
    of: #"(?:^|&)token=[A-Za-z0-9_-]{32,}(?:&|$)"#,
    options: .regularExpression
  ) != nil
}

enum NativePreviewBundleRequestFailure: Error, Sendable {
  case cancelled
  case requestFailed
  case httpStatus(Int?)
  case empty
  case tooLarge

  var code: String {
    switch self {
    case .cancelled: "launch_cancelled"
    case .requestFailed: "bundle_request_failed"
    case .httpStatus: "bundle_http_status"
    case .empty: "bundle_empty"
    case .tooLarge: "bundle_too_large"
    }
  }

  var message: String {
    switch self {
    case .cancelled:
      "Native Preview launch was cancelled."
    case .requestFailed:
      "The Native Preview bundle request failed."
    case let .httpStatus(status):
      status.map { "Metro returned HTTP \($0)." } ?? "Metro did not return an HTTP response."
    case .empty:
      "Metro returned an empty Native Preview bundle."
    case .tooLarge:
      "Native Preview bundle exceeds the 48 MiB limit."
    }
  }
}

final class NativePreviewBundleRequest: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private let lock = NSLock()
  private var body = Data()
  private var completion: ((Result<Data, NativePreviewBundleRequestFailure>) -> Void)?
  private var responseAccepted = false
  private var session: URLSession?
  private var cancelled = false

  func start(
    url: URL,
    completion: @escaping (Result<Data, NativePreviewBundleRequestFailure>) -> Void
  ) {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpShouldSetCookies = false
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.timeoutIntervalForRequest = 30
    configuration.timeoutIntervalForResource = 30
    configuration.urlCache = nil
    configuration.urlCredentialStorage = nil
    let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    let accepted = lock.withLock {
      guard !cancelled else { return false }
      self.completion = completion
      self.session = session
      return true
    }
    guard accepted else {
      session.invalidateAndCancel()
      completion(.failure(.cancelled))
      return
    }

    var request = URLRequest(url: url)
    request.timeoutInterval = 30
    session.dataTask(with: request).resume()
  }

  func cancel() {
    let shouldSettle = lock.withLock {
      cancelled = true
      return completion != nil
    }
    if shouldSettle { settle(.failure(.cancelled)) }
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
      settle(.failure(.httpStatus((response as? HTTPURLResponse)?.statusCode)))
      completionHandler(.cancel)
      return
    }
    let expectedBytes = response.expectedContentLength
    guard expectedBytes < 0 || expectedBytes <= nativePreviewMaxBundleBytes else {
      settle(.failure(.tooLarge))
      completionHandler(.cancel)
      return
    }
    guard expectedBytes != 0 else {
      settle(.failure(.empty))
      completionHandler(.cancel)
      return
    }

    lock.withLock { responseAccepted = true }
    completionHandler(.allow)
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive data: Data
  ) {
    let exceededLimit = lock.withLock {
      guard completion != nil else { return false }
      guard data.count <= nativePreviewMaxBundleBytes - body.count else { return true }
      body.append(data)
      return false
    }
    if exceededLimit {
      settle(.failure(.tooLarge))
      dataTask.cancel()
    }
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didCompleteWithError error: Error?
  ) {
    if error != nil {
      settle(.failure(.requestFailed))
      return
    }
    let snapshot = lock.withLock { (responseAccepted, body) }
    guard snapshot.0 else {
      settle(.failure(.httpStatus(nil)))
      return
    }
    guard !snapshot.1.isEmpty else {
      settle(.failure(.empty))
      return
    }
    settle(.success(snapshot.1))
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }

  private func settle(_ result: Result<Data, NativePreviewBundleRequestFailure>) {
    let settlement = lock.withLock { () -> (((Result<Data, NativePreviewBundleRequestFailure>) -> Void), URLSession)? in
      guard let completion else { return nil }
      self.completion = nil
      let session = self.session
      self.session = nil
      return session.map { (completion, $0) }
    }
    guard let (completion, session) = settlement else { return }
    switch result {
    case .success:
      session.finishTasksAndInvalidate()
    case .failure:
      session.invalidateAndCancel()
    }
    completion(result)
  }
}

final class NativePreviewLaunchState: @unchecked Sendable {
  struct Token: Equatable, Sendable {
    fileprivate let sequence: UInt64
    let requestId: String
  }

  private struct ActiveLaunch {
    let token: Token
    var cancellationHandlers: [() -> Void]
  }

  private let lock = NSLock()
  private var nextSequence: UInt64 = 0
  private var active: ActiveLaunch?
  private var cancellingSequence: UInt64?

  func begin(requestId: String) -> Token? {
    lock.withLock {
      guard active == nil, cancellingSequence == nil else { return nil }
      nextSequence &+= 1
      let token = Token(sequence: nextSequence, requestId: requestId)
      active = ActiveLaunch(token: token, cancellationHandlers: [])
      return token
    }
  }

  func addCancellationHandler(for token: Token, _ handler: @escaping () -> Void) -> Bool {
    lock.withLock {
      guard active?.token == token else { return false }
      active?.cancellationHandlers.append(handler)
      return true
    }
  }

  func isCurrent(_ token: Token) -> Bool {
    lock.withLock { active?.token == token }
  }

  func finish(_ token: Token) {
    lock.withLock {
      guard active?.token == token else { return }
      active = nil
    }
  }

  func cancel(requestId: String) -> Bool {
    let cancellation = lock.withLock { () -> (UInt64, [() -> Void])? in
      guard active?.token.requestId == requestId else { return nil }
      let sequence = active?.token.sequence ?? 0
      let handlers = active?.cancellationHandlers ?? []
      active = nil
      cancellingSequence = sequence
      return (sequence, handlers)
    }
    guard let (sequence, handlers) = cancellation else { return false }
    handlers.reversed().forEach { $0() }
    lock.withLock {
      if cancellingSequence == sequence { cancellingSequence = nil }
    }
    return true
  }
}
