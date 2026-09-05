import { describe, expect, it } from 'vitest'
import type { HostEvent } from '@runwhale/mobile-protocol'
import { latestSessionSystemPrompt, mergeSessionTranscript, projectSessionTranscript } from '../src/utils/session-transcript'
import type { ToolActivitySessionEvent as Event } from '../src/utils/tool-activity'

const scope = { projectId: 'project', sessionId: 'session', taskId: 'task' }
const event = (type: string, seq: number, data: Record<string, unknown> = {}, surfaceOp?: unknown): Event => ({ type, seq, time: seq, data, ...(surfaceOp ? { surfaceOp } : {}) })
const message = (text: string, kind = 'user') => ({ content: [{ type: 'text', text }], source: { kind } })
function live(e: Event, afterSequence?: number): HostEvent {
  return { v: 1, type: 'event', name: 'session.event', sequence: e.seq! + 100, timestamp: e.time!, data: { ...scope, event: e, afterSequence, sessionSequence: e.seq } }
}
const delta = (seq: number, text: string): HostEvent => ({ ...live(event('', seq)), name: 'agent.delta', data: { ...scope, sessionSequence: seq, turn: 1, step: 1, kind: 'text', text } })

describe('one Session transcript', () => {
  it('converges at every history/live split, including duplicate deliveries and final handoff', () => {
    const log = [
      event('user/message', 0, message('inspect')),
      event('turn/start', 1, { turn: 1 }),
      event('step/start', 2, { turn: 1, step: 1 }),
      event('goal/change', 3, { goal: { objective: 'work' } }),
      event('user/message', 4, message('injected context', 'plugin')),
      event('request/context', 5, { contextWindow: 128000 }),
      event('request/header', 6, { reason: 'initial', header: { system: 'System instructions' } }),
      event('assistant/message', 8, { turn: 1, step: 1, ...message('answer') }),
      event('tool/call', 9, { turn: 1, step: 1, callId: 'read', name: 'read_files', input: { path: 'a.ts' } }),
      event('tool/result', 10, { turn: 1, step: 1, callId: 'read', output: 'result', isError: false }),
      event('step/end', 11, { turn: 1, step: 1 }),
      event('turn/end', 12, { turn: 1, reason: { kind: 'stop' }, usage: { inputTokens: 120, outputTokens: 42 } }),
    ]
    const expected = projectSessionTranscript(log)
    expect(expected.map(row => row.kind)).toEqual(['user', 'context', 'assistant', 'activity', 'turn'])
    for (let split = 0; split <= log.length; split++) {
      const tail = log.slice(split).map((e, i) => live(e, log[split + i - 1]?.seq))
      const merged = mergeSessionTranscript(log.slice(0, split), [...tail, ...tail, delta(7, 'partial')], scope)
      expect(merged.repair).toBe('')
      expect(projectSessionTranscript(merged.events)).toEqual(expected)
      expect(latestSessionSystemPrompt(merged.events)).toBe('System instructions')
    }
    const pending = projectSessionTranscript(mergeSessionTranscript(log.slice(0, 4), [live(log[4]!), delta(7, 'partial')], scope).events, true)
    expect(pending.find(row => row.kind === 'context')).toMatchObject({ context: { details: [{ text: 'injected context' }] } })
    expect(pending.find(row => row.kind === 'assistant')).toMatchObject({ id: 'assistant:1:1', status: 'streaming', blocks: [{ text: 'partial' }] })
    expect(expected.find(row => row.kind === 'assistant')).toMatchObject({ id: 'assistant:1:1', status: 'settled', branchSequence: 12 })
  })

  it('repairs missing or oversized records without treating chunk seq gaps as missing records', () => {
    const first = event('user/message', 0, message('a'))
    const last = event('turn/end', 8, { turn: 1 })
    const signal = { ...live(event('user/message', 6)), data: { ...scope, sessionSequence: 6, afterSequence: 0 } }
    const tail = [signal, live(last, 6)]
    expect(mergeSessionTranscript([first], tail, scope).repair).toBe('6')
    expect(mergeSessionTranscript([first, event('user/message', 6, message('x'.repeat(200000), 'plugin'))], tail, scope).repair).toBe('')
    expect(mergeSessionTranscript([first], [live(last, 0)], scope).repair).toBe('')
    expect(mergeSessionTranscript([], [live(first)], { ...scope, sessionId: 'other' }).events).toEqual([])
  })

  it('keeps log-only state out of chat and correlates commands and landed compaction only', () => {
    const log = [
      ...['goal/change', 'plan/mode', 'session/title', 'request/context'].map((type, seq) => event(type, seq, {}, 'append')),
      event('command/run', 4, { commandId: 'goal', name: 'goal', args: ' ship' }),
      event('command/done', 5, { commandId: 'goal', kind: 'success', text: 'Goal created' }),
      event('compaction/start', 6, { compactionId: 'auto' }),
      event('compaction/summary', 7, { compactionId: 'auto', summary: [{ type: 'text', text: 'Summary' }] }),
    ]
    expect(projectSessionTranscript(log)).toHaveLength(1)
    log.push(event('user/message', 8, { ...message('replacement'), source: { kind: 'plugin', plugin: 'compact', compactionId: 'auto' } }, { op: 'replace', start: 0, end: 3 }))
    log.push(event('compaction/end', 9, { compactionId: 'auto' }))
    log.push(event('command/run', 10, { commandId: 'manual', name: 'compact' }))
    log.push(event('user/message', 11, { ...message('replacement'), source: { kind: 'plugin', plugin: 'compact', compactionId: 'manual-compact', sourceCommandId: 'manual' } }, 'replace'))
    log.push(event('command/done', 12, { commandId: 'manual', kind: 'success', text: 'Compacted' }))
    const rows = projectSessionTranscript(log)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ text: '/goal  ship\nGoal created', busy: false })
    expect(rows[1]).toMatchObject({ label: 'compaction', text: 'Summary', event: { seq: 8 } })
    expect(rows[2]).toMatchObject({ id: 'command:manual', text: '/compact\nCompacted' })
  })

  it('resets failed chunks, retains the retry chain and cancels a scheduled retry at its boundary', () => {
    const log = [
      event('assistant/chunk', 0, { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'wrong' } }),
      event('llm/retry', 1, { turn: 1, step: 1, retryId: 'r', retry: 1, error: { message: 'busy' } }),
      event('llm/retry-started', 2, { turn: 1, step: 1, retryId: 'r', retry: 1 }),
      event('assistant/chunk', 3, { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'correct' } }),
    ]
    expect(projectSessionTranscript(log, true).find(row => row.kind === 'assistant')).toMatchObject({ blocks: [{ text: 'correct' }] })
    log.push(event('llm/retry', 4, { turn: 1, step: 1, retryId: 'r', retry: 2 }))
    log.push(event('turn/end', 5, { turn: 1, reason: { kind: 'error', error: { message: 'cancelled' } } }))
    const rows = projectSessionTranscript(log)
    const retry = rows.find(row => row.kind === 'notice' && row.label === 'retry')!
    expect(retry).toMatchObject({ busy: false })
    expect(JSON.parse((retry as { text: string }).text).map((attempt: { state: string }) => attempt.state)).toEqual(['started', 'cancelled'])
    expect(rows.some(row => row.kind === 'assistant')).toBe(false)
    expect(rows.find(row => row.kind === 'notice' && row.label === 'error')).toMatchObject({ failed: true, text: expect.stringContaining('cancelled') })
  })

  it('keeps every request header in the log and exposes only the latest instructions in details', () => {
    const log = [
      event('user/message', 0, { source: { kind: 'plugin', plugin: 'catalog' }, content: [{ type: 'text', text: 'a ' }, { type: 'widget', value: 42 }, { type: 'text', text: ' b' }] }),
      event('request/header', 1, { reason: 'initial', header: { system: 'Instructions', tools: [] } }),
      event('request/header', 2, { reason: 'change', header: { system: 'Instructions', tools: ['new'] } }),
      event('request/header', 3, { reason: 'change', header: { system: 'New instructions' } }),
      event('request/header', 4, { reason: 'series', header: { system: 'New instructions' } }),
      event('request/header', 5, { reason: 'resume', header: { system: 'New instructions' } }),
      event('request/header', 6, { reason: 'change', startsSeries: true, header: { system: 'Final instructions\n\nPreserve whitespace.' } }, 'append'),
      event('turn/end', 7, { turn: 1, reason: { kind: 'max-tokens' } }),
    ]
    const original = structuredClone(log)
    const rows = projectSessionTranscript(log)
    expect(rows.map(row => row.kind)).toEqual(['context', 'notice', 'turn'])
    expect(rows[0]).toMatchObject({ context: { details: [{ text: 'a {\n  "type": "widget",\n  "value": 42\n} b', sourceName: 'catalog' }] } })
    expect(latestSessionSystemPrompt(log)).toBe('Final instructions\n\nPreserve whitespace.')
    expect(log).toEqual(original)
    // A new complete header without a prompt must never resurrect an older prompt.
    expect(latestSessionSystemPrompt([...log, event('request/header', 8, { header: {} })])).toBeUndefined()
    expect(latestSessionSystemPrompt([...log, event('request/header', 8, { header: { system: '' } })])).toBeUndefined()
    expect(latestSessionSystemPrompt([])).toBeUndefined()
  })
})
