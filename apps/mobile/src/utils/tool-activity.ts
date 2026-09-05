import type { HostEvent } from '@runwhale/mobile-protocol'

export type ToolActivityState = 'running' | 'succeeded' | 'failed' | 'stopped'

export interface ToolActivityItem {
  id: string
  callId?: string
  name: string
  target?: string
  input?: unknown
  output?: unknown
  error?: unknown
  meta?: unknown
  turn?: number
  step?: number
  startSequence?: number
  endSequence?: number
  sourceSequences: number[]
  sourceEvents: Array<ToolActivitySessionEvent | HostEvent>
  state: ToolActivityState
}

export interface ToolActivityGroup {
  id: string
  turn?: number
  step?: number
  items: ToolActivityItem[]
  startSequence?: number
  endSequence?: number
  sourceSequences: number[]
  state: ToolActivityState
}

export interface ToolActivitySessionEvent {
  type: string
  seq?: number
  time?: number
  data?: Record<string, unknown>
  surfaceOp?: unknown
  [key: string]: unknown
}

export interface ToolActivityProjectionEntry {
  kind: 'activity'
  id: string
  activity: ToolActivityGroup
}

export interface HistoryToolActivityEventEntry {
  kind: 'event'
  id: string
  event: ToolActivitySessionEvent
}

export type HistoryToolActivityProjectionEntry = ToolActivityProjectionEntry | HistoryToolActivityEventEntry

interface ToolPosition {
  position: number
  event?: ToolActivitySessionEvent | HostEvent
  sequence?: number
  turn?: number
  step?: number
}

interface ToolResultDetail {
  callId?: string
  output?: unknown
  error?: unknown
  meta?: unknown
  failed: boolean
  target?: string
}

interface ProjectionBuilder {
  groups: ToolActivityGroup[]
  groupsByTurnStep: Map<string, ToolActivityGroup>
  pendingByCallId: Map<string, ToolActivityItem[]>
  groupForItem: Map<ToolActivityItem, ToolActivityGroup>
  itemIdCounts: Map<string, number>
  activeLegacyGroup?: ToolActivityGroup
  legacyGroupSerial: number
  insert(group: ToolActivityGroup): void
}

export function projectHistoryToolActivities(events: readonly unknown[]): HistoryToolActivityProjectionEntry[] {
  const entries: HistoryToolActivityProjectionEntry[] = []
  const entryIdCounts = new Map<string, number>()
  const builder = createBuilder((activity) => entries.push({ kind: 'activity', id: activity.id, activity }))

  events.forEach((value, position) => {
    const event = asSessionEvent(value)
    if (!event) {
      builder.activeLegacyGroup = undefined
      return
    }
    if (isExplicitReplacement(event.surfaceOp)) return

    const sequence = finiteNumber(event.seq)
    const data = event.data ?? {}
    const turn = finiteNumber(data.turn)
    const step = finiteNumber(data.step)
    const source: ToolPosition = { position, event, ...(sequence === undefined ? {} : { sequence }), ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }) }

    if (event.type === 'tool/call') {
      addToolCall(builder, source, {
        callId: nonEmptyString(data.callId),
        name: nonEmptyString(data.name) ?? 'unknown',
        input: toolInput(data),
        meta: data.meta,
        target: toolTarget(data, toolInput(data)),
      })
      return
    }

    if (event.type === 'tool/result') {
      addToolResult(builder, source, resultDetail(data))
      return
    }

    builder.activeLegacyGroup = undefined
    if (event.type === 'step/end') closeStep(builder, turn, step)
    else if (event.type === 'turn/end') closeTurn(builder, turn)

    const baseId = historyEventId(event, position)
    entries.push({ kind: 'event', id: uniqueId(baseId, entryIdCounts), event })
  })

  finalizeGroups(builder)
  return entries
}

function createBuilder(insert: ProjectionBuilder['insert']): ProjectionBuilder {
  return {
    groups: [],
    groupsByTurnStep: new Map(),
    pendingByCallId: new Map(),
    groupForItem: new Map(),
    itemIdCounts: new Map(),
    legacyGroupSerial: 0,
    insert,
  }
}

function addToolCall(builder: ProjectionBuilder, source: ToolPosition, detail: { callId?: string; name: string; input?: unknown; meta?: unknown; target?: string }): void {
  const group = groupForSource(builder, source)
  const item: ToolActivityItem = {
    id: nextItemId(builder, group, detail.callId, 'call'),
    ...(detail.callId === undefined ? {} : { callId: detail.callId }),
    name: detail.name,
    ...(detail.target === undefined ? {} : { target: detail.target }),
    ...(detail.input === undefined ? {} : { input: detail.input }),
    ...(detail.meta === undefined ? {} : { meta: detail.meta }),
    ...(source.turn === undefined ? {} : { turn: source.turn }),
    ...(source.step === undefined ? {} : { step: source.step }),
    ...(source.sequence === undefined ? {} : { startSequence: source.sequence, endSequence: source.sequence }),
    sourceSequences: source.sequence === undefined ? [] : [source.sequence],
    sourceEvents: source.event ? [source.event] : [],
    state: 'running',
  }
  group.items.push(item)
  builder.groupForItem.set(item, group)
  addGroupSource(group, source.sequence)
  if (detail.callId) {
    const pending = builder.pendingByCallId.get(detail.callId) ?? []
    pending.push(item)
    builder.pendingByCallId.set(detail.callId, pending)
  }
  recomputeGroupState(group)
}

function addToolResult(builder: ProjectionBuilder, source: ToolPosition, detail: ToolResultDetail): void {
  const pending = detail.callId ? builder.pendingByCallId.get(detail.callId) : undefined
  let matchingIndex = pending?.findIndex((item) => source.turn !== undefined && source.step !== undefined
    ? item.turn === source.turn && item.step === source.step
    : true) ?? -1
  if (matchingIndex < 0 && source.turn !== undefined && source.step !== undefined) {
    matchingIndex = pending?.findIndex((item) => item.turn === undefined || item.step === undefined) ?? -1
  }
  const item = matchingIndex >= 0 ? pending?.splice(matchingIndex, 1)[0] : undefined
  if (pending?.length === 0 && detail.callId) builder.pendingByCallId.delete(detail.callId)

  if (item) {
    const group = builder.groupForItem.get(item)!
    applyResult(item, detail, source)
    addGroupSource(group, source.sequence)
    recomputeGroupState(group)
    return
  }

  const group = groupForSource(builder, source)
  const orphan: ToolActivityItem = {
    id: nextItemId(builder, group, detail.callId, 'result'),
    ...(detail.callId === undefined ? {} : { callId: detail.callId }),
    name: 'unknown',
    ...(detail.target === undefined ? {} : { target: detail.target }),
    ...(detail.output === undefined ? {} : { output: detail.output }),
    ...(detail.error === undefined ? {} : { error: detail.error }),
    ...(detail.meta === undefined ? {} : { meta: detail.meta }),
    ...(source.turn === undefined ? {} : { turn: source.turn }),
    ...(source.step === undefined ? {} : { step: source.step }),
    ...(source.sequence === undefined ? {} : { startSequence: source.sequence, endSequence: source.sequence }),
    sourceSequences: source.sequence === undefined ? [] : [source.sequence],
    sourceEvents: source.event ? [source.event] : [],
    state: detail.failed ? 'failed' : 'succeeded',
  }
  group.items.push(orphan)
  builder.groupForItem.set(orphan, group)
  addGroupSource(group, source.sequence)
  recomputeGroupState(group)
}

function applyResult(item: ToolActivityItem, detail: ToolResultDetail, source: ToolPosition): void {
  if (detail.output !== undefined) item.output = detail.output
  if (detail.error !== undefined) item.error = detail.error
  if (detail.meta !== undefined) item.meta = detail.meta
  if (!item.target && detail.target) item.target = detail.target
  item.state = detail.failed ? 'failed' : 'succeeded'
  if (source.sequence !== undefined) {
    item.endSequence = source.sequence
    appendUnique(item.sourceSequences, source.sequence)
  }
  if (source.event && !item.sourceEvents.includes(source.event)) item.sourceEvents.push(source.event)
}

function groupForSource(builder: ProjectionBuilder, source: ToolPosition): ToolActivityGroup {
  if (source.turn !== undefined && source.step !== undefined) {
    const key = turnStepKey(source.turn, source.step)
    const existing = builder.groupsByTurnStep.get(key)
    if (existing) return existing
    const group = createGroup(builder, source, `tool-activity:turn:${source.turn}:step:${source.step}`)
    builder.groupsByTurnStep.set(key, group)
    return group
  }
  if (builder.activeLegacyGroup) return builder.activeLegacyGroup
  const anchor = source.sequence === undefined ? `index:${source.position}` : String(source.sequence)
  const group = createGroup(builder, source, `tool-activity:legacy:${anchor}:${builder.legacyGroupSerial}`)
  builder.legacyGroupSerial += 1
  builder.activeLegacyGroup = group
  return group
}

function createGroup(builder: ProjectionBuilder, source: ToolPosition, id: string): ToolActivityGroup {
  const group: ToolActivityGroup = {
    id,
    ...(source.turn === undefined ? {} : { turn: source.turn }),
    ...(source.step === undefined ? {} : { step: source.step }),
    items: [],
    ...(source.sequence === undefined ? {} : { startSequence: source.sequence, endSequence: source.sequence }),
    sourceSequences: [],
    state: 'running',
  }
  builder.groups.push(group)
  builder.insert(group)
  return group
}

function closeStep(builder: ProjectionBuilder, turn: number | undefined, step: number | undefined): void {
  if (turn !== undefined && step !== undefined) {
    const group = builder.groupsByTurnStep.get(turnStepKey(turn, step))
    if (group) stopRunningItems(builder, group)
  } else {
    for (const group of builder.groups) {
      if (group.items.some((item) => item.state === 'running')) stopRunningItems(builder, group)
    }
  }
  closeLegacyGroups(builder)
}

function closeTurn(builder: ProjectionBuilder, turn: number | undefined): void {
  if (turn === undefined) {
    closeAll(builder)
    return
  }
  for (const group of builder.groups) {
    if (group.turn === turn) stopRunningItems(builder, group)
  }
  closeLegacyGroups(builder)
}

function closeLegacyGroups(builder: ProjectionBuilder): void {
  for (const group of builder.groups) {
    if (group.turn === undefined || group.step === undefined) stopRunningItems(builder, group)
  }
}

function closeAll(builder: ProjectionBuilder): void {
  for (const group of builder.groups) stopRunningItems(builder, group)
}

function stopRunningItems(builder: ProjectionBuilder, group: ToolActivityGroup): void {
  for (const item of group.items) {
    if (item.state !== 'running') continue
    item.state = 'stopped'
    if (!item.callId) continue
    const pending = builder.pendingByCallId.get(item.callId)
    if (!pending) continue
    const index = pending.indexOf(item)
    if (index >= 0) pending.splice(index, 1)
    if (pending.length === 0) builder.pendingByCallId.delete(item.callId)
  }
  recomputeGroupState(group)
}

function finalizeGroups(builder: ProjectionBuilder): void {
  for (const group of builder.groups) recomputeGroupState(group)
}

function recomputeGroupState(group: ToolActivityGroup): void {
  group.state = aggregateState(group.items)
  const sequences = group.items.flatMap((item) => item.sourceSequences)
  if (sequences.length > 0) {
    group.startSequence = Math.min(...sequences)
    group.endSequence = Math.max(...sequences)
  }
}

function aggregateState(items: readonly ToolActivityItem[]): ToolActivityState {
  if (items.some((item) => item.state === 'failed')) return 'failed'
  if (items.some((item) => item.state === 'running')) return 'running'
  if (items.some((item) => item.state === 'stopped')) return 'stopped'
  return 'succeeded'
}

function addGroupSource(group: ToolActivityGroup, sequence: number | undefined): void {
  appendUnique(group.sourceSequences, sequence)
  if (sequence === undefined) return
  group.startSequence = group.startSequence === undefined ? sequence : Math.min(group.startSequence, sequence)
  group.endSequence = group.endSequence === undefined ? sequence : Math.max(group.endSequence, sequence)
}

function resultDetail(data: Record<string, unknown>): ToolResultDetail {
  const message = asRecord(data.message)
  const source = asRecord(message?.source)
  const content = message?.content ?? data.output ?? data.content
  const blocks = Array.isArray(content) ? content.map(asRecord).filter((block): block is Record<string, unknown> => block !== undefined) : []
  const sourceCallId = nonEmptyString(source?.callId)
  const directCallId = nonEmptyString(data.callId)
  const matchingBlock = blocks.find((block) => block.type === 'tool-result' && nonEmptyString(block.toolCallId) === (directCallId ?? sourceCallId))
    ?? blocks.find((block) => block.type === 'tool-result')
  const callId = directCallId ?? sourceCallId ?? nonEmptyString(matchingBlock?.toolCallId)
  const nestedIsError = typeof matchingBlock?.isError === 'boolean' ? matchingBlock.isError : undefined
  const directIsError = typeof data.isError === 'boolean' ? data.isError : undefined
  const failed = nestedIsError ?? directIsError ?? hasErrorValue(data.error)
  const nestedError = failed ? matchingBlock?.content : undefined
  const output = message?.content ?? data.output ?? data.content
  const error = failed ? data.error ?? nestedError ?? output : undefined
  return {
    ...(callId === undefined ? {} : { callId }),
    ...(output === undefined ? {} : { output }),
    ...(error === undefined ? {} : { error }),
    ...(data.meta === undefined ? {} : { meta: data.meta }),
    failed,
    ...(toolTarget(data, output) === undefined ? {} : { target: toolTarget(data, output) }),
  }
}

function toolInput(data: Record<string, unknown>): unknown {
  if (data.input !== undefined) return data.input
  if (data.arguments === undefined) return undefined
  if (typeof data.arguments !== 'string') return data.arguments
  try { return JSON.parse(data.arguments) } catch { return data.arguments }
}

function toolTarget(...values: unknown[]): string | undefined {
  for (const value of values) {
    const record = asRecord(value)
    if (!record) continue
    const direct = targetValue(record.path)
      ?? targetValue(record.paths)
      ?? filesTarget(record.files)
      ?? targetValue(record.entry)
      ?? targetValue(record.package)
      ?? targetValue(record.platform)
    if (direct) return direct
  }
  return undefined
}

function targetValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!Array.isArray(value)) return undefined
  const entries = value.flatMap((entry) => typeof entry === 'string' && entry.trim() ? [entry.trim()] : [])
  return entries.length > 0 ? entries.join(', ') : undefined
}

function filesTarget(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const entries = value.flatMap((entry) => {
    if (typeof entry === 'string' && entry.trim()) return [entry.trim()]
    const record = asRecord(entry)
    return typeof record?.path === 'string' && record.path.trim() ? [record.path.trim()] : []
  })
  return entries.length > 0 ? entries.join(', ') : undefined
}

function nextItemId(builder: ProjectionBuilder, group: ToolActivityGroup, callId: string | undefined, fallback: string): string {
  const base = callId ? `${group.id}:call:${encodeURIComponent(callId)}` : `${group.id}:${fallback}`
  return uniqueId(base, builder.itemIdCounts)
}

function turnStepKey(turn: number, step: number): string {
  return `${turn}:${step}`
}

function isExplicitReplacement(value: unknown): boolean {
  if (value === 'replace') return true
  return asRecord(value)?.op === 'replace'
}

function asSessionEvent(value: unknown): ToolActivitySessionEvent | undefined {
  const event = asRecord(value)
  return event && typeof event.type === 'string' ? event as ToolActivitySessionEvent : undefined
}

function historyEventId(event: ToolActivitySessionEvent, position: number): string {
  return `session-event:${finiteNumber(event.seq) ?? `index:${position}`}:${event.type}`
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

function hasErrorValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false && value !== ''
}

function appendUnique(values: number[], value: number | undefined): void {
  if (value !== undefined && !values.includes(value)) values.push(value)
}

function uniqueId(base: string, counts: Map<string, number>): string {
  const count = (counts.get(base) ?? 0) + 1
  counts.set(base, count)
  return count === 1 ? base : `${base}:${count}`
}
