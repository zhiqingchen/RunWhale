import type { PreviewEndpoint } from '@runwhale/mobile-protocol'
import { describe, expect, it } from 'vitest'
import { previewDeviceReport } from '../src/utils/preview-feedback'
import { initialPreviewLifecycleState, previewLifecycleReducer } from '../src/utils/preview-lifecycle'

const endpoint: PreviewEndpoint = { projectId: 'project', requestedBySessionId: 'agent-session', platform: 'ios', revision: 3, port: 3100, token: 'fixture', bundleUrl: 'http://127.0.0.1:3100/index.bundle?token=fixture' }
const published = previewLifecycleReducer(initialPreviewLifecycleState('native'), { type: 'bundle-ready', target: 'native', bundleUrl: endpoint.bundleUrl, revision: endpoint.revision })

describe('Preview device feedback', () => {
  it('reports startup only after content mounts, and keeps the publication owner', () => {
    expect(previewDeviceReport(published, endpoint)).toBeUndefined()
    const opened = previewLifecycleReducer(published, { type: 'content-opened', bundleUrl: endpoint.bundleUrl })
    expect(previewDeviceReport(opened, endpoint)).toEqual({ projectId: 'project', sessionId: 'agent-session', platform: 'ios', revision: 3, status: 'opened' })
    expect(previewDeviceReport(opened, { ...endpoint, bundleUrl: 'different-bundle' })).toBeUndefined()
    expect(previewDeviceReport(opened, { ...endpoint, requestedBySessionId: undefined })).toBeUndefined()
  })

  it('reports a device failure with redacted diagnostics and no endpoint credentials', () => {
    const failed = previewLifecycleReducer(published, { type: 'content-failed', bundleUrl: endpoint.bundleUrl, message: `Animation failed at ${endpoint.bundleUrl} authorization=Bearer fixture-secret` })
    expect(previewDeviceReport(failed, endpoint)).toEqual({ projectId: 'project', sessionId: 'agent-session', platform: 'ios', revision: 3, status: 'failed', message: 'Animation failed at <redacted-url> authorization=Bearer <redacted>' })
  })
})
