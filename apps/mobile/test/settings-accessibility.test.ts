import { describe, expect, it } from 'vitest'
import { settingsAccessibilityContract, settingsChoiceAccessibility, settingsRadioAccessibilityState } from '../src/utils/settings-accessibility'

describe('Settings accessibility contract', () => {
  it('uses explicit button and radio roles', () => {
    expect(settingsAccessibilityContract).toEqual({ buttonRole: 'button', radioRole: 'radio' })
  })

  it('combines a choice label with its optional scope hint', () => {
    expect(settingsChoiceAccessibility('Permission mode', 'Read only', 'Blocks file writes.')).toEqual({
      accessibilityLabel: 'Permission mode, Read only',
      accessibilityHint: 'Blocks file writes.',
    })
    expect(settingsChoiceAccessibility('Provider', 'DeepSeek')).toEqual({
      accessibilityLabel: 'Provider, DeepSeek',
    })
  })

  it('reports radio selection with checked while preserving operational state', () => {
    expect(settingsRadioAccessibilityState(true)).toEqual({ checked: true })
    expect(settingsRadioAccessibilityState(false, { busy: true, disabled: true })).toEqual({ busy: true, disabled: true, checked: false })
    expect(settingsRadioAccessibilityState(true)).not.toHaveProperty('selected')
  })
})
