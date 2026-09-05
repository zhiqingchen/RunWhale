import { describe, expect, it } from 'vitest'
import { assistantMessageCopyText, codeCopyFeedbackReducer, formatTranscriptJson, initialCodeCopyFeedbackState, transcriptBranchActionState, transcriptInteractionContract } from '../src/utils/transcript-feedback'

describe('transcript interaction feedback', () => {
  it('uses formatted JSON only for valid structured details', () => {
    expect(formatTranscriptJson('{"message":"failed"}')).toBe('{\n  "message": "failed"\n}')
    expect(formatTranscriptJson('[1,2]')).toBe('[\n  1,\n  2\n]')
    expect(formatTranscriptJson('[context] instructions')).toBeUndefined()
    expect(formatTranscriptJson('Normal instructions')).toBeUndefined()
  })
  it('marks only the active branch action busy while disabling conflicting branch entries', () => {
    const inFlight = { throughSequence: 12 }
    expect(transcriptBranchActionState(inFlight, 12, true)).toEqual({ busy: true, available: false })
    expect(transcriptBranchActionState(inFlight, 18, true)).toEqual({ busy: false, available: false })
    expect(transcriptBranchActionState(undefined, 12, false)).toEqual({ busy: false, available: false })
    expect(transcriptBranchActionState(undefined, 12, true)).toEqual({ busy: false, available: true })
  })

  it('tracks code-copy progress, success, and timed reset without accepting duplicate starts', () => {
    const copying = codeCopyFeedbackReducer(initialCodeCopyFeedbackState, 'start')
    expect(copying).toBe('copying')
    expect(codeCopyFeedbackReducer(copying, 'start')).toBe(copying)
    const copied = codeCopyFeedbackReducer(copying, 'succeed')
    expect(copied).toBe('copied')
    expect(codeCopyFeedbackReducer(copied, 'reset')).toBe('idle')
  })

  it('keeps code-copy failures visible until the user retries', () => {
    const failed = codeCopyFeedbackReducer(codeCopyFeedbackReducer(initialCodeCopyFeedbackState, 'start'), 'fail')
    expect(failed).toBe('failed')
    expect(codeCopyFeedbackReducer(failed, 'reset')).toBe('failed')
    expect(codeCopyFeedbackReducer(failed, 'start')).toBe('copying')
  })

  it('copies assistant answer fragments faithfully while excluding reasoning', () => {
    expect(assistantMessageCopyText([
      { kind: 'reasoning', text: 'Private chain of thought' },
      { kind: 'text', text: '  First frag' },
      { kind: 'text', text: 'ment.\n' },
      { kind: 'reasoning', text: 'More private reasoning' },
      { kind: 'text', text: '    indented line\n' },
      { kind: 'text', text: 'Trailing whitespace  ' },
    ])).toBe('  First fragment.\n    indented line\nTrailing whitespace  ')
    expect(assistantMessageCopyText([{ kind: 'reasoning', text: 'Reasoning only' }])).toBe('')
    expect(assistantMessageCopyText([
      { kind: 'text', text: '  ' },
      { kind: 'reasoning', text: 'Excluded' },
      { kind: 'text', text: '\n\t' },
    ])).toBe('')
  })

  it('settles same-tick duplicate copy transitions on the first terminal result', () => {
    const copying = codeCopyFeedbackReducer(initialCodeCopyFeedbackState, 'start')

    const copied = codeCopyFeedbackReducer(copying, 'succeed')
    expect(codeCopyFeedbackReducer(copied, 'fail')).toBe('copied')

    const failed = codeCopyFeedbackReducer(copying, 'fail')
    expect(codeCopyFeedbackReducer(failed, 'succeed')).toBe('failed')
  })

  it('keeps transcript branch, copy, and disclosure targets at least 44 points tall', () => {
    expect(transcriptInteractionContract).toEqual({
      loadEarlierMinimumHeight: 44,
      branchMinimumSize: 44,
      disclosureMinimumHeight: 44,
      codeCopyMinimumSize: 44,
      assistantCopyMinimumSize: 44,
    })
    expect(Math.min(...Object.values(transcriptInteractionContract))).toBeGreaterThanOrEqual(44)
  })
})
