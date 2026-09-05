export interface LocalPersistenceSource {
  error?: string
  retry(): Promise<void>
}

export function localPersistenceErrors(sources: readonly LocalPersistenceSource[], fallback: string): string[] {
  const errors: string[] = []
  const seen = new Set<string>()

  for (const source of sources) {
    if (source.error === undefined) continue
    const error = source.error.trim() || fallback
    if (seen.has(error)) continue
    seen.add(error)
    errors.push(error)
  }

  return errors
}

export async function retryLocalPersistence(sources: readonly LocalPersistenceSource[]): Promise<void> {
  const failing = sources.filter((source) => source.error !== undefined)
  const results = await Promise.allSettled(failing.map(async (source) => source.retry()))
  const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (firstFailure) throw firstFailure.reason
}
