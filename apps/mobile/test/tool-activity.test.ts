import { describe, expect, it } from 'vitest'
import {
  projectHistoryToolActivities,
  type ToolActivityGroup,
} from '../src/utils/tool-activity'

function historyEvent(type: string, seq: number, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type, seq, time: seq, data, ...extra }
}

function activities(entries: ReturnType<typeof projectHistoryToolActivities>): ToolActivityGroup[] {
  return entries.flatMap((entry) => entry.kind === 'activity' ? [entry.activity] : [])
}

describe('history Tool Activity projection', () => {
  it('pairs interleaved calls by callId and groups the complete turn step at its first tool position', () => {
    const projection = projectHistoryToolActivities([
      historyEvent('user/message', 1, { message: { content: [{ type: 'text', text: 'inspect' }] } }),
      historyEvent('tool/call', 2, { turn: 3, step: 4, callId: 'read', name: 'read_file', arguments: JSON.stringify({ path: 'src/a.ts', content: 'must not become the target' }) }),
      historyEvent('tool/call', 3, { turn: 3, step: 4, callId: 'list', name: 'list_files', arguments: JSON.stringify({ paths: ['src', 'test'] }) }),
      historyEvent('tool/result', 4, {
        turn: 3,
        step: 4,
        message: { source: { callId: 'list' }, content: [{ type: 'tool-result', toolCallId: 'list', isError: false, content: [{ type: 'text', text: 'ok' }] }] },
      }),
      historyEvent('tool/result', 5, {
        turn: 3,
        step: 4,
        isError: false,
        message: { source: { callId: 'read' }, content: [{ type: 'tool-result', toolCallId: 'read', isError: true, content: [{ type: 'text', text: 'missing' }] }] },
      }),
      historyEvent('turn/end', 6, { turn: 3, reason: { kind: 'completed' } }),
    ])

    expect(projection.map((entry) => entry.kind)).toEqual(['event', 'activity', 'event'])
    const group = activities(projection)[0]!
    expect(group).toMatchObject({
      id: 'tool-activity:turn:3:step:4',
      turn: 3,
      step: 4,
      startSequence: 2,
      endSequence: 5,
      sourceSequences: [2, 3, 4, 5],
      state: 'failed',
    })
    expect(group.items.map((item) => ({ callId: item.callId, name: item.name, target: item.target, state: item.state, sources: item.sourceSequences }))).toEqual([
      { callId: 'read', name: 'read_file', target: 'src/a.ts', state: 'failed', sources: [2, 5] },
      { callId: 'list', name: 'list_files', target: 'src, test', state: 'succeeded', sources: [3, 4] },
    ])
    expect(group.items[0]?.input).toEqual({ path: 'src/a.ts', content: 'must not become the target' })
    expect(group.items[0]?.error).toEqual([{ type: 'text', text: 'missing' }])
  })

  it('pairs duplicate non-empty IDs in call order while empty IDs remain independent', () => {
    const projection = projectHistoryToolActivities([
      historyEvent('tool/call', 1, { callId: 'same', name: 'first' }),
      historyEvent('tool/call', 2, { callId: 'same', name: 'second' }),
      historyEvent('tool/result', 3, { callId: 'same', content: ['one'], isError: false }),
      historyEvent('tool/result', 4, { callId: 'same', content: ['two'], isError: true }),
      historyEvent('tool/call', 5, { callId: '   ', name: 'empty-call' }),
      historyEvent('tool/result', 6, { callId: '', content: ['orphan'], isError: false }),
      historyEvent('turn/end', 7, { turn: 1 }),
    ])

    const [group] = activities(projection)
    expect(group?.items.map((item) => ({ name: item.name, callId: item.callId, state: item.state }))).toEqual([
      { name: 'first', callId: 'same', state: 'succeeded' },
      { name: 'second', callId: 'same', state: 'failed' },
      { name: 'empty-call', callId: undefined, state: 'stopped' },
      { name: 'unknown', callId: undefined, state: 'succeeded' },
    ])
    expect(new Set(group?.items.map((item) => item.id)).size).toBe(4)
  })

  it('uses consecutive legacy groups but pairs a late result back to the original call', () => {
    const projection = projectHistoryToolActivities([
      historyEvent('tool/call', 1, { callId: 'late', name: 'bash', arguments: 'not-json' }),
      historyEvent('assistant/message', 2, { message: { content: [{ type: 'text', text: 'between' }] } }),
      historyEvent('tool/result', 3, { callId: 'late', content: [{ type: 'text', text: 'done' }], isError: false }),
      historyEvent('tool/result', 4, { callId: 'orphan', content: [{ type: 'text', text: 'settled' }], isError: false }),
    ])

    expect(projection.map((entry) => entry.kind)).toEqual(['activity', 'event', 'activity'])
    const [callGroup, orphanGroup] = activities(projection)
    expect(callGroup?.items[0]).toMatchObject({ name: 'bash', input: 'not-json', output: [{ type: 'text', text: 'done' }], state: 'succeeded' })
    expect(callGroup?.sourceSequences).toEqual([1, 3])
    expect(orphanGroup?.items[0]).toMatchObject({ name: 'unknown', callId: 'orphan', state: 'succeeded' })
  })

  it('drops explicit replacement copies while preserving original top-level surface metadata and legacy events', () => {
    const original = historyEvent('user/message', 1, { text: 'original' }, { surfaceOp: 'append', sourceEventSeqs: [0] })
    const legacy = historyEvent('assistant/message', 2, { text: 'legacy' })
    const replacedAssistant = historyEvent('assistant/message', 3, { text: 'replacement' }, { surfaceOp: { op: 'replace', start: 1, end: 2 } })
    const originalResult = historyEvent('tool/result', 4, { callId: 'orphan', content: ['full'], isError: false }, { surfaceOp: 'append' })
    const prunedResult = historyEvent('tool/result', 5, { callId: 'orphan', content: ['pruned'], isError: false }, { surfaceOp: { op: 'replace', start: 4, end: 4 } })

    const projection = projectHistoryToolActivities([original, legacy, replacedAssistant, originalResult, prunedResult])
    const plainEvents = projection.flatMap((entry) => entry.kind === 'event' ? [entry.event] : [])
    expect(plainEvents).toEqual([original, legacy])
    expect(plainEvents[0]).toBe(original)
    expect(activities(projection)[0]?.items[0]?.output).toEqual(['full'])
    expect(activities(projection)[0]?.items[0]?.sourceEvents).toEqual([originalResult])
  })

  it('marks only unmatched work behind a closed step as stopped', () => {
    const projection = projectHistoryToolActivities([
      historyEvent('tool/call', 1, { turn: 1, step: 1, callId: 'closed', name: 'read_file' }),
      historyEvent('step/end', 2, { turn: 1, step: 1 }),
      historyEvent('tool/call', 3, { turn: 1, step: 2, callId: 'open', name: 'read_file' }),
    ])

    const groups = activities(projection)
    expect(groups.map((group) => group.state)).toEqual(['stopped', 'running'])
    expect(groups.map((group) => group.items[0]?.state)).toEqual(['stopped', 'running'])
  })

  it('does not let a stopped call consume a reused callId result from a later step', () => {
    const projection = projectHistoryToolActivities([
      historyEvent('tool/call', 1, { turn: 1, step: 1, callId: 'shared', name: 'first' }),
      historyEvent('step/end', 2, { turn: 1, step: 1 }),
      historyEvent('tool/call', 3, { turn: 1, step: 2, callId: 'shared', name: 'second' }),
      historyEvent('tool/result', 4, { turn: 1, step: 2, callId: 'shared', output: 'done', isError: false }),
    ])

    const groups = activities(projection)
    expect(groups[0]?.items[0]).toMatchObject({ name: 'first', state: 'stopped' })
    expect(groups[1]?.items[0]).toMatchObject({ name: 'second', output: 'done', state: 'succeeded' })
  })

  it('pairs a structured result back to a running legacy call with the same ID', () => {
    const projection = projectHistoryToolActivities([
      historyEvent('tool/call', 1, { callId: 'mixed', name: 'legacy-call' }),
      historyEvent('tool/result', 2, { turn: 2, step: 4, callId: 'mixed', output: 'done', isError: false }),
      historyEvent('turn/end', 3, { turn: 2 }),
    ])

    const groups = activities(projection)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.items[0]).toMatchObject({ name: 'legacy-call', callId: 'mixed', output: 'done', state: 'succeeded' })
  })

  it('closes structured running calls when legacy boundary events omit IDs', () => {
    const stepProjection = projectHistoryToolActivities([
      historyEvent('tool/call', 1, { turn: 1, step: 2, callId: 'step', name: 'step-call' }),
      historyEvent('step/end', 2),
    ])
    const turnProjection = projectHistoryToolActivities([
      historyEvent('tool/call', 1, { turn: 3, step: 1, callId: 'turn', name: 'turn-call' }),
      historyEvent('turn/end', 2),
    ])

    expect(activities(stepProjection)[0]?.state).toBe('stopped')
    expect(activities(turnProjection)[0]?.state).toBe('stopped')
  })
})
