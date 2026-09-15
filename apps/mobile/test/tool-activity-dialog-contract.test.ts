import { describe, expect, it } from 'vitest'
import { toolActivityDialogSelectionReducer } from '../src/components/tool-activity-dialog-contract'

describe('tool activity dialog selection', () => {
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
