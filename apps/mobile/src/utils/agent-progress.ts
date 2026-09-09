import type { ToolActivitySessionEvent as Event } from './tool-activity'

export interface AgentProgress {
  phase: 'preparing' | 'waiting' | 'reasoning' | 'responding' | 'tool-input' | 'tool' | 'retry' | 'finishing'
  startedAt?: number
  updatedAt?: number
  tool?: string
  characters?: number
  retry?: number
  maxRetries?: number
  retryAt?: number
}

/** Only current-turn activity drives the live indicator; abandoned attempts reset it. */
export function projectAgentProgress(events: readonly Event[]): AgentProgress {
  let progress: AgentProgress = { phase: 'preparing' }
  const tools = new Map<string, { name: string; startedAt?: number }>()
  const input = new Map<string, number>()
  const start = Math.max(0, events.findLastIndex(event => event.type === 'turn/start'))
  const update = (phase: AgentProgress['phase'], time: number | undefined, detail: Partial<AgentProgress> = {}) => {
    progress = { phase, startedAt: phase === progress.phase && detail.tool === progress.tool ? progress.startedAt : time, updatedAt: time, ...detail }
  }
  for (const event of events.slice(start)) {
    const data = record(event.data)
    if (event.type === 'turn/start' || event.type === 'step/start' || event.type === 'llm/retry-started') {
      tools.clear(); input.clear()
      update('waiting', event.time)
      progress.startedAt = event.time
    } else if (event.type === 'llm/retry') {
      tools.clear(); input.clear()
      update('retry', event.time, { retry: number(data.retry), maxRetries: number(data.maxRetries), retryAt: event.time === undefined ? undefined : event.time + (number(data.delayMs) ?? 0) })
    } else if (event.type === 'assistant/chunk') {
      const chunk = record(data.chunk)
      if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') update(chunk.type === 'text-delta' ? 'responding' : 'reasoning', event.time)
      else if (chunk.type === 'tool-call-delta') {
        const key = String(chunk.id || (chunk.index ?? 'tool'))
        const characters = (input.get(key) ?? 0) + (number(chunk.characters) ?? String(chunk.argumentsDelta ?? '').length)
        input.set(key, characters)
        update('tool-input', event.time, { tool: String(chunk.name || progress.tool || ''), characters })
      }
      if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'tool-call-delta') progress.updatedAt = number(data.updatedAt) ?? event.time
    } else if (event.type === 'tool/call') {
      const name = String(data.name ?? '')
      tools.set(String(data.callId), { name, startedAt: event.time })
      const first = tools.values().next().value!
      update('tool', event.time, { tool: [...tools.values()].map(tool => tool.name).join(', '), startedAt: first.startedAt })
    } else if (event.type === 'tool/result') {
      const callId = data.callId ?? record(record(data.message).source).callId
      tools.delete(String(callId))
      const first = tools.values().next().value
      update(first ? 'tool' : 'finishing', event.time, first ? { tool: [...tools.values()].map(tool => tool.name).join(', '), startedAt: first.startedAt } : {})
    } else if (event.type === 'step/end' || event.type === 'turn/end') {
      tools.clear(); input.clear()
      update('finishing', event.time)
    }
  }
  return progress
}

function record(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {} }
function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
