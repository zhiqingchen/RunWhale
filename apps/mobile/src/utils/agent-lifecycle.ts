import type { AgentSessionRecord, HostEvent } from '@runwhale/mobile-protocol'

export type AgentLifecycleState = Extract<AgentSessionRecord['state'], 'running' | 'completed' | 'failed' | 'aborted' | 'paused'>

const LIFECYCLE_STATES = new Set<AgentLifecycleState>(['running', 'completed', 'failed', 'aborted', 'paused'])

export function latestAgentLifecycleState(
  events: readonly HostEvent[],
  projectId: string,
  sessionId: string | undefined,
  afterSequence = -1,
): AgentLifecycleState | undefined {
  if (!sessionId) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event && event.sequence <= afterSequence) continue
    if (event?.name !== 'agent.state') continue
    const data = event.data as { projectId?: unknown; sessionId?: unknown; state?: unknown }
    if (data.projectId !== projectId || data.sessionId !== sessionId || !LIFECYCLE_STATES.has(data.state as AgentLifecycleState)) continue
    return data.state as AgentLifecycleState
  }
  return undefined
}
