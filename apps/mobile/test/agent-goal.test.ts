import { describe, expect, it } from 'vitest'
import { MOBILE_HOST_PROTOCOL_VERSION, type HostEvent } from '@runwhale/mobile-protocol'
import { agentGoalProjectionVersion, parseAgentGoalCommand, projectAgentGoal } from '../src/utils/agent-goal'

function goal(objective: string, revision = 1) {
  return { id: 'goal-1', revision, objective, phase: 'active' as const, maxGoalRounds: 10, roundsStarted: 0, createdAt: 1, updatedAt: 1 }
}

function liveGoal(sequence: number, projectId: string, sessionId: string, detail: unknown): HostEvent {
  return {
    v: MOBILE_HOST_PROTOCOL_VERSION,
    type: 'event',
    sequence,
    timestamp: sequence,
    name: 'agent.state',
    data: { projectId, sessionId, taskId: 'task-1', state: 'goal/change', detail },
  }
}

function tasklessLiveGoal(sequence: number, projectId: string, sessionId: string, detail: unknown): HostEvent {
  const event = liveGoal(sequence, projectId, sessionId, detail)
  return { ...event, data: { ...(event.data as Record<string, unknown>), taskId: undefined } }
}

describe('Agent Goal projection', () => {
  it('projects a goal created by an in-flight Agent tool call', () => {
    expect(projectAgentGoal([], [liveGoal(2, 'project-1', 'session-1', { operation: 'create', goal: goal('Ship it') })], {
      projectId: 'project-1', sessionId: 'session-1',
    })).toMatchObject({ observed: true, goal: { objective: 'Ship it', phase: 'active' } })
  })

  it('applies the latest matching live edit and ignores another session', () => {
    const persisted = [{ type: 'goal/change', data: { operation: 'create', goal: goal('Old') } }]
    const live = [
      liveGoal(3, 'project-1', 'other-session', { operation: 'edit', goal: goal('Wrong session', 2) }),
      liveGoal(4, 'project-1', 'session-1', { operation: 'edit', goal: goal('New', 2) }),
    ]
    expect(projectAgentGoal(persisted, live, { projectId: 'project-1', sessionId: 'session-1' }).goal?.objective).toBe('New')
  })

  it('removes the card after a matching live clear', () => {
    const persisted = [{ type: 'goal/change', data: { operation: 'create', goal: goal('Ship it') } }]
    expect(projectAgentGoal(persisted, [liveGoal(5, 'project-1', 'session-1', { operation: 'clear' })], {
      projectId: 'project-1', sessionId: 'session-1',
    })).toEqual({ observed: true })
  })

  it('applies taskless host mutations after an earlier task-scoped Goal update', () => {
    const persisted = [{ type: 'goal/change', data: { operation: 'complete', goal: { ...goal('Old'), revision: 2, phase: 'complete' } } }]
    const live = [
      liveGoal(6, 'project-1', 'session-1', { operation: 'complete', goal: { ...goal('Old'), revision: 2, phase: 'complete' } }),
      tasklessLiveGoal(7, 'project-1', 'session-1', { operation: 'create', goal: goal('New Goal') }),
    ]
    expect(projectAgentGoal(persisted, live, { projectId: 'project-1', sessionId: 'session-1' }).goal?.objective).toBe('New Goal')
  })

  it('exposes a stable version that changes only with projected Goal state', () => {
    expect(agentGoalProjectionVersion({ observed: false })).toBe('unobserved')
    expect(agentGoalProjectionVersion({ observed: true })).toBe('clear')
    expect(agentGoalProjectionVersion({ observed: true, goal: goal('First') })).toBe(agentGoalProjectionVersion({ observed: true, goal: goal('Renamed elsewhere') }))
    expect(agentGoalProjectionVersion({ observed: true, goal: goal('First', 2) })).not.toBe(agentGoalProjectionVersion({ observed: true, goal: goal('First') }))
  })

  it('does not rewind admitted rounds when a live create is replayed after its persisted copy', () => {
    const created = { type: 'goal/change', data: { operation: 'create', goal: goal('Continue') } }
    const admitted = { type: 'user/message', data: { source: { kind: 'goal', goalId: 'goal-1', revision: 1, round: 2 } } }
    const options = { projectId: 'project-1', sessionId: 'session-1' }
    expect(projectAgentGoal([created, admitted], [liveGoal(1, 'project-1', 'session-1', created.data)], options).goal?.roundsStarted).toBe(2)
    const live: HostEvent = { ...liveGoal(2, 'project-1', 'session-1', {}), name: 'session.event', data: { ...options, event: admitted } }
    expect(projectAgentGoal([created], [live], options).goal?.roundsStarted).toBe(2)
  })

  // DSH advances this counter on admitted user/message events, without a goal/change.
  it('advances round progress when a matching automatic goal round is admitted', () => {
    const created = { type: 'goal/change', data: { operation: 'create', goal: goal('Continue working') } }
    const admitted = { type: 'user/message', data: { source: { kind: 'goal', goalId: 'goal-1', revision: 1, round: 1 } } }
    const options = { projectId: 'project-1', sessionId: 'session-1' }
    const before = projectAgentGoal([created], [], options)
    const after = projectAgentGoal([created, admitted], [], options)
    expect(after.goal?.roundsStarted).toBe(1)
    expect(agentGoalProjectionVersion(after)).not.toBe(agentGoalProjectionVersion(before))
  })
})

describe('Agent Goal command', () => {
  it('opens Goal settings for the bare command and rejects lookalike command names', () => {
    expect(parseAgentGoalCommand('/goal')).toEqual({ kind: 'open' })
    expect(parseAgentGoalCommand('/goal   ')).toEqual({ kind: 'open' })
    expect(parseAgentGoalCommand('/goalkeeper')).toBeUndefined()
    expect(parseAgentGoalCommand('/goals')).toBeUndefined()
    expect(parseAgentGoalCommand('/Goal')).toBeUndefined()
    expect(parseAgentGoalCommand('/goal\u00a0pause')).toBeUndefined()
  })

  it('creates a trimmed objective from arbitrary non-control input', () => {
    expect(parseAgentGoalCommand('/goal  polish the app ')).toEqual({ kind: 'create', objective: 'polish the app' })
    expect(parseAgentGoalCommand('/goal\nship the release')).toEqual({ kind: 'create', objective: 'ship the release' })
    expect(parseAgentGoalCommand('/goal pause only after verification')).toEqual({ kind: 'create', objective: 'pause only after verification' })
    expect(parseAgentGoalCommand('/goal clear after release')).toEqual({ kind: 'create', objective: 'clear after release' })
    expect(parseAgentGoalCommand('/goal editability review')).toEqual({ kind: 'create', objective: 'editability review' })
  })

  it('recognizes exact pause, resume, and clear controls case-insensitively', () => {
    expect(parseAgentGoalCommand('/goal pause')).toEqual({ kind: 'pause' })
    expect(parseAgentGoalCommand('/goal\tRESUME')).toEqual({ kind: 'resume' })
    expect(parseAgentGoalCommand('/goal Clear')).toEqual({ kind: 'clear' })
  })

  it('requires a replacement objective for edit and extracts explicit edits', () => {
    expect(parseAgentGoalCommand('/goal edit')).toEqual({ kind: 'invalid-edit' })
    expect(parseAgentGoalCommand('/goal EDIT   ')).toEqual({ kind: 'invalid-edit' })
    expect(parseAgentGoalCommand('/goal edit  polish the app ')).toEqual({ kind: 'edit', objective: 'polish the app' })
    expect(parseAgentGoalCommand('/goal EDIT\nship it')).toEqual({ kind: 'edit', objective: 'ship it' })
  })

})
