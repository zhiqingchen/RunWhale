const KEY_NAME = /(?:api[-_]?key|authorization|credential|github[-_]?token|password|secret|token)/i
const TOKEN_VALUE = /(?:sk-[A-Za-z0-9_-]{20,}|gh[opusr]_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._~+/-]{16,})/g

export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(TOKEN_VALUE, '[REDACTED]')
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (typeof value !== 'object' || value === null) return value
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    output[key] = KEY_NAME.test(key) ? '[REDACTED]' : redactSecrets(child)
  }
  return output
}

export function findSecretLeaks(text: string, knownSecrets: readonly string[] = []): string[] {
  const leaks = new Set<string>()
  for (const match of text.matchAll(TOKEN_VALUE)) leaks.add(match[0])
  for (const secret of knownSecrets) {
    if (secret.length >= 8 && text.includes(secret)) leaks.add(secret)
  }
  return [...leaks]
}
