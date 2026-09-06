import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { HostEvent } from '@runwhale/mobile-protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { usePreviewTesting } from '../src/hooks/use-preview-testing'

const native = vi.hoisted(() => ({
  findNodeHandle: vi.fn(() => 42),
  captureWebPreview: vi.fn(async () => JSON.stringify({ timestamp: 123, image: { mediaType: 'image/jpeg', base64: 'image', width: 320, height: 640 } })),
}))
vi.mock('react-native', () => ({ findNodeHandle: native.findNodeHandle }))
vi.mock('@runwhale/node-host', () => ({ NodeHost: { captureWebPreview: native.captureWebPreview } }))

let tree: ReactTestRenderer
afterEach(async () => {
  await act(async () => tree?.unmount())
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('captures the native Web Preview container and completes a claimed request only once', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const captureView = { nativeTag: 42 }
  const webView = { injectJavaScript: vi.fn(), goForward: vi.fn() }
  const request = vi.fn(async (method: string) => method === 'preview.test.claim' ? { command: { kind: 'screenshot' } } : { accepted: true })
  const probe = { id: 'probe', projectId: 'notes', revision: 2, platform: 'web', expiresAt: Date.now() + 15_000 }
  const event = { name: 'preview.test.request', data: probe } as HostEvent
  function Harness({ events }: { events: HostEvent[] }) {
    usePreviewTesting({
      projectId: 'notes', active: { revision: 2, bundleUrl: 'http://127.0.0.1/preview', target: 'web', opened: true },
      webVisible: true, events, request: request as never,
      webView: { current: webView } as never, webCaptureView: { current: captureView } as never,
    })
    return null
  }
  await act(async () => { tree = create(<Harness events={[event]} />) })
  expect(native.findNodeHandle).toHaveBeenCalledWith(captureView)
  expect(native.captureWebPreview).toHaveBeenCalledWith(42)
  expect(webView.injectJavaScript).not.toHaveBeenCalled()
  expect(request).toHaveBeenLastCalledWith('preview.test.complete', {
    id: 'probe', projectId: 'notes', revision: 2,
    result: { timestamp: 123, image: { mediaType: 'image/jpeg', base64: 'image', width: 320, height: 640 } },
  })
  await act(async () => tree.update(<Harness events={[event]} />))
  expect(native.captureWebPreview).toHaveBeenCalledOnce()
})
