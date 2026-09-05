import type { AgentSessionRecord } from '@runwhale/mobile-protocol'
import type { ProjectLoadStatus, StudioProject } from '@/state/project-data'

export interface NewProjectSubmissionUiState {
  submitting: boolean
  dismissalNoticeOpen: boolean
}

export type NewProjectSubmissionUiEvent =
  | { type: 'start' }
  | { type: 'remove-attempted' }
  | { type: 'dismiss-notice' }
  | { type: 'settle' }

export const idleNewProjectSubmissionUiState: NewProjectSubmissionUiState = {
  submitting: false,
  dismissalNoticeOpen: false,
}

export function newProjectSubmissionUiReducer(state: NewProjectSubmissionUiState, event: NewProjectSubmissionUiEvent): NewProjectSubmissionUiState {
  if (event.type === 'start') return { submitting: true, dismissalNoticeOpen: false }
  if (event.type === 'remove-attempted') {
    if (!state.submitting || state.dismissalNoticeOpen) return state
    return { ...state, dismissalNoticeOpen: true }
  }
  if (event.type === 'dismiss-notice') {
    if (!state.dismissalNoticeOpen) return state
    return { ...state, dismissalNoticeOpen: false }
  }
  if (!state.submitting && !state.dismissalNoticeOpen) return state
  return idleNewProjectSubmissionUiState
}

export function newProjectAvailability(projectLoadStatus: ProjectLoadStatus, runtimeReady: boolean, submitting: boolean): { controlsDisabled: boolean; submissionAvailable: boolean } {
  return {
    controlsDisabled: submitting || projectLoadStatus !== 'ready',
    submissionAvailable: projectLoadStatus === 'ready' && runtimeReady,
  }
}

export interface PreparedNewProjectSubmission {
  key: string
  project: StudioProject
  sessionId: string
  initialized: boolean
}

export function newProjectSubmissionKey(repositoryUrl: string, name: string, template: 'web' | 'expo'): string {
  return repositoryUrl
    ? JSON.stringify(['clone', repositoryUrl, name])
    : JSON.stringify(['template', name, template])
}

export async function prepareNewProjectSubmission({
  current,
  key,
  initialized,
  createProject,
  createSessionId,
}: {
  current?: PreparedNewProjectSubmission
  key: string
  initialized: boolean
  createProject(): StudioProject | Promise<StudioProject>
  createSessionId(): string
}): Promise<PreparedNewProjectSubmission> {
  if (current?.key === key) return current
  return {
    key,
    project: await createProject(),
    sessionId: createSessionId(),
    initialized,
  }
}

export async function completeNewProjectSubmission({
  submission,
  title,
  initializeProject,
  createSession,
  readSession,
  commitProject,
}: {
  submission: PreparedNewProjectSubmission
  title: string
  initializeProject(project: StudioProject): Promise<unknown>
  createSession(input: { projectId: string; sessionId: string; title: string }): Promise<AgentSessionRecord>
  readSession(input: { projectId: string; sessionId: string }): Promise<AgentSessionRecord>
  commitProject(project: StudioProject): void | Promise<void>
}): Promise<AgentSessionRecord> {
  if (!submission.initialized) {
    await initializeProject(submission.project)
    submission.initialized = true
  }
  const input = { projectId: submission.project.id, sessionId: submission.sessionId, title }
  let session: AgentSessionRecord
  try {
    session = await createSession(input)
  } catch (cause) {
    try {
      session = await readSession({ projectId: input.projectId, sessionId: input.sessionId })
    } catch {
      throw cause
    }
  }
  await commitProject(submission.project)
  return session
}
