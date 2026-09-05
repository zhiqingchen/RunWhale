import ExpoModulesCore
import Foundation

private let nativePreviewStorageValuesKey = "values"

@objc(RunWhaleNativePreviewAppContextFactory)
public final class NativePreviewAppContextFactory: NSObject {
  @objc(makeAppContextWithDocumentDirectory:cacheDirectory:fileSystemManager:)
  public static func makeAppContext(
    documentDirectory: URL,
    cacheDirectory: URL,
    fileSystemManager: FileSystemManager
  ) -> AppContext {
    let config = AppContextConfig(
      documentDirectory: documentDirectory,
      cacheDirectory: cacheDirectory,
      appGroups: []
    )
    let appContext = AppContext(config: config)
    appContext.fileSystem = fileSystemManager
    return appContext
  }
}

public final class NativePreviewStorageModule: Module {
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("RunWhalePreviewStorage")

    AsyncFunction("getItem") { (key: String) -> String? in
      try self.withValues { values in
        return values[key]
      }
    }

    AsyncFunction("setItem") { (key: String, value: String) in
      try self.updateValues { values in
        values[key] = value
      }
    }

    AsyncFunction("removeItem") { (key: String) in
      try self.updateValues { values in
        values.removeValue(forKey: key)
      }
    }

    AsyncFunction("mergeItem") { (key: String, value: String) in
      try self.updateValues { values in
        values[key] = try mergeNativePreviewStorageValue(values[key], with: value)
      }
    }

    AsyncFunction("getAllKeys") { () -> [String] in
      try self.withValues { values in
        values.keys.sorted()
      }
    }

    AsyncFunction("clear") {
      try self.replaceValues([:])
    }

    AsyncFunction("multiGet") { (keys: [String]) -> [[String?]] in
      try self.withValues { values in
        keys.map { key in [key, values[key]] }
      }
    }

    AsyncFunction("multiSet") { (pairs: [[String]]) in
      try self.updateValues { values in
        for pair in pairs {
          let (key, value) = try validateNativePreviewStoragePair(pair)
          values[key] = value
        }
      }
    }

    AsyncFunction("multiRemove") { (keys: [String]) in
      try self.updateValues { values in
        for key in keys {
          values.removeValue(forKey: key)
        }
      }
    }

    AsyncFunction("multiMerge") { (pairs: [[String]]) in
      try self.updateValues { values in
        for pair in pairs {
          let (key, value) = try validateNativePreviewStoragePair(pair)
          values[key] = try mergeNativePreviewStorageValue(values[key], with: value)
        }
      }
    }
  }

  private func withValues<Result>(_ body: ([String: String]) throws -> Result) throws -> Result {
    try lock.withLock {
      try body(try loadValues())
    }
  }

  private func updateValues(_ update: (inout [String: String]) throws -> Void) throws {
    try lock.withLock {
      var values = try loadValues()
      try update(&values)
      try saveValues(values)
    }
  }

  private func replaceValues(_ values: [String: String]) throws {
    try lock.withLock {
      try saveValues(values)
    }
  }

  private func loadValues() throws -> [String: String] {
    let defaults = try storageDefaults()
    guard let stored = defaults.object(forKey: nativePreviewStorageValuesKey) else {
      return [:]
    }
    guard let values = stored as? [String: String] else {
      throw NativePreviewStorageException("Native Preview storage is corrupt.")
    }
    return values
  }

  private func saveValues(_ values: [String: String]) throws {
    let defaults = try storageDefaults()
    if values.isEmpty {
      defaults.removeObject(forKey: nativePreviewStorageValuesKey)
    } else {
      defaults.set(values, forKey: nativePreviewStorageValuesKey)
    }
  }

  private func storageDefaults() throws -> UserDefaults {
    guard
      let documentDirectory = appContext?.config.documentDirectory,
      documentDirectory.lastPathComponent == "files"
    else {
      throw NativePreviewStorageException("Native Preview project storage is unavailable.")
    }
    let projectID = documentDirectory.deletingLastPathComponent().lastPathComponent
    try validateNativePreviewProjectIdentifier(projectID)
    guard let defaults = UserDefaults(suiteName: "runwhale-native-preview-storage-\(projectID)") else {
      throw NativePreviewStorageException("Native Preview project storage could not be opened.")
    }
    return defaults
  }
}

private func validateNativePreviewProjectIdentifier(_ projectID: String) throws {
  let range = projectID.range(of: #"^[a-z0-9][a-z0-9-]{1,62}$"#, options: .regularExpression)
  guard range?.lowerBound == projectID.startIndex, range?.upperBound == projectID.endIndex else {
    throw NativePreviewStorageException("Native Preview project identifier is invalid.")
  }
}

private func validateNativePreviewStoragePair(_ pair: [String]) throws -> (String, String) {
  guard pair.count == 2 else {
    throw NativePreviewStorageException("AsyncStorage entries must contain one key and one value.")
  }
  return (pair[0], pair[1])
}

private func mergeNativePreviewStorageValue(_ existing: String?, with incoming: String) throws -> String {
  guard let existing else {
    return incoming
  }
  guard
    let existingData = existing.data(using: .utf8),
    let incomingData = incoming.data(using: .utf8),
    var existingObject = try JSONSerialization.jsonObject(with: existingData) as? [String: Any],
    let incomingObject = try JSONSerialization.jsonObject(with: incomingData) as? [String: Any]
  else {
    throw NativePreviewStorageException("AsyncStorage merge values must be JSON objects.")
  }

  mergeNativePreviewStorageObject(&existingObject, with: incomingObject)
  let data = try JSONSerialization.data(withJSONObject: existingObject, options: [.sortedKeys])
  guard let encoded = String(data: data, encoding: .utf8) else {
    throw NativePreviewStorageException("AsyncStorage could not encode the merged value.")
  }
  return encoded
}

private func mergeNativePreviewStorageObject(
  _ existing: inout [String: Any],
  with incoming: [String: Any]
) {
  for (key, incomingValue) in incoming {
    if var existingValue = existing[key] as? [String: Any],
       let incomingValue = incomingValue as? [String: Any] {
      mergeNativePreviewStorageObject(&existingValue, with: incomingValue)
      existing[key] = existingValue
    } else {
      existing[key] = incomingValue
    }
  }
}

private final class NativePreviewStorageException: GenericException<String>, @unchecked Sendable {
  override var reason: String { param }
}
