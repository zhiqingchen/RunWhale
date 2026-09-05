import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '@runwhale/mobile-protocol'
import { createProjectDraft } from '../src/state/project-data'
import { focusedInputScrollOffset } from '../src/utils/keyboard-scroll'
import { completeNewProjectSubmission, idleNewProjectSubmissionUiState, newProjectAvailability, newProjectSubmissionKey, newProjectSubmissionUiReducer, prepareNewProjectSubmission, type PreparedNewProjectSubmission } from '../src/utils/new-project-flow'

function session(projectId: string, sessionId: string): AgentSessionRecord {
  return { projectId, sessionId, title: 'New session', updatedAt: 1, state: 'idle', events: [] }
}

describe('New Project retry flow', () => {
  it('keeps a focused field at the top of the resized form after rotation', () => {
    expect(focusedInputScrollOffset(0, 130, 60)).toBe(70)
    expect(focusedInputScrollOffset(100, 80, 60)).toBe(120)
    expect(focusedInputScrollOffset(0, 40, 60)).toBe(0)
  })

  it('keeps every project-producing control disabled until stored projects are ready', () => {
    expect(newProjectAvailability('loading', true, false)).toEqual({ controlsDisabled: true, submissionAvailable: false })
    expect(newProjectAvailability('failed', true, false)).toEqual({ controlsDisabled: true, submissionAvailable: false })
    expect(newProjectAvailability('ready', false, false)).toEqual({ controlsDisabled: false, submissionAvailable: false })
    expect(newProjectAvailability('ready', true, true)).toEqual({ controlsDisabled: true, submissionAvailable: true })
    expect(newProjectAvailability('ready', true, false)).toEqual({ controlsDisabled: false, submissionAvailable: true })
  })

  it('blocks route removal only while one submission attempt is active', () => {
    expect(newProjectSubmissionUiReducer(idleNewProjectSubmissionUiState, { type: 'remove-attempted' })).toBe(idleNewProjectSubmissionUiState)

    const submitting = newProjectSubmissionUiReducer(idleNewProjectSubmissionUiState, { type: 'start' })
    expect(submitting).toEqual({ submitting: true, dismissalNoticeOpen: false })

    const warned = newProjectSubmissionUiReducer(submitting, { type: 'remove-attempted' })
    expect(warned).toEqual({ submitting: true, dismissalNoticeOpen: true })
    expect(newProjectSubmissionUiReducer(warned, { type: 'remove-attempted' })).toBe(warned)

    const waiting = newProjectSubmissionUiReducer(warned, { type: 'dismiss-notice' })
    expect(waiting).toEqual({ submitting: true, dismissalNoticeOpen: false })
    expect(newProjectSubmissionUiReducer(waiting, { type: 'settle' })).toBe(idleNewProjectSubmissionUiState)
  })

  it('reuses an unchanged prepared project and session instead of repeating clone work', async () => {
    const createProject = vi.fn(async () => createProjectDraft('Cloned', 'web', 'cloned-project'))
    const key = newProjectSubmissionKey('https://example.test/repo.git', 'Cloned', 'expo')
    const first = await prepareNewProjectSubmission({ key, initialized: true, createProject, createSessionId: () => 'session-one' })
    const retry = await prepareNewProjectSubmission({ current: first, key, initialized: true, createProject, createSessionId: () => 'session-two' })

    expect(retry).toBe(first)
    expect(retry.sessionId).toBe('session-one')
    expect(createProject).toHaveBeenCalledOnce()
  })

  it('keeps a template project out of the local list until initialization and session creation recover', async () => {
    const submission: PreparedNewProjectSubmission = {
      key: newProjectSubmissionKey('', 'Starter', 'web'),
      project: createProjectDraft('Starter', 'web', 'starter-project'),
      sessionId: 'starter-session',
      initialized: false,
    }
    const initializeProject = vi.fn(async () => undefined)
    const createSession = vi.fn()
      .mockRejectedValueOnce(new Error('session unavailable'))
      .mockResolvedValueOnce(session('starter-project', 'starter-session'))
    const readSession = vi.fn().mockRejectedValue(new Error('not found'))
    const commitProject = vi.fn()

    await expect(completeNewProjectSubmission({ submission, title: 'New session', initializeProject, createSession, readSession, commitProject })).rejects.toThrow('session unavailable')
    expect(commitProject).not.toHaveBeenCalled()
    await expect(completeNewProjectSubmission({ submission, title: 'New session', initializeProject, createSession, readSession, commitProject })).resolves.toMatchObject({ sessionId: 'starter-session' })
    expect(initializeProject).toHaveBeenCalledOnce()
    expect(commitProject).toHaveBeenCalledOnce()
  })

  it('accepts an existing fixed-id session when its create response was lost', async () => {
    const submission: PreparedNewProjectSubmission = {
      key: newProjectSubmissionKey('https://example.test/repo.git', '', 'web'),
      project: createProjectDraft('Cloned', 'web', 'cloned-project'),
      sessionId: 'cloned-session',
      initialized: true,
    }
    const existing = session('cloned-project', 'cloned-session')
    const initializeProject = vi.fn(async () => undefined)
    const commitProject = vi.fn()

    await expect(completeNewProjectSubmission({
      submission,
      title: 'New session',
      initializeProject,
      createSession: async () => { throw new Error('response lost') },
      readSession: async () => existing,
      commitProject,
    })).resolves.toBe(existing)
    expect(initializeProject).not.toHaveBeenCalled()
    expect(commitProject).toHaveBeenCalledWith(submission.project)
  })

  it('does not finish until the project commit is durable', async () => {
    const submission: PreparedNewProjectSubmission = {
      key: newProjectSubmissionKey('', 'Durable', 'web'),
      project: createProjectDraft('Durable', 'web', 'durable-project'),
      sessionId: 'durable-session',
      initialized: true,
    }
    let releaseCommit!: () => void
    const commitProject = vi.fn(() => new Promise<void>((resolve) => { releaseCommit = resolve }))
    let completed = false

    const completion = completeNewProjectSubmission({
      submission,
      title: 'New session',
      initializeProject: async () => undefined,
      createSession: async () => session('durable-project', 'durable-session'),
      readSession: async () => session('durable-project', 'durable-session'),
      commitProject,
    }).then((result) => {
      completed = true
      return result
    })

    await vi.waitFor(() => expect(commitProject).toHaveBeenCalledOnce())
    expect(completed).toBe(false)
    releaseCommit()
    await expect(completion).resolves.toMatchObject({ sessionId: 'durable-session' })
    expect(completed).toBe(true)
  })

  it('rejects when the durable project commit fails', async () => {
    const submission: PreparedNewProjectSubmission = {
      key: newProjectSubmissionKey('', 'Unsaved', 'web'),
      project: createProjectDraft('Unsaved', 'web', 'unsaved-project'),
      sessionId: 'unsaved-session',
      initialized: true,
    }

    await expect(completeNewProjectSubmission({
      submission,
      title: 'New session',
      initializeProject: async () => undefined,
      createSession: async () => session('unsaved-project', 'unsaved-session'),
      readSession: async () => session('unsaved-project', 'unsaved-session'),
      commitProject: async () => { throw new Error('project save failed') },
    })).rejects.toThrow('project save failed')
  })
})
