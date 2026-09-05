import type { PreviewPlatform, RuntimePlatform } from '@runwhale/mobile-protocol'
import type { StudioProject } from '@/state/projects'
import type { PreviewTarget } from '@/utils/preview-lifecycle'

export type ProjectPreviewConfiguration =
  | { target: PreviewTarget; platform: 'web' | RuntimePlatform }
  | { error: string }

export function projectPreviewConfiguration(project: StudioProject, runtimePlatform: PreviewPlatform): ProjectPreviewConfiguration {
  const source = project.files.find((file) => file.path === 'runwhale.json')?.content
  if (!source) return { error: 'Project does not contain runwhale.json' }
  let manifest: Record<string, unknown>
  try {
    manifest = asRecord(JSON.parse(source) as unknown)
  } catch {
    return { error: 'Project manifest is not valid JSON' }
  }
  const entry = asRecord(manifest.entry)
  const preview = asRecord(manifest.preview)
  const hasWeb = nonEmptyString(entry.web)
  const nativePlatform = runtimePlatform === 'web' ? undefined : runtimePlatform
  const hasNative = nativePlatform ? nonEmptyString(entry[nativePlatform]) : false
  const selected = preview.target
  if (selected !== undefined && selected !== 'web' && selected !== 'native') {
    return { error: 'Project preview.target must be web or native' }
  }
  if (selected === 'web') {
    return hasWeb
      ? { target: 'web', platform: 'web' }
      : { error: 'Project selects Web Preview but does not declare entry.web' }
  }
  if (selected === 'native') {
    if (!nativePlatform) return { error: 'Native Preview is unavailable in the desktop UI' }
    return hasNative
      ? { target: 'native', platform: nativePlatform }
      : { error: `Project selects Native Preview but does not declare entry.${nativePlatform}` }
  }
  if (hasWeb && hasNative) {
    return { error: 'Project declares both Web and Native Preview entries; set preview.target in runwhale.json' }
  }
  if (hasNative && nativePlatform) return { target: 'native', platform: nativePlatform }
  if (hasWeb) return { target: 'web', platform: 'web' }
  return { error: `Project does not declare a Preview entry for ${runtimePlatform}` }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}
