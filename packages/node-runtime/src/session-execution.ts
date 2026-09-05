import type { AgentSessionRecord, MobilePermissionMode } from '@runwhale/mobile-protocol'
import type { AgentDriver } from './agent-driver.js'
import { createLatestOnlyWriter } from './latest-only-writer.js'

interface SessionExecutionOptions {
  agent: AgentDriver
  acquireProject(): Promise<() => void>
  write(record: AgentSessionRecord): Promise<unknown>
  publish(taskId: string, event: unknown, afterSequence?: number): void
}

/** Owns one loaded session, including the intervals between automatic rounds. */
export class AgentSessionExecution {
  phase: 'idle' | 'preparing' | 'driving' | 'finishing' = 'idle'
  stopping = false
  pauseRequested = false
  packageMutated = false
  readonly messageOperations = new Set<Promise<unknown>>()
  controller = new AbortController()
  completion = Promise.resolve()
  events: unknown[] = []
  receivedLiveEvent = false
  startEventCount = 0
  record: AgentSessionRecord | undefined
  taskId = ''
  private finishCompletion: (() => void) | undefined
  private releaseProject: (() => void) | undefined
  private unsubscribe: (() => void) | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private afterSequence: number | undefined
  private persistenceFailure: unknown
  private readonly writer

  constructor(readonly projectId: string, readonly sessionId: string, private readonly options: SessionExecutionOptions) {
    this.writer = createLatestOnlyWriter<AgentSessionRecord>(async (record) => { await options.write(record) })
  }

  get active(): boolean { return this.phase !== 'idle' }
  get permissionMode(): MobilePermissionMode { return this.record?.permissionMode ?? 'review' }

  begin(taskId: string): void {
    if (this.active) throw new Error('Agent session is already running')
    this.phase = 'preparing'
    this.taskId = taskId
    this.controller = new AbortController()
    this.completion = new Promise((resolve) => { this.finishCompletion = resolve })
    this.stopping = false
    this.pauseRequested = false
    this.packageMutated = false
    this.receivedLiveEvent = false
    this.persistenceFailure = undefined
  }

  async acquireProject(): Promise<void> { this.releaseProject = await this.options.acquireProject() }

  initialize(record: AgentSessionRecord): void {
    this.record = { ...record, taskId: this.taskId }
    this.events = [...record.events]
    this.startEventCount = this.events.length
    this.afterSequence = this.events.reduce<number | undefined>((last, value) => {
      const event = value as { type?: unknown; seq?: unknown } | undefined
      return event?.type !== 'assistant/chunk' && typeof event?.seq === 'number' ? event.seq : last
    }, undefined)
    this.unsubscribe ??= this.options.agent.observeSession?.(this.sessionId, this.acceptEvent)
  }

  readonly acceptEvent = (event: unknown): void => {
    this.receivedLiveEvent = true
    this.events.push(event)
    this.options.publish(this.taskId, event, this.afterSequence)
    const value = event as { type?: unknown; seq?: unknown } | undefined
    if (value?.type !== 'assistant/chunk' && typeof value?.seq === 'number') this.afterSequence = value.seq
    if (!this.timer) this.timer = setTimeout(() => {
      void this.persist(this.active ? 'running' : this.record?.state ?? 'completed').catch((error: unknown) => {
        this.persistenceFailure = error
        this.controller.abort(error)
        void Promise.resolve(this.options.agent.cancel?.(this.sessionId)).catch(() => undefined)
      })
    }, 1_000)
  }

  async persist(state = this.record?.state ?? 'completed'): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (!this.record) return
    this.record = { ...this.record, taskId: this.taskId, updatedAt: Date.now(), state, events: structuredClone(this.events) }
    await this.writer.write(this.record)
  }

  async whenIdle(): Promise<void> {
    await this.options.agent.whenIdle?.(this.sessionId)
    if (this.persistenceFailure) throw this.persistenceFailure
  }

  async cancelAndDrain(reason: unknown): Promise<void> {
    this.controller.abort(reason)
    await this.options.agent.cancel?.(this.sessionId)
    await this.options.agent.whenIdle?.(this.sessionId)
  }

  finish(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.phase = 'idle'
    this.stopping = false
    this.messageOperations.clear()
    this.releaseProject?.()
    this.releaseProject = undefined
    this.finishCompletion?.()
    this.finishCompletion = undefined
  }

  async dispose(): Promise<void> {
    await this.completion
    if (this.timer) await this.persist()
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }
}
