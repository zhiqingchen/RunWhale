import { describe, expect, it } from 'vitest'
import { agentRecoveryState, agentSessionFailureMessage, retireEndedAgentRun } from '../src/utils/agent-recovery'

describe('Agent recovery', () => {
  it('distinguishes stopped, interrupted, and failed sessions', () => {
    expect(agentRecoveryState('aborted')).toBe('aborted')
    expect(agentRecoveryState('paused')).toBe('paused')
    expect(agentRecoveryState('interrupted')).toBe('interrupted')
    expect(agentRecoveryState('failed')).toBe('failed')
    expect(agentRecoveryState('completed')).toBeUndefined()
    expect(agentRecoveryState('running')).toBeUndefined()
    expect(agentRecoveryState(undefined)).toBeUndefined()
  })

  it('retires the suspended request transport when the host checkpoints a pause', () => {
    const request = new AbortController()
    retireEndedAgentRun(request, 'running')
    expect(request.signal.aborted).toBe(false)
    retireEndedAgentRun(request, 'paused')
    expect(request.signal.reason).toMatchObject({ code: 'ABORTED' })
  })

  it('restores the terminal error after reopening, without leaking an older failure into a retry', () => {
    const failed = { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'RATE_LIMIT', message: 'Please try again later.' } } } }
    expect(agentSessionFailureMessage([failed])).toBe('RATE_LIMIT: Please try again later.')
    expect(agentSessionFailureMessage([failed, { type: 'turn/start' }])).toBeUndefined()
    expect(agentSessionFailureMessage([failed, { type: 'turn/end', data: { reason: { kind: 'aborted' } } }])).toBeUndefined()
    expect(agentSessionFailureMessage([])).toBeUndefined()
    expect(agentSessionFailureMessage([], { code: 'HOST_FAILURE', message: '  Request failed.  ' })).toBe('HOST_FAILURE: Request failed.')
    expect(agentSessionFailureMessage([failed], { message: '  ' })).toBe('RATE_LIMIT: Please try again later.')
  })
})
