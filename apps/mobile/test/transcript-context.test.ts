import { describe, expect, it } from 'vitest'
import { contextDetailSummary, transcriptContextDetail } from '../src/utils/transcript-context'

describe('transcript context details', () => {
  it('projects internal messages with their durable source', () => {
    expect(transcriptContextDetail('catalog', {
      content: [{ type: 'text', text: '<system-reminder>\nSkills here\n</system-reminder>' }],
      source: { kind: 'skill-catalog' },
    })).toEqual({ id: 'catalog', sourceKind: 'skill-catalog', text: '<system-reminder>\nSkills here\n</system-reminder>' })
  })

  it('does not project real user messages as context', () => {
    expect(transcriptContextDetail('user', {
      content: [{ type: 'text', text: '<system-reminder>literal text</system-reminder>' }],
      source: { kind: 'user' },
    })).toBeUndefined()
  })

  it('builds a compact list summary without the reminder envelope', () => {
    expect(contextDetailSummary('<system-reminder>\n  A   useful context  \n</system-reminder>')).toBe('A useful context')
  })

  it('presents goal completion without losing the full objective or original instructions', () => {
    const objective = '实现小游戏“霓虹变轨”\n支持 "再来一局" 和 C:\\games 保存位置'
    const text = `<goal_complete>\nObjective: ${JSON.stringify(objective)}\nWrite the closing message.\n</goal_complete>`
    const data = { message: { content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'tool-goal', form: 'notice', summary: 'complete: 实现小游戏…' } } }
    const original = structuredClone(data)
    expect(transcriptContextDetail('complete', data)).toMatchObject({ text, notice: { kind: 'goal-complete', objective } })
    expect(data).toEqual(original)
    expect(transcriptContextDetail('old', { content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'tool-goal' } })?.notice).toEqual({ kind: 'goal-complete', objective })
  })

  it('keeps a blocked goal distinct from completion and shows its reason', () => {
    expect(transcriptContextDetail('blocked', {
      source: { kind: 'plugin', plugin: 'tool-goal', summary: 'blocked: Ship the game' },
      content: [{ type: 'text', text: '<goal_blocked>\nObjective: "Ship the game"\nBlocked: "Connect the test device"\nWrite the closing message.\n</goal_blocked>' }],
    })?.notice).toEqual({ kind: 'goal-blocked', objective: 'Ship the game', reason: 'Connect the test device' })
  })

  it('uses supplied summaries for notices and tolerates a malformed objective', () => {
    const source = { kind: 'plugin', plugin: 'tool-goal', summary: 'complete: Build the game' }
    expect(transcriptContextDetail('fallback', { source, content: [{ type: 'text', text: '<goal_complete>\nObjective: "bad\\xescape"\n</goal_complete>' }] })?.notice).toEqual({ kind: 'goal-complete', objective: 'Build the game' })
    expect(transcriptContextDetail('summary', { source: { kind: 'plugin', plugin: 'catalog', summary: 'Available skills' }, content: [{ type: 'text', text: '<instructions>Long raw context</instructions>' }] })).toMatchObject({ summary: 'Available skills', text: '<instructions>Long raw context</instructions>' })
  })

  it('recognizes background recovery by source without interpreting quoted user text', () => {
    const content = [{ type: 'text', text: '<goal_complete>\nObjective: "Literal example"\n</goal_complete>' }]
    expect(transcriptContextDetail('human', { content, source: { kind: 'user', plugin: 'tool-goal' } })).toBeUndefined()
    expect(transcriptContextDetail('other', { content, source: { kind: 'plugin', plugin: 'other' } })?.notice).toBeUndefined()
    expect(transcriptContextDetail('resumed', { source: { kind: 'plugin', plugin: 'runwhale-background', summary: 'Resumed after background pause' }, content: [{ type: 'text', text: 'Continue the unfinished request.' }] })?.notice).toEqual({ kind: 'background-resumed' })
  })
})
