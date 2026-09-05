import { describe, expect, it, vi } from 'vitest'
import { createPreferenceStorageCoordinator, type PreferencePersistenceFailure } from '../src/utils/preference-storage'

describe('preference storage coordination', () => {
  it('applies untouched hydration without surfacing read failures', async () => {
    const apply = vi.fn()
    const persistence = createPreferenceStorageCoordinator()

    await expect(persistence.hydrate(() => Promise.resolve('saved'), apply)).resolves.toBeUndefined()
    expect(apply).toHaveBeenCalledWith('saved')

    await expect(persistence.hydrate(() => Promise.reject(new Error('storage unavailable')), apply)).resolves.toBeUndefined()
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('does not let late hydration overwrite an immediate user update', async () => {
    let resolveRead!: (value: string | null) => void
    const apply = vi.fn()
    const write = vi.fn(() => Promise.resolve())
    const persistence = createPreferenceStorageCoordinator()
    const hydration = persistence.hydrate(() => new Promise<string | null>((resolve) => { resolveRead = resolve }), apply)

    await Promise.resolve()
    const update = persistence.persist('user-choice', write)
    resolveRead('stale-saved-choice')
    await Promise.all([hydration, update])

    expect(apply).not.toHaveBeenCalled()
    expect(write).toHaveBeenCalledWith('user-choice')
  })

  it('serializes writes and lets each caller observe its own rejection', async () => {
    let rejectFirst!: (cause: Error) => void
    const values: string[] = []
    const write = vi.fn((value: string) => {
      values.push(value)
      if (value === 'older') return new Promise<void>((_resolve, reject) => { rejectFirst = reject })
      return Promise.resolve()
    })
    const persistence = createPreferenceStorageCoordinator()
    const older = persistence.persist('older', write)
    const newer = persistence.persist('newer', write)

    await Promise.resolve()
    expect(values).toEqual(['older'])
    rejectFirst(new Error('write failed'))
    await expect(older).rejects.toThrow('write failed')
    await expect(newer).resolves.toBeUndefined()
    expect(values).toEqual(['older', 'newer'])
  })

  it('reports a rejected latest write', async () => {
    const changes: Array<PreferencePersistenceFailure | undefined> = []
    const persistence = createPreferenceStorageCoordinator((failure) => changes.push(failure))

    await expect(persistence.persist('latest', async () => {
      throw new Error('device storage unavailable')
    })).rejects.toThrow('device storage unavailable')

    expect(changes).toEqual([{ revision: 1, message: 'device storage unavailable' }])
  })

  it('does not publish a stale failure when a newer queued write succeeds', async () => {
    const changes: Array<PreferencePersistenceFailure | undefined> = []
    const write = vi.fn()
      .mockRejectedValueOnce(new Error('older write failed'))
      .mockResolvedValueOnce(undefined)
    const persistence = createPreferenceStorageCoordinator((failure) => changes.push(failure))

    const older = persistence.persist('older', write)
    const newer = persistence.persist('newer', write)

    await expect(older).rejects.toThrow('older write failed')
    await expect(newer).resolves.toBeUndefined()
    expect(changes).toEqual([undefined])
  })

  it('keeps failure visible while retrying and retries only the exact latest snapshot', async () => {
    const changes: Array<PreferencePersistenceFailure | undefined> = []
    let rejectRetry!: (cause: Error) => void
    const write = vi.fn()
      .mockRejectedValueOnce(new Error('older snapshot failed'))
      .mockRejectedValueOnce(new Error('latest snapshot failed'))
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectRetry = reject }))
      .mockResolvedValueOnce(undefined)
    const persistence = createPreferenceStorageCoordinator((failure) => changes.push(failure))

    await expect(persistence.persist('older', write)).rejects.toThrow('older snapshot failed')
    await expect(persistence.persist('latest', write)).rejects.toThrow('latest snapshot failed')
    expect(changes.at(-1)).toEqual({ revision: 2, message: 'latest snapshot failed' })

    const failedRetry = persistence.retryLatest()
    await Promise.resolve()
    expect(changes.at(-1)).toEqual({ revision: 2, message: 'latest snapshot failed' })
    rejectRetry(new Error('retry failed'))
    await expect(failedRetry).rejects.toThrow('retry failed')
    expect(changes.at(-1)).toEqual({ revision: 3, message: 'retry failed' })

    await expect(persistence.retryLatest()).resolves.toBeUndefined()
    expect(changes.at(-1)).toBeUndefined()
    expect(write.mock.calls.map(([value]) => value)).toEqual(['older', 'latest', 'latest', 'latest'])
  })

  it('lets a new user update suppress a stale retry failure', async () => {
    const changes: Array<PreferencePersistenceFailure | undefined> = []
    const values: string[] = []
    let rejectRetry!: (cause: Error) => void
    let resolveNewer!: () => void
    let call = 0
    const write = vi.fn((value: string) => {
      values.push(value)
      call += 1
      if (call === 1) return Promise.reject(new Error('initial failure'))
      if (call === 2) return new Promise<void>((_resolve, reject) => { rejectRetry = reject })
      return new Promise<void>((resolve) => { resolveNewer = resolve })
    })
    const persistence = createPreferenceStorageCoordinator((failure) => changes.push(failure))

    await expect(persistence.persist('older', write)).rejects.toThrow('initial failure')
    const retry = persistence.retryLatest()
    await Promise.resolve()
    const newer = persistence.persist('newer', write)
    rejectRetry(new Error('stale retry failed'))

    await expect(retry).rejects.toThrow('stale retry failed')
    expect(changes).toEqual([{ revision: 1, message: 'initial failure' }])
    resolveNewer()
    await expect(newer).resolves.toBeUndefined()
    expect(changes.at(-1)).toBeUndefined()
    expect(values).toEqual(['older', 'older', 'newer'])
  })

  it('treats retry before the first write as a no-op', async () => {
    const onFailureChange = vi.fn()
    const persistence = createPreferenceStorageCoordinator(onFailureChange)

    await expect(persistence.retryLatest()).resolves.toBeUndefined()
    expect(onFailureChange).not.toHaveBeenCalled()
  })

  it('does not treat retrying a saved choice as a new user revision', async () => {
    let resolveRead!: (value: string | null) => void
    const apply = vi.fn()
    const write = vi.fn(() => Promise.resolve())
    const persistence = createPreferenceStorageCoordinator()

    await persistence.persist('choice', write)
    const hydration = persistence.hydrate(() => new Promise<string | null>((resolve) => { resolveRead = resolve }), apply)
    await Promise.resolve()
    await persistence.retryLatest()
    resolveRead('saved')
    await hydration

    expect(apply).toHaveBeenCalledWith('saved')
    expect(write).toHaveBeenCalledTimes(2)
  })
})
