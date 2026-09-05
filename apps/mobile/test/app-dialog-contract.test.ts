import { describe, expect, it } from 'vitest'
import { appDialogActionVariant, appDialogMaximumHeight, appDialogVisualContract } from '../src/components/app-dialog-contract'

describe('application dialog contract', () => {
  it('keeps the close target accessible without crowding a compact dialog title', () => {
    expect(appDialogVisualContract.closeTargetSize).toBeGreaterThanOrEqual(44)
    const compactTitleWidth = 375
      - (appDialogVisualContract.viewportHorizontalPadding * 2)
      - (appDialogVisualContract.contentPadding * 2)
      - appDialogVisualContract.headingGap
      - appDialogVisualContract.closeTargetSize
    expect(compactTitleWidth).toBeGreaterThanOrEqual(240)
  })

  it('bounds dialog content to the safe viewport', () => {
    expect(appDialogMaximumHeight(667, 20, 0)).toBe(615)
    expect(appDialogMaximumHeight(40, 20, 20)).toBe(appDialogVisualContract.actionMinimumHeight)
  })

  it('maps cancel, confirmation, and destructive actions consistently', () => {
    expect(appDialogActionVariant('cancel')).toBe('ghost')
    expect(appDialogActionVariant('primary')).toBe('primary')
    expect(appDialogActionVariant('danger')).toBe('danger')
  })
})
