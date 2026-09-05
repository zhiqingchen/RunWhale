import { describe, expect, it, vi } from 'vitest'
import { closedProjectActionState, omitProjectRecordEntry, performProjectDeletion, projectActionReducer } from '../src/utils/project-actions'

describe('project actions', () => {
  it('opens delete confirmation and preserves the target when cancelled', () => {
    const target = { projectId: 'project-one', name: 'Project one' }
    const confirmation = projectActionReducer(closedProjectActionState, { type: 'request-delete', target })
    expect(confirmation).toEqual({ phase: 'confirm-delete', target, status: 'idle' })
    expect(projectActionReducer(confirmation, { type: 'dismiss' })).toEqual(closedProjectActionState)
    expect(target).toEqual({ projectId: 'project-one', name: 'Project one' })
  })

  it('locks deletion against dismissal and duplicate confirmation until it settles', () => {
    const target = { projectId: 'project-one', name: 'Project one' }
    const confirmation = projectActionReducer(closedProjectActionState, { type: 'request-delete', target })
    const deleting = projectActionReducer(confirmation, { type: 'begin-delete' })

    expect(deleting).toEqual({ phase: 'confirm-delete', target, status: 'deleting', error: undefined })
    expect(projectActionReducer(deleting, { type: 'begin-delete' })).toBe(deleting)
    expect(projectActionReducer(deleting, { type: 'dismiss' })).toBe(deleting)
  })

  it('retains a retryable target and error, then clears the error on retry', () => {
    const target = { projectId: 'project-one', name: 'Project one' }
    const confirmation = projectActionReducer(closedProjectActionState, { type: 'request-delete', target })
    const deleting = projectActionReducer(confirmation, { type: 'begin-delete' })
    const failed = projectActionReducer(deleting, { type: 'delete-failed', error: 'Device storage unavailable.' })

    expect(failed).toEqual({ phase: 'confirm-delete', target, status: 'failed', error: 'Device storage unavailable.' })
    const retrying = projectActionReducer(failed, { type: 'begin-delete' })
    expect(retrying).toEqual({ phase: 'confirm-delete', target, status: 'deleting', error: undefined })
    expect(projectActionReducer(retrying, { type: 'delete-succeeded' })).toEqual(closedProjectActionState)
  })

  it('runs runtime, local persistence, and draft cleanup in fixed order', async () => {
    const order: string[] = []
    const deleteRuntime = vi.fn(async () => { order.push('runtime'); return false })
    const removeLocal = vi.fn(async () => { order.push('local') })
    const clearDrafts = vi.fn(async () => { order.push('drafts') })

    await expect(performProjectDeletion({ projectId: 'project-one', deleteRuntime, removeLocal, clearDrafts })).resolves.toBeUndefined()
    expect(order).toEqual(['runtime', 'local', 'drafts'])
    expect(deleteRuntime).toHaveBeenCalledExactlyOnceWith('project-one')
    expect(removeLocal).toHaveBeenCalledExactlyOnceWith('project-one')
    expect(clearDrafts).toHaveBeenCalledExactlyOnceWith('project-one')
  })

  it('does not start a later cleanup step after a failure', async () => {
    const clearDrafts = vi.fn(async () => undefined)
    await expect(performProjectDeletion({
      projectId: 'project-one',
      deleteRuntime: async () => undefined,
      removeLocal: async () => { throw new Error('storage unavailable') },
      clearDrafts,
    })).rejects.toThrow('storage unavailable')
    expect(clearDrafts).not.toHaveBeenCalled()
  })

  it('omits only the target project state and remains idempotent', () => {
    const initial = { 'project-one': ['first'], 'project-two': ['second'] }
    const omitted = omitProjectRecordEntry(initial, 'project-one')

    expect(omitted).toEqual({ 'project-two': ['second'] })
    expect(initial).toEqual({ 'project-one': ['first'], 'project-two': ['second'] })
    expect(omitProjectRecordEntry(omitted, 'project-one')).toBe(omitted)
  })
})
