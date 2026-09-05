import type { HostEvent } from '@runwhale/mobile-protocol'

const MAX_RETAINED_TERMINAL_TASKS = 8
const LIVE_TRANSCRIPT_EVENT_NAMES = new Set([
  'agent.delta',
  'agent.message',
  'agent.state',
  'agent.tool',
  'session.event',
  'task.output',
  'task.state',
])
const RETRY_STATES = new Set(['llm/retry', 'llm/retry-started'])

export function compactLiveTranscriptEvents(events: readonly HostEvent[]): HostEvent[] {
  return [...events]
    .sort((left, right) => left.sequence - right.sequence)
    .reduce<HostEvent[]>((current, event) => appendLiveTranscriptEvent(current, event), [])
}

export function appendLiveTranscriptEvent(current: readonly HostEvent[], event: HostEvent): HostEvent[] {
  const data = asRecord(event.data)
  const taskKey = liveTranscriptTaskKey(data)
  if (!taskKey || !LIVE_TRANSCRIPT_EVENT_NAMES.has(event.name)) return current as HostEvent[]
  if (event.name === 'agent.state' && data?.state === 'usage') return current as HostEvent[]
  if (event.sequence <= latestProcessedHostSequence(current)) return current as HostEvent[]

  let next = [...current]
  if (event.name === 'agent.state' && RETRY_STATES.has(String(data?.state ?? ''))) {
    const turn = finiteNumber(data?.turn)
    const step = finiteNumber(data?.step)
    if (turn !== undefined && step !== undefined) {
      next = next.filter((candidate) => {
        if (candidate.name !== 'agent.delta') return true
        const candidateData = asRecord(candidate.data)
        return liveTranscriptTaskKey(candidateData) !== taskKey
          || finiteNumber(candidateData?.turn) !== turn
          || finiteNumber(candidateData?.step) !== step
      })
    }
  }

  if (event.name === 'agent.delta') {
    const previousIndex = findLastTaskEventIndex(next, taskKey)
    const previous = previousIndex < 0 ? undefined : next[previousIndex]
    const previousData = asRecord(previous?.data)
    if (previous?.name === 'agent.delta' && sameDeltaSegment(previousData, data)) {
      const sessionSequences = uniqueNumbers([...eventSessionSequences(previousData), ...eventSessionSequences(data)])
      const mergedData: Record<string, unknown> = {
        ...previousData,
        ...data,
        text: `${String(previousData?.text ?? '')}${String(data?.text ?? '')}`,
        endSequence: eventEndSequence(event),
      }
      const firstSessionSequence = eventSessionSequences(previousData)[0] ?? eventSessionSequences(data)[0]
      if (firstSessionSequence !== undefined) mergedData.sessionSequence = firstSessionSequence
      if (sessionSequences.length > 0) mergedData.sessionSequences = sessionSequences
      next[previousIndex] = { ...previous, data: mergedData }
      return retainRecentTasks(next)
    }

    const normalizedData: Record<string, unknown> = {
      ...data,
      endSequence: eventEndSequence(event),
    }
    const sessionSequences = eventSessionSequences(data)
    if (sessionSequences.length > 0) normalizedData.sessionSequences = sessionSequences
    next.push({ ...event, data: normalizedData })
    return retainRecentTasks(next)
  }

  next.push(event)
  return retainRecentTasks(next)
}

function sameDeltaSegment(left: Record<string, unknown> | undefined, right: Record<string, unknown> | undefined): boolean {
  return left?.kind === right?.kind
    && finiteNumber(left?.turn) === finiteNumber(right?.turn)
    && finiteNumber(left?.step) === finiteNumber(right?.step)
}

function findLastTaskEventIndex(events: readonly HostEvent[], taskKey: string): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (liveTranscriptTaskKey(asRecord(events[index]?.data)) === taskKey) return index
  }
  return -1
}

function retainRecentTasks(events: HostEvent[]): HostEvent[] {
  const tasks = new Map<string, { latestSequence: number; terminal: boolean }>()
  for (const event of events) {
    const data = asRecord(event.data)
    const taskKey = retainedTaskKey(data)
    if (!taskKey) continue
    const current = tasks.get(taskKey)
    const state = event.name === 'agent.state' || event.name === 'task.state' ? String(data?.state ?? '') : undefined
    tasks.set(taskKey, {
      latestSequence: Math.max(current?.latestSequence ?? 0, eventEndSequence(event)),
      terminal: state === 'running' ? false : isTerminalState(state) ? true : current?.terminal ?? false,
    })
  }
  const terminalTasks = [...tasks]
    .filter(([, task]) => task.terminal)
    .sort((left, right) => right[1].latestSequence - left[1].latestSequence)
  if (terminalTasks.length <= MAX_RETAINED_TERMINAL_TASKS) return events
  const retainedTerminalTasks = new Set(terminalTasks.slice(0, MAX_RETAINED_TERMINAL_TASKS).map(([taskKey]) => taskKey))
  return events.filter((event) => {
    const taskKey = retainedTaskKey(asRecord(event.data))
    const task = taskKey ? tasks.get(taskKey) : undefined
    return Boolean(taskKey && task && (!task.terminal || retainedTerminalTasks.has(taskKey)))
  })
}

function latestProcessedHostSequence(events: readonly HostEvent[]): number {
  return events.reduce((latest, event) => Math.max(latest, eventEndSequence(event)), 0)
}

function eventSessionSequences(data: Record<string, unknown> | undefined): number[] {
  const recorded = Array.isArray(data?.sessionSequences) ? uniqueNumbers(data.sessionSequences) : []
  const single = finiteNumber(data?.sessionSequence)
  return uniqueNumbers(single === undefined ? recorded : [single, ...recorded])
}

function eventEndSequence(event: HostEvent): number {
  return finiteNumber(asRecord(event.data)?.endSequence) ?? event.sequence
}

function liveTranscriptTaskKey(data: Record<string, unknown> | undefined): string | undefined {
  const projectId = nonEmptyString(data?.projectId)
  const taskId = nonEmptyString(data?.taskId)
  if (!projectId || !taskId) return undefined
  return `${projectId}\0${nonEmptyString(data?.sessionId) ?? ''}\0${taskId}`
}

function retainedTaskKey(data: Record<string, unknown> | undefined): string | undefined {
  const projectId = nonEmptyString(data?.projectId)
  const taskId = nonEmptyString(data?.taskId)
  return projectId && taskId ? `${projectId}\0${taskId}` : undefined
}

function isTerminalState(state: string | undefined): boolean {
  return state === 'completed' || state === 'failed' || state === 'aborted' || state === 'interrupted'
    || state === 'cancelled' || state === 'stopped'
}

function uniqueNumbers(values: readonly unknown[]): number[] {
  return [...new Set(values.flatMap((value) => {
    const number = finiteNumber(value)
    return number === undefined ? [] : [number]
  }))]
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
