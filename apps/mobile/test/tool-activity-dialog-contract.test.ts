import { describe, expect, it } from 'vitest'
import { toolActivityDialogContract, toolActivityDialogHeight, toolActivityDialogSelectionReducer } from '../src/components/tool-activity-dialog-contract'

describe('tool activity dialog contract', () => {
  it('uses a bounded bottom half-screen surface', () => {
    expect(toolActivityDialogHeight(800)).toBe(400)
    expect(toolActivityDialogHeight(1_400)).toBe(toolActivityDialogContract.maximumHeight)
    expect(toolActivityDialogHeight(400)).toBe(toolActivityDialogContract.minimumHeight)
    expect(toolActivityDialogHeight(180)).toBe(180)
    expect(toolActivityDialogHeight(-20)).toBe(0)
  })

  it('keeps navigation and tool rows comfortably tappable', () => {
    expect(toolActivityDialogContract.closeTargetSize).toBeGreaterThanOrEqual(44)
    expect(toolActivityDialogContract.toolRowMinimumHeight).toBeGreaterThanOrEqual(48)
  })

  it('keeps the viewed tool selected while a running activity updates in place', () => {
    const opened = toolActivityDialogSelectionReducer({}, { type: 'sync', open: true, activityId: 'activity', initialItemId: 'failed-first' })
    const selected = toolActivityDialogSelectionReducer(opened, { type: 'select', activityId: 'activity', itemId: 'running-second' })
    const updated = toolActivityDialogSelectionReducer(selected, { type: 'sync', open: true, activityId: 'activity', initialItemId: 'new-failure' })

    expect(updated).toBe(selected)
    expect(updated.itemId).toBe('running-second')
  })

  it('defaults a failed activity to its first failure and resets only across activities or closure', () => {
    const failed = toolActivityDialogSelectionReducer({}, { type: 'sync', open: true, activityId: 'failed', initialItemId: 'first-failure' })
    expect(failed).toEqual({ activityId: 'failed', itemId: 'first-failure' })
    expect(toolActivityDialogSelectionReducer(failed, { type: 'back', activityId: 'failed' })).toEqual({ activityId: 'failed' })
    expect(toolActivityDialogSelectionReducer(failed, { type: 'sync', open: true, activityId: 'next' })).toEqual({ activityId: 'next' })
    expect(toolActivityDialogSelectionReducer(failed, { type: 'sync', open: false })).toEqual({})
  })
})
