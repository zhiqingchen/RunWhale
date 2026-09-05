import { describe, expect, it } from 'vitest'
import { settingsLayout, settingsProviderColumnCount, settingsUseStackedRows } from '../src/utils/settings-layout'

describe('Settings phone layout', () => {
  it('uses a single provider column before labels would clip', () => {
    expect(settingsProviderColumnCount(320)).toBe(1)
    expect(settingsProviderColumnCount(390)).toBe(2)
    expect(settingsProviderColumnCount(390, 1.5)).toBe(1)
  })

  it('stacks label and value rows at accessibility font scales', () => {
    expect(settingsUseStackedRows(1.49)).toBe(false)
    expect(settingsUseStackedRows(1.5)).toBe(true)
  })

  it('keeps every compact Settings action at least 44 points high', () => {
    expect(settingsLayout.minimumTouchTarget).toBeGreaterThanOrEqual(44)
  })
})
