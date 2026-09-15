import { describe, expect, it } from 'vitest'
import { AGENT_COMPOSER_BASE_PADDING, agentComposerBottomPadding, agentKeyboardOverlap } from '../src/utils/agent-keyboard'

describe('Agent keyboard layout', () => {
  it('calculates only the part of the window covered by the keyboard', () => {
    expect(agentKeyboardOverlap(874, 539)).toBe(335)
    expect(agentKeyboardOverlap(500, 600)).toBe(0)
  })

  it('applies the bottom safe area only while the keyboard is hidden', () => {
    expect(agentComposerBottomPadding(34, false)).toBe(AGENT_COMPOSER_BASE_PADDING + 34)
    expect(agentComposerBottomPadding(34, true)).toBe(AGENT_COMPOSER_BASE_PADDING)
    expect(agentComposerBottomPadding(-1, false)).toBe(AGENT_COMPOSER_BASE_PADDING)
  })
})
