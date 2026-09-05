import type { AgentGoal, HostEvent } from '@runwhale/mobile-protocol'

export interface AgentGoalProjectionOptions {
  projectId: string
  sessionId?: string
}

export interface AgentGoalProjection {
  observed: boolean
  goal?: AgentGoal
}

export type AgentGoalCommand =
  | { kind: 'open' }
  | { kind: 'create'; objective: string }
  | { kind: 'edit'; objective: string }
  | { kind: 'invalid-edit' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'clear' }

export function agentGoalProjectionVersion(projection: AgentGoalProjection): string {
  if (!projection.observed) return 'unobserved'
  const goal = projection.goal
  return goal ? [goal.id, goal.revision, goal.phase, goal.roundsStarted, goal.updatedAt].join(':') : 'clear'
}

/** Recognizes the mobile `/goal` command without sending it through the model. */
export function parseAgentGoalCommand(input: string): AgentGoalCommand | undefined {
  const match = input.match(/^\/goal(?=$|[\t\n\r ])([\s\S]*)$/u)
  if (!match) return undefined
  const argument = match[1]?.trim() ?? ''
  if (!argument) return { kind: 'open' }
  const control = argument.toLowerCase()
  if (control === 'clear') return { kind: 'clear' }
  if (control === 'pause') return { kind: 'pause' }
  if (control === 'resume') return { kind: 'resume' }
  if (control === 'edit') return { kind: 'invalid-edit' }
  if (/^edit(?=\s)/iu.test(argument)) return { kind: 'edit', objective: argument.slice(4).trim() }
  return { kind: 'create', objective: argument }
}

/** Replays durable and live goal changes so an in-flight tool mutation reaches the composer immediately. */
export function projectAgentGoal(
  persistedEvents: readonly unknown[],
  liveEvents: readonly HostEvent[],
  options: AgentGoalProjectionOptions,
): AgentGoalProjection {
  let projection: AgentGoalProjection = { observed: false }

  for (const value of persistedEvents) {
    const event = asRecord(value)
    projection = applyGoalEvent(projection, event?.type, asRecord(event?.data))
  }

  for (const event of [...liveEvents].sort((left, right) => left.sequence - right.sequence)) {
    const data = asRecord(event.data)
    if (!belongsToSession(data, options)) continue
    if (event.name === 'session.event') {
      const sessionEvent = asRecord(data?.event)
      projection = applyGoalEvent(projection, sessionEvent?.type, asRecord(sessionEvent?.data))
    } else if (event.name === 'agent.state' && data?.state === 'goal/change') {
      projection = applyGoalEvent(projection, 'goal/change', asRecord(data.detail))
    }
  }

  return projection
}

function applyGoalEvent(projection: AgentGoalProjection, type: unknown, data: Record<string, unknown> | undefined): AgentGoalProjection {
  if (type === 'goal/change') {
    const next = goalChange(data)
    if (!next) return projection
    if (!(data?.operation === 'create' && projection.goal?.phase === 'complete' && next.goal?.revision === 1) && next.goal && projection.goal && next.goal.id === projection.goal.id) {
      if (next.goal.revision < projection.goal.revision) return projection
      next.goal.roundsStarted = Math.max(next.goal.roundsStarted, projection.goal.roundsStarted)
    }
    return next
  }
  const source = asRecord(data?.source)
  const goal = projection.goal
  if (type !== 'user/message' || !goal || source?.kind !== 'goal'
    || source.goalId !== goal.id || source.revision !== goal.revision
    || !Number.isSafeInteger(source.round) || Number(source.round) <= goal.roundsStarted) return projection
  return { observed: true, goal: { ...goal, roundsStarted: Number(source.round) } }
}

function goalChange(data: Record<string, unknown> | undefined): AgentGoalProjection | undefined {
  if (!data) return undefined
  if (data.operation === 'clear') return { observed: true }
  const source = asRecord(data.goal)
  if (!source || typeof source.id !== 'string' || typeof source.objective !== 'string'
    || typeof source.revision !== 'number' || typeof source.maxGoalRounds !== 'number') return undefined
  const phase = source.phase === 'paused' || source.phase === 'blocked' || source.phase === 'complete' ? source.phase : 'active'
  const blockedReason = asRecord(source.blockedReason)
  return {
    observed: true,
    goal: {
      id: source.id,
      revision: source.revision,
      objective: source.objective,
      phase,
      maxGoalRounds: source.maxGoalRounds,
      roundsStarted: Number(data.roundsStarted ?? source.roundsStarted ?? 0),
      createdAt: Number(data.createdAt ?? source.createdAt ?? 0),
      updatedAt: Number(data.updatedAt ?? source.updatedAt ?? 0),
      ...(source.activation === 'armed' || source.activation === 'disarmed' ? { activation: source.activation } : {}),
      ...(typeof blockedReason?.code === 'string' && typeof blockedReason.message === 'string'
        ? { blockedReason: { code: blockedReason.code, message: blockedReason.message } }
        : {}),
    },
  }
}

function belongsToSession(data: Record<string, unknown> | undefined, options: AgentGoalProjectionOptions): boolean {
  if (!data || data.projectId !== options.projectId) return false
  return options.sessionId === undefined || data.sessionId === options.sessionId
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
