import { MOBILE_HOST_PROTOCOL_VERSION, type HostEvent } from '@runwhale/mobile-protocol'
import { describe, expect, it } from 'vitest'
import { parseAgentPlanCommand, projectAgentPlanMode } from '../src/utils/agent-plan'

function livePlanMode(
  sequence: number,
  projectId: string,
  sessionId: string,
  state: { active: boolean; pending?: boolean },
): HostEvent {
  return {
    v: MOBILE_HOST_PROTOCOL_VERSION,
    type: 'event',
    sequence,
    timestamp: sequence,
    name: 'agent.state',
    data: { projectId, sessionId, state: 'plan-mode', ...state },
  }
}

describe('Agent Plan command', () => {
  it('enters plan mode for the bare command and rejects lookalike command names', () => {
    expect(parseAgentPlanCommand('/plan')).toEqual({ kind: 'enter' })
    expect(parseAgentPlanCommand('/plan   ')).toEqual({ kind: 'enter' })
    expect(parseAgentPlanCommand('/planner')).toBeUndefined()
    expect(parseAgentPlanCommand('/plans')).toBeUndefined()
    expect(parseAgentPlanCommand('/Plan')).toBeUndefined()
    expect(parseAgentPlanCommand('/plan\u00a0off')).toBeUndefined()
  })

  it('leaves only for the exact lowercase off argument', () => {
    expect(parseAgentPlanCommand('/plan off')).toEqual({ kind: 'leave' })
    expect(parseAgentPlanCommand('/plan\toff  ')).toEqual({ kind: 'leave' })
    expect(parseAgentPlanCommand('/plan OFF')).toEqual({ kind: 'enter', message: 'OFF' })
    expect(parseAgentPlanCommand('/plan off now')).toEqual({ kind: 'enter', message: 'off now' })
  })

  it('enters plan mode and carries any other trimmed suffix as the next message', () => {
    expect(parseAgentPlanCommand('/plan  sketch the mobile flow ')).toEqual({ kind: 'enter', message: 'sketch the mobile flow' })
    expect(parseAgentPlanCommand('/plan\ncompare both options')).toEqual({ kind: 'enter', message: 'compare both options' })
  })
})

describe('Agent Plan projection', () => {
  it('restores the last durable plan mode', () => {
    const active = projectAgentPlanMode([
      { type: 'plan/mode', data: { active: false } },
      { type: 'plan/mode', data: { active: true } },
    ], [], { projectId: 'project-1', sessionId: 'session-1' })

    expect(active).toEqual({ observed: true, active: true })
  })

  it('applies only live state for the selected project and session in sequence order', () => {
    const live = [
      livePlanMode(5, 'project-1', 'session-1', { active: false }),
      livePlanMode(4, 'project-1', 'session-1', { active: true }),
      livePlanMode(6, 'project-1', 'other-session', { active: true }),
      livePlanMode(7, 'other-project', 'session-1', { active: true }),
    ]

    expect(projectAgentPlanMode([], live, { projectId: 'project-1', sessionId: 'session-1' }))
      .toEqual({ observed: true, active: false })
  })

  it('prefers a pending live target over the currently committed mode', () => {
    const persisted = [{ type: 'plan/mode', data: { active: false } }]
    expect(projectAgentPlanMode(persisted, [
      livePlanMode(8, 'project-1', 'session-1', { active: false, pending: true }),
    ], { projectId: 'project-1', sessionId: 'session-1' })).toEqual({ observed: true, active: true })

    expect(projectAgentPlanMode([{ type: 'plan/mode', data: { active: true } }], [
      livePlanMode(9, 'project-1', 'session-1', { active: true, pending: false }),
    ], { projectId: 'project-1', sessionId: 'session-1' })).toEqual({ observed: true, active: false })
  })

  it('applies a plan mode event committed at a live Agent step boundary', () => {
    const committed = {
      ...livePlanMode(10, 'project-1', 'session-1', { active: false }),
      data: { projectId: 'project-1', sessionId: 'session-1', state: 'plan/mode', detail: { active: true } },
    }
    expect(projectAgentPlanMode([], [committed], { projectId: 'project-1', sessionId: 'session-1' }))
      .toEqual({ observed: true, active: true })
  })

  it('falls back to persisted recovery when unrelated or malformed live events arrive', () => {
    const persisted = [
      { type: 'plan/mode', data: { active: true } },
      { type: 'plan/mode', data: { active: 'yes' } },
    ]
    const unrelated = {
      ...livePlanMode(10, 'project-1', 'session-1', { active: false }),
      name: 'agent.delta' as const,
    }

    expect(projectAgentPlanMode(persisted, [unrelated], { projectId: 'project-1', sessionId: 'session-1' }))
      .toEqual({ observed: true, active: true })
  })
})
