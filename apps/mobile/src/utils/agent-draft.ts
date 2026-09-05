export const agentDraftDebounceMs = 180
export const agentDraftStoragePrefix = 'runwhale.agent-draft.v1:'

export function agentDraftStorageKey(projectId: string, sessionId?: string): string {
  return `${agentDraftStoragePrefix}${projectId}:${sessionId ?? 'new'}`
}

export function appendAgentPrompt(draft: string, message: string): string {
  return draft.trim() ? `${draft.trimEnd()}\n\n${message}` : message
}

export function agentDraftProjectPrefix(projectId: string): string {
  return `${agentDraftStoragePrefix}${projectId}:`
}

export interface AgentDraftProjectStorage {
  getAllKeys(): Promise<readonly string[]>
  multiRemove(keys: readonly string[]): Promise<void>
}

export async function clearAgentDraftsForProject(storage: AgentDraftProjectStorage, projectId: string): Promise<void> {
  const prefix = agentDraftProjectPrefix(projectId)
  const keys = (await storage.getAllKeys()).filter((key) => key.startsWith(prefix))
  if (keys.length > 0) await storage.multiRemove(keys)
}

export interface AgentDraftStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export interface AgentDraftCoordinator {
  beginHydration(key: string, fallback: string, apply: (value: string) => void, onReady?: () => void): () => void
  markEdited(key: string): void
  persistEdited(key: string, value: string): void
  clear(key: string): Promise<void>
  flush(): Promise<void>
}

interface ActiveDraft {
  id: number
  key: string
  hydrationStarted: boolean
  hydrationInvalidated: boolean
  edited: boolean
}

interface PendingDraftWrite {
  key: string
  value: string
  timer: ReturnType<typeof setTimeout>
}

export function createAgentDraftCoordinator(
  storage: AgentDraftStorage,
  debounceMs = agentDraftDebounceMs,
): AgentDraftCoordinator {
  let nextId = 0
  let active: ActiveDraft | undefined
  let pendingWrite: PendingDraftWrite | undefined
  let writeTail = Promise.resolve()
  let latestFallback: { key: string; value: string } | undefined

  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const result = writeTail.then(operation)
    writeTail = result.catch(() => undefined)
    return writeTail
  }

  const dispatchPendingWrite = (): void => {
    if (!pendingWrite) return
    const { key, value, timer } = pendingWrite
    pendingWrite = undefined
    clearTimeout(timer)
    void enqueue(() => storage.setItem(key, value))
  }

  const scheduleWrite = (key: string, value: string): void => {
    if (pendingWrite) {
      clearTimeout(pendingWrite.timer)
      pendingWrite = undefined
    }
    const timer = setTimeout(() => {
      if (pendingWrite?.timer !== timer) return
      dispatchPendingWrite()
    }, debounceMs)
    pendingWrite = { key, value, timer }
  }

  const activate = (key: string): ActiveDraft => {
    if (active?.key === key) return active
    dispatchPendingWrite()
    nextId += 1
    active = {
      id: nextId,
      key,
      hydrationStarted: false,
      hydrationInvalidated: false,
      edited: false,
    }
    return active
  }

  return {
    beginHydration(key, fallback, apply, onReady) {
      if (latestFallback?.key !== key || fallback) latestFallback = { key, value: fallback }
      const currentFallback = latestFallback.value
      const draft = activate(key)
      const id = draft.id
      if (!draft.hydrationStarted) {
        draft.hydrationStarted = true
        if (!draft.hydrationInvalidated) apply(currentFallback)
        const finish = (stored: string | null): void => {
          if (active?.id !== id || active.hydrationInvalidated) return
          const value = stored ?? currentFallback
          apply(value)
          if (stored === null && value) scheduleWrite(key, value)
        }
        void Promise.resolve().then(() => storage.getItem(key)).then(finish, () => undefined).then(() => {
          if (active?.id === id) onReady?.()
        })
      }
      return () => {
        if (active?.id !== id) return
        dispatchPendingWrite()
        active = undefined
      }
    },
    markEdited(key) {
      const draft = activate(key)
      draft.hydrationInvalidated = true
      draft.edited = true
    },
    persistEdited(key, value) {
      if (active?.key !== key || !active.edited) return
      scheduleWrite(key, value)
    },
    clear(key) {
      if (latestFallback?.key === key) latestFallback = { key, value: '' }
      if (active?.key === key) {
        active.hydrationInvalidated = true
        active.edited = false
      }
      if (pendingWrite?.key === key) {
        clearTimeout(pendingWrite.timer)
        pendingWrite = undefined
      }
      return enqueue(() => storage.removeItem(key))
    },
    flush() {
      dispatchPendingWrite()
      return writeTail
    },
  }
}
