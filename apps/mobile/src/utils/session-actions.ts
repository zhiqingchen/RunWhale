import type { AgentSessionRecord, AgentSessionSummary } from '@runwhale/mobile-protocol'
import { type ActionInFlightGuard, runExclusiveAction } from './action-progress'
import { createMobileSessionId } from './session-id'

export interface CreateSessionInput {
  projectId: string
  sessionId: string
  title: string
}

export interface SessionActionTarget {
  projectId: string
  sessionId: string
  title: string
}

export type SessionCreationFailures = Readonly<Record<string, string>>

export type SessionActionState =
  | { phase: 'closed' }
  | { phase: 'actions'; target: SessionActionTarget }
  | { phase: 'confirm-delete'; target: SessionActionTarget }

export type SessionActionEvent =
  | { type: 'open'; target: SessionActionTarget }
  | { type: 'request-delete' }
  | { type: 'dismiss' }

export type SessionSummaryLoadStatus = 'loading' | 'loaded' | 'failed'
export type SessionRefreshPresentationStatus = 'loading' | 'ready' | 'failed'
export type SessionRefreshPhase = 'start' | 'success' | 'failure'

export type SessionSummaryLoadResult =
  | { status: 'loaded'; sessions: AgentSessionSummary[] }
  | { status: 'failed' }

export const closedSessionActionState: SessionActionState = { phase: 'closed' }

const sessionTitleEncoder = new TextEncoder()

export function sessionRefreshPresentationStatus(hydrated: boolean, phase: SessionRefreshPhase): SessionRefreshPresentationStatus {
  if (hydrated || phase === 'success') return 'ready'
  return phase === 'start' ? 'loading' : 'failed'
}

export function firstPromptSessionTitle(prompt: string, maxWords = 5, maxBytes = 40): string {
  const words = prompt.replace(/[\u0000-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu, '').replace(/\s+/gu, ' ').trim().split(' ').filter(Boolean).slice(0, maxWords)
  let title = ''
  for (const character of words.join(' ')) {
    if (sessionTitleEncoder.encode(title + character).byteLength > maxBytes) break
    title += character
  }
  return title.trimEnd()
}

export function shouldInitializeSessionTitle(session: AgentSessionSummary | undefined, placeholder: string): session is AgentSessionSummary {
  return Boolean(session && session.eventCount === 0 && session.title === placeholder)
}

export function sessionActionReducer(state: SessionActionState, event: SessionActionEvent): SessionActionState {
  if (event.type === 'open') return { phase: 'actions', target: event.target }
  if (event.type === 'request-delete' && state.phase === 'actions') return { phase: 'confirm-delete', target: state.target }
  return closedSessionActionState
}

export async function createAndNavigateSession({
  projectId,
  title,
  createSession,
  navigate,
  sessionId = createMobileSessionId(),
}: {
  projectId: string
  title: string
  createSession(input: CreateSessionInput): Promise<AgentSessionRecord>
  navigate(sessionId: string): void
  sessionId?: string
}): Promise<AgentSessionRecord> {
  const created = await createSession({ projectId, sessionId, title })
  navigate(created.sessionId)
  return created
}

export function isSessionDeleteAccessibilityAction(actionName: string): boolean {
  return actionName === 'delete'
}

export function sessionCreationFailureMessage(
  failures: SessionCreationFailures,
  projectId: string,
): string | undefined {
  return failures[projectId]
}

export function setSessionCreationFailure(
  failures: SessionCreationFailures,
  projectId: string,
  message: string,
): SessionCreationFailures {
  return { ...failures, [projectId]: message }
}

export function clearSessionCreationFailure(
  failures: SessionCreationFailures,
  projectId: string,
): SessionCreationFailures {
  if (failures[projectId] === undefined) return failures
  const next = { ...failures }
  delete next[projectId]
  return next
}

export async function loadSessionSummaries(load: () => Promise<AgentSessionSummary[]>): Promise<SessionSummaryLoadResult> {
  try {
    return { status: 'loaded', sessions: await load() }
  } catch {
    return { status: 'failed' }
  }
}

export async function loadSessionSummariesOnce(guard: ActionInFlightGuard, load: () => Promise<AgentSessionSummary[]>): Promise<SessionSummaryLoadResult | undefined> {
  return runExclusiveAction(guard, () => loadSessionSummaries(load))
}

export function removeSessionSummary(
  sessionsByProject: Readonly<Record<string, readonly AgentSessionSummary[]>>,
  projectId: string,
  sessionId: string,
): Record<string, AgentSessionSummary[]> {
  const mutableSessions = Object.fromEntries(
    Object.entries(sessionsByProject).map(([key, sessions]) => [key, [...sessions]]),
  )
  return {
    ...mutableSessions,
    [projectId]: [...(sessionsByProject[projectId] ?? [])].filter((session) => session.sessionId !== sessionId),
  }
}
