import { describe, expect, it } from 'vitest'
import { projectAgentProgress } from '../src/utils/agent-progress'
import type { ToolActivitySessionEvent } from '../src/utils/tool-activity'

const event = (type: string, time: number, data: Record<string, unknown> = {}): ToolActivitySessionEvent => ({ type, time, data })
const chunk = (time: number, data: Record<string, unknown>) => event('assistant/chunk', time, { chunk: data })

describe('live agent progress', () => {
  it('distinguishes waiting, reasoning, text, and slow tool input from tool execution', () => {
    const events = [event('turn/start', 100), event('step/start', 200)]
    expect(projectAgentProgress(events)).toEqual({ phase: 'waiting', startedAt: 200, updatedAt: 200 })
    events.push(chunk(300, { type: 'reasoning-delta', text: 'Thinking' }))
    expect(projectAgentProgress(events).phase).toBe('reasoning')
    events.push(chunk(400, { type: 'text-delta', text: 'Writing the game' }))
    expect(projectAgentProgress(events).phase).toBe('responding')
    events.push(chunk(500, { type: 'tool-call-delta', id: 'write', index: 0, name: 'write_files', argumentsDelta: '{' }))
    events.push(chunk(90_000, { type: 'tool-call-delta', id: 'write', index: 0, argumentsDelta: '"files":[' }))
    expect(projectAgentProgress(events)).toEqual({ phase: 'tool-input', tool: 'write_files', characters: 10, startedAt: 500, updatedAt: 90_000 })
    events.push(event('tool/call', 90_100, { callId: 'write', name: 'write_files' }))
    expect(projectAgentProgress(events)).toEqual({ phase: 'tool', tool: 'write_files', startedAt: 90_100, updatedAt: 90_100 })
  })

  it('keeps outstanding parallel tools visible until their results arrive', () => {
    const events = [event('tool/call', 100, { callId: 'read', name: 'read_files' }), event('tool/call', 200, { callId: 'git', name: 'git_status' })]
    expect(projectAgentProgress(events)).toMatchObject({ phase: 'tool', tool: 'read_files, git_status', startedAt: 100 })
    events.push(event('tool/result', 300, { message: { source: { callId: 'read' } } }))
    expect(projectAgentProgress(events)).toMatchObject({ phase: 'tool', tool: 'git_status', startedAt: 200 })
    events.push(event('tool/result', 400, { callId: 'git' }))
    expect(projectAgentProgress(events)).toEqual({ phase: 'finishing', startedAt: 400, updatedAt: 400 })
  })

  it('resets abandoned input and timers on retry and on the next turn', () => {
    const events = [chunk(100, { type: 'tool-call-delta', id: 'write', name: 'write_files', argumentsDelta: 'incomplete' })]
    events.push(event('llm/retry', 200, { retry: 1, maxRetries: 2, delayMs: 500 }))
    expect(projectAgentProgress(events)).toEqual({ phase: 'retry', startedAt: 200, updatedAt: 200, retry: 1, maxRetries: 2, retryAt: 700 })
    events.push(event('llm/retry-started', 700))
    expect(projectAgentProgress(events)).toEqual({ phase: 'waiting', startedAt: 700, updatedAt: 700 })
    events.push(chunk(800, { type: 'tool-call-delta', id: 'write', name: 'write_files', characters: 2 }))
    expect(projectAgentProgress(events)).toMatchObject({ phase: 'tool-input', characters: 2, startedAt: 800 })
    events.push(event('turn/start', 1_000))
    expect(projectAgentProgress(events)).toEqual({ phase: 'waiting', startedAt: 1_000, updatedAt: 1_000 })
  })
})
