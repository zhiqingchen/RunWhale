import type { PreviewPlatform } from './types.js'

/** Selects the same Preview target in Studio and the embedded runtime. */
export function resolveProjectPreviewPlatform(manifest: { entry?: unknown; preview?: unknown }, runtimePlatform: PreviewPlatform): PreviewPlatform | undefined {
  const entry = asRecord(manifest.entry)
  const selected = asRecord(manifest.preview).target
  const hasWeb = nonEmptyString(entry.web)
  const nativePlatform = runtimePlatform === 'web' ? undefined : runtimePlatform
  const hasNative = nativePlatform ? nonEmptyString(entry[nativePlatform]) : false
  if (selected !== undefined && selected !== 'web' && selected !== 'native') {
    throw new Error('Project preview.target must be web or native')
  }
  if (selected === 'web') {
    if (!hasWeb) throw new Error('Project selects Web Preview but does not declare entry.web')
    return 'web'
  }
  if (selected === 'native') {
    if (!nativePlatform) throw new Error('This project requires iOS or Android for Preview')
    if (!hasNative) throw new Error(`Project does not declare entry.${nativePlatform}`)
    return nativePlatform
  }
  if (hasWeb && hasNative) {
    throw new Error('Project declares multiple preview entry types; set preview.target in runwhale.json')
  }
  if (hasNative) return nativePlatform
  if (hasWeb) return 'web'
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}
