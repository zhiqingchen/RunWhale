import type { HostEvent, PreviewEndpoint, PreviewPlatform } from '@runwhale/mobile-protocol'

export interface AgentPreviewPublication {
  sequence: number
  endpoint: PreviewEndpoint
}

export function latestAgentPreviewPublication(
  events: readonly HostEvent[],
  projectId: string,
  sessionId: string,
  afterSequence: number,
): AgentPreviewPublication | undefined {
  let latest: AgentPreviewPublication | undefined
  for (const event of events) {
    if (event.sequence <= afterSequence || event.name !== 'preview.ready' || !isRecord(event.data)) continue
    const data = event.data
    if (data.projectId !== projectId || data.requestedBySessionId !== sessionId) continue
    if (!isPreviewPlatform(data.platform) || !Number.isSafeInteger(data.revision) || Number(data.revision) < 1) continue
    if (!Number.isSafeInteger(data.port) || Number(data.port) < 1 || Number(data.port) > 65_535) continue
    if (typeof data.token !== 'string' || data.token.length === 0 || typeof data.bundleUrl !== 'string') continue
    const endpoint: PreviewEndpoint = {
      projectId,
      platform: data.platform,
      revision: Number(data.revision),
      port: Number(data.port),
      token: data.token,
      bundleUrl: data.bundleUrl,
      requestedBySessionId: data.requestedBySessionId,
    }
    if (!latest || event.sequence > latest.sequence) latest = { sequence: event.sequence, endpoint }
  }
  return latest
}

function isPreviewPlatform(value: unknown): value is PreviewPlatform {
  return value === 'android' || value === 'ios' || value === 'web'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
