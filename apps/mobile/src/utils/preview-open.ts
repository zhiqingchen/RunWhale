import type { PreviewEndpoint, PreviewOpenResult } from '@runwhale/mobile-protocol'

export type PreviewLaunchResolution =
  | { status: 'build' }
  | { status: 'ready'; endpoint: PreviewEndpoint }

export async function resolvePreviewLaunch(
  mode: 'open' | 'run',
  openCached: () => Promise<PreviewOpenResult>,
): Promise<PreviewLaunchResolution> {
  if (mode === 'run') return { status: 'build' }
  const cached = await openCached()
  return cached.status === 'ready'
    ? { status: 'ready', endpoint: cached.endpoint }
    : { status: 'build' }
}
