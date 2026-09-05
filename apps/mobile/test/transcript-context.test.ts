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
})
