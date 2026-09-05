import { describe, expect, it, vi } from 'vitest'
import { agentDestructiveActionContract, agentImagePickerAvailable, agentPrimaryActionState, agentQueueActionReducer, agentResponseReducer, agentSendSubmissionBusy, idleAgentQueueActionState, idleAgentResponseState, mergeStoppedAgentMessages, performAgentDestructiveMutation, performAgentRun, resolveAgentPlanMode, restoreStoppedAgentMessages, shouldDismissConsumedQueuedMessage, showAgentEmptyState } from '../src/utils/agent-feedback'

describe('Agent feedback', () => {
  it('keeps the empty state hidden while session history is being restored', () => {
    expect(showAgentEmptyState('loading', 0, false, '')).toBe(false)
    expect(showAgentEmptyState('failed', 0, false, '')).toBe(false)
    expect(showAgentEmptyState('ready', 0, false, '')).toBe(true)
    expect(showAgentEmptyState('ready', 1, false, '')).toBe(false)
    expect(showAgentEmptyState('ready', 0, true, '')).toBe(false)
  })

  it('keeps the empty state hidden after the first run completes until its history is restored', () => {
    expect(showAgentEmptyState('ready', 0, false, 'first prompt')).toBe(false)
  })

  it('keeps Plan and image composer actions ordered without blocking a running queue with run submission state', () => {
    expect(resolveAgentPlanMode(false, { active: true })).toBe(true)
    expect(resolveAgentPlanMode(false, { active: false, pending: true })).toBe(true)
    expect(resolveAgentPlanMode(true, { active: true, pending: false })).toBe(false)
    expect(resolveAgentPlanMode(true)).toBe(true)
    expect(agentSendSubmissionBusy(true, true, false, false)).toBe(true)
    expect(agentSendSubmissionBusy(false, true, true, false)).toBe(false)
    expect(agentSendSubmissionBusy(false, true, false, true)).toBe(true)
    expect(agentImagePickerAvailable(false, 3)).toBe(true)
    expect(agentImagePickerAvailable(false, 4)).toBe(false)
    expect(agentImagePickerAvailable(true, 0)).toBe(false)
  })

  it('uses one primary Send/Stop seat while Enter remains the running queue path', () => {
    expect(agentPrimaryActionState(false, false, false, false)).toEqual({ action: 'send', disabled: true, pending: false })
    expect(agentPrimaryActionState(false, false, true, true)).toEqual({ action: 'send', disabled: false, pending: true })
    expect(agentPrimaryActionState(true, false, false, true)).toEqual({ action: 'stop', disabled: false, pending: false })
    expect(agentPrimaryActionState(true, true, true, false)).toEqual({ action: 'stop', disabled: true, pending: true })
  })

  it('restores stopped queued messages ahead of the current composer draft without duplicating it', () => {
    expect(restoreStoppedAgentMessages('', [{ text: 'first' }, { text: 'second' }])).toBe('first\n\nsecond')
    expect(restoreStoppedAgentMessages('draft', [{ text: 'queued' }])).toBe('queued\n\ndraft')
    expect(restoreStoppedAgentMessages(' queued ', [{ text: 'queued' }], 'queued')).toBe('queued')
    expect(restoreStoppedAgentMessages('queued', [{ text: 'queued' }])).toBe('queued\n\nqueued')
    expect(restoreStoppedAgentMessages('untouched', [])).toBe('untouched')
  })

  it('uses local edits for runtime-confirmed recoverable messages without reviving completed queue rows', () => {
    expect(mergeStoppedAgentMessages(
      [{ messageId: 'claimed', text: 'edited locally', mode: 'followup' as const }, { messageId: 'pending', text: 'local pending', mode: 'steer' as const }],
      [{ messageId: 'pending', text: 'server pending', mode: 'steer' as const }, { messageId: 'raced', text: 'accepted during race', mode: 'followup' as const }],
    )).toEqual([
      { messageId: 'pending', text: 'local pending', mode: 'steer' },
      { messageId: 'raced', text: 'accepted during race', mode: 'followup' },
    ])
  })

  it('serializes mutually exclusive approval and question responses and unlocks retry', () => {
    const busy = agentResponseReducer(idleAgentResponseState, 'start')
    expect(busy).toBe('busy')
    expect(agentResponseReducer(busy, 'start')).toBe(busy)
    const retryable = agentResponseReducer(busy, 'finish')
    expect(retryable).toBe('idle')
    expect(agentResponseReducer(retryable, 'start')).toBe('busy')
  })

  it('guards conflicting mutations per queued message while allowing another item to proceed', () => {
    const convertingFirst = agentQueueActionReducer(idleAgentQueueActionState, { type: 'start', messageId: 'message-1', action: 'convert' })
    expect(convertingFirst).toEqual({ 'message-1': 'convert' })
    expect(agentQueueActionReducer(convertingFirst, { type: 'start', messageId: 'message-1', action: 'convert' })).toBe(convertingFirst)
    expect(agentQueueActionReducer(convertingFirst, { type: 'start', messageId: 'message-1', action: 'delete' })).toBe(convertingFirst)

    const deletingSecond = agentQueueActionReducer(convertingFirst, { type: 'start', messageId: 'message-2', action: 'delete' })
    expect(deletingSecond).toEqual({ 'message-1': 'convert', 'message-2': 'delete' })
    expect(agentQueueActionReducer(deletingSecond, { type: 'finish', messageId: 'message-1', action: 'delete' })).toBe(deletingSecond)
    expect(agentQueueActionReducer(deletingSecond, { type: 'finish', messageId: 'message-1', action: 'convert' })).toEqual({ 'message-2': 'delete' })
  })

  it('holds a queued-message lock throughout delete confirmation and releases it on cancellation', () => {
    const confirmingDelete = agentQueueActionReducer(idleAgentQueueActionState, { type: 'start', messageId: 'message-1', action: 'delete' })
    expect(confirmingDelete).toEqual({ 'message-1': 'delete' })
    expect(agentQueueActionReducer(confirmingDelete, { type: 'start', messageId: 'message-1', action: 'delete' })).toBe(confirmingDelete)
    expect(agentQueueActionReducer(confirmingDelete, { type: 'start', messageId: 'message-1', action: 'convert' })).toBe(confirmingDelete)

    const cancelled = agentQueueActionReducer(confirmingDelete, { type: 'finish', messageId: 'message-1', action: 'delete' })
    expect(cancelled).toEqual(idleAgentQueueActionState)
    expect(agentQueueActionReducer(cancelled, { type: 'start', messageId: 'message-1', action: 'convert' })).toEqual({ 'message-1': 'convert' })
  })

  it('dismisses a queued delete confirmation when the Agent consumes that message', () => {
    const action = { kind: 'delete-queued-message' as const, messageId: 'message-1' }
    expect(shouldDismissConsumedQueuedMessage(action, false, new Set(['message-1']))).toBe(true)
    expect(shouldDismissConsumedQueuedMessage(action, true, new Set(['message-1']))).toBe(false)
    expect(shouldDismissConsumedQueuedMessage(action, false, new Set(['message-2']))).toBe(false)
    expect(shouldDismissConsumedQueuedMessage(undefined, false, new Set(['message-1']))).toBe(false)
  })

  it('continues the run and finishes when persisted-draft cleanup fails', async () => {
    const run = vi.fn(async () => undefined)
    const recover = vi.fn(async () => undefined)
    const finish = vi.fn()

    await performAgentRun({
      clearPersistedDraft: async () => { throw new Error('storage unavailable') },
      run,
      recover,
      finish,
    })

    expect(run).toHaveBeenCalledOnce()
    expect(recover).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledOnce()
  })

  it('deletes only the confirmed queued message and reports busy state around the mutation', async () => {
    const deleteQueuedMessage = vi.fn(async () => ({ deleted: true }))
    const onBusyChange = vi.fn()
    const onError = vi.fn()

    await expect(performAgentDestructiveMutation({
      action: { kind: 'delete-queued-message', messageId: 'message-7' },
      projectId: 'project-3',
      sessionId: 'session-5',
      queueNoLongerPendingMessage: 'no longer pending',
      deleteQueuedMessage,
      onBusyChange,
      onError,
    })).resolves.toBe(true)

    expect(deleteQueuedMessage).toHaveBeenCalledWith({ projectId: 'project-3', sessionId: 'session-5', messageId: 'message-7' })
    expect(onBusyChange.mock.calls).toEqual([[true], [false]])
    expect(onError).toHaveBeenCalledWith(undefined)
  })

  it('uses a destructive AppDialog action for queued message deletion', () => {
    expect(agentDestructiveActionContract).toEqual({
      queuedMessageDelete: {
        dialogTestID: 'agent-queued-message-delete-dialog',
        actionTestID: 'agent-queued-message-delete-confirm',
        tone: 'danger',
      },
    })
  })
})
