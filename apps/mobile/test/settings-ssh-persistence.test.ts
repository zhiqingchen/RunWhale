import { describe, expect, it } from 'vitest'
import { generateAndPersistSshCredential, type SshCredentialPersistenceOperations } from '../src/utils/settings-ssh-persistence'

interface PersistenceHarness {
  operations: SshCredentialPersistenceOperations
  state(): { privateCredential: string | null; publicMetadata: string | null; runtimeCredential: string | null }
}

function persistenceHarness({
  privateCredential = null,
  publicMetadata = null,
  failPrivateWrite = false,
  failPublicWrite = false,
}: {
  privateCredential?: string | null
  publicMetadata?: string | null
  failPrivateWrite?: boolean
  failPublicWrite?: boolean
} = {}): PersistenceHarness {
  let durablePrivateCredential = privateCredential
  let durablePublicMetadata = publicMetadata
  let runtimeCredential = privateCredential
  let privateWritePendingFailure = failPrivateWrite
  let publicWritePendingFailure = failPublicWrite

  return {
    operations: {
      generate: async () => {
        runtimeCredential = 'private-next'
        return { privateKeyOneTime: 'private-next', publicKey: 'public-next', fingerprint: 'fingerprint-next' }
      },
      readPrivateCredential: async () => durablePrivateCredential,
      writePrivateCredential: async (value) => {
        durablePrivateCredential = value
        if (privateWritePendingFailure) {
          privateWritePendingFailure = false
          throw new Error('private persistence failed')
        }
      },
      deletePrivateCredential: async () => { durablePrivateCredential = null },
      readPublicMetadata: async () => durablePublicMetadata,
      writePublicMetadata: async (value) => {
        durablePublicMetadata = value
        if (publicWritePendingFailure) {
          publicWritePendingFailure = false
          throw new Error('metadata persistence failed')
        }
      },
      deletePublicMetadata: async () => { durablePublicMetadata = null },
      restoreRuntimeCredential: async (value) => { runtimeCredential = value },
    },
    state: () => ({ privateCredential: durablePrivateCredential, publicMetadata: durablePublicMetadata, runtimeCredential }),
  }
}

describe('Settings SSH credential persistence', () => {
  it('persists matching private and public state after generation', async () => {
    const harness = persistenceHarness()
    await expect(generateAndPersistSshCredential(harness.operations)).resolves.toEqual({
      publicKey: 'public-next',
      fingerprint: 'fingerprint-next',
    })
    expect(harness.state()).toEqual({
      privateCredential: 'private-next',
      publicMetadata: '{"publicKey":"public-next","fingerprint":"fingerprint-next"}',
      runtimeCredential: 'private-next',
    })
  })

  it('replaces public metadata whose private credential was missing', async () => {
    const harness = persistenceHarness({ publicMetadata: '{"publicKey":"public-before","fingerprint":"fingerprint-before"}' })
    await generateAndPersistSshCredential(harness.operations)
    expect(harness.state()).toEqual({
      privateCredential: 'private-next',
      publicMetadata: '{"publicKey":"public-next","fingerprint":"fingerprint-next"}',
      runtimeCredential: 'private-next',
    })
  })

  it('restores the prior durable and runtime state when metadata persistence fails', async () => {
    const previousMetadata = '{"publicKey":"public-before","fingerprint":"fingerprint-before"}'
    const harness = persistenceHarness({ privateCredential: 'private-before', publicMetadata: previousMetadata, failPublicWrite: true })
    await expect(generateAndPersistSshCredential(harness.operations)).rejects.toThrow('metadata persistence failed')
    expect(harness.state()).toEqual({
      privateCredential: 'private-before',
      publicMetadata: previousMetadata,
      runtimeCredential: 'private-before',
    })
  })

  it('clears every new credential artifact when no prior state existed', async () => {
    const harness = persistenceHarness({ failPublicWrite: true })
    await expect(generateAndPersistSshCredential(harness.operations)).rejects.toThrow('metadata persistence failed')
    expect(harness.state()).toEqual({ privateCredential: null, publicMetadata: null, runtimeCredential: null })
  })

  it('restores metadata-only state when replacement fails', async () => {
    const previousMetadata = '{"publicKey":"public-before","fingerprint":"fingerprint-before"}'
    const harness = persistenceHarness({ publicMetadata: previousMetadata, failPublicWrite: true })
    await expect(generateAndPersistSshCredential(harness.operations)).rejects.toThrow('metadata persistence failed')
    expect(harness.state()).toEqual({
      privateCredential: null,
      publicMetadata: previousMetadata,
      runtimeCredential: null,
    })
  })

  it('rolls back a partially applied private-credential write', async () => {
    const previousMetadata = '{"publicKey":"public-before","fingerprint":"fingerprint-before"}'
    const harness = persistenceHarness({ privateCredential: 'private-before', publicMetadata: previousMetadata, failPrivateWrite: true })
    await expect(generateAndPersistSshCredential(harness.operations)).rejects.toThrow('private persistence failed')
    expect(harness.state()).toEqual({
      privateCredential: 'private-before',
      publicMetadata: previousMetadata,
      runtimeCredential: 'private-before',
    })
  })
})
