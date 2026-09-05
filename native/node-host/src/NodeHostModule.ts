import { NativeModule, requireOptionalNativeModule } from 'expo'

export type NativeNodeState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed'

export interface NativeNodeSnapshot {
  state: NativeNodeState
  nodeVersion?: string
  lastError?: string
}

export interface NodeStateEvent extends NativeNodeSnapshot {
  timestamp: number
}

export interface NodeLogEvent {
  level: 'info' | 'error'
  message: string
  timestamp: number
}

export type NativePreviewActionEvent =
  | { action: 'reload' }
  | { action: 'failure'; message: string }

export interface NodeHostEventMap {
  onNodeState: NodeStateEvent
  onNodeLog: NodeLogEvent
  onNativePreviewAction: NativePreviewActionEvent
}

declare class NodeHostNativeModule extends NativeModule<{
  onNodeState(event: NodeStateEvent): void
  onNodeLog(event: NodeLogEvent): void
  onNativePreviewAction(event: NativePreviewActionEvent): void
}> {
  start(projectRoot: string, entry: string): Promise<NativeNodeSnapshot>
  startBundled(): Promise<NativeNodeSnapshot>
  stop(port?: number, token?: string): Promise<NativeNodeSnapshot>
  snapshot(): NativeNodeSnapshot
  runtimeRoot(): string
  readHostInfo(): string | null
  takeNativePreviewDiagnostic(): string | null
  openNativePreview(bundleUrl: string, requestId: string, projectId: string): Promise<{ opened: boolean }>
  cancelNativePreviewOpen(requestId: string): boolean
}

const browserSnapshot: NativeNodeSnapshot = { state: 'stopped' }
const browserShim = {
  async start() { return browserSnapshot },
  async startBundled() { return browserSnapshot },
  async stop() { return browserSnapshot },
  snapshot() { return browserSnapshot },
  runtimeRoot() { return '' },
  readHostInfo() { return null },
  takeNativePreviewDiagnostic() { return null },
  async openNativePreview() { return { opened: false } },
  cancelNativePreviewOpen() { return false },
  addListener() { return { remove() {} } },
} as unknown as NodeHostNativeModule

export default requireOptionalNativeModule<NodeHostNativeModule>('RunWhaleNodeHost') ?? browserShim
