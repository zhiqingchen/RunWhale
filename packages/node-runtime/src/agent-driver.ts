import type { AgentGoal, AgentQueuedMessage, MobileAgentPreset, MobileImageMediaType, MobileModelProvider, MobileModelProviderProfile } from '@runwhale/mobile-protocol'

export interface AgentRunOptions {
  sessionId: string
  prompt: string
  seed?: readonly unknown[] | undefined
  projectRoot?: string | undefined
  signal?: AbortSignal | undefined
  onEvent?: ((event: unknown) => void) | undefined
  planMode?: boolean | undefined
  provider?: MobileModelProvider | undefined
  model?: string | undefined
  agentPreset?: MobileAgentPreset | undefined
  attachments?: readonly AgentImageInput[] | undefined
  modelProfile?: MobileModelProviderProfile | undefined
  startPaused?: boolean | undefined
}

export interface AgentDriver {
  loadSession?(options: AgentSessionLoadOptions): Promise<void>
  run(options: AgentRunOptions): Promise<{
    text: string
    events?: readonly unknown[]
    failure?: { code?: string; message: string }
  }>
  observeSession?(sessionId: string, onEvent: (event: unknown) => void): () => void
  whenIdle?(sessionId: string): Promise<void>
  pause?(sessionId: string): Promise<void>
  resume?(sessionId: string, signal?: AbortSignal): ReturnType<AgentDriver['run']>
  cancel?(sessionId: string): Promise<AgentCancellationResult> | AgentCancellationResult
  message?(sessionId: string, prompt: string, mode: 'followup' | 'steer'): Promise<{ accepted: boolean; messageId?: string }> | { accepted: boolean; messageId?: string }
  notifyPreview?(sessionId: string, message: string): Promise<boolean> | boolean
  pendingMessages?(sessionId: string): Promise<Array<{ messageId: string; text: string; mode: 'followup' | 'steer' }>> | Array<{ messageId: string; text: string; mode: 'followup' | 'steer' }>
  updateMessage?(sessionId: string, messageId: string, prompt: string): Promise<{ accepted: boolean; messageId?: string }> | { accepted: boolean; messageId?: string }
  deleteMessage?(sessionId: string, messageId: string): Promise<boolean> | boolean
  setPlanMode?(sessionId: string, active: boolean): Promise<{ active: boolean; pending?: boolean; outcome: 'committed' | 'queued' | 'cancelled' | 'noop' }> | { active: boolean; pending?: boolean; outcome: 'committed' | 'queued' | 'cancelled' | 'noop' }
  getGoal?(sessionId: string): Promise<AgentGoal | undefined> | AgentGoal | undefined
  createGoal?(sessionId: string, objective: string, maxGoalRounds?: number): Promise<AgentGoal> | AgentGoal
  editGoal?(sessionId: string, ref: { id: string; revision: number }, objective?: string, maxGoalRounds?: number): Promise<AgentGoal> | AgentGoal
  pauseGoal?(sessionId: string, ref: { id: string; revision: number }): Promise<AgentGoal> | AgentGoal
  resumeGoal?(sessionId: string, ref: { id: string; revision: number }): Promise<AgentGoal> | AgentGoal
  clearGoal?(sessionId: string, ref: { id: string; revision: number }): Promise<void> | void
  sessionEvents?(sessionId: string): Promise<readonly unknown[]> | readonly unknown[]
  releaseSession?(sessionId: string): Promise<void>
  releaseProject?(projectRoot: string): Promise<void>
  dispose?(): Promise<void>
}

export type AgentSessionLoadOptions = Pick<AgentRunOptions, 'sessionId' | 'seed' | 'projectRoot' | 'provider' | 'model' | 'modelProfile' | 'agentPreset'>

export interface AgentCancellationResult {
  cancelled: boolean
  restoredMessages: AgentQueuedMessage[]
}

export interface AgentImageInput {
  data: Uint8Array
  mediaType: MobileImageMediaType
  name?: string
}
