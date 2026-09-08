const TOKEN_VALUE = /(?:sk-[A-Za-z0-9_-]{20,}|gh[opusr]_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._~+/-]{16,})/g

export function findSecretLeaks(text: string, knownSecrets: readonly string[] = []): string[] {
  const leaks = new Set<string>()
  for (const match of text.matchAll(TOKEN_VALUE)) leaks.add(match[0])
  for (const secret of knownSecrets) {
    if (secret.length >= 8 && text.includes(secret)) leaks.add(secret)
  }
  return [...leaks]
}
