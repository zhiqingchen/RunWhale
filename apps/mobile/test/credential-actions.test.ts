import { describe, expect, it, vi } from 'vitest'
import { CredentialActivationError, CredentialRemovalError, isProviderCredentialInputValid, removeCredential, saveCredential } from '../src/utils/credential-actions'

describe('credential settings actions', () => {
  it('persists a credential before activating it in the local runtime', async () => {
    const calls: string[] = []
    await saveCredential({
      value: '  test-provider-secret  ',
      persist: async (value) => { calls.push(`persist:${value}`) },
      activate: async (value) => { calls.push(`activate:${value}`) },
    })
    expect(calls).toEqual(['persist:test-provider-secret', 'activate:test-provider-secret'])
  })

  it.each([
    ['blank', '   '],
    ['short', 'short'],
    ['multiline', 'valid-key\nsecond-line'],
    ['oversized', 'x'.repeat(8_193)],
  ])('rejects %s credentials before persistence or activation', async (_case, value) => {
    const persist = vi.fn<(value: string) => Promise<void>>()
    const activate = vi.fn<(value: string) => Promise<void>>()
    expect(isProviderCredentialInputValid(value)).toBe(false)
    await expect(saveCredential({ value, persist, activate })).rejects.toThrow('credential is invalid')
    expect(persist).not.toHaveBeenCalled()
    expect(activate).not.toHaveBeenCalled()
  })

  it('accepts a structurally valid credential after trimming', () => {
    expect(isProviderCredentialInputValid('  valid-key  ')).toBe(true)
  })

  it('does not send a credential to the runtime when secure persistence fails', async () => {
    const activate = vi.fn()
    await expect(saveCredential({
      value: 'test-provider-secret',
      persist: async () => { throw new Error('secure store unavailable') },
      activate,
    })).rejects.toThrow('secure store unavailable')
    expect(activate).not.toHaveBeenCalled()
  })

  it('reports activation separately without exposing the credential', async () => {
    const secret = 'test-provider-secret'
    let failure: unknown
    try {
      await saveCredential({
        value: secret,
        persist: async () => undefined,
        activate: async () => { throw new Error('runtime unavailable') },
      })
    } catch (cause) {
      failure = cause
    }
    expect(failure).toBeInstanceOf(CredentialActivationError)
    expect(String(failure)).not.toContain(secret)
  })

  it('deactivates a credential before removing its durable copy', async () => {
    const calls: string[] = []
    await removeCredential({
      deactivate: async () => { calls.push('deactivate') },
      remove: async () => { calls.push('remove') },
    })
    expect(calls).toEqual(['deactivate', 'remove'])
  })

  it('still removes the durable copy when runtime deactivation fails', async () => {
    const remove = vi.fn(async () => undefined)
    let failure: unknown
    try {
      await removeCredential({
        deactivate: async () => { throw new Error('runtime unavailable') },
        remove,
      })
    } catch (cause) {
      failure = cause
    }
    expect(remove).toHaveBeenCalledOnce()
    expect(failure).toBeInstanceOf(CredentialRemovalError)
    expect((failure as CredentialRemovalError).durableRemovalFailed).toBe(false)
  })

  it('reports a durable removal failure separately', async () => {
    let failure: unknown
    try {
      await removeCredential({
        deactivate: async () => undefined,
        remove: async () => { throw new Error('secure store unavailable') },
      })
    } catch (cause) {
      failure = cause
    }
    expect(failure).toBeInstanceOf(CredentialRemovalError)
    expect((failure as CredentialRemovalError).durableRemovalFailed).toBe(true)
  })

  it('attempts durable removal even when both removal steps fail', async () => {
    const remove = vi.fn(async () => { throw new Error('secure store unavailable') })
    await expect(removeCredential({
      deactivate: async () => { throw new Error('runtime unavailable') },
      remove,
    })).rejects.toMatchObject({ durableRemovalFailed: true })
    expect(remove).toHaveBeenCalledOnce()
  })
})
