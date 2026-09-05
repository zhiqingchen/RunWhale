export interface PortableAgentMessage {
  content?: unknown
  source?: unknown
}

export interface PortableAgentMessageEvent {
  type?: unknown
  data?: Record<string, unknown>
}

export function agentMessage(data: Record<string, unknown> | undefined): PortableAgentMessage | undefined {
  const nested = asRecord(data?.message)
  return (nested ?? data) as PortableAgentMessage | undefined
}

export function agentMessageText(data: Record<string, unknown> | undefined): string {
  const content = agentMessage(data)?.content
  if (!Array.isArray(content)) return ''
  return content.flatMap((value) => {
    const block = asRecord(value)
    return block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []
  }).join('\n')
}

export function agentMessageSource(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return asRecord(agentMessage(data)?.source)
}

/**
 * DSH persists both human prompts and model-facing injections as user-role
 * messages. Their typed source is authoritative; the text fallback only keeps
 * older session records without source metadata from exposing known injections.
 */
export function isHumanAgentMessage(data: Record<string, unknown> | undefined): boolean {
  const sourceKind = agentMessageSource(data)?.kind
  if (typeof sourceKind === 'string' && sourceKind) return sourceKind === 'user'
  return !isLegacyInternalMessageText(agentMessageText(data))
}

export function lastHumanUserPrompt(events: readonly unknown[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = asRecord(events[index]) as PortableAgentMessageEvent | undefined
    if (event?.type !== 'user/message' || !isHumanAgentMessage(event.data)) continue
    const text = agentMessageText(event.data).trim()
    if (text) return text
  }
  return ''
}

function isLegacyInternalMessageText(text: string): boolean {
  const normalized = text.trimStart()
  return normalized.startsWith('Current runtime context.')
    || normalized.startsWith('<system-reminder>')
    || normalized.startsWith('<available_skills>')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
