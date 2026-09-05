import type { MobileModelDefinition, MobileModelProviderProfile } from '@runwhale/mobile-protocol'

export function normalizedModelProfile(value: unknown): MobileModelProviderProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Model profile must be an object.')
  const candidate = value as { baseURL?: unknown; models?: unknown }
  const baseURL = typeof candidate.baseURL === 'string' ? candidate.baseURL.trim() : ''
  if (baseURL) {
    const parsed = new URL(baseURL)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Base URL must use HTTP or HTTPS.')
  }
  if (!Array.isArray(candidate.models) || candidate.models.length === 0 || candidate.models.length > 100) throw new Error('Add between 1 and 100 models.')
  const seen = new Set<string>()
  const models = candidate.models.map((entry): MobileModelDefinition => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Each model must be an object.')
    const source = entry as { id?: unknown; name?: unknown; contextWindow?: unknown; maxTokens?: unknown }
    const id = typeof source.id === 'string' ? source.id.trim() : ''
    if (!id || id.length > 256 || seen.has(id)) throw new Error('Model IDs must be unique and at most 256 characters.')
    seen.add(id)
    const name = typeof source.name === 'string' ? source.name.trim() : ''
    if (name.length > 256) throw new Error('Model names must be at most 256 characters.')
    const contextWindow = optionalPositiveInteger(source.contextWindow, 'Context window')
    const maxTokens = optionalPositiveInteger(source.maxTokens, 'Max output tokens')
    return { id, ...(name ? { name } : {}), ...(contextWindow ? { contextWindow } : {}), ...(maxTokens ? { maxTokens } : {}) }
  })
  return { ...(baseURL ? { baseURL } : {}), models }
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`)
  return parsed
}
