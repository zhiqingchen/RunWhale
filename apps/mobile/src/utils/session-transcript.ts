import type { HostEvent } from '@runwhale/mobile-protocol'
import { agentMessageText, isHumanAgentMessage } from './agent-message'
import { projectHistoryToolActivities, type HistoryToolActivityProjectionEntry, type ToolActivityGroup, type ToolActivitySessionEvent as Event } from './tool-activity'
import { transcriptContextDetail, type TranscriptContextRecord } from './transcript-context'
import { transcriptUserMessageId } from './transcript-user'
import type { AssistantMessageBlock } from './transcript-feedback'

export interface TranscriptScope { projectId: string; sessionId?: string }
export type SessionTranscriptRow =
  | { id: string; kind: 'user'; event: Event; text: string }
  | { id: string; kind: 'assistant'; event?: Event; blocks: AssistantMessageBlock[]; status: 'streaming' | 'settled' | 'interrupted'; branchSequence?: number }
  | { id: string; kind: 'activity'; activity: ToolActivityGroup }
  | { id: string; kind: 'context'; context: TranscriptContextRecord }
  | { id: string; kind: 'turn'; event: Event }
  | { id: string; kind: 'notice'; event: Event; label: 'command' | 'compaction' | 'retry' | 'error' | 'max-tokens'; text: string; busy?: boolean; failed?: boolean }

/** Request headers are complete snapshots; an omitted prompt clears the previous one. */
export function latestSessionSystemPrompt(events: readonly Event[]): string | undefined {
  const header = events.findLast(event => event.type === 'request/header')
  const system = record(header?.data?.header).system
  return typeof system === 'string' && system.trim() ? system : undefined
}

/** Merge one Session log with its live tail. Host sequence and Session seq are distinct. */
export function mergeSessionTranscript(history: readonly unknown[], live: readonly HostEvent[], scope: TranscriptScope): { events: Event[]; repair: string } {
  const recorded = history.filter(isEvent)
  const bySeq = new Map(recorded.filter(e => typeof e.seq === 'number').map(e => [e.seq!, e]))
  const transient: Event[] = []
  const missing = new Set<number>()
  for (const host of live) {
    const data = record(host.data)
    if (data.projectId !== scope.projectId || data.sessionId !== scope.sessionId) continue
    if (host.name === 'session.event') {
      if (typeof data.afterSequence === 'number' && !bySeq.has(data.afterSequence)) missing.add(data.afterSequence)
      if (isEvent(data.event) && typeof data.event.seq === 'number') {
        if (!bySeq.has(data.event.seq)) bySeq.set(data.event.seq, data.event)
      } else if (typeof data.sessionSequence === 'number') missing.add(data.sessionSequence)
    } else if (host.name === 'agent.delta') {
      transient.push({ type: 'assistant/chunk', seq: Number(data.sessionSequence ?? Number.MAX_SAFE_INTEGER), time: host.timestamp,
        data: { turn: data.turn, step: data.step, chunk: { type: data.kind === 'reasoning' ? 'reasoning-delta' : 'text-delta', text: data.text }, transient: true } })
    }
  }
  return {
    events: [...recorded.filter(e => typeof e.seq !== 'number'), ...bySeq.values(), ...transient].sort((a, b) => (a.seq ?? -1) - (b.seq ?? -1)),
    repair: [...missing].filter(seq => !bySeq.has(seq)).sort((a, b) => a - b).join(','),
  }
}

/** One semantic projection for both incremental delivery and historical replay. */
export function projectSessionTranscript(events: readonly Event[], running = false): SessionTranscriptRow[] {
  const rows: SessionTranscriptRow[] = []
  const assistants = new Map<string, Extract<SessionTranscriptRow, { kind: 'assistant' }>>()
  const notices = new Map<string, Extract<SessionTranscriptRow, { kind: 'notice' }>>()
  const retries = new Map<string, Record<string, unknown>[]>()
  const settled = new Set(events.filter(e => e.type === 'assistant/message' && !replacement(e)).map(stepKey))
  let ordinal = 0
  let turn: unknown
  let step: unknown
  let lastAssistant: Extract<SessionTranscriptRow, { kind: 'assistant' }> | undefined
  const notice = (id: string, event: Event, label: Extract<SessionTranscriptRow, { kind: 'notice' }>['label'], text: string) => {
    let row = notices.get(id)
    if (!row) { row = { id, kind: 'notice', event, label, text }; notices.set(id, row); rows.push(row) }
    row.event = event
    row.text = text
    return row
  }
  // Replacement checkpoints are evidence for compaction, never ordinary input messages.
  const checkpoints: HistoryToolActivityProjectionEntry[] = []
  const summaries = new Map(events.filter(e => e.type === 'compaction/summary').map(e => [e.data?.compactionId, e]))
  for (const event of events) {
    const source = record(event.data?.source)
    if (event.type === 'user/message' && replacement(event) && source.kind === 'plugin' && source.plugin === 'compact' && typeof source.compactionId === 'string') {
      checkpoints.push({ kind: 'event', id: `compaction:${source.compactionId}`, event })
    }
  }
  const entries = [...projectHistoryToolActivities(events), ...checkpoints].sort((a, b) =>
    (a.kind === 'event' ? a.event.seq ?? -1 : a.activity.startSequence ?? -1) - (b.kind === 'event' ? b.event.seq ?? -1 : b.activity.startSequence ?? -1))
  for (const entry of entries) {
    if (entry.kind === 'activity') { rows.push(entry); continue }
    const event = entry.event
    const data = event.data ?? {}
    if (event.type === 'turn/start') { turn = data.turn; step = undefined; lastAssistant = undefined }
    if (event.type === 'step/start') { turn = data.turn ?? turn; step = data.step }
    const key = stepKey({ ...event, data: { ...data, turn: data.turn ?? turn, step: data.step ?? step } })
    if (event.type === 'user/message') {
      if (replacement(event)) {
        const source = record(data.source)
        const id = source.sourceCommandId ? `command:${source.sourceCommandId}` : entry.id
        notice(id, event, 'compaction', [notices.get(id)?.text, contentText(summaries.get(source.compactionId)?.data?.summary)].filter(Boolean).join('\n'))
      } else if (isHumanAgentMessage(data)) {
        rows.push({ id: transcriptUserMessageId(++ordinal), kind: 'user', event, text: agentMessageText(data) })
        lastAssistant = undefined
      } else {
        const detail = transcriptContextDetail(entry.id, data)
        if (detail) rows.push({ id: entry.id, kind: 'context', context: { id: entry.id, details: [detail] } })
      }
    } else if (event.type === 'assistant/message' || event.type === 'assistant/chunk') {
      const final = event.type === 'assistant/message'
      if (!final && settled.has(key)) continue
      const chunk = record(data.chunk)
      if (!final && chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') continue
      let row = assistants.get(key)
      if (!row) { row = { id: key, kind: 'assistant', blocks: [], status: 'streaming' }; assistants.set(key, row); rows.push(row) }
      if (final) {
        row.blocks = messageBlocks(data)
        row.event = event
        row.status = data.interrupted === true ? 'interrupted' : 'settled'
      } else {
        const kind = chunk.type === 'reasoning-delta' ? 'reasoning' : 'text'
        const previous = row.blocks.at(-1)
        if (previous?.kind === kind) previous.text += String(chunk.text ?? '')
        else row.blocks.push({ kind, text: String(chunk.text ?? '') })
      }
      lastAssistant = row
    } else if (event.type === 'llm/retry' || event.type === 'llm/retry-started') {
      if (!settled.has(key)) {
        const assistant = assistants.get(key)
        if (assistant) assistant.blocks = []
      }
      const id = `retry:${data.retryId ?? key}`
      const attempts = retries.get(id) ?? []
      if (event.type === 'llm/retry') attempts.push({ ...data, state: 'scheduled' })
      else {
        const attempt = attempts.find(attempt => attempt.retry === data.retry)
        if (attempt) attempt.state = 'started'
      }
      retries.set(id, attempts)
      const row = notice(id, event, 'retry', detailText(attempts))
      row.busy = event.type === 'llm/retry'
    } else if (event.type === 'command/run' || event.type === 'command/done') {
      const id = `command:${data.commandId}`
      const old = notices.get(id)
      const text = event.type === 'command/run' ? `/${data.name ?? ''} ${detailText(data.args)}`.trim() : [old?.text, data.text].filter(Boolean).join('\n')
      const row = notice(id, event, 'command', text)
      row.busy = event.type === 'command/run'
      row.failed = data.kind === 'error'
    } else if (event.type === 'step/end' || event.type === 'turn/end') {
      for (const [id, row] of assistants) {
        if ((event.type === 'turn/end' ? id.startsWith(`assistant:${data.turn ?? turn}:`) : id === key) && row.status === 'streaming') row.status = 'interrupted'
      }
      for (const [id, attempts] of retries) {
        const latest = attempts.at(-1)
        if (latest?.turn !== (data.turn ?? turn) || (event.type === 'step/end' && latest?.step !== (data.step ?? step))) continue
        if (latest?.state === 'scheduled') latest.state = 'cancelled'
        const row = notices.get(id)!
        row.text = detailText(attempts)
        row.busy = false
      }
      if (event.type === 'turn/end') {
        const reason = record(data.reason)
        if (reason.kind === 'error' || reason.kind === 'max-tokens') {
          const row = notice(`${entry.id}:reason`, event, reason.kind, detailText(reason.error)); row.failed = reason.kind === 'error'
        }
        if (lastAssistant?.status === 'settled' && (reason.kind === 'stop' || reason.kind === 'completed')) lastAssistant.branchSequence = event.seq
        rows.push({ id: entry.id, kind: 'turn', event })
        lastAssistant = undefined
      }
    } else if (!LOG_ONLY.has(event.type) && (event.surfaceOp === 'append' || record(event.surfaceOp).op === 'append')) {
      notice(entry.id, event, 'command', detailText(data))
    }
  }
  if (!running) for (const row of rows) {
    if (row.kind === 'assistant' && row.status === 'streaming') row.status = 'interrupted'
    if (row.kind === 'notice') row.busy = false
    if (row.kind === 'activity') {
      for (const item of row.activity.items) if (item.state === 'running') item.state = 'stopped'
      if (row.activity.state === 'running') row.activity.state = 'stopped'
    }
  }
  return rows.filter(row => row.kind !== 'assistant' || row.blocks.some(block => block.text.trim()))
}

const LOG_ONLY = new Set(['goal/change', 'plan/mode', 'session/title', 'request/header', 'request/context', 'turn/start', 'step/start', 'compaction/start', 'compaction/summary', 'compaction/end'])
function stepKey(event: Event): string { return `assistant:${event.data?.turn ?? '?'}:${event.data?.step ?? '?'}` }
function replacement(event: Event): boolean { return event.surfaceOp === 'replace' || record(event.surfaceOp).op === 'replace' }
function isEvent(value: unknown): value is Event { return typeof record(value).type === 'string' }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function detailText(value: unknown): string { return value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2) }
function contentText(value: unknown): string { return Array.isArray(value) ? value.map(block => record(block).type === 'text' ? String(record(block).text ?? '') : detailText(block)).join('') : detailText(value) }
function messageBlocks(data: Record<string, unknown>): AssistantMessageBlock[] {
  const content = (record(data.message).content ?? data.content) as unknown
  return Array.isArray(content) ? content.flatMap(value => {
    const block = record(value)
    return (block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string' ? [{ kind: block.type, text: block.text }] : []
  }) : []
}
