import { describe, expect, it } from 'vitest'
import { sessionQuickActionDialogContentHeight, sessionQuickActionDialogContract, sessionQuickActionDialogHeight } from '../src/components/session-quick-action-contract'

describe('session quick-action dialog contract', () => {
  it('uses a bounded bottom half-screen surface', () => {
    expect(sessionQuickActionDialogHeight(800)).toBe(400)
    expect(sessionQuickActionDialogHeight(1_400)).toBe(sessionQuickActionDialogContract.maximumHeight)
    expect(sessionQuickActionDialogHeight(400)).toBe(sessionQuickActionDialogContract.minimumHeight)
    expect(sessionQuickActionDialogHeight(180)).toBe(180)
  })

  it('keeps compact-sheet controls accessible without crowding the title', () => {
    expect(sessionQuickActionDialogContract.closeTargetSize).toBeGreaterThanOrEqual(44)
    expect(sessionQuickActionDialogContract.optionMinimumHeight).toBeGreaterThanOrEqual(44)

    const compactTitleWidth = 375
      - sessionQuickActionDialogContract.headerPaddingLeft
      - sessionQuickActionDialogContract.headerPaddingRight
      - sessionQuickActionDialogContract.headerGap
      - sessionQuickActionDialogContract.closeTargetSize
    expect(compactTitleWidth).toBeGreaterThanOrEqual(280)
  })

  it('gives simple picker options a more relaxed visual rhythm', () => {
    expect(sessionQuickActionDialogContract.spaciousOptionMinimumHeight).toBeGreaterThan(sessionQuickActionDialogContract.optionMinimumHeight)
    expect(sessionQuickActionDialogContract.spaciousOptionGap).toBeGreaterThan(0)
    expect(sessionQuickActionDialogContract.spaciousOptionIconSize).toBeGreaterThan(34)
  })

  it('fits a short spacious picker to its content', () => {
    expect(sessionQuickActionDialogContentHeight(800, 3, 34)).toBe(340)
    expect(sessionQuickActionDialogContentHeight(300, 3, 34)).toBe(300)
  })
})
