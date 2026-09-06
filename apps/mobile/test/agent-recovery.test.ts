import { describe, expect, it } from 'vitest'
import { agentRecoveryState, agentRunTransportRecovered, agentSessionFailureMessage, isAgentCredentialFailure, retireEndedAgentRun } from '../src/utils/agent-recovery'
import type { AgentSessionRecord } from '@runwhale/mobile-protocol'

describe('Agent recovery', () => {
  it('recognizes credential failures without misclassifying other errors', () => {
    expect(isAgentCredentialFailure('AUTH: Authentication failed (401)')).toBe(true)
    expect(isAgentCredentialFailure('MISSING_CREDENTIAL: Configure a provider')).toBe(true)
    expect(isAgentCredentialFailure('RATE_LIMIT: Please try again')).toBe(false)
    expect(isAgentCredentialFailure(undefined)).toBe(false)
  })
  it('reconciles a lost run response without mistaking a previous terminal attempt for recovery', () => {
    const record: AgentSessionRecord = { sessionId: 'session', projectId: 'project', title: 'Test', updatedAt: 1, taskId: 'previous', state: 'completed', events: [] }
    expect(agentRunTransportRecovered(undefined, 'previous')).toBe(false)
    expect(agentRunTransportRecovered(record, 'previous')).toBe(false)
    expect(agentRunTransportRecovered({ ...record, state: 'failed' }, 'previous')).toBe(false)
    expect(agentRunTransportRecovered({ ...record, state: 'running' }, 'previous')).toBe(true)
    for (const state of ['completed', 'failed', 'paused', 'aborted', 'interrupted'] as const) {
      expect(agentRunTransportRecovered({ ...record, taskId: 'current', state }, 'previous')).toBe(true)
    }
    expect(agentRunTransportRecovered({ ...record, state: 'idle', taskId: 'current' }, 'previous')).toBe(false)
  })
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
