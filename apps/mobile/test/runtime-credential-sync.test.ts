import { describe, expect, it, vi } from 'vitest'
import { RUNTIME_CREDENTIAL_PROVIDERS, synchronizeRuntimeCredentials } from '../src/utils/runtime-credential-sync'

interface SyncHarnessOptions {
  active?: () => boolean
  providerValues?: ReadonlyMap<string, string | null>
  sshValue?: string | null
}

function syncHarness({ active = () => true, providerValues = new Map(), sshValue = null }: SyncHarnessOptions = {}) {
  const setProvider = vi.fn(async (): Promise<void> => undefined)
  const deleteProvider = vi.fn(async (): Promise<void> => undefined)
  const setSsh = vi.fn(async (): Promise<void> => undefined)
  const deleteSsh = vi.fn(async (): Promise<void> => undefined)
  const onSynchronized = vi.fn(async (): Promise<void> => undefined)
  return {
    operations: {
      isActive: active,
      readProvider: vi.fn(async (provider: string) => providerValues.get(provider) ?? null),
      setProvider,
      deleteProvider,
      readSsh: vi.fn(async () => sshValue),
      setSsh,
      deleteSsh,
      onSynchronized,
    },
    setProvider,
    deleteProvider,
    setSsh,
    deleteSsh,
    onSynchronized,
  }
}

describe('runtime credential synchronization', () => {
  it('sets present providers and actively deletes absent credentials', async () => {
    const harness = syncHarness({
      providerValues: new Map([['deepseek', 'deepseek-secret'], ['anthropic', '   ']]),
    })

    await synchronizeRuntimeCredentials(harness.operations)

    expect(harness.setProvider).toHaveBeenCalledWith('deepseek', 'deepseek-secret')
    expect(harness.deleteProvider.mock.calls).toEqual([['openai'], ['anthropic'], ['google']])
    expect(harness.setSsh).not.toHaveBeenCalled()
    expect(harness.deleteSsh).toHaveBeenCalledOnce()
    expect(harness.onSynchronized).toHaveBeenCalledWith([])
  })

  it('isolates provider failures and still synchronizes SSH', async () => {
    const attempted: string[] = []
    const secret = 'must-not-escape'
    const onSynchronized = vi.fn(async () => undefined)

    await synchronizeRuntimeCredentials({
      isActive: () => true,
      readProvider: async (provider) => {
        attempted.push(`read:${provider}`)
        if (provider === 'deepseek') throw new Error(secret)
        return `${provider}-secret`
      },
      setProvider: async (provider) => {
        attempted.push(`set:${provider}`)
        if (provider === 'openai') throw new Error(secret)
      },
      deleteProvider: async (provider) => { attempted.push(`delete:${provider}`) },
      readSsh: async () => {
        attempted.push('read:ssh')
        return 'ssh-secret'
      },
      setSsh: async () => { attempted.push('set:ssh') },
      deleteSsh: async () => { attempted.push('delete:ssh') },
      onSynchronized,
    })

    expect(attempted).toEqual([
      'read:deepseek',
      'read:openai',
      'set:openai',
      'read:anthropic',
      'set:anthropic',
      'read:google',
      'set:google',
      'read:ssh',
      'set:ssh',
    ])
    expect(onSynchronized).toHaveBeenCalledWith(['deepseek', 'openai'])
    expect(JSON.stringify(onSynchronized.mock.calls)).not.toContain(secret)
  })

  it('continues after an absent provider cannot be deleted', async () => {
    const attempted: string[] = []
    const onSynchronized = vi.fn(async () => undefined)
    await synchronizeRuntimeCredentials({
      isActive: () => true,
      readProvider: async (provider) => { attempted.push(`read:${provider}`); return null },
      setProvider: async () => undefined,
      deleteProvider: async (provider) => {
        attempted.push(`delete:${provider}`)
        if (provider === 'deepseek') throw new Error('delete failed')
      },
      readSsh: async () => null,
      setSsh: async () => undefined,
      deleteSsh: async () => { attempted.push('delete:ssh') },
      onSynchronized,
    })

    expect(attempted).toEqual([
      'read:deepseek', 'delete:deepseek',
      'read:openai', 'delete:openai',
      'read:anthropic', 'delete:anthropic',
      'read:google', 'delete:google',
      'delete:ssh',
    ])
    expect(onSynchronized).toHaveBeenCalledWith(['deepseek'])
  })

  it.each(['read', 'set', 'delete'] as const)('isolates an SSH %s failure without retaining private material', async (failure) => {
    const secret = 'private-material'
    const onSynchronized = vi.fn(async () => undefined)
    await synchronizeRuntimeCredentials({
      isActive: () => true,
      readProvider: async () => null,
      setProvider: async () => undefined,
      deleteProvider: async () => undefined,
      readSsh: async () => {
        if (failure === 'read') throw new Error(secret)
        return failure === 'delete' ? null : secret
      },
      setSsh: async () => {
        if (failure === 'set') throw new Error(secret)
      },
      deleteSsh: async () => {
        if (failure === 'delete') throw new Error(secret)
      },
      onSynchronized,
    })

    expect(onSynchronized).toHaveBeenCalledWith(['ssh'])
    expect(RUNTIME_CREDENTIAL_PROVIDERS).toHaveLength(4)
    expect(JSON.stringify(onSynchronized.mock.calls)).not.toContain(secret)
  })

  it('does not cross the completion barrier while the final mutation is pending', async () => {
    const pending = deferred<void>()
    const harness = syncHarness({ sshValue: 'ssh-secret' })
    harness.operations.setSsh.mockImplementation(async () => pending.promise)

    const synchronizing = synchronizeRuntimeCredentials(harness.operations)
    await vi.waitFor(() => expect(harness.setSsh).toHaveBeenCalledOnce())
    expect(harness.onSynchronized).not.toHaveBeenCalled()

    pending.resolve()
    await synchronizing
    expect(harness.onSynchronized).toHaveBeenCalledWith([])
  })

  it('propagates final host validation failures beyond the credential warning path', async () => {
    const harness = syncHarness()
    harness.operations.onSynchronized.mockRejectedValueOnce(new Error('host no longer answers'))

    await expect(synchronizeRuntimeCredentials(harness.operations)).rejects.toThrow('host no longer answers')
    expect(harness.onSynchronized).toHaveBeenCalledWith([])
  })

  it('suppresses a final validation rejection after cancellation', async () => {
    let active = true
    const pending = deferred<void>()
    const harness = syncHarness({ active: () => active })
    harness.operations.onSynchronized.mockImplementationOnce(async () => pending.promise)

    const synchronizing = synchronizeRuntimeCredentials(harness.operations)
    await vi.waitFor(() => expect(harness.onSynchronized).toHaveBeenCalledOnce())
    active = false
    pending.reject(new Error('stale host rejection'))

    await expect(synchronizing).resolves.toBeUndefined()
  })

  it('stops before mutation when cancelled during a credential read', async () => {
    let active = true
    const pending = deferred<string | null>()
    const harness = syncHarness({ active: () => active })
    harness.operations.readProvider.mockImplementationOnce(async () => pending.promise)

    const synchronizing = synchronizeRuntimeCredentials(harness.operations)
    active = false
    pending.resolve('deepseek-secret')
    await synchronizing

    expect(harness.setProvider).not.toHaveBeenCalled()
    expect(harness.operations.readSsh).not.toHaveBeenCalled()
    expect(harness.onSynchronized).not.toHaveBeenCalled()
  })

  it('stops later work and publication when cancelled during a mutation', async () => {
    let active = true
    const pending = deferred<void>()
    const harness = syncHarness({ active: () => active, providerValues: new Map([['deepseek', 'deepseek-secret']]) })
    harness.operations.setProvider.mockImplementationOnce(async () => pending.promise)

    const synchronizing = synchronizeRuntimeCredentials(harness.operations)
    await vi.waitFor(() => expect(harness.setProvider).toHaveBeenCalledOnce())
    active = false
    pending.resolve()
    await synchronizing

    expect(harness.operations.readProvider).toHaveBeenCalledTimes(1)
    expect(harness.operations.readSsh).not.toHaveBeenCalled()
    expect(harness.onSynchronized).not.toHaveBeenCalled()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
