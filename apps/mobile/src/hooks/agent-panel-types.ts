import type { StudioAgentRunOptions } from '@/utils/agent-run'
import { type SessionRefreshPresentationStatus } from '@/utils/session-actions'
import type { AgentSessionSummary, HostEvent, MobileModelProvider } from '@runwhale/mobile-protocol'

export interface AgentPanelProps {
  projectId: string
  initialSessionId?: string
  sessionSummaries: readonly AgentSessionSummary[]
  sessionSummariesRefreshing: boolean
  sessionSummaryStatus: SessionRefreshPresentationStatus
  events?: readonly HostEvent[]
  liveEvents?: readonly HostEvent[]
  promptInsertion?: { id: string; text: string }
  onPromptInserted?(): void
  onRun(options: StudioAgentRunOptions): Promise<{ sessionId: string; taskId: string }>
  onSessionChange?(sessionId: string | undefined): void
  onRunningChange?(running: boolean): void
  sessionDetailsOpen?: boolean
  onSessionDetailsOpenChange?(open: boolean): void
}

export interface PendingAgentMessage {
  messageId: string
  text: string
  mode: 'followup' | 'steer'
}

export type GoalMutationAction = 'create' | 'edit' | 'pause' | 'resume' | 'clear'

export type ApprovalResponseAction = 'approve' | 'reject' | 'answer'

export type AgentAttachmentSource = 'files' | 'photos' | 'camera'

export function providerLabel(provider: MobileModelProvider): string {
  if (provider === 'openai') return 'OpenAI'
  if (provider === 'anthropic') return 'Claude'
  if (provider === 'google') return 'Gemini'
  return 'DeepSeek'
}

export const QUICK_ACTION_DISMISS_DELAY_MS = 200
