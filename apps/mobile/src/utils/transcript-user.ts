import type { HostEvent } from '@runwhale/mobile-protocol'
import { agentMessageText, isHumanAgentMessage } from './agent-message'
import { projectHistoryToolActivities } from './tool-activity'

export interface TranscriptUserMessage {
  id: string
  text: string
}

export type PendingTranscriptPrompt = TranscriptUserMessage

export interface SubmittedTranscriptPrompt extends PendingTranscriptPrompt {
  revision: number
  sessionId: string
}

export interface TranscriptPromptHistory {
  sessionId: string
  messages: readonly TranscriptUserMessage[]
  state?: string
  settleRevision?: number
}

export function transcriptUserMessageId(ordinal: number): string {
  return `user-message:${ordinal}`
}

export function projectTranscriptUserMessages(events: readonly unknown[]): TranscriptUserMessage[] {
  const messages: TranscriptUserMessage[] = []
  for (const entry of projectHistoryToolActivities(events)) {
    if (entry.kind !== 'event' || entry.event.type !== 'user/message' || !isHumanAgentMessage(entry.event.data)) continue
    messages.push({
      id: transcriptUserMessageId(messages.length + 1),
      text: agentMessageText(entry.event.data),
    })
  }
  return messages
}

export function liveAgentMessageIds(events: readonly HostEvent[], scope: { projectId: string; sessionId?: string }): Set<string> {
  const ids = new Set<string>()
  for (const event of events) {
    if (event.name !== 'agent.message') continue
    const data = asRecord(event.data)
    if (!data || data.projectId !== scope.projectId) continue
    if (scope.sessionId !== undefined && data.sessionId !== scope.sessionId) continue
    if (typeof data.messageId === 'string' && data.messageId) ids.add(data.messageId)
  }
  return ids
}

export function queuedMessagesAwaitingConsumption<T extends { messageId: string }>(messages: readonly T[], consumedMessageIds: ReadonlySet<string>): T[] {
  return messages.filter((message) => !consumedMessageIds.has(message.messageId))
}

export function unresolvedTranscriptPrompt(messages: readonly TranscriptUserMessage[], pending: PendingTranscriptPrompt | undefined): PendingTranscriptPrompt | undefined {
  return pending && !messages.some((message) => message.id === pending.id) ? pending : undefined
}

export function reconcileSubmittedTranscriptPrompt(pending: SubmittedTranscriptPrompt | undefined, history: TranscriptPromptHistory): SubmittedTranscriptPrompt | undefined {
  if (!pending || pending.sessionId !== history.sessionId) return pending
  if (history.messages.some((message) => message.id === pending.id)) return undefined
  return history.settleRevision === pending.revision && history.state !== 'running' ? undefined : pending
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
