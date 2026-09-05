import { describe, expect, it, vi } from 'vitest'
import { closedProjectRenameState, isProjectRenameDraftValid, persistProjectRename, projectRenameReducer, projectRenameSelection } from '../src/utils/project-rename'

describe('project rename', () => {
  it('opens with the current name selected for editing and cancellation preserves it', () => {
    const target = { projectId: 'meteor-dodge', name: 'Meteor Dodge' }
    const editing = projectRenameReducer(closedProjectRenameState, { type: 'open', target })
    expect(editing).toEqual({ phase: 'editing', target, draft: 'Meteor Dodge' })
    expect(projectRenameReducer(editing, { type: 'dismiss' })).toEqual(closedProjectRenameState)
    expect(target.name).toBe('Meteor Dodge')
    expect(projectRenameSelection(editing.phase === 'editing' ? editing.draft : '')).toEqual({ start: 0, end: 12 })
  })

  it('enables Save only for a valid project-name draft', () => {
    expect(isProjectRenameDraftValid('  Meteor   Dash  ')).toBe(true)
    expect(isProjectRenameDraftValid('   ')).toBe(false)
    expect(isProjectRenameDraftValid('../secret')).toBe(false)
    expect(isProjectRenameDraftValid('x'.repeat(81))).toBe(false)
  })

  it('normalizes and persists through the runtime before local storage', async () => {
    const order: string[] = []
    const renameRuntime = vi.fn(async ({ name }: { projectId: string; name: string }) => { order.push('runtime'); return { name } })
    const persistLocal = vi.fn(async () => { order.push('local') })
    await expect(persistProjectRename({ projectId: 'meteor-dodge', draft: '  Meteor   Dash  ', renameRuntime, persistLocal })).resolves.toBe('Meteor Dash')
    expect(renameRuntime).toHaveBeenCalledWith({ projectId: 'meteor-dodge', name: 'Meteor Dash' })
    expect(persistLocal).toHaveBeenCalledWith('meteor-dodge', 'Meteor Dash')
    expect(order).toEqual(['runtime', 'local'])
  })

  it('blocks invalid values and surfaces persistence failures', async () => {
    const renameRuntime = vi.fn(async () => ({ name: 'unused' }))
    const persistLocal = vi.fn(async () => undefined)
    await expect(persistProjectRename({ projectId: 'meteor-dodge', draft: ' ', renameRuntime, persistLocal })).rejects.toEqual(expect.objectContaining({ issue: 'empty' }))
    expect(renameRuntime).not.toHaveBeenCalled()
    renameRuntime.mockRejectedValueOnce(new Error('runtime unavailable'))
    await expect(persistProjectRename({ projectId: 'meteor-dodge', draft: 'Meteor Dash', renameRuntime, persistLocal })).rejects.toThrow('runtime unavailable')
    expect(persistLocal).not.toHaveBeenCalled()
  })
})
