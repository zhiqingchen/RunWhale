export const agentDestructiveActionContract = {
  queuedMessageDelete: {
    dialogTestID: 'agent-queued-message-delete-dialog',
    actionTestID: 'agent-queued-message-delete-confirm',
    tone: 'danger',
  },
} as const

export type AgentSessionHistoryState = 'loading' | 'ready' | 'failed'

export type AgentResponseState = 'idle' | 'busy'

export type AgentResponseEvent = 'start' | 'finish'

export const idleAgentResponseState: AgentResponseState = 'idle'

export function agentResponseReducer(state: AgentResponseState, event: AgentResponseEvent): AgentResponseState {
  if (event === 'start') return state === 'busy' ? state : 'busy'
  return state === 'busy' ? 'idle' : state
}

export type AgentQueueAction = 'convert' | 'delete'

export type AgentQueueActionState = Readonly<Record<string, AgentQueueAction | undefined>>

export type AgentQueueActionEvent =
  | { type: 'start'; messageId: string; action: AgentQueueAction }
  | { type: 'finish'; messageId: string; action: AgentQueueAction }

export const idleAgentQueueActionState: AgentQueueActionState = {}

export function agentQueueActionReducer(state: AgentQueueActionState, event: AgentQueueActionEvent): AgentQueueActionState {
  if (event.type === 'start') {
    if (state[event.messageId]) return state
    return { ...state, [event.messageId]: event.action }
  }
  if (state[event.messageId] !== event.action) return state
  const next: Record<string, AgentQueueAction | undefined> = { ...state }
  delete next[event.messageId]
  return next
}

export type AgentDestructiveAction = { kind: 'delete-queued-message'; messageId: string }

export function shouldDismissConsumedQueuedMessage(action: AgentDestructiveAction | undefined, busy: boolean, consumedMessageIds: ReadonlySet<string>): boolean {
  return action?.kind === 'delete-queued-message' && !busy && consumedMessageIds.has(action.messageId)
}

export function showAgentEmptyState(historyState: AgentSessionHistoryState, sessionEventCount: number, running: boolean, submittedPrompt: string): boolean {
  return historyState === 'ready' && sessionEventCount === 0 && !running && !submittedPrompt
}

export function resolveAgentPlanMode(previous: boolean, result?: { active: boolean; pending?: boolean }): boolean {
  return result ? result.pending ?? result.active : previous
}

export function agentSendSubmissionBusy(planModeSubmitting: boolean, running: boolean, runSubmitting: boolean, queueSubmitting: boolean): boolean {
  return planModeSubmitting || (running ? queueSubmitting : runSubmitting)
}

export function agentPrimaryActionState(running: boolean, stopping: boolean, sendAvailable: boolean, sendBusy: boolean): { action: 'send' | 'stop'; disabled: boolean; pending: boolean } {
  return running
    ? { action: 'stop', disabled: stopping, pending: stopping }
    : { action: 'send', disabled: !sendAvailable, pending: sendBusy }
}

export function agentImagePickerAvailable(running: boolean, attachmentCount: number): boolean {
  return !running && attachmentCount < 4
}

export function mergeStoppedAgentMessages<T extends { messageId: string; text: string }>(local: readonly T[], restored: readonly T[]): T[] {
  const localById = new Map(local.map((message) => [message.messageId, message]))
  return restored.map((message) => localById.get(message.messageId) ?? message)
}

export function restoreStoppedAgentMessages(prompt: string, messages: readonly { text: string }[], submittedDraft?: string): string {
  const restored = messages.map((message) => message.text.trim()).filter(Boolean)
  if (restored.length === 0) return prompt
  const draft = prompt.trim()
  const submitted = submittedDraft?.trim()
  const draftRepresentsRestoredSubmission = Boolean(draft && submitted === draft && restored.includes(draft))
  if (draft && !draftRepresentsRestoredSubmission) restored.push(draft)
  return restored.join('\n\n')
}

export async function performAgentRun({
  clearPersistedDraft,
  run,
  recover,
  finish,
}: {
  clearPersistedDraft(): Promise<void>
  run(): Promise<void>
  recover(cause: unknown): Promise<void>
  finish(): void
}): Promise<void> {
  try {
    await clearPersistedDraft()
  } catch {
    // Persisted-draft cleanup is best effort and must never block the submitted run.
  }
  try {
    await run()
  } catch (cause) {
    await recover(cause)
  } finally {
    finish()
  }
}

export async function performAgentDestructiveMutation({
  action,
  projectId,
  sessionId,
  queueNoLongerPendingMessage,
  deleteQueuedMessage,
  onBusyChange,
  onError,
}: {
  action: AgentDestructiveAction
  projectId: string
  sessionId?: string
  queueNoLongerPendingMessage: string
  deleteQueuedMessage(input: { projectId: string; sessionId: string; messageId: string }): Promise<{ deleted: boolean }>
  onBusyChange(busy: boolean): void
  onError(error: string | undefined): void
}): Promise<boolean> {
  onBusyChange(true)
  onError(undefined)
  try {
    if (!sessionId) throw new Error(queueNoLongerPendingMessage)
    const result = await deleteQueuedMessage({ projectId, sessionId, messageId: action.messageId })
    if (!result.deleted) throw new Error(queueNoLongerPendingMessage)
    return true
  } catch (cause) {
    onError(cause instanceof Error ? cause.message : String(cause))
    return false
  } finally {
    onBusyChange(false)
  }
}
