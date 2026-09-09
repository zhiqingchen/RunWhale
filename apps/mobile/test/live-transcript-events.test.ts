import type { HostEvent, HostEventName } from '@runwhale/mobile-protocol'
import { describe, expect, it } from 'vitest'
import { appendLiveTranscriptEvent, compactLiveTranscriptEvents } from '../src/utils/live-transcript-events'
import { mergeSessionTranscript, projectSessionTranscript } from '../src/utils/session-transcript'
import { projectAgentProgress } from '../src/utils/agent-progress'

const messages = (events: HostEvent[], scope = base) => projectSessionTranscript(mergeSessionTranscript([], events, scope).events, true).flatMap(row => row.kind === 'assistant' ? row.blocks.map(block => block.text) : [])

const base = { projectId: 'project', sessionId: 'session', taskId: 'task' }

function hostEvent(sequence: number, name: HostEventName, data: Record<string, unknown>): HostEvent {
  return { v: 1, type: 'event', sequence, timestamp: sequence, name, data }
}

describe('live transcript event compaction', () => {
  it('shows coalesced tool input activity without exposing arguments as assistant text', () => {
    const fragments = Array.from({ length: 600 }, (_, index) => hostEvent(index + 1, 'agent.delta', {
      ...base, kind: 'tool-call', callId: 'write', index: 0, tool: 'write_files', characters: 4,
      turn: 1, step: 1, sessionSequence: index + 1, sessionTime: 1_000 + index * 100,
    }))
    const compacted = compactLiveTranscriptEvents(fragments)
    expect(compacted).toHaveLength(1)
    expect(messages(compacted)).toEqual([])
    const events = mergeSessionTranscript([], compacted, base).events
    expect(projectAgentProgress(events)).toEqual({ phase: 'tool-input', tool: 'write_files', characters: 2_400, startedAt: 1_000, updatedAt: 60_900 })
    expect(appendLiveTranscriptEvent(compacted, fragments.at(-1)!)).toBe(compacted)

    const nextTool = appendLiveTranscriptEvent(compacted, hostEvent(601, 'agent.delta', {
      ...base, kind: 'tool-call', callId: 'check', index: 1, tool: 'git_diff', characters: 2,
      turn: 1, step: 1, sessionSequence: 601, sessionTime: 61_000,
    }))
    expect(nextTool).toHaveLength(2)
    expect(projectAgentProgress(mergeSessionTranscript([], nextTool, base).events)).toMatchObject({ tool: 'git_diff', characters: 2, startedAt: 61_000 })
    const retry = appendLiveTranscriptEvent(nextTool, hostEvent(602, 'agent.state', { ...base, state: 'llm/retry', turn: 1, step: 1 }))
    expect(retry.filter(event => event.name === 'agent.delta')).toHaveLength(0)
  })

  it('keeps the complete response after the generic event window passes 500 entries', () => {
    const fragments = Array.from({ length: 600 }, (_, index) => `[${String(index).padStart(3, '0')}]`)
    const events = [
      hostEvent(1, 'agent.state', { ...base, state: 'turn/start', turn: 1, sessionSequence: 1 }),
      ...fragments.map((text, index) => hostEvent(index + 2, 'agent.delta', {
        ...base,
        kind: 'text',
        text,
        turn: 1,
        step: 1,
        sessionSequence: index + 2,
      })),
    ]

    expect(events.slice(-500)[0]?.sequence).toBe(102)
    const compacted = compactLiveTranscriptEvents(events)
    expect(compacted).toHaveLength(2)
    expect(messages(compacted)).toEqual([fragments.join('')])
  })

  it('drops a failed retry attempt and applies reconnect replays idempotently', () => {
    const failed = [
      hostEvent(10, 'agent.delta', { ...base, kind: 'text', text: 'pan', turn: 1, step: 1, sessionSequence: 10 }),
      hostEvent(11, 'agent.delta', { ...base, kind: 'text', text: 'Respond', turn: 1, step: 1, sessionSequence: 11 }),
    ]
    const retry = hostEvent(12, 'agent.state', { ...base, state: 'llm/retry', turn: 1, step: 1, sessionSequence: 12 })
    const successful = [
      hostEvent(14, 'agent.delta', { ...base, kind: 'text', text: 'correct', turn: 1, step: 1, sessionSequence: 14 }),
      hostEvent(15, 'agent.delta', { ...base, kind: 'text', text: ' answer', turn: 1, step: 1, sessionSequence: 15 }),
    ]
    let compacted = compactLiveTranscriptEvents([...failed, retry, ...successful])
    const beforeReplay = compacted
    for (const event of [...failed, retry, ...successful]) compacted = appendLiveTranscriptEvent(compacted, event)

    expect(compacted).toBe(beforeReplay)
    expect(messages(compacted)).toEqual(['correct answer'])

    compacted = appendLiveTranscriptEvent(compacted, hostEvent(16, 'agent.delta', {
      ...base,
      kind: 'text',
      text: '!',
      turn: 1,
      step: 1,
      sessionSequence: 16,
    }))
    expect(messages(compacted)).toEqual(['correct answer!'])
  })

  it('does not merge across task, kind, step, or tool boundaries', () => {
    const otherTask = { ...base, taskId: 'other-task' }
    const compacted = compactLiveTranscriptEvents([
      hostEvent(1, 'agent.delta', { ...base, kind: 'text', text: 'one', turn: 1, step: 1, sessionSequence: 1 }),
      hostEvent(2, 'agent.delta', { ...otherTask, kind: 'text', text: 'other', turn: 1, step: 1, sessionSequence: 1 }),
      hostEvent(3, 'agent.delta', { ...base, kind: 'reasoning', text: 'think', turn: 1, step: 1, sessionSequence: 2 }),
      hostEvent(4, 'agent.delta', { ...base, kind: 'text', text: 'two', turn: 1, step: 2, sessionSequence: 3 }),
      hostEvent(5, 'agent.tool', { ...base, phase: 'call', tool: 'read_file', callId: 'read', turn: 1, step: 2, sessionSequence: 4 }),
      hostEvent(6, 'agent.delta', { ...base, kind: 'text', text: 'three', turn: 1, step: 2, sessionSequence: 5 }),
    ])

    expect(compacted).toHaveLength(6)
  })

  it('retains individual live user messages between assistant segments', () => {
    const compacted = compactLiveTranscriptEvents([
      hostEvent(1, 'agent.message', { ...base, messageId: 'one', message: { id: 'one', content: [{ type: 'text', text: 'one' }], source: { kind: 'user' } }, sessionSequence: 10 }),
      hostEvent(2, 'agent.delta', { ...base, kind: 'text', text: 'answer one', turn: 1, step: 1, sessionSequence: 11 }),
      hostEvent(3, 'agent.message', { ...base, messageId: 'two', message: { id: 'two', content: [{ type: 'text', text: 'two' }], source: { kind: 'user' } }, sessionSequence: 12 }),
      hostEvent(4, 'agent.delta', { ...base, kind: 'text', text: 'answer two', turn: 2, step: 1, sessionSequence: 13 }),
    ])

    expect(compacted.map((event) => event.name)).toEqual(['agent.message', 'agent.delta', 'agent.message', 'agent.delta'])
  })

  it('never evicts active tasks when bounding completed transcript history', () => {
    const events = Array.from({ length: 9 }, (_, index) => {
      const identity = { projectId: 'project', sessionId: `session-${index}`, taskId: `task-${index}` }
      return [
        hostEvent(index * 2 + 1, 'agent.state', { ...identity, state: 'running' }),
        hostEvent(index * 2 + 2, 'agent.delta', { ...identity, kind: 'text', text: String(index), turn: 1, step: 1 }),
      ]
    }).flat()

    const compacted = compactLiveTranscriptEvents(events)
    for (let index = 0; index < 9; index += 1) {
      expect(messages(compacted, {
        projectId: 'project',
        sessionId: `session-${index}`,
        taskId: `task-${index}`,
      })).toEqual([String(index)])
    }
  })
})
