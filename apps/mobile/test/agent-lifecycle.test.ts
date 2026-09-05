import { describe, expect, it } from 'vitest'
import { MOBILE_HOST_PROTOCOL_VERSION, type HostEvent } from '@runwhale/mobile-protocol'
import { latestAgentLifecycleState } from '../src/utils/agent-lifecycle'

function event(sequence: number, projectId: string, sessionId: string, state: string): HostEvent {
  return { v: MOBILE_HOST_PROTOCOL_VERSION, type: 'event', sequence, timestamp: sequence, name: 'agent.state', data: { projectId, sessionId, state } }
}

describe('Agent lifecycle', () => {
  it('ignores the stopped run when a fresh retry is being submitted', () => {
    const stopped = [event(1, 'project-a', 'session-a', 'running'), event(2, 'project-a', 'session-a', 'aborted')]
    expect(latestAgentLifecycleState(stopped, 'project-a', 'session-a', 2)).toBeUndefined()
    expect(latestAgentLifecycleState([...stopped, event(3, 'project-a', 'session-a', 'running')], 'project-a', 'session-a', 2)).toBe('running')
    expect(latestAgentLifecycleState([...stopped, event(4, 'project-a', 'session-a', 'aborted')], 'project-a', 'session-a', 2)).toBe('aborted')
  })

  it('selects only the latest lifecycle state for the active project session', () => {
    expect(latestAgentLifecycleState([
      event(1, 'project-a', 'session-a', 'running'),
      event(2, 'project-a', 'session-a', 'step/start'),
      event(3, 'project-a', 'session-b', 'aborted'),
      event(4, 'project-a', 'session-a', 'aborted'),
    ], 'project-a', 'session-a')).toBe('aborted')
  })

  it('returns undefined without matching lifecycle evidence', () => {
    expect(latestAgentLifecycleState([event(1, 'project-a', 'session-a', 'running')], 'project-b', 'session-a')).toBeUndefined()
    expect(latestAgentLifecycleState([], 'project-a', undefined)).toBeUndefined()
  })
})
