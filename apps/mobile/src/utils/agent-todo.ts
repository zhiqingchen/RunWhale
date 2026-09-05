import type { HostEvent } from '@runwhale/mobile-protocol'

export type AgentTodoStatus = 'pending' | 'in_progress' | 'completed'

export interface AgentTodoItem {
  content: string
  status: AgentTodoStatus
}

export interface AgentTodoProjectionOptions {
  projectId: string
  sessionId?: string
  taskId?: string
}

/**
 * Replays the durable and current live session tails using dsh-tool-todo's projection rules:
 * every todo/write replaces the whole list, and the next turn/start clears it.
 */
export function projectAgentTodos(
  persistedEvents: readonly unknown[],
  liveEvents: readonly HostEvent[],
  options: AgentTodoProjectionOptions,
): AgentTodoItem[] | undefined {
  let todos: AgentTodoItem[] | undefined

  for (const value of persistedEvents) {
    const event = asRecord(value)
    if (!event || typeof event.type !== 'string' || isExplicitReplacement(event.surfaceOp)) continue
    if (event.type === 'turn/start') todos = undefined
    else if (event.type === 'todo/write') todos = todoItems(asRecord(event.data)?.todos)
  }

  for (const event of [...liveEvents].sort((left, right) => left.sequence - right.sequence)) {
    if (event.name !== 'agent.state') continue
    const data = asRecord(event.data)
    if (!belongsToSession(data, options)) continue
    if (data?.state === 'turn/start') todos = undefined
    else if (data?.state === 'todo/write') todos = todoItems(asRecord(data.detail)?.todos)
  }

  return todos?.length ? todos : undefined
}

function todoItems(value: unknown): AgentTodoItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items: AgentTodoItem[] = []
  for (const valueItem of value) {
    const item = asRecord(valueItem)
    const content = typeof item?.content === 'string' ? item.content.trim() : ''
    const status = item?.status
    if (!content || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')) continue
    items.push({ content, status })
  }
  return items
}

function belongsToSession(data: Record<string, unknown> | undefined, options: AgentTodoProjectionOptions): boolean {
  if (!data || data.projectId !== options.projectId) return false
  if (options.sessionId !== undefined && data.sessionId !== options.sessionId) return false
  return options.taskId === undefined || data.taskId === options.taskId
}

function isExplicitReplacement(value: unknown): boolean {
  if (value === 'replace') return true
  return asRecord(value)?.op === 'replace'
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
