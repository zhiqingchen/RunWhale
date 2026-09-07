import { resolveProjectPreviewPlatform, type PreviewPlatform, type RuntimePlatform } from '@runwhale/mobile-protocol'
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
  try {
    const platform = resolveProjectPreviewPlatform(manifest, runtimePlatform)
    return platform
      ? { target: platform === 'web' ? 'web' : 'native', platform }
      : { error: `Project does not declare a Preview entry for ${runtimePlatform}` }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
