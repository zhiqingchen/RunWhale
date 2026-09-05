import type { MobileAgentPreset, MobileModelProvider, MobileModelProviderProfile, MobilePermissionMode } from '@runwhale/mobile-protocol'
import type { AgentImageDraft } from './agent-image'

export interface StudioAgentRunOptions {
  prompt: string
  resume?: boolean
  sessionId?: string
  planMode?: boolean
  provider?: MobileModelProvider
  model?: string
  agentPreset?: MobileAgentPreset
  permissionMode?: MobilePermissionMode
  attachments?: readonly AgentImageDraft[]
  signal?: AbortSignal
  modelProfile?: MobileModelProviderProfile
}
