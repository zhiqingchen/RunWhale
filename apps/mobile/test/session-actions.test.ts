import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '@runwhale/mobile-protocol'
import { clearSessionCreationFailure, closedSessionActionState, createAndNavigateSession, isSessionDeleteAccessibilityAction, loadSessionSummaries, loadSessionSummariesOnce, removeSessionSummary, sessionActionReducer, sessionCreationFailureMessage, sessionRefreshPresentationStatus, setSessionCreationFailure, type CreateSessionInput } from '../src/utils/session-actions'

function emptySession(input: CreateSessionInput): AgentSessionRecord {
  return {
    ...input,
    updatedAt: 1,
    state: 'idle',
    events: [],
  }
}

describe('session actions', () => {
  it('shows feedback for a cold session load, failure, and retry until success', () => {
    expect(sessionRefreshPresentationStatus(false, 'start')).toBe('loading')
    expect(sessionRefreshPresentationStatus(false, 'failure')).toBe('failed')
    expect(sessionRefreshPresentationStatus(false, 'start')).toBe('loading')
    expect(sessionRefreshPresentationStatus(false, 'success')).toBe('ready')
  })

  it('keeps hydrated session refreshes ready through every phase', () => {
    expect(sessionRefreshPresentationStatus(true, 'start')).toBe('ready')
    expect(sessionRefreshPresentationStatus(true, 'failure')).toBe('ready')
    expect(sessionRefreshPresentationStatus(true, 'success')).toBe('ready')
  })

  it('creates and navigates to a new project session while preserving prior sessions', async () => {
    const projectId = 'project-one'
    const title = 'New session'
    const sessions = new Map<string, AgentSessionRecord>([['prior-session', emptySession({ projectId, sessionId: 'prior-session', title: 'Prior session' })]])
    const navigate = vi.fn()
    const created = await createAndNavigateSession({
      projectId,
      title,
      sessionId: 'new-session',
      createSession: async (input) => {
        const record = emptySession(input)
        sessions.set(record.sessionId, record)
        return record
      },
      navigate,
    })

    expect(created.events).toEqual([])
    expect(sessions.has('prior-session')).toBe(true)
    expect(sessions.has('new-session')).toBe(true)
    expect(navigate).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith('new-session')
  })

  it('does not navigate or mutate prior sessions when creation fails', async () => {
    const priorSessions = ['prior-session']
    const navigate = vi.fn()
    await expect(createAndNavigateSession({
      projectId: 'project-one',
      title: 'New session',
      sessionId: 'failed-session',
      createSession: async () => { throw new Error('runtime unavailable') },
      navigate,
    })).rejects.toThrow('runtime unavailable')
    expect(priorSessions).toEqual(['prior-session'])
    expect(navigate).not.toHaveBeenCalled()
  })

  it('preserves independent session-creation failures and clears only the retried project', () => {
    const firstFailure = setSessionCreationFailure({}, 'project-one', 'First session failed.')
    const bothFailures = setSessionCreationFailure(firstFailure, 'project-two', 'Second session failed.')
    expect(sessionCreationFailureMessage(bothFailures, 'project-one')).toBe('First session failed.')
    expect(sessionCreationFailureMessage(bothFailures, 'project-two')).toBe('Second session failed.')

    const retriedFirst = clearSessionCreationFailure(bothFailures, 'project-one')
    expect(sessionCreationFailureMessage(retriedFirst, 'project-one')).toBeUndefined()
    expect(sessionCreationFailureMessage(retriedFirst, 'project-two')).toBe('Second session failed.')
    expect(clearSessionCreationFailure(retriedFirst, 'missing-project')).toBe(retriedFirst)
  })

  it('recognizes the accessible alternative to a session-row long press', () => {
    expect(isSessionDeleteAccessibilityAction('delete')).toBe(true)
    expect(isSessionDeleteAccessibilityAction('activate')).toBe(false)
  })

  it('distinguishes an empty session list from a failed session-list request', async () => {
    await expect(loadSessionSummaries(async () => [])).resolves.toEqual({ status: 'loaded', sessions: [] })
    await expect(loadSessionSummaries(async () => { throw new Error('runtime unavailable') })).resolves.toEqual({ status: 'failed' })
  })

  it('prevents duplicate session-summary loads and unlocks an observable retry after failure', async () => {
    const guard = { current: false }
    let rejectLoad!: (error: Error) => void
    const first = loadSessionSummariesOnce(guard, () => new Promise((_resolve, reject) => { rejectLoad = reject }))

    await expect(loadSessionSummariesOnce(guard, async () => [])).resolves.toBeUndefined()
    expect(guard.current).toBe(true)
    rejectLoad(new Error('runtime unavailable'))
    await expect(first).resolves.toEqual({ status: 'failed' })
    expect(guard.current).toBe(false)
    await expect(loadSessionSummariesOnce(guard, async () => [])).resolves.toEqual({ status: 'loaded', sessions: [] })
  })

  it('opens contextual actions, requires a delete confirmation, and preserves the session when dismissed', () => {
    const target = { projectId: 'project-one', sessionId: 'prior-session', title: 'Prior session' }
    const actions = sessionActionReducer(closedSessionActionState, { type: 'open', target })
    expect(actions).toEqual({ phase: 'actions', target })
    const confirmation = sessionActionReducer(actions, { type: 'request-delete' })
    expect(confirmation).toEqual({ phase: 'confirm-delete', target })
    expect(sessionActionReducer(confirmation, { type: 'dismiss' })).toEqual(closedSessionActionState)
    expect(target.sessionId).toBe('prior-session')
  })

  it('removes only the confirmed session immediately and remains safe across repeated refreshes', () => {
    const first = { projectId: 'project-one', sessionId: 'first', title: 'First', updatedAt: 2, turnCount: 1, eventCount: 2, preview: 'First', state: 'idle' as const }
    const second = { projectId: 'project-one', sessionId: 'second', title: 'Second', updatedAt: 1, turnCount: 0, eventCount: 0, preview: '', state: 'idle' as const }
    const initial = { 'project-one': [first, second] }
    const deleted = removeSessionSummary(initial, 'project-one', 'first')
    expect(deleted['project-one']).toEqual([second])
    expect(initial['project-one']).toEqual([first, second])
    expect(removeSessionSummary(deleted, 'project-one', 'first')).toEqual(deleted)
  })
})
