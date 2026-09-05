import { actionErrorPresentation } from './action-progress'

export const settingsDestructiveActionContract = {
  apiKeyRemoval: {
    dialogTestID: 'settings-api-key-removal-dialog',
    actionTestID: 'settings-api-key-removal-confirm',
    tone: 'danger',
  },
  sshKeyRotation: {
    dialogTestID: 'settings-ssh-key-rotation-dialog',
    actionTestID: 'settings-ssh-key-rotation-confirm',
    tone: 'danger',
  },
} as const

export type SshPublicMetadataState =
  | { status: 'loading' }
  | { status: 'unconfigured' }
  | { status: 'configured'; publicKey: string; fingerprint: string }
  | { status: 'failed' }

export type SshOperationAvailability =
  | { available: true }
  | { available: false; unavailableReason: 'secure-storage-loading' | 'secure-storage-failed' | 'secure-storage-unavailable' | 'runtime' }

export type SshSecureStorageState =
  | { status: 'loading' }
  | { status: 'available'; credentialPresent: boolean }
  | { status: 'failed' }
  | { status: 'unavailable' }

export const SSH_PRIVATE_CREDENTIAL_STORAGE_KEY = 'github.ssh-private-key'
export const SSH_PUBLIC_METADATA_STORAGE_KEY = 'runwhale.github-ssh-public.v1'

export type SshCopyState = 'idle' | 'copying' | 'copied' | 'failed'
export type SshSettingsSummaryState = 'loading' | 'configured' | 'unconfigured' | 'needs-attention' | 'failed'

const sshUnavailableWarningPresentation = {
  accessibilityRole: 'alert',
  accessibilityLiveRegion: 'polite',
  status: 'warning',
} as const

export type SshUnavailableFeedbackPresentation = {
  messageKey: 'sshSecureStorageAccessFailed' | 'sshSecureStorageRequired' | 'sshRuntimeRequired'
  alert: typeof actionErrorPresentation | typeof sshUnavailableWarningPresentation
}

export type SshInFlightOperation = 'credential-mutation' | 'public-key-copy'

export interface SshOperationGate {
  tryStart(operation: SshInFlightOperation): boolean
  finish(operation: SshInFlightOperation): void
  isActive(operation?: SshInFlightOperation): boolean
}

export function createSshOperationGate(): SshOperationGate {
  let activeOperation: SshInFlightOperation | undefined
  return {
    tryStart(operation) {
      if (activeOperation !== undefined) return false
      activeOperation = operation
      return true
    },
    finish(operation) {
      if (activeOperation === operation) activeOperation = undefined
    },
    isActive(operation) {
      return operation === undefined ? activeOperation !== undefined : activeOperation === operation
    },
  }
}

export interface SshCopyPresentation {
  showSpinner: boolean
  showSuccess: boolean
  showFailure: boolean
  accessibilityLiveRegion: 'polite'
  accessibilityState: {
    busy: boolean
    disabled: boolean
  }
}

export function sshCopyPresentation(state: SshCopyState): SshCopyPresentation {
  const busy = state === 'copying'
  return {
    showSpinner: busy,
    showSuccess: state === 'copied',
    showFailure: state === 'failed',
    accessibilityLiveRegion: 'polite',
    accessibilityState: { busy, disabled: busy },
  }
}

export function sshOperationAvailability(secureStorage: SshSecureStorageState, runtimeReady: boolean): SshOperationAvailability {
  if (secureStorage.status === 'loading') return { available: false, unavailableReason: 'secure-storage-loading' }
  if (secureStorage.status === 'failed') return { available: false, unavailableReason: 'secure-storage-failed' }
  if (secureStorage.status === 'unavailable') return { available: false, unavailableReason: 'secure-storage-unavailable' }
  if (!runtimeReady) return { available: false, unavailableReason: 'runtime' }
  return { available: true }
}

export function sshUnavailableFeedbackPresentation(
  availability: SshOperationAvailability,
): SshUnavailableFeedbackPresentation | undefined {
  if (availability.available || availability.unavailableReason === 'secure-storage-loading') return undefined
  if (availability.unavailableReason === 'secure-storage-failed') {
    return { messageKey: 'sshSecureStorageAccessFailed', alert: actionErrorPresentation }
  }
  return {
    messageKey: availability.unavailableReason === 'secure-storage-unavailable' ? 'sshSecureStorageRequired' : 'sshRuntimeRequired',
    alert: sshUnavailableWarningPresentation,
  }
}

export function isSshSecureStorageRetryable(secureStorage: SshSecureStorageState): boolean {
  return secureStorage.status === 'failed'
}

export function isSshPrivateCredentialMissing(metadata: SshPublicMetadataState, secureStorage: SshSecureStorageState): boolean {
  return metadata.status === 'configured' && secureStorage.status === 'available' && !secureStorage.credentialPresent
}

export function sshSettingsSummaryState(state: { metadata: SshPublicMetadataState; secureStorage: SshSecureStorageState }): SshSettingsSummaryState {
  if (state.metadata.status === 'loading' || state.secureStorage.status === 'loading') return 'loading'
  if (state.metadata.status === 'failed' || state.secureStorage.status === 'failed') return 'failed'
  if (isSshPrivateCredentialMissing(state.metadata, state.secureStorage)) return 'needs-attention'
  if (state.metadata.status === 'configured' && state.secureStorage.status === 'available') return 'configured'
  return 'unconfigured'
}

export async function probeSshSecureStorage(
  read: () => Promise<string | null>,
): Promise<Exclude<SshSecureStorageState, { status: 'loading' }>> {
  try {
    const value = await read()
    return { status: 'available', credentialPresent: Boolean(value?.trim()) }
  } catch {
    return { status: 'failed' }
  }
}

export async function loadSshSettingsStorage(
  readPublicMetadata: () => Promise<string | null>,
  readPrivateCredential?: () => Promise<string | null>,
): Promise<{ metadata: SshPublicMetadataState; secureStorage: SshSecureStorageState }> {
  const [metadata, secureStorage] = await Promise.all([
    loadSshPublicMetadata(readPublicMetadata),
    readPrivateCredential
      ? probeSshSecureStorage(readPrivateCredential)
      : Promise.resolve({ status: 'unavailable' } as const),
  ])
  return { metadata, secureStorage }
}

export function parseSshPublicMetadata(value: string | null): Exclude<SshPublicMetadataState, { status: 'loading' }> {
  if (value === null) return { status: 'unconfigured' }
  try {
    const saved = JSON.parse(value) as { publicKey?: unknown; fingerprint?: unknown }
    if (typeof saved.publicKey !== 'string' || saved.publicKey.trim().length === 0 || typeof saved.fingerprint !== 'string' || saved.fingerprint.trim().length === 0) {
      return { status: 'failed' }
    }
    return { status: 'configured', publicKey: saved.publicKey, fingerprint: saved.fingerprint }
  } catch {
    return { status: 'failed' }
  }
}

export async function loadSshPublicMetadata(read: () => Promise<string | null>): Promise<Exclude<SshPublicMetadataState, { status: 'loading' }>> {
  try {
    return parseSshPublicMetadata(await read())
  } catch {
    return { status: 'failed' }
  }
}
