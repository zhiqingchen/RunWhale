import type { PreviewPlatform } from './types.js'

/** Coordinates are relative to the Preview viewport, in its reported units. */
export interface PreviewBounds { x: number; y: number; width: number; height: number }
export interface PreviewNode {
  id: string
  parentId?: string
  role: string
  text?: string
  label?: string
  value?: string
  testId?: string
  bounds: PreviewBounds
  visible: boolean
  enabled: boolean
  selected?: boolean
  actions: Array<'press' | 'fill' | 'scroll'>
}
export interface PreviewLog {
  sequence: number
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
}
export type PreviewTestCommand =
  | { kind: 'inspect' }
  | { kind: 'screenshot' }
  | { kind: 'logs'; afterSequence: number }
  | { kind: 'action'; snapshotId: string; nodeId: string; action: 'press' | 'fill' | 'scroll'; text?: string; direction?: 'up' | 'down' }

export interface PreviewTestRequest {
  id: string
  projectId: string
  revision: number
  platform: PreviewPlatform
  expiresAt: number
}
export interface PreviewTestResult {
  timestamp: number
  snapshotId?: string
  nodes?: PreviewNode[]
  truncated?: boolean
  viewport?: { width: number; height: number; scale: number }
  image?: { mediaType: 'image/jpeg'; base64: string; width: number; height: number }
  logs?: PreviewLog[]
  nextSequence?: number
  gap?: boolean
  performed?: boolean
  method?: string
  error?: string
}

export interface PreviewTestObservation extends PreviewTestResult {
  projectId: string
  revision: number
  platform: PreviewPlatform
}
