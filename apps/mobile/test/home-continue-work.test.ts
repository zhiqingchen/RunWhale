import { MOBILE_HOST_PROTOCOL_VERSION, type AgentSessionSummary, type HostEvent, type HostSnapshot } from '@runwhale/mobile-protocol'
import { describe, expect, it } from 'vitest'
import type { StudioProject } from '../src/state/projects'
import {
  homeActivePreviewProjectId,
  homeContinueWorkViewModel,
  homePreviewTarget,
  homeProjectHasActivePreview,
  homeSessionPresentation,
  homeWorkspaceTarget,
  isCurrentHomeContinueRequest,
  selectLatestHomeProject,
  selectLatestHomeSession,
} from '../src/utils/home-continue-work'

function project(id: string, updatedAt: number): StudioProject {
  return { id, name: id, description: '', updatedAt, files: [] }
}

function session(projectId: string, sessionId: string, updatedAt: number, state: AgentSessionSummary['state'] = 'completed'): AgentSessionSummary {
  return {
    projectId,
    sessionId,
    title: sessionId,
    updatedAt,
    state,
    turnCount: 2,
    eventCount: 6,
    preview: `${sessionId} summary`,
  }
}

function hostSnapshot(activeProjectId?: string, withPreview = false): HostSnapshot {
  return {
    protocolVersion: MOBILE_HOST_PROTOCOL_VERSION,
    runtimeAbi: 'runwhale-test-v1',
    state: 'running',
    ...(activeProjectId ? { activeProjectId } : {}),
    ...(withPreview ? { activePreview: { platform: 'web' as const, port: 31_337, revision: 1, startedAt: 10 } } : {}),
    lastEventSequence: 0,
  }
}

function event(sequence: number, name: HostEvent['name'], data: Record<string, unknown>): HostEvent {
  return { v: MOBILE_HOST_PROTOCOL_VERSION, type: 'event', sequence, timestamp: sequence, name, data }
}

describe('Home continue-work selection', () => {
  it('selects the most recently updated project without relying on array order', () => {
    const older = project('older', 10)
    const latest = project('latest', 30)
    const equallyRecent = project('equally-recent', 30)
    const middle = project('middle', 20)

    expect(selectLatestHomeProject([])).toBeUndefined()
    expect(selectLatestHomeProject([middle, older, latest, equallyRecent])).toBe(latest)
  })

  it('selects the latest session for the selected project and ignores stale project results', () => {
    const older = session('selected', 'older-session', 10)
    const latest = session('selected', 'latest-session', 30)
    const equallyRecent = session('selected', 'equally-recent-session', 30)
    const staleProject = session('stale', 'stale-session', 40)

    expect(selectLatestHomeSession([older, staleProject, latest, equallyRecent], 'selected')).toBe(latest)
    expect(selectLatestHomeSession([staleProject], 'selected')).toBeUndefined()
  })
})

describe('Home continue-work presentation', () => {
  it('maps the emphasized and settled session states', () => {
    expect(homeSessionPresentation('running')).toEqual({ labelKey: 'stateRunning', tone: 'active' })
    expect(homeSessionPresentation('failed')).toEqual({ labelKey: 'stateFailed', tone: 'danger' })
    expect(homeSessionPresentation('interrupted')).toEqual({ labelKey: 'stateInterrupted', tone: 'warning' })
    expect(homeSessionPresentation('completed')).toEqual({ labelKey: 'stateCompleted', tone: 'neutral' })
    expect(homeSessionPresentation('idle')).toEqual({ labelKey: 'stateIdle', tone: 'neutral' })
    expect(homeSessionPresentation('aborted')).toEqual({ labelKey: 'stateAborted', tone: 'neutral' })
  })

  it('opens the latest session when available and otherwise falls back to the project', () => {
    const latestProject = project('latest-project', 30)
    const latestSession = session(latestProject.id, 'latest-session', 40)

    expect(homeContinueWorkViewModel([latestProject], [latestSession])).toMatchObject({
      project: latestProject,
      session: latestSession,
      target: homeWorkspaceTarget(latestProject.id, latestSession.sessionId),
    })
    expect(homeContinueWorkViewModel([latestProject], [])?.target).toEqual(homeWorkspaceTarget(latestProject.id))
    expect(homeContinueWorkViewModel([latestProject], undefined)?.target).toEqual(homeWorkspaceTarget(latestProject.id))
    expect(homeContinueWorkViewModel([], undefined)).toBeUndefined()
  })

  it('offers Preview only when the active Preview belongs to the latest project', () => {
    const latestProject = project('latest-project', 30)
    const latestSession = session(latestProject.id, 'latest-session', 40)
    const active = hostSnapshot('other-project', true)
    const matchingReady = event(2, 'preview.ready', { projectId: latestProject.id, platform: 'web', port: 31_337 })
    const otherProjectReady = event(3, 'preview.ready', { projectId: 'other-project', platform: 'web', port: 31_337 })
    const otherPortReady = event(4, 'preview.ready', { projectId: 'other-project', platform: 'web', port: 40_000 })

    expect(homeActivePreviewProjectId(active, [matchingReady, otherPortReady])).toBe(latestProject.id)
    expect(homeActivePreviewProjectId(active, [matchingReady, otherProjectReady])).toBe('other-project')
    expect(homeActivePreviewProjectId(active, [otherPortReady])).toBeUndefined()
    expect(homeActivePreviewProjectId(hostSnapshot(latestProject.id), [matchingReady])).toBeUndefined()
    expect(homeProjectHasActivePreview(active, latestProject.id, latestProject.id)).toBe(true)
    expect(homeProjectHasActivePreview(active, 'other-project', latestProject.id)).toBe(false)
    expect(homeProjectHasActivePreview(hostSnapshot(latestProject.id), latestProject.id, latestProject.id)).toBe(false)
    expect(homeProjectHasActivePreview(undefined, latestProject.id, latestProject.id)).toBe(false)
    expect(homeContinueWorkViewModel([latestProject], [latestSession], active, latestProject.id)).toMatchObject({
      previewActive: true,
      previewTarget: homePreviewTarget(latestProject.id, latestSession.sessionId),
    })
    expect(homeContinueWorkViewModel([latestProject], [], active, 'other-project')).toMatchObject({ previewActive: false })
  })

  it('rejects responses from an older refresh or a previously selected project', () => {
    const request = { projectId: 'project-a', revision: 1 }

    expect(isCurrentHomeContinueRequest(request, 'project-a', 1)).toBe(true)
    expect(isCurrentHomeContinueRequest(request, 'project-a', 2)).toBe(false)
    expect(isCurrentHomeContinueRequest(request, 'project-b', 1)).toBe(false)
    expect(isCurrentHomeContinueRequest(request, undefined, 1)).toBe(false)
  })
})
