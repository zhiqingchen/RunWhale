import type { AgentSessionRecord } from '@runwhale/mobile-protocol'

export type AgentRecoveryState = Extract<AgentSessionRecord['state'], 'failed' | 'aborted' | 'interrupted' | 'paused'>

export function agentRecoveryState(state: AgentSessionRecord['state'] | undefined): AgentRecoveryState | undefined {
  return state === 'failed' || state === 'aborted' || state === 'interrupted' || state === 'paused' ? state : undefined
}

export function retireEndedAgentRun(controller: AbortController | undefined, state: AgentSessionRecord['state'] | undefined): void {
  if (state === 'completed' || state === 'failed' || state === 'aborted' || state === 'paused') {
    controller?.abort(Object.assign(new Error('Agent run ended'), { code: 'ABORTED' }))
  }
}

export function agentSessionFailureMessage(events: readonly unknown[], failure?: AgentSessionRecord['failure']): string | undefined {
  if (failure?.message.trim()) return [failure.code, failure.message.trim()].filter(Boolean).join(': ')
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as { type?: string; data?: { reason?: { kind?: string; error?: { code?: string; message?: string } } } } | undefined
    // An older turn's error must not be shown for a newer attempt.
    if (event?.type === 'turn/start') return undefined
    if (event?.type !== 'turn/end') continue
    const reason = event.data?.reason
    if (reason?.kind !== 'error' || !reason.error?.message?.trim()) return undefined
    return [reason.error.code, reason.error.message.trim()].filter(Boolean).join(': ')
  }
  return undefined
}
