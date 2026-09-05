import { agentMessageSource, isHumanAgentMessage } from './agent-message'

export interface TranscriptContextDetail {
  id: string
  sourceKind: string
  sourceName?: string
  text: string
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
  return { id, sourceKind, ...(plugin ? { sourceName: plugin } : {}), text }
}

export function contextDetailSummary(text: string, limit = 160): string {
  const normalized = text.replace(/<\/?system-reminder>/g, '').replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}
