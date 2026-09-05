import type { MobileModelProvider } from '@runwhale/mobile-protocol'

export const RUNTIME_CREDENTIAL_PROVIDERS = ['deepseek', 'openai', 'anthropic', 'google'] as const satisfies readonly MobileModelProvider[]

export type RuntimeCredentialSyncFailure = MobileModelProvider | 'ssh'

export interface RuntimeCredentialSyncOperations {
  isActive(): boolean
  readProvider(provider: MobileModelProvider): Promise<string | null>
  setProvider(provider: MobileModelProvider, value: string): Promise<void>
  deleteProvider(provider: MobileModelProvider): Promise<void>
  readSsh(): Promise<string | null>
  setSsh(value: string): Promise<void>
  deleteSsh(): Promise<void>
  onSynchronized(failures: readonly RuntimeCredentialSyncFailure[]): void | Promise<void>
}

export async function synchronizeRuntimeCredentials(
  operations: RuntimeCredentialSyncOperations,
): Promise<void> {
  const failures: RuntimeCredentialSyncFailure[] = []

  for (const provider of RUNTIME_CREDENTIAL_PROVIDERS) {
    if (!operations.isActive()) return
    try {
      const value = await operations.readProvider(provider)
      if (!operations.isActive()) return
      const normalized = normalizedCredential(value)
      if (normalized === null) await operations.deleteProvider(provider)
      else await operations.setProvider(provider, normalized)
      if (!operations.isActive()) return
    } catch {
      if (!operations.isActive()) return
      failures.push(provider)
    }
  }

  if (!operations.isActive()) return
  try {
    const value = await operations.readSsh()
    if (!operations.isActive()) return
    const normalized = normalizedCredential(value)
    if (normalized === null) await operations.deleteSsh()
    else await operations.setSsh(normalized)
    if (!operations.isActive()) return
  } catch {
    if (!operations.isActive()) return
    failures.push('ssh')
  }

  if (!operations.isActive()) return
  try {
    await operations.onSynchronized(failures)
  } catch (error) {
    if (!operations.isActive()) return
    throw error
  }
}

function normalizedCredential(value: string | null): string | null {
  return value?.trim() ? value : null
}
