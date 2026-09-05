export interface PreferencePersistenceFailure {
  revision: number
  message: string
}

export interface PreferenceStorageCoordinator {
  hydrate(read: () => Promise<string | null>, apply: (value: string | null) => void): Promise<void>
  persist(value: string, write: (value: string) => Promise<void>): Promise<void>
  retryLatest(): Promise<void>
}

interface PreferencePersistenceSnapshot {
  value: string
  write(value: string): Promise<void>
}

export function createPreferenceStorageCoordinator(
  onFailureChange: (failure?: PreferencePersistenceFailure) => void = () => undefined,
): PreferenceStorageCoordinator {
  let userRevision = 0
  let writeRevision = 0
  let writeTail = Promise.resolve()
  let latestSnapshot: PreferencePersistenceSnapshot | undefined

  const enqueue = (snapshot: PreferencePersistenceSnapshot) => {
    const revision = ++writeRevision
    const request = writeTail.then(() => snapshot.write(snapshot.value))
    writeTail = request.catch(() => undefined)
    return request.then(
      () => {
        if (revision === writeRevision) onFailureChange(undefined)
      },
      (cause: unknown) => {
        if (revision === writeRevision) {
          onFailureChange({ revision, message: cause instanceof Error ? cause.message : String(cause) })
        }
        throw cause
      },
    )
  }

  return {
    hydrate(read, apply) {
      const revisionAtStart = userRevision
      return Promise.resolve()
        .then(read)
        .then((value) => {
          if (revisionAtStart === userRevision) apply(value)
        })
        .catch(() => undefined)
    },
    persist(value, write) {
      userRevision += 1
      latestSnapshot = { value, write }
      return enqueue(latestSnapshot)
    },
    retryLatest() {
      return latestSnapshot ? enqueue(latestSnapshot) : Promise.resolve()
    },
  }
}
