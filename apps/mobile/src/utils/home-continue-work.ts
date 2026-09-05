import type { AgentSessionSummary, HostEvent, HostSnapshot } from '@runwhale/mobile-protocol'
import type { StudioProject } from '@/state/projects'
import { WORKSPACE_PREVIEW_OPEN_REQUEST } from './workspace-layout'

export type HomeContinueWorkTone = 'neutral' | 'active' | 'warning' | 'danger'

export type HomeSessionLabelKey =
  | 'stateIdle'
  | 'stateRunning'
  | 'stateCompleted'
  | 'stateFailed'
  | 'stateAborted'
  | 'stateInterrupted'
  | 'statePaused'

export interface HomeSessionPresentation {
  labelKey: HomeSessionLabelKey
  tone: HomeContinueWorkTone
}

export interface HomeWorkspaceTarget {
  pathname: '/workspace/[id]'
  params: {
    id: string
    sessionId?: string
    preview?: typeof WORKSPACE_PREVIEW_OPEN_REQUEST
  }
}

export interface HomeContinueWorkViewModel {
  project: StudioProject
  session?: AgentSessionSummary
  status?: HomeSessionPresentation
  target: HomeWorkspaceTarget
  previewActive: boolean
  previewTarget?: HomeWorkspaceTarget
}

export interface HomeContinueRequest {
  projectId: string
  revision: number
}

export function selectLatestHomeProject(projects: readonly StudioProject[]): StudioProject | undefined {
  return latestByUpdatedAt(projects)
}

export function selectLatestHomeSession(
  sessions: readonly AgentSessionSummary[],
  projectId: string,
): AgentSessionSummary | undefined {
  return latestByUpdatedAt(sessions.filter((session) => session.projectId === projectId))
}

export function homeSessionPresentation(state: AgentSessionSummary['state']): HomeSessionPresentation {
  if (state === 'paused') return { labelKey: 'statePaused', tone: 'neutral' }
  if (state === 'running') return { labelKey: 'stateRunning', tone: 'active' }
  if (state === 'failed') return { labelKey: 'stateFailed', tone: 'danger' }
  if (state === 'interrupted') return { labelKey: 'stateInterrupted', tone: 'warning' }
  if (state === 'completed') return { labelKey: 'stateCompleted', tone: 'neutral' }
  if (state === 'aborted') return { labelKey: 'stateAborted', tone: 'neutral' }
  return { labelKey: 'stateIdle', tone: 'neutral' }
}

export function homeWorkspaceTarget(projectId: string, sessionId?: string): HomeWorkspaceTarget {
  return {
    pathname: '/workspace/[id]',
    params: { id: projectId, ...(sessionId ? { sessionId } : {}) },
  }
}

export function homePreviewTarget(projectId: string, sessionId?: string): HomeWorkspaceTarget {
  return {
    pathname: '/workspace/[id]',
    params: { id: projectId, ...(sessionId ? { sessionId } : {}), preview: WORKSPACE_PREVIEW_OPEN_REQUEST },
  }
}

export function homeActivePreviewProjectId(snapshot: HostSnapshot | undefined, events: readonly HostEvent[]): string | undefined {
  const activePreview = snapshot?.activePreview
  if (!activePreview) return undefined
  let latest: HostEvent | undefined
  for (const event of events) {
    if (event.name !== 'preview.ready') continue
    const data = asRecord(event.data)
    if (data.platform !== activePreview.platform || data.port !== activePreview.port || typeof data.projectId !== 'string') continue
    if (!latest || event.sequence > latest.sequence) latest = event
  }
  const data = asRecord(latest?.data)
  return typeof data.projectId === 'string' ? data.projectId : undefined
}

export function homeProjectHasActivePreview(
  snapshot: HostSnapshot | undefined,
  activePreviewProjectId: string | undefined,
  projectId: string,
): boolean {
  return snapshot?.activePreview !== undefined && activePreviewProjectId === projectId
}

export function homeContinueWorkViewModel(
  projects: readonly StudioProject[],
  sessions: readonly AgentSessionSummary[] | undefined,
  snapshot?: HostSnapshot,
  activePreviewProjectId?: string,
): HomeContinueWorkViewModel | undefined {
  const project = selectLatestHomeProject(projects)
  if (!project) return undefined
  const session = sessions ? selectLatestHomeSession(sessions, project.id) : undefined
  const previewActive = homeProjectHasActivePreview(snapshot, activePreviewProjectId, project.id)
  return {
    project,
    ...(session ? { session, status: homeSessionPresentation(session.state) } : {}),
    target: homeWorkspaceTarget(project.id, session?.sessionId),
    previewActive,
    ...(previewActive ? { previewTarget: homePreviewTarget(project.id, session?.sessionId) } : {}),
  }
}

export function isCurrentHomeContinueRequest(
  request: HomeContinueRequest,
  currentProjectId: string | undefined,
  currentRevision: number,
): boolean {
  return request.projectId === currentProjectId && request.revision === currentRevision
}

function latestByUpdatedAt<T extends { updatedAt: number }>(items: readonly T[]): T | undefined {
  let latest: T | undefined
  for (const item of items) {
    if (!latest || item.updatedAt > latest.updatedAt) latest = item
  }
  return latest
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
