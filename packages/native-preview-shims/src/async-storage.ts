import { requireNativeModule } from 'expo-modules-core'

export type Callback = (error?: Error | null) => void
export type CallbackWithResult<T> = (error?: Error | null, result?: T | null) => void
export type KeyValuePair = [string, string | null]
export type MultiCallback = (errors?: readonly (Error | null)[] | null) => void
export type MultiGetCallback = (
  errors?: readonly (Error | null)[] | null,
  result?: readonly KeyValuePair[],
) => void

export type AsyncStorageHook = {
  getItem(callback?: CallbackWithResult<string>): Promise<string | null>
  setItem(value: string, callback?: Callback): Promise<void>
  mergeItem(value: string, callback?: Callback): Promise<void>
  removeItem(callback?: Callback): Promise<void>
}

export type AsyncStorageStatic = {
  getItem(key: string, callback?: CallbackWithResult<string>): Promise<string | null>
  setItem(key: string, value: string, callback?: Callback): Promise<void>
  removeItem(key: string, callback?: Callback): Promise<void>
  mergeItem(key: string, value: string, callback?: Callback): Promise<void>
  clear(callback?: Callback): Promise<void>
  getAllKeys(callback?: CallbackWithResult<readonly string[]>): Promise<readonly string[]>
  flushGetRequests(): void
  multiGet(keys: readonly string[], callback?: MultiGetCallback): Promise<readonly KeyValuePair[]>
  multiSet(keyValuePairs: ReadonlyArray<readonly [string, string]>, callback?: MultiCallback): Promise<void>
  multiRemove(keys: readonly string[], callback?: MultiCallback): Promise<void>
  multiMerge(keyValuePairs: ReadonlyArray<readonly [string, string]>, callback?: MultiCallback): Promise<void>
}

type PreviewStorageModule = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  mergeItem(key: string, value: string): Promise<void>
  clear(): Promise<void>
  getAllKeys(): Promise<string[]>
  multiGet(keys: string[]): Promise<KeyValuePair[]>
  multiSet(keyValuePairs: Array<[string, string]>): Promise<void>
  multiRemove(keys: string[]): Promise<void>
  multiMerge(keyValuePairs: Array<[string, string]>): Promise<void>
}

const nativeStorage = requireNativeModule<PreviewStorageModule>('RunWhalePreviewStorage')

function validateInput(key: unknown, value?: unknown, hasValue = false): void {
  if (typeof key !== 'string') {
    console.warn(`[AsyncStorage] Using ${typeof key} type for key is not supported. Use string instead.\nKey passed: ${String(key)}\n`)
  }
  if (!hasValue || typeof value === 'string') return
  if (value == null) {
    throw new Error(
      `[AsyncStorage] Passing null/undefined as value is not supported. If you want to remove a value, use .removeItem instead.\nPassed value: ${String(value)}\nPassed key: ${String(key)}\n`,
    )
  }
  console.warn(`[AsyncStorage] The value for key "${String(key)}" is not a string. Consider stringifying it.`)
}

function validatePairs(pairs: ReadonlyArray<readonly [string, string]>, callback: unknown): void {
  if (!Array.isArray(pairs) || pairs.length === 0 || !Array.isArray(pairs[0])) {
    throw new Error('[AsyncStorage] Expected array of key-value pairs as first argument to multiSet')
  }
  if (callback && typeof callback !== 'function') {
    throw new Error('[AsyncStorage] Expected function as second argument to multiSet')
  }
  for (const [key, value] of pairs) validateInput(key, value, true)
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function withCallback<T>(
  operation: Promise<T>,
  callback?: (error?: Error | null, result?: T) => void,
): Promise<T> {
  operation.then(
    (result) => callback?.(null, result),
    (error) => callback?.(normalizeError(error)),
  )
  return operation
}

function withVoidCallback(operation: Promise<void>, callback?: Callback): Promise<void> {
  operation.then(
    () => callback?.(null),
    (error) => callback?.(normalizeError(error)),
  )
  return operation
}

function withMultiCallback(operation: Promise<void>, callback?: MultiCallback): Promise<void> {
  return operation.then(
    () => {
      callback?.(null)
    },
    (error) => {
      const errors = [normalizeError(error)] as const
      callback?.(errors)
      return Promise.reject(errors)
    },
  )
}

const AsyncStorage: AsyncStorageStatic = {
  getItem(key, callback) {
    validateInput(key)
    return withCallback(nativeStorage.getItem(key), callback)
  },

  setItem(key, value, callback) {
    validateInput(key, value, true)
    return withVoidCallback(nativeStorage.setItem(key, value), callback)
  },

  removeItem(key, callback) {
    validateInput(key)
    return withVoidCallback(nativeStorage.removeItem(key), callback)
  },

  mergeItem(key, value, callback) {
    validateInput(key, value, true)
    return withVoidCallback(nativeStorage.mergeItem(key, value), callback)
  },

  clear(callback) {
    return withVoidCallback(nativeStorage.clear(), callback)
  },

  getAllKeys(callback) {
    return withCallback(nativeStorage.getAllKeys(), callback)
  },

  flushGetRequests() {},

  multiGet(keys, callback) {
    for (const key of keys) validateInput(key)
    const operation = nativeStorage.multiGet([...keys])
    operation.then(
      (result) => callback?.(null, result),
      (error) => callback?.([normalizeError(error)]),
    )
    return operation
  },

  multiSet(keyValuePairs, callback) {
    validatePairs(keyValuePairs, callback)
    return withMultiCallback(
      nativeStorage.multiSet(keyValuePairs.map(([key, value]) => [key, value])),
      callback,
    )
  },

  multiRemove(keys, callback) {
    for (const key of keys) validateInput(key)
    return withMultiCallback(nativeStorage.multiRemove([...keys]), callback)
  },

  multiMerge(keyValuePairs, callback) {
    validatePairs(keyValuePairs, callback)
    return withMultiCallback(
      nativeStorage.multiMerge(keyValuePairs.map(([key, value]) => [key, value])),
      callback,
    )
  },
}

export function useAsyncStorage(key: string): AsyncStorageHook {
  return {
    getItem: (callback) => AsyncStorage.getItem(key, callback),
    setItem: (value, callback) => AsyncStorage.setItem(key, value, callback),
    mergeItem: (value, callback) => AsyncStorage.mergeItem(key, value, callback),
    removeItem: (callback) => AsyncStorage.removeItem(key, callback),
  }
}

export default AsyncStorage
