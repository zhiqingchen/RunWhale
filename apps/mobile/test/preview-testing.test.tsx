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
  const probe = { id: 'probe', kind: 'screenshot', projectId: 'notes', revision: 2, platform: 'web', expiresAt: Date.now() + 15_000 }
  const event = { name: 'preview.test.request', data: probe } as HostEvent
  function Harness({ events }: { events: HostEvent[] }) {
    usePreviewTesting({
      projectId: 'notes', enabled: true, active: { revision: 2, bundleUrl: 'http://127.0.0.1/preview', target: 'web', opened: true },
      webVisible: true, events, request: request as never,
      closePreview: async () => undefined,
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

it('leaves test requests available until the focused matching revision has mounted', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const request = vi.fn(async (method: string) => method === 'preview.test.claim' ? { command: { kind: 'inspect' } } : { accepted: true })
  const injectJavaScript = vi.fn()
  const probe = { id: 'inspect', kind: 'inspect', projectId: 'notes', revision: 2, platform: 'web', expiresAt: Date.now() + 15_000 }
  const events = [{ name: 'preview.test.request', data: probe }] as HostEvent[]
  let receive: (data: string) => void
  function Harness({ enabled, revision, opened }: { enabled: boolean; revision: number; opened: boolean }) {
    receive = usePreviewTesting({
      projectId: 'notes', enabled, active: { revision, bundleUrl: 'preview', target: 'web', opened },
      webVisible: true, events, request: request as never, closePreview: async () => undefined,
      webView: { current: { injectJavaScript } } as never, webCaptureView: { current: null },
    })
    return null
  }
  await act(async () => { tree = create(<Harness enabled={false} revision={2} opened />) })
  expect(request).not.toHaveBeenCalled()
  await act(async () => tree.update(<Harness enabled revision={1} opened />))
  expect(request).not.toHaveBeenCalled()
  await act(async () => tree.update(<Harness enabled revision={2} opened={false} />))
  expect(request).not.toHaveBeenCalled()
  await act(async () => tree.update(<Harness enabled revision={2} opened />))
  expect(request).toHaveBeenCalledOnce()
  expect(injectJavaScript).toHaveBeenCalledOnce()
  await act(async () => receive(JSON.stringify({ type: 'runwhale.preview.test', id: 'inspect', result: { timestamp: 1, snapshotId: 'current', nodes: [] } })))
  expect(request).toHaveBeenLastCalledWith('preview.test.complete', expect.objectContaining({ result: { timestamp: 1, snapshotId: 'current', nodes: [] } }))
})

it('closes through Studio and rejects unfinished observations and late Web replies', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const request = vi.fn(async (method: string, params: { id: string }) => method === 'preview.test.claim' ? { command: { kind: params.id } } : { accepted: true })
  const closePreview = vi.fn(async () => undefined)
  const event = (kind: 'close' | 'inspect') => ({ name: 'preview.test.request', data: { id: kind, kind, projectId: 'notes', revision: 2, platform: 'web', expiresAt: Date.now() + 15_000 } }) as HostEvent
  let receive: (data: string) => void
  function Harness({ events }: { events: HostEvent[] }) {
    receive = usePreviewTesting({
      projectId: 'notes', enabled: true, active: { revision: 2, bundleUrl: 'preview', target: 'web', opened: true },
      webVisible: true, events, request: request as never, closePreview,
      webView: { current: { injectJavaScript: vi.fn() } } as never, webCaptureView: { current: null },
    })
    return null
  }
  const inspect = event('inspect')
  await act(async () => { tree = create(<Harness events={[inspect]} />) })
  await act(async () => tree.update(<Harness events={[inspect, event('close')]} />))
  expect(closePreview).toHaveBeenCalledOnce()
  expect(request).toHaveBeenCalledWith('preview.test.complete', expect.objectContaining({ id: 'close', result: expect.objectContaining({ closed: true }) }))
  expect(request).toHaveBeenCalledWith('preview.test.complete', expect.objectContaining({ id: 'inspect', result: expect.objectContaining({ error: expect.stringContaining('closed') }) }))
  const count = request.mock.calls.length
  await act(async () => receive(JSON.stringify({ type: 'runwhale.preview.test', id: 'inspect', result: { timestamp: 1, snapshotId: 'late', nodes: [] } })))
  expect(request).toHaveBeenCalledTimes(count)
})

it('does not execute a claimed request after its route loses focus', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let claim!: (value: { command: { kind: 'screenshot' } }) => void
  const request = vi.fn(async (method: string) => method === 'preview.test.claim'
    ? new Promise((resolve) => { claim = resolve }) : { accepted: true })
  const events = [{ name: 'preview.test.request', data: { id: 'capture', kind: 'screenshot', projectId: 'notes', revision: 2, platform: 'web', expiresAt: Date.now() + 15_000 } }] as HostEvent[]
  function Harness({ enabled }: { enabled: boolean }) {
    usePreviewTesting({
      projectId: 'notes', enabled, active: { revision: 2, bundleUrl: 'preview', target: 'web', opened: true },
      webVisible: true, events, request: request as never, closePreview: async () => undefined,
      webView: { current: null }, webCaptureView: { current: { nativeTag: 42 } } as never,
    })
    return null
  }
  await act(async () => { tree = create(<Harness enabled />) })
  await act(async () => tree.update(<Harness enabled={false} />))
  await act(async () => claim({ command: { kind: 'screenshot' } }))
  expect(native.captureWebPreview).not.toHaveBeenCalled()
  expect(request).toHaveBeenLastCalledWith('preview.test.complete', expect.objectContaining({ result: expect.objectContaining({ error: expect.stringContaining('no longer focused') }) }))
})
