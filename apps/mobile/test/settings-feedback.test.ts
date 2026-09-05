import { describe, expect, it, vi } from 'vitest'
import { actionErrorPresentation } from '../src/utils/action-progress'
import { createSshOperationGate, isSshPrivateCredentialMissing, isSshSecureStorageRetryable, loadSshPublicMetadata, loadSshSettingsStorage, parseSshPublicMetadata, probeSshSecureStorage, settingsDestructiveActionContract, sshCopyPresentation, sshOperationAvailability, sshSettingsSummaryState, sshUnavailableFeedbackPresentation } from '../src/utils/settings-feedback'

describe('Settings feedback contract', () => {
  it('requires destructive AppDialog actions for API key removal and SSH key rotation', () => {
    expect(settingsDestructiveActionContract.apiKeyRemoval).toEqual({
      dialogTestID: 'settings-api-key-removal-dialog',
      actionTestID: 'settings-api-key-removal-confirm',
      tone: 'danger',
    })
    expect(settingsDestructiveActionContract.sshKeyRotation).toEqual({
      dialogTestID: 'settings-ssh-key-rotation-dialog',
      actionTestID: 'settings-ssh-key-rotation-confirm',
      tone: 'danger',
    })
  })

  it('distinguishes a missing SSH key from unreadable metadata', async () => {
    await expect(loadSshPublicMetadata(async () => null)).resolves.toEqual({ status: 'unconfigured' })
    await expect(loadSshPublicMetadata(async () => { throw new Error('storage unavailable') })).resolves.toEqual({ status: 'failed' })
    expect(parseSshPublicMetadata('{"publicKey":42}')).toEqual({ status: 'failed' })
  })

  it('returns complete public metadata without exposing private credentials', () => {
    expect(parseSshPublicMetadata(JSON.stringify({ publicKey: 'ssh-ed25519 public-material', fingerprint: 'SHA256:fingerprint', privateKey: 'private-material' }))).toEqual({
      status: 'configured',
      publicKey: 'ssh-ed25519 public-material',
      fingerprint: 'SHA256:fingerprint',
    })
  })

  it('explains why SSH generation and rotation are unavailable', () => {
    expect(sshOperationAvailability({ status: 'loading' }, true)).toEqual({ available: false, unavailableReason: 'secure-storage-loading' })
    expect(sshOperationAvailability({ status: 'failed' }, true)).toEqual({ available: false, unavailableReason: 'secure-storage-failed' })
    expect(sshOperationAvailability({ status: 'unavailable' }, true)).toEqual({ available: false, unavailableReason: 'secure-storage-unavailable' })
    expect(sshOperationAvailability({ status: 'available', credentialPresent: false }, false)).toEqual({ available: false, unavailableReason: 'runtime' })
    expect(sshOperationAvailability({ status: 'available', credentialPresent: false }, true)).toEqual({ available: true })
  })

  it('presents secure-storage access failures as errors without collapsing expected SSH gating', () => {
    const failed = sshUnavailableFeedbackPresentation({ available: false, unavailableReason: 'secure-storage-failed' })
    expect(failed).toEqual({
      messageKey: 'sshSecureStorageAccessFailed',
      alert: actionErrorPresentation,
    })
    expect(failed?.alert).toBe(actionErrorPresentation)

    expect(sshUnavailableFeedbackPresentation({ available: false, unavailableReason: 'secure-storage-unavailable' })).toEqual({
      messageKey: 'sshSecureStorageRequired',
      alert: {
        accessibilityRole: 'alert',
        accessibilityLiveRegion: 'polite',
        status: 'warning',
      },
    })
    expect(sshUnavailableFeedbackPresentation({ available: false, unavailableReason: 'runtime' })).toMatchObject({
      messageKey: 'sshRuntimeRequired',
      alert: { accessibilityLiveRegion: 'polite', status: 'warning' },
    })
    expect(sshUnavailableFeedbackPresentation({ available: false, unavailableReason: 'secure-storage-loading' })).toBeUndefined()
  })

  it('retries native probe failures but not permanent platform unavailability', () => {
    expect(isSshSecureStorageRetryable({ status: 'failed' })).toBe(true)
    expect(isSshSecureStorageRetryable({ status: 'unavailable' })).toBe(false)
    expect(isSshSecureStorageRetryable({ status: 'loading' })).toBe(false)
    expect(isSshSecureStorageRetryable({ status: 'available', credentialPresent: false })).toBe(false)
  })

  it('probes secure storage without exposing stored credentials', async () => {
    const readMissing = vi.fn(async () => null)
    const readPresent = vi.fn(async () => 'private-material')

    await expect(probeSshSecureStorage(readMissing)).resolves.toEqual({ status: 'available', credentialPresent: false })
    const present = await probeSshSecureStorage(readPresent)
    expect(present).toEqual({ status: 'available', credentialPresent: true })
    expect(JSON.stringify(present)).not.toContain('private-material')
    await expect(probeSshSecureStorage(async () => { throw new Error('keychain denied') })).resolves.toEqual({ status: 'failed' })
    expect(readMissing).toHaveBeenCalledOnce()
    expect(readPresent).toHaveBeenCalledOnce()
  })

  it('detects public metadata whose private credential is missing', async () => {
    const metadata = { status: 'configured', publicKey: 'public-material', fingerprint: 'SHA256:fingerprint' } as const

    expect(isSshPrivateCredentialMissing(metadata, { status: 'available', credentialPresent: false })).toBe(true)
    expect(isSshPrivateCredentialMissing(metadata, { status: 'available', credentialPresent: true })).toBe(false)
    expect(isSshPrivateCredentialMissing(metadata, { status: 'failed' })).toBe(false)
    expect(isSshPrivateCredentialMissing({ status: 'unconfigured' }, { status: 'available', credentialPresent: false })).toBe(false)

    await expect(loadSshSettingsStorage(async () => JSON.stringify(metadata), async () => null)).resolves.toEqual({
      metadata,
      secureStorage: { status: 'available', credentialPresent: false },
    })
    await expect(loadSshSettingsStorage(async () => null)).resolves.toEqual({
      metadata: { status: 'unconfigured' },
      secureStorage: { status: 'unavailable' },
    })
  })

  it('never summarizes metadata without its private credential as configured', () => {
    const metadata = { status: 'configured', publicKey: 'public-material', fingerprint: 'SHA256:fingerprint' } as const

    expect(sshSettingsSummaryState({ metadata, secureStorage: { status: 'available', credentialPresent: false } })).toBe('needs-attention')
    expect(sshSettingsSummaryState({ metadata, secureStorage: { status: 'available', credentialPresent: true } })).toBe('configured')
    expect(sshSettingsSummaryState({ metadata, secureStorage: { status: 'failed' } })).toBe('failed')
    expect(sshSettingsSummaryState({ metadata, secureStorage: { status: 'unavailable' } })).toBe('unconfigured')
    expect(sshSettingsSummaryState({ metadata: { status: 'unconfigured' }, secureStorage: { status: 'available', credentialPresent: true } })).toBe('unconfigured')
  })

  it('presents SSH public-key copy progress, success, and failure consistently', () => {
    expect(sshCopyPresentation('idle')).toEqual({
      showSpinner: false,
      showSuccess: false,
      showFailure: false,
      accessibilityLiveRegion: 'polite',
      accessibilityState: { busy: false, disabled: false },
    })
    expect(sshCopyPresentation('copying')).toEqual({
      showSpinner: true,
      showSuccess: false,
      showFailure: false,
      accessibilityLiveRegion: 'polite',
      accessibilityState: { busy: true, disabled: true },
    })
    expect(sshCopyPresentation('copied')).toMatchObject({ showSpinner: false, showSuccess: true, showFailure: false })
    expect(sshCopyPresentation('failed')).toMatchObject({ showSpinner: false, showSuccess: false, showFailure: true })
  })

  it('synchronously serializes SSH credential mutations and public-key copies', () => {
    const gate = createSshOperationGate()

    expect(gate.tryStart('credential-mutation')).toBe(true)
    expect(gate.isActive('credential-mutation')).toBe(true)
    expect(gate.tryStart('credential-mutation')).toBe(false)
    expect(gate.tryStart('public-key-copy')).toBe(false)

    gate.finish('public-key-copy')
    expect(gate.isActive()).toBe(true)
    gate.finish('credential-mutation')
    expect(gate.isActive()).toBe(false)
    expect(gate.tryStart('public-key-copy')).toBe(true)
    gate.finish('public-key-copy')
    expect(gate.isActive()).toBe(false)
  })
})
