import type { HostEvent, HostEventName } from '@runwhale/mobile-protocol'
import { describe, expect, it } from 'vitest'
import { projectAgentTodos } from '../src/utils/agent-todo'

const base = { projectId: 'project', sessionId: 'session', taskId: 'task' }

function historyEvent(type: string, seq: number, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type, seq, time: seq, data, ...extra }
}

function hostEvent(sequence: number, name: HostEventName, data: Record<string, unknown>): HostEvent {
  return { v: 1, type: 'event', sequence, timestamp: sequence, name, data }
}

describe('Agent todo projection', () => {
  it('uses the latest whole-list write and retains it through the end of a turn', () => {
    const todos = projectAgentTodos([
      historyEvent('turn/start', 1),
      historyEvent('todo/write', 2, { todos: [{ content: 'Inspect', status: 'in_progress' }, { content: 'Verify', status: 'pending' }] }),
      historyEvent('todo/write', 3, { todos: [{ content: 'Inspect', status: 'completed' }, { content: 'Verify', status: 'in_progress' }] }),
      historyEvent('turn/end', 4),
    ], [], base)

    expect(todos).toEqual([
      { content: 'Inspect', status: 'completed' },
      { content: 'Verify', status: 'in_progress' },
    ])
  })

  it('clears the previous plan when a new turn starts', () => {
    const todos = projectAgentTodos([
      historyEvent('todo/write', 1, { todos: [{ content: 'Old work', status: 'completed' }] }),
      historyEvent('turn/start', 2),
    ], [], base)

    expect(todos).toBeUndefined()
  })

  it('applies live writes immediately and clears an old durable plan at live turn start', () => {
    const history = [historyEvent('todo/write', 1, { todos: [{ content: 'Old work', status: 'completed' }] })]
    const live = [
      hostEvent(3, 'agent.state', { ...base, state: 'todo/write', detail: { todos: [{ content: 'Build', status: 'in_progress' }] } }),
      hostEvent(2, 'agent.state', { ...base, state: 'turn/start' }),
    ]

    expect(projectAgentTodos(history, live, base)).toEqual([{ content: 'Build', status: 'in_progress' }])
    expect(projectAgentTodos(history, live.slice(1), base)).toBeUndefined()
  })

  it('ignores other tasks and explicit surface replacement copies', () => {
    const todos = projectAgentTodos([
      historyEvent('todo/write', 1, { todos: [{ content: 'Keep', status: 'pending' }] }),
      historyEvent('todo/write', 2, { todos: [{ content: 'Ignore', status: 'completed' }] }, { surfaceOp: { op: 'replace' } }),
    ], [
      hostEvent(3, 'agent.state', { ...base, taskId: 'other', state: 'todo/write', detail: { todos: [{ content: 'Other', status: 'pending' }] } }),
    ], base)

    expect(todos).toEqual([{ content: 'Keep', status: 'pending' }])
  })

  it('hides empty replacement lists', () => {
    expect(projectAgentTodos([
      historyEvent('todo/write', 1, { todos: [] }),
    ], [], base)).toBeUndefined()
  })
})
