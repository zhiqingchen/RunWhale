export class CredentialActivationError extends Error {
  constructor(cause: unknown) {
    super('credential activation failed', { cause })
    this.name = 'CredentialActivationError'
  }
}

export class CredentialRemovalError extends Error {
  readonly durableRemovalFailed: boolean

  constructor(cause: unknown, durableRemovalFailed: boolean) {
    super(durableRemovalFailed ? 'credential removal failed' : 'credential deactivation failed', { cause })
    this.name = 'CredentialRemovalError'
    this.durableRemovalFailed = durableRemovalFailed
  }
}

export function normalizeProviderCredential(value: string): string {
  return value.trim()
}

export function isProviderCredentialInputValid(value: string): boolean {
  const normalized = normalizeProviderCredential(value)
  return normalized.length >= 8 && normalized.length <= 8_192 && !/[\r\n\0]/.test(normalized)
}

export async function saveCredential({
  value,
  persist,
  activate,
}: {
  value: string
  persist(value: string): Promise<void>
  activate(value: string): Promise<void>
}): Promise<void> {
  const normalized = normalizeProviderCredential(value)
  if (!isProviderCredentialInputValid(normalized)) throw new Error('credential is invalid')
  await persist(normalized)
  try {
    await activate(normalized)
  } catch (cause) {
    throw new CredentialActivationError(cause)
  }
}

export async function removeCredential({
  deactivate,
  remove,
}: {
  deactivate(): Promise<void>
  remove(): Promise<void>
}): Promise<void> {
  let deactivationFailed = false
  let deactivationCause: unknown
  try {
    await deactivate()
  } catch (cause) {
    deactivationFailed = true
    deactivationCause = cause
  }

  try {
    await remove()
  } catch (cause) {
    throw new CredentialRemovalError(cause, true)
  }

  if (deactivationFailed) throw new CredentialRemovalError(deactivationCause, false)
}
