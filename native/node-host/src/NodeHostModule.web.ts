import type { NativeNodeSnapshot, NodeHostEventMap } from './NodeHostModule'

const snapshot: NativeNodeSnapshot = { state: 'stopped' }

/**
 * Browser-only development shim. Studio pages are intentionally usable from
 * the desktop Metro server, while the embedded Node host and native Preview
 * remain device-only capabilities.
 */
const NodeHost = {
  async start(): Promise<NativeNodeSnapshot> { return snapshot },
  async startBundled(): Promise<NativeNodeSnapshot> { return snapshot },
  async recoverTransport(): Promise<string | null> { return null },
  async stop(): Promise<NativeNodeSnapshot> { return snapshot },
  snapshot(): NativeNodeSnapshot { return snapshot },
  runtimeRoot(): string { return '' },
  readHostInfo(): string | null { return null },
  takeNativePreviewDiagnostic(): string | null { return null },
  async openNativePreview(): Promise<{ opened: boolean }> { return { opened: false } },
  cancelNativePreviewOpen(): boolean { return false },
  addListener<EventName extends keyof NodeHostEventMap>(
    _event: EventName,
    _listener: (event: NodeHostEventMap[EventName]) => void,
  ) {
    return { remove() {} }
  },
}

export default NodeHost
