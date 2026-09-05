import type { HostEvent } from '@runwhale/mobile-protocol'

export interface AgentPlanProjectionOptions {
  projectId: string
  sessionId?: string
}

export interface AgentPlanProjection {
  observed: boolean
  active: boolean
}

export type AgentPlanCommand =
  | { kind: 'enter'; message?: string }
  | { kind: 'leave' }

/** Recognizes DeepSeek Harness' `/plan [off|message]` command semantics. */
export function parseAgentPlanCommand(input: string): AgentPlanCommand | undefined {
  const match = input.match(/^\/plan(?=$|[\t\n\r ])([\s\S]*)$/u)
  if (!match) return undefined
  const argument = match[1]?.trim() ?? ''
  if (argument === 'off') return { kind: 'leave' }
  return argument ? { kind: 'enter', message: argument } : { kind: 'enter' }
}

/** Replays durable mode changes and matching live selections for one Agent session. */
export function projectAgentPlanMode(
  persistedEvents: readonly unknown[],
  liveEvents: readonly HostEvent[],
  options: AgentPlanProjectionOptions,
): AgentPlanProjection {
  let projection: AgentPlanProjection = { observed: false, active: false }

  for (const value of persistedEvents) {
    const event = asRecord(value)
    if (event?.type !== 'plan/mode') continue
    const active = asRecord(event.data)?.active
    if (typeof active === 'boolean') projection = { observed: true, active }
  }

  for (const event of [...liveEvents].sort((left, right) => left.sequence - right.sequence)) {
    if (event.name !== 'agent.state') continue
    const data = asRecord(event.data)
    if (!belongsToSession(data, options)) continue
    const active = data?.state === 'plan-mode'
      ? typeof data.pending === 'boolean' ? data.pending : data.active
      : data?.state === 'plan/mode' ? asRecord(data.detail)?.active : undefined
    if (typeof active === 'boolean') projection = { observed: true, active }
  }

  return projection
}

function belongsToSession(data: Record<string, unknown> | undefined, options: AgentPlanProjectionOptions): boolean {
  if (!data || data.projectId !== options.projectId) return false
  return options.sessionId === undefined || data.sessionId === options.sessionId
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
