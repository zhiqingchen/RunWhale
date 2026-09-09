import { agentMessageSource, isHumanAgentMessage } from './agent-message'

export interface TranscriptContextDetail {
  id: string
  sourceKind: string
  sourceName?: string
  text: string
  summary?: string
  notice?: { kind: 'goal-complete' | 'goal-blocked' | 'background-resumed'; objective?: string; reason?: string }
}

export interface TranscriptContextRecord {
  id: string
  details: TranscriptContextDetail[]
}

export function transcriptContextDetail(id: string, data: Record<string, unknown> | undefined): TranscriptContextDetail | undefined {
  if (isHumanAgentMessage(data)) return undefined
  const message = data?.message && typeof data.message === 'object' ? data.message as Record<string, unknown> : data
  const text = Array.isArray(message?.content) ? message.content.map(block => block?.type === 'text' ? block.text : JSON.stringify(block, null, 2)).join('') : ''
  if (!text.trim()) return undefined
  const source = agentMessageSource(data)
  const sourceKind = typeof source?.kind === 'string' && source.kind ? source.kind : 'internal'
  const plugin = typeof source?.plugin === 'string' && source.plugin ? source.plugin : undefined
  const summary = typeof source?.summary === 'string' && source.summary.trim() ? source.summary.trim() : undefined
  const notice = sourceKind === 'plugin' ? contextNotice(plugin, text, summary) : undefined
  return { id, sourceKind, ...(plugin ? { sourceName: plugin } : {}), text, ...(summary ? { summary } : {}), ...(notice ? { notice } : {}) }
}

/** Interpret only known plugin records; quoted control text in a human message stays literal. */
function contextNotice(plugin: string | undefined, text: string, summary: string | undefined): TranscriptContextDetail['notice'] {
  if (plugin === 'runwhale-background') return { kind: 'background-resumed' }
  if (plugin !== 'tool-goal') return undefined
  const summaryMatch = summary?.match(/^(complete|blocked):\s*(.*)$/s)
  const phase = text.trimStart().match(/^<goal_(complete|blocked)>/)?.[1] ?? summaryMatch?.[1]
  if (phase !== 'complete' && phase !== 'blocked') return undefined
  const objective = contextJsonString(text, 'Objective') ?? summaryMatch?.[2]?.trim()
  const reason = phase === 'blocked' ? contextJsonString(text, 'Blocked') : undefined
  return { kind: phase === 'complete' ? 'goal-complete' : 'goal-blocked', ...(objective ? { objective } : {}), ...(reason ? { reason } : {}) }
}

function contextJsonString(text: string, label: 'Objective' | 'Blocked'): string | undefined {
  const value = text.split('\n').find(line => line.startsWith(`${label}:`))?.slice(label.length + 1).trim()
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'string' && parsed.trim() ? parsed : undefined
  } catch { return undefined }
}

export function contextDetailSummary(text: string, limit = 160): string {
  const normalized = text.replace(/<\/?system-reminder>/g, '').replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}
