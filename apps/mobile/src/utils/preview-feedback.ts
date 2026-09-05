import { previewRepairMessage, type MobileHostRequestMap, type PreviewEndpoint } from '@runwhale/mobile-protocol'
import type { PreviewLifecycleState } from './preview-lifecycle'

export function previewDeviceReport(state: PreviewLifecycleState, endpoint: PreviewEndpoint | undefined): MobileHostRequestMap['preview.report']['params'] | undefined {
  if (!endpoint?.requestedBySessionId || state.operation || state.active?.bundleUrl !== endpoint.bundleUrl) return undefined
  if (!state.error && !state.active.opened) return undefined
  return {
    projectId: endpoint.projectId,
    sessionId: endpoint.requestedBySessionId,
    platform: endpoint.platform,
    revision: endpoint.revision,
    status: state.error ? 'failed' : 'opened',
    ...(state.error ? { message: previewRepairMessage(state.error) } : {}),
  }
}
