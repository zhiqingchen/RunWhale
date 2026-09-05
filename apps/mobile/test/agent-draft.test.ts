import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendAgentPrompt, agentDraftDebounceMs, agentDraftProjectPrefix, agentDraftStorageKey, clearAgentDraftsForProject, createAgentDraftCoordinator, type AgentDraftStorage } from '../src/utils/agent-draft'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (cause?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function storageWith(overrides: Partial<AgentDraftStorage> = {}): AgentDraftStorage {
  return {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
    ...overrides,
  }
}

describe('Agent draft coordinator', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('appends Preview repair after a slow draft hydration and persists both messages', async () => {
    const read = deferred<string | null>()
    const setItem = vi.fn(async () => undefined)
    const coordinator = createAgentDraftCoordinator(storageWith({ getItem: () => read.promise, setItem }))
    let displayed = ''
    coordinator.beginHydration('draft-a', '', (value) => { displayed = value }, () => {
      coordinator.markEdited('draft-a')
      displayed = appendAgentPrompt(displayed, 'Fix this Preview error')
      coordinator.persistEdited('draft-a', displayed)
    })
    await vi.advanceTimersByTimeAsync(agentDraftDebounceMs)
    expect(displayed).toBe('')
    read.resolve('Keep my draft  ')
    await vi.advanceTimersByTimeAsync(agentDraftDebounceMs)
    await coordinator.flush()
    expect(displayed).toBe('Keep my draft\n\nFix this Preview error')
    expect(setItem).toHaveBeenCalledExactlyOnceWith('draft-a', displayed)
    expect(appendAgentPrompt('  ', 'Fix this Preview error')).toBe('Fix this Preview error')
  })

  it('appends to input typed during hydration and ignores a previous session readiness callback', async () => {
    const read = deferred<string | null>()
    const coordinator = createAgentDraftCoordinator(storageWith({ getItem: () => read.promise }))
    const staleReady = vi.fn()
    const release = coordinator.beginHydration('old-session', '', () => undefined, staleReady)
    release()
    let displayed = ''
    coordinator.beginHydration('current-session', '', (value) => { displayed = value }, () => {
      displayed = appendAgentPrompt(displayed, 'Fix Preview')
    })
    coordinator.markEdited('current-session')
    displayed = 'New input'
    read.resolve('Saved input')
    await vi.advanceTimersByTimeAsync(agentDraftDebounceMs)
    expect(staleReady).not.toHaveBeenCalled()
    expect(displayed).toBe('New input\n\nFix Preview')
  })

  it('keeps immediate input when a slow hydration resolves later', async () => {
    const read = deferred<string | null>()
    const setItem = vi.fn(async () => undefined)
    const coordinator = createAgentDraftCoordinator(storageWith({ getItem: () => read.promise, setItem }))
    let displayed = ''

    const release = coordinator.beginHydration('draft-a', 'initial prompt', (value) => { displayed = value })
    coordinator.markEdited('draft-a')
    displayed = 'typed before read'
    coordinator.persistEdited('draft-a', displayed)
    read.resolve('stale persisted value')
    await Promise.resolve()

    expect(displayed).toBe('typed before read')
    await vi.advanceTimersByTimeAsync(agentDraftDebounceMs)
    await coordinator.flush()
    expect(setItem).toHaveBeenCalledExactlyOnceWith('draft-a', 'typed before read')
    release()
  })

  it('does not persist a default blank while hydrating and keeps the initial prompt fallback', async () => {
    const blankRead = deferred<string | null>()
    const blankSetItem = vi.fn(async () => undefined)
    const blankCoordinator = createAgentDraftCoordinator(storageWith({ getItem: () => blankRead.promise, setItem: blankSetItem }))

    blankCoordinator.beginHydration('blank', '', () => undefined)
    await vi.advanceTimersByTimeAsync(agentDraftDebounceMs * 2)
    expect(blankSetItem).not.toHaveBeenCalled()
    blankRead.resolve(null)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(agentDraftDebounceMs)
    expect(blankSetItem).not.toHaveBeenCalled()

    const fallbackSetItem = vi.fn(async () => undefined)
    const fallbackCoordinator = createAgentDraftCoordinator(storageWith({ setItem: fallbackSetItem }))
    let displayed = ''
    fallbackCoordinator.beginHydration('fallback', 'seed prompt', (value) => { displayed = value })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(agentDraftDebounceMs)
    await fallbackCoordinator.flush()

    expect(displayed).toBe('seed prompt')
    expect(fallbackSetItem).toHaveBeenCalledExactlyOnceWith('fallback', 'seed prompt')
  })

  it('retains the first fallback across an activate-cleanup-activate cycle', async () => {
    const firstRead = deferred<string | null>()
    const secondRead = deferred<string | null>()
    const reads = [firstRead.promise, secondRead.promise]
    const coordinator = createAgentDraftCoordinator(storageWith({ getItem: () => reads.shift()! }))
    let displayed = ''

    const releaseFirst = coordinator.beginHydration('draft-a', 'initial prompt', (value) => { displayed = value })
    releaseFirst()
    coordinator.beginHydration('draft-a', '', (value) => { displayed = value })
    firstRead.resolve(null)
    secondRead.resolve(null)
    await Promise.resolve()

    expect(displayed).toBe('initial prompt')
  })

  it('does not overwrite storage with a fallback after a rejected read', async () => {
    const read = deferred<string | null>()
    const setItem = vi.fn(async () => undefined)
    const coordinator = createAgentDraftCoordinator(storageWith({ getItem: () => read.promise, setItem }))
    let displayed = ''

    coordinator.beginHydration('draft-a', 'initial prompt', (value) => { displayed = value })
    read.reject(new Error('storage temporarily unavailable'))
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(agentDraftDebounceMs)

    expect(displayed).toBe('initial prompt')
    expect(setItem).not.toHaveBeenCalled()

    coordinator.markEdited('draft-a')
    coordinator.persistEdited('draft-a', 'explicit edit')
    await vi.advanceTimersByTimeAsync(agentDraftDebounceMs)
    await coordinator.flush()
    expect(setItem).toHaveBeenCalledExactlyOnceWith('draft-a', 'explicit edit')
  })

  it('serializes slow writes and continues after a rejected write', async () => {
    const firstWrite = deferred<void>()
    const values: string[] = []
    const setItem = vi.fn(async (_key: string, value: string) => {
      values.push(value)
      if (value === 'first') await firstWrite.promise
    })
    const coordinator = createAgentDraftCoordinator(storageWith({ setItem }))
    coordinator.beginHydration('draft-a', '', () => undefined)
    await Promise.resolve()

    coordinator.markEdited('draft-a')
    coordinator.persistEdited('draft-a', 'first')
    await vi.advanceTimersByTimeAsync(agentDraftDebounceMs)
    coordinator.persistEdited('draft-a', 'second')
    await vi.advanceTimersByTimeAsync(agentDraftDebounceMs)
    expect(values).toEqual(['first'])

    firstWrite.reject(new Error('storage unavailable'))
    await coordinator.flush()
    expect(values).toEqual(['first', 'second'])

    coordinator.persistEdited('draft-a', 'third')
    await vi.advanceTimersByTimeAsync(agentDraftDebounceMs)
    await coordinator.flush()
    expect(values).toEqual(['first', 'second', 'third'])
  })

  it('isolates pending writes and late hydration across draft key switches', async () => {
    const firstRead = deferred<string | null>()
    const secondRead = deferred<string | null>()
    const writes: Array<[string, string]> = []
    const coordinator = createAgentDraftCoordinator(storageWith({
      getItem: (key) => key === 'draft-a' ? firstRead.promise : secondRead.promise,
      setItem: async (key, value) => { writes.push([key, value]) },
    }))
    let displayed = ''

    const releaseFirst = coordinator.beginHydration('draft-a', '', (value) => { displayed = value })
    coordinator.markEdited('draft-a')
    displayed = 'draft A edit'
    coordinator.persistEdited('draft-a', displayed)
    releaseFirst()
    const releaseSecond = coordinator.beginHydration('draft-b', '', (value) => { displayed = value })
    coordinator.persistEdited('draft-b', 'draft A edit')

    firstRead.resolve('late draft A')
    secondRead.resolve('stored draft B')
    await Promise.resolve()
    await coordinator.flush()

    expect(displayed).toBe('stored draft B')
    expect(writes).toEqual([['draft-a', 'draft A edit']])

    coordinator.markEdited('draft-b')
    coordinator.persistEdited('draft-b', 'draft B edit')
    await vi.advanceTimersByTimeAsync(agentDraftDebounceMs)
    await coordinator.flush()
    expect(writes).toEqual([['draft-a', 'draft A edit'], ['draft-b', 'draft B edit']])
    releaseSecond()
  })

  it('orders submit cleanup after an in-flight write', async () => {
    const slowWrite = deferred<void>()
    const operations: string[] = []
    const coordinator = createAgentDraftCoordinator(storageWith({
      setItem: async () => {
        operations.push('set')
        await slowWrite.promise
      },
      removeItem: async () => { operations.push('remove') },
    }))
    coordinator.beginHydration('draft-a', '', () => undefined)
    await Promise.resolve()
    coordinator.markEdited('draft-a')
    coordinator.persistEdited('draft-a', 'submitted prompt')
    await vi.advanceTimersByTimeAsync(agentDraftDebounceMs)

    const cleared = coordinator.clear('draft-a')
    expect(operations).toEqual(['set'])
    slowWrite.resolve()
    await cleared
    expect(operations).toEqual(['set', 'remove'])
  })

  it('recovers from rejected cleanup and accepts a later explicit edit', async () => {
    const setItem = vi.fn(async () => undefined)
    const coordinator = createAgentDraftCoordinator(storageWith({
      setItem,
      removeItem: async () => { throw new Error('storage temporarily unavailable') },
    }))
    coordinator.beginHydration('draft-a', '', () => undefined)
    await Promise.resolve()

    await expect(coordinator.clear('draft-a')).resolves.toBeUndefined()
    coordinator.markEdited('draft-a')
    coordinator.persistEdited('draft-a', 'edit after failed cleanup')
    await vi.advanceTimersByTimeAsync(agentDraftDebounceMs)
    await coordinator.flush()

    expect(setItem).toHaveBeenCalledExactlyOnceWith('draft-a', 'edit after failed cleanup')
  })
})

describe('project Agent draft cleanup', () => {
  it('removes every target-project draft without matching neighboring prefixes', async () => {
    const multiRemove = vi.fn(async () => undefined)
    await clearAgentDraftsForProject({
      getAllKeys: async () => [
        agentDraftStorageKey('project-one'),
        agentDraftStorageKey('project-one', 'session-a'),
        agentDraftStorageKey('project-one-more', 'session-b'),
        'runwhale.projects.v1',
      ],
      multiRemove,
    }, 'project-one')

    expect(agentDraftProjectPrefix('project-one')).toBe('runwhale.agent-draft.v1:project-one:')
    expect(multiRemove).toHaveBeenCalledExactlyOnceWith([
      'runwhale.agent-draft.v1:project-one:new',
      'runwhale.agent-draft.v1:project-one:session-a',
    ])
  })

  it('is idempotent when the project has no drafts', async () => {
    const multiRemove = vi.fn(async () => undefined)
    await clearAgentDraftsForProject({ getAllKeys: async () => ['runwhale.projects.v1'], multiRemove }, 'missing')
    expect(multiRemove).not.toHaveBeenCalled()
  })

  it('propagates storage failures so project deletion remains retryable', async () => {
    await expect(clearAgentDraftsForProject({
      getAllKeys: async () => [agentDraftStorageKey('project-one')],
      multiRemove: async () => { throw new Error('storage unavailable') },
    }, 'project-one')).rejects.toThrow('storage unavailable')
  })
})
