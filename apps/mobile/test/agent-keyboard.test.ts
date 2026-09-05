import { describe, expect, it } from 'vitest'
import { AGENT_COMPOSER_BASE_PADDING, AGENT_IOS_QUESTION_KEYBOARD_CLEARANCE, AGENT_IOS_QUESTION_KEYBOARD_REVEAL_DELTA, AGENT_QUESTION_KEYBOARD_CLEARANCE, AGENT_QUESTION_KEYBOARD_REVEAL_DELTA, agentComposerBottomPadding, agentKeyboardDismissMode, agentKeyboardOverlap, agentQuestionKeyboardClearance, agentQuestionKeyboardRevealOffset } from '../src/utils/agent-keyboard'

describe('Agent keyboard layout', () => {
  it('calculates only the part of the window covered by the keyboard', () => {
    expect(agentKeyboardOverlap(874, 539)).toBe(335)
    expect(agentKeyboardOverlap(500, 600)).toBe(0)
  })

  it('supports interactive iOS dismissal and drag dismissal elsewhere', () => {
    expect(agentKeyboardDismissMode('ios')).toBe('interactive')
    expect(agentKeyboardDismissMode('android')).toBe('on-drag')
  })

  it('applies the bottom safe area only while the keyboard is hidden', () => {
    expect(agentComposerBottomPadding(34, false)).toBe(AGENT_COMPOSER_BASE_PADDING + 34)
    expect(agentComposerBottomPadding(34, true)).toBe(AGENT_COMPOSER_BASE_PADDING)
    expect(agentComposerBottomPadding(-1, false)).toBe(AGENT_COMPOSER_BASE_PADDING)
  })

  it('expands only the iOS question clearance while preserving Android behavior', () => {
    expect(AGENT_QUESTION_KEYBOARD_CLEARANCE).toBe(72)
    expect(AGENT_QUESTION_KEYBOARD_REVEAL_DELTA).toBe(72)
    expect(AGENT_IOS_QUESTION_KEYBOARD_CLEARANCE).toBe(176)
    expect(AGENT_IOS_QUESTION_KEYBOARD_REVEAL_DELTA).toBe(200)
    expect(agentQuestionKeyboardClearance('ios')).toBe(176)
    expect(agentQuestionKeyboardClearance('android')).toBe(72)
    expect(agentQuestionKeyboardRevealOffset(128, 'ios')).toBe(328)
    expect(agentQuestionKeyboardRevealOffset(128, 'android')).toBe(200)
    expect(agentQuestionKeyboardRevealOffset(-20, 'ios')).toBe(200)
  })
})
