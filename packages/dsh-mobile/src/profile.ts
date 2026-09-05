import { Context } from '@deepseek-ai/cordis'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import WorkerThreadCodeRuntime from '@deepseek-ai/dsh-code-runtime-worker-thread'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import GoalService, { type GoalRef, type GoalView } from '@deepseek-ai/dsh-goal'
import * as GoalRoundDriver from '@deepseek-ai/dsh-goal-round-driver'
import LlmRuntime, { createUserMessage, LlmAdapter, MessageId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import PlanModeController from '@deepseek-ai/dsh-plan-mode'
import SessionStore, { interruptedTurnClosers, SessionId, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import * as ToolGoal from '@deepseek-ai/dsh-tool-goal'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ApprovalService, { setApprovalPolicy, type ApprovalOutcome, type ApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import UserQuestionService, {
  type AskUserQuestionAnswer,
  type AskUserQuestionItem,
  UserQuestionError,
} from '@deepseek-ai/dsh-user-questions'
import { MobileCredentialProvider, type NativeSecretStore } from './credentials-mobile.js'
import { MobileImageAttachmentStore } from './image-attachments-mobile.js'
import { registerMobileWorkspaceTools, type MobileWorkspaceServices } from './tools-mobile.js'
import { MOBILE_DEFAULT_MODELS, type AgentGoal, type AgentQueuedMessage, type MobileModelProvider, type MobileModelProviderProfile, type MobilePermissionMode } from '@runwhale/mobile-protocol'

export interface MobileHarnessOptions {
  secrets: NativeSecretStore
  attachmentRoot?: string
  persona?: string
  mode: 'deepseek' | 'deterministic'
  provider?: MobileModelProvider
  model?: string
  modelProfile?: MobileModelProviderProfile
  deterministicReply?: string
  requestPackageInstall?: MobileWorkspaceServices['requestPackageInstall']
  requestApproval?: (request: MobileApprovalRequest, signal?: AbortSignal) => Promise<ApprovalOutcome>
  requestUserQuestions?: (request: MobileUserQuestionRequest, signal?: AbortSignal) => Promise<AskUserQuestionAnswer>
  workspaceServices?: Omit<MobileWorkspaceServices, 'requestPackageInstall'>
}

export interface MobileImageInput {
  data: Uint8Array
  mediaType: ImageMediaType
  name?: string
}

export interface MobileApprovalRequest {
  sessionId: string
  toolName: string
  callId?: string
  reason?: string
}

export interface MobileUserQuestionRequest {
  sessionId?: string
  questions: AskUserQuestionItem[]
}

export const DEEPSEEK_MOBILE_MODEL = 'deepseek-v4-flash'
export const MOBILE_PROVIDER_DEFAULT_MODELS = MOBILE_DEFAULT_MODELS
export const MOBILE_MAX_PARALLEL_TOOL_CALLS = 6
export const OPENAI_MOBILE_REQUEST_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const OPENAI_MOBILE_REQUEST_IMAGE_PIXEL_BUDGET = 16_000_000

const defaultMobilePersona = 'You are RunWhale, an on-device assistant. Inspect the attached project files, make focused edits with the available mobile tools, validate changes, and explain the verified result.'
const efficientMobileWorkflow = 'Keep the coding loop efficient. Use read_files or write_files for multiple known related paths, and group independent read-only tool calls in one step. Reuse current results instead of repeating inspection. Run the narrowest validation that proves the affected behavior; use the on-phone Preview only for changes that affect rendered or runtime behavior. Native Preview may use only the native packages already exposed by the host ABI; never invoke Xcode, Gradle, EAS, IPA, or APK builds for a user project. The host automatically commits successful file-changing project turns, so do not call git_add or git_commit unless the user explicitly requests a Git operation or a specific commit boundary.'

export interface MobileHarnessFailure {
  code?: string
  message: string
}

class DeterministicAdapter extends LlmAdapter {
  constructor(private readonly reply: string) { super() }
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: this.reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: this.reply } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export interface MobileHarnessSessionOptions {
  sessionId: string
  seed?: readonly unknown[] | undefined
  projectRoot?: string | undefined
}

export interface MobileHarnessRunOptions extends MobileHarnessSessionOptions {
  startPaused?: boolean | undefined
  prompt: string
  signal?: AbortSignal | undefined
  onEvent?: ((event: SessionEvent) => void) | undefined
  planMode?: boolean | undefined
  attachments?: readonly MobileImageInput[] | undefined
}

export class MobileHarness {
  private readonly initializedSessions = new Set<string>()
  private readonly observers = new Map<string, Set<(event: SessionEvent) => void>>()
  private readonly activityListeners = new Map<string, Set<() => void>>()
  private readonly queuedMessages = new Map<string, Map<string, AgentQueuedMessage>>()
  private readonly backgroundPauses = new Map<string, { goalId?: string }>()

  constructor(
    readonly context: Context,
    private readonly provider: string,
    private readonly model: string,
    private readonly workspaces: Map<string, string>,
    private readonly permissionModeFor: (sessionId: string) => MobilePermissionMode,
  ) {
    context.on('session/event', (session, event) => {
      if (this.initializedSessions.has(String(session.id))) this.publishSessionEvent(String(session.id), event)
    })
    context.on('agent/status', ({ agent }) => this.notifyActivity(String(agent.id)))
    context.on('goal/changed', ({ agent }) => this.notifyActivity(String(agent.id)))
  }

  /** Observation belongs to a loaded session, not to an individual prompt. */
  observeSession(sessionId: string, onEvent: (event: SessionEvent) => void): () => void {
    const listeners = this.observers.get(sessionId) ?? new Set()
    this.observers.set(sessionId, listeners)
    listeners.add(onEvent)
    return () => {
      listeners.delete(onEvent)
      if (listeners.size === 0) this.observers.delete(sessionId)
    }
  }

  private publishSessionEvent(sessionId: string, event: SessionEvent): void {
    for (const listener of this.observers.get(sessionId) ?? []) listener(event)
  }

  private notifyActivity(sessionId: string): void {
    for (const listener of [...(this.activityListeners.get(sessionId) ?? [])]) listener()
  }

  /** Includes the armed Goal handoff between automatic rounds. */
  async whenIdle(sessionId: string): Promise<void> {
    const agent = this.agent(sessionId)
    while (true) {
      await agent.whenIdle()
      const goal = this.getGoal(sessionId)
      if (goal?.phase !== 'active' || goal.activation !== 'armed') return
      await new Promise<void>((resolve) => {
        const listeners = this.activityListeners.get(sessionId) ?? new Set()
        this.activityListeners.set(sessionId, listeners)
        const changed = () => {
          listeners.delete(changed)
          if (listeners.size === 0) this.activityListeners.delete(sessionId)
          resolve()
        }
        listeners.add(changed)
      })
    }
  }

  /** Restore the session and its disarmed Goal without submitting a prompt. */
  loadSession({ sessionId, seed = [], projectRoot }: MobileHarnessSessionOptions): void | Promise<void> {
    if (projectRoot) this.workspaces.set(sessionId, projectRoot)
    const id = SessionId(sessionId)
    const agent = this.context.agents.get(id)
    if (!agent && seed.length > 0) {
      // Mobile restores through agents.create rather than DSH's persistence
      // loader, so apply the same crash-tail closure before the next request.
      // Missing tool outcomes stay explicitly unknown; recorded work is kept.
      const events = seed as readonly SessionEvent[]
      return this.context.agents.create({
        sessionId: id,
        seed: [...events, ...interruptedTurnClosers(events)],
        agentOptions: { provider: this.provider, model: this.model },
      }).then(({ agent: restored }) => this.initializeSession(sessionId, restored, true, seed.length))
    }
    this.initializeSession(sessionId, agent ?? this.context.agentLoop.create(id, { provider: this.provider, model: this.model }), !agent, seed.length)
  }

  private initializeSession(sessionId: string, agent: Agent, created: boolean, seedLength: number): void {
    const approvalPolicy: ApprovalPolicy = this.permissionModeFor(sessionId) === 'danger-full-access' ? 'never' : 'ask'
    if (created) {
      if ((this.context.approval.overrideOf(agent.session) ?? 'ask') !== approvalPolicy) setApprovalPolicy(agent.session, approvalPolicy)
    } else {
      this.context.approval.setPolicy(agent, approvalPolicy)
    }
    // Seed restoration and creation-time setup can append events before the
    // public session/event listener below exists. In particular, DSH inserts a
    // session/end-seed marker at the first live sequence without publishing it.
    // Replay that exact constructor/setup suffix through the mobile boundary so
    // an interrupted turn cannot persist later live events with a seq gap.
    const creationEvents = created ? agent.session.snapshotEvents(SessionLogOffset(seedLength)) : []
    this.initializedSessions.add(sessionId)
    for (const event of creationEvents) this.publishSessionEvent(sessionId, event)
  }

  async run({ sessionId, prompt, seed = [], projectRoot, signal, onEvent, planMode, attachments = [], startPaused }: MobileHarnessRunOptions): Promise<{ text: string; events: readonly SessionEvent[]; failure?: MobileHarnessFailure }> {
    if (startPaused) this.backgroundPauses.set(sessionId, {})
    else this.backgroundPauses.delete(sessionId)
    const disposeEvents = onEvent ? this.observeSession(sessionId, onEvent) : undefined
    try {
      const loading = this.loadSession({ sessionId, seed, projectRoot })
      if (loading) await loading
      return await this.runLoadedSession({ sessionId, prompt, signal, planMode, attachments })
    } finally {
      disposeEvents?.()
    }
  }

  private async runLoadedSession({ sessionId, prompt, signal, planMode, attachments = [] }: MobileHarnessRunOptions): Promise<{ text: string; events: readonly SessionEvent[]; failure?: MobileHarnessFailure }> {
    const agent = this.agent(sessionId)
    const abort = () => agent.cancel({ kind: 'user' }, { keepInbox: true })
    signal?.addEventListener('abort', abort, { once: true })
    try {
      if (signal?.aborted) abort()
      if (planMode !== undefined) this.context.planMode.set(agent, planMode)
      const imageRefs = attachments.length > 0 ? await this.context.attachments.saveImages(attachments) : []
      if (!signal?.aborted) {
        const message = createUserMessage({
          content: [...imageRefs.map((attachment) => ({ type: 'image' as const, attachment })), { type: 'text', text: prompt }],
          source: { kind: 'user' },
        })
        if (this.backgroundPauses.has(sessionId)) {
          agent.send(message, 'next-turn', false)
          return { text: '', events: agent.session.snapshotEvents() }
        }
        agent.followup(message)
        if (signal?.aborted) abort()
        await this.whenIdle(sessionId)
      }
    } finally {
      signal?.removeEventListener('abort', abort)
    }
    const events = agent.session.snapshotEvents()
    this.forgetConsumedQueuedMessages(sessionId, events)
    const message = events.findLast((event) => event.type === 'assistant/message')
    const text = message?.type === 'assistant/message'
      ? message.data.message.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('')
      : ''
    const failure = signal?.aborted ? undefined : terminalFailure(events, message !== undefined)
    return { text, events, ...(failure ? { failure } : {}) }
  }

  async cancel(sessionId: string): Promise<{ cancelled: boolean; restoredMessages: AgentQueuedMessage[] }> {
    const wasPaused = this.backgroundPauses.delete(sessionId)
    const agent = this.context.agents.get(SessionId(sessionId))
    if (!agent) return { cancelled: false, restoredMessages: [] }
    const armed = this.getGoal(sessionId)?.activation === 'armed'
    if (agent.status !== 'running' && !armed && !wasPaused) return { cancelled: false, restoredMessages: [] }
    // An active Goal round is paused by DSH's cancellation lifecycle. Between
    // rounds, disarm explicitly because Agent.cancel() has no idle activity.
    if (agent.status !== 'running') {
      this.context.goals.disarm(agent)
      this.notifyActivity(sessionId)
    }
    const pendingMessages = this.pendingMessages(sessionId)
    this.forgetCompletedQueuedMessages(sessionId, agent.session.snapshotEvents())
    const tracked = this.queuedMessages.get(sessionId)
    const restoredMessages = [
      ...(tracked?.values() ?? []),
      ...pendingMessages.filter((message) => !tracked?.has(message.messageId)),
    ]
    // Snapshot and clear the inbox in one synchronous turn. A waking message
    // left behind during abort convergence would otherwise start another turn.
    agent.cancel({ kind: 'user' })
    for (const message of restoredMessages) tracked?.delete(message.messageId)
    if (tracked?.size === 0) this.queuedMessages.delete(sessionId)
    await agent.whenIdle()
    return { cancelled: true, restoredMessages }
  }

  /** Backgrounding preserves queued input and has a distinct durable cause. */
  async pause(sessionId: string): Promise<void> {
    const agent = this.context.agents.get(SessionId(sessionId))
    if (this.backgroundPauses.has(sessionId)) { await agent?.whenIdle(); return }
    const goal = agent ? this.getGoal(sessionId) : undefined
    this.backgroundPauses.set(sessionId, goal?.activation === 'armed' ? { goalId: goal.id } : {})
    if (!agent) return
    if (goal?.activation === 'armed') this.context.goals.disarm(agent)
    agent.cancel({ kind: 'hook', reason: 'App entered background' }, { keepInbox: true })
    this.notifyActivity(sessionId)
    await agent.whenIdle()
  }

  async resume(sessionId: string, signal?: AbortSignal): ReturnType<MobileHarness['run']> {
    // The host also permits explicit continuation of a durable paused session
    // after process restart. Such a session has no in-memory Goal arm to restore.
    const pause = this.backgroundPauses.get(sessionId) ?? {}
    this.backgroundPauses.delete(sessionId)
    const agent = this.agent(sessionId)
    const abort = () => agent.cancel({ kind: 'user' })
    signal?.addEventListener('abort', abort, { once: true })
    try {
      if (signal?.aborted) { abort(); throw signal.reason }
      const notice = createUserMessage({
        content: [{ type: 'text', text: 'The app returned from the background. Continue the unfinished request using the existing session and pending messages. First reconcile recorded tool results with the current workspace. Preserve completed changes; do not repeat successful actions. If an interrupted action may have had external effects, verify its outcome before retrying; ask the user if it cannot be determined.' }],
        source: { kind: 'plugin', plugin: 'runwhale-background', form: 'notice', summary: 'Resumed after background pause' },
      })
      const goal = this.getGoal(sessionId)
      if (pause.goalId && goal?.id === pause.goalId && (goal.phase === 'paused' || goal.phase === 'active')) {
        agent.inject(notice)
        this.resumeGoal(sessionId, goal)
      } else {
        agent.send(notice, 'next-step', true)
      }
      await this.whenIdle(sessionId)
    } finally {
      signal?.removeEventListener('abort', abort)
    }
    const events = agent.session.snapshotEvents()
    this.forgetConsumedQueuedMessages(sessionId, events)
    const message = events.findLast((event) => event.type === 'assistant/message')
    const text = message?.type === 'assistant/message' ? message.data.message.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('') : ''
    const failure = signal?.aborted ? undefined : terminalFailure(events, Boolean(message))
    return { text, events, ...(failure ? { failure } : {}) }
  }

  message(sessionId: string, prompt: string, mode: 'followup' | 'steer'): { accepted: boolean; messageId?: string } {
    const agent = this.context.agents.get(SessionId(sessionId))
    if (!agent || !prompt.trim()) return { accepted: false }
    const message = createUserMessage({ content: [{ type: 'text', text: prompt.trim() }], source: { kind: 'user' } })
    const portable = { messageId: String(message.id), text: prompt.trim(), mode }
    const tracked = this.queuedMessages.get(sessionId) ?? new Map<string, AgentQueuedMessage>()
    tracked.set(portable.messageId, portable)
    this.queuedMessages.set(sessionId, tracked)
    try {
      if (mode === 'steer') agent.steer(message)
      else agent.followup(message)
      return { accepted: true, messageId: portable.messageId }
    } catch (cause) {
      tracked.delete(portable.messageId)
      if (tracked.size === 0) this.queuedMessages.delete(sessionId)
      throw cause
    }
  }

  notifyPreview(sessionId: string, text: string): boolean {
    const agent = this.context.agents.get(SessionId(sessionId))
    if (!agent || !text.trim()) return false
    agent.inject(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'runwhale-preview', form: 'notice', summary: 'Preview device result' },
    }))
    return true
  }

  pendingMessages(sessionId: string): Array<{ messageId: string; text: string; mode: 'followup' | 'steer' }> {
    const agent = this.context.agents.get(SessionId(sessionId))
    if (!agent) return []
    const project = (message: (typeof agent.inbox.nextTurn)[number], mode: 'followup' | 'steer') => ({
      messageId: String(message.id),
      text: message.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('\n'),
      mode,
    })
    return [
      ...agent.inbox.nextStep.filter((message) => message.source.kind === 'user').map((message) => project(message, 'steer')),
      ...agent.inbox.nextTurn.filter((message) => message.source.kind === 'user').map((message) => project(message, 'followup')),
    ]
  }

  updateMessage(sessionId: string, messageId: string, prompt: string): { accepted: boolean; messageId?: string } {
    const agent = this.context.agents.get(SessionId(sessionId))
    if (!agent || !prompt.trim()) return { accepted: false }
    const message = createUserMessage({ content: [{ type: 'text', text: prompt.trim() }], source: { kind: 'user' } })
    const accepted = agent.inbox.replace(MessageId(messageId), message)
    if (accepted) {
      const tracked = this.queuedMessages.get(sessionId)
      const previous = tracked?.get(messageId)
      tracked?.delete(messageId)
      if (tracked && previous) tracked.set(String(message.id), { messageId: String(message.id), text: prompt.trim(), mode: previous.mode })
    }
    return { accepted, ...(accepted ? { messageId: String(message.id) } : {}) }
  }

  deleteMessage(sessionId: string, messageId: string): boolean {
    const deleted = this.context.agents.get(SessionId(sessionId))?.inbox.remove(MessageId(messageId)) ?? false
    if (deleted) {
      const tracked = this.queuedMessages.get(sessionId)
      tracked?.delete(messageId)
      if (tracked?.size === 0) this.queuedMessages.delete(sessionId)
    }
    return deleted
  }

  setPlanMode(sessionId: string, active: boolean): { active: boolean; pending?: boolean; outcome: 'committed' | 'queued' | 'cancelled' | 'noop' } {
    const agent = this.context.agents.get(SessionId(sessionId))
    if (!agent) throw new Error('agent session is not active')
    const outcome = this.context.planMode.set(agent, active)
    return { ...this.context.planMode.get(agent), outcome }
  }

  getPlanMode(sessionId: string): { active: boolean; pending?: boolean } {
    const agent = this.context.agents.get(SessionId(sessionId))
    if (!agent) throw new Error('agent session is not active')
    return this.context.planMode.get(agent)
  }

  getGoal(sessionId: string): AgentGoal | undefined {
    const goal = this.context.goals.get(this.agent(sessionId))
    return goal ? portableGoal(goal) : undefined
  }

  createGoal(sessionId: string, objective: string, maxGoalRounds?: number): AgentGoal {
    return portableGoal(this.context.goals.create(this.agent(sessionId), { objective, ...(maxGoalRounds === undefined ? {} : { maxGoalRounds }) }))
  }

  editGoal(sessionId: string, ref: { id: string; revision: number }, objective?: string, maxGoalRounds?: number): AgentGoal {
    return portableGoal(this.context.goals.edit(this.agent(sessionId), goalRef(ref), { ...(objective === undefined ? {} : { objective }), ...(maxGoalRounds === undefined ? {} : { maxGoalRounds }) }))
  }

  pauseGoal(sessionId: string, ref: { id: string; revision: number }): AgentGoal {
    return portableGoal(this.context.goals.pause(this.agent(sessionId), goalRef(ref)))
  }

  resumeGoal(sessionId: string, ref: { id: string; revision: number }): AgentGoal {
    return portableGoal(this.context.goals.resume(this.agent(sessionId), goalRef(ref)))
  }

  clearGoal(sessionId: string, ref: { id: string; revision: number }): void {
    this.context.goals.clear(this.agent(sessionId), goalRef(ref))
  }

  sessionEvents(sessionId: string): readonly SessionEvent[] { return this.agent(sessionId).session.snapshotEvents() }

  async dispose(): Promise<void> { await this.context.fiber.dispose() }

  private agent(sessionId: string): Agent {
    const agent = this.context.agents.get(SessionId(sessionId))
    if (!agent) throw new Error('agent session is not loaded')
    return agent
  }

  private forgetConsumedQueuedMessages(sessionId: string, events: readonly SessionEvent[]): void {
    const tracked = this.queuedMessages.get(sessionId)
    if (!tracked) return
    for (const event of events) {
      if (event.type === 'user/message') tracked.delete(String(event.data.id))
    }
    if (tracked.size === 0) this.queuedMessages.delete(sessionId)
  }

  private forgetCompletedQueuedMessages(sessionId: string, events: readonly SessionEvent[]): void {
    const tracked = this.queuedMessages.get(sessionId)
    if (!tracked) return
    for (const messageId of completedTurnMessageIds(events)) tracked.delete(messageId)
    if (tracked.size === 0) this.queuedMessages.delete(sessionId)
  }
}

function completedTurnMessageIds(events: readonly SessionEvent[]): string[] {
  const completed: string[] = []
  let current: string[] | undefined
  for (const event of events) {
    if (event.type === 'turn/start') current = []
    else if (event.type === 'user/message' && current) current.push(String(event.data.id))
    else if (event.type === 'turn/end' && current) {
      completed.push(...current)
      current = undefined
    }
  }
  return completed
}

export async function createMobileHarness(options: MobileHarnessOptions): Promise<MobileHarness> {
  const ctx = new Context()
  const workspaces = new Map<string, string>()
  if (options.attachmentRoot) await ctx.plugin(MobileImageAttachmentStore, { root: options.attachmentRoot })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { persona: `${options.persona ?? defaultMobilePersona} ${efficientMobileWorkflow}` })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(SkillRegistry)
  ctx.skills.register({
    name: 'mobile-project-workflow',
    description: 'Safely inspect, edit, validate, preview, and commit the current RunWhale project.',
    source: 'bundled',
    content: 'Work only inside the current mobile project. Inspect related files together, batch coordinated file edits, use expected versions for existing files, and avoid repeating unchanged evidence. Run TypeScript diagnostics for affected source and inspect the resulting Git diff. A TypeScript environment or configuration failure means validation is blocked, not passed; never replace it with a bundle-success claim. For Web, use ordinary .css imports, React/DOM code in the manifest entry, and index.html for markup, metadata and styles. Embedded Preview uses Metro, not Vite: scripts in index.html are replaced by the bundled manifest entry, and CSS Modules, Sass, and build-time CSS plugins are unsupported. Keep phone content inside safe areas; run Preview only when the change affects rendered or runtime behavior. The host automatically commits successful file-changing turns, so do not call git_add or git_commit unless the user explicitly requests a Git operation or a specific commit boundary. A runnable project is incomplete until runwhale.json declares its actual entry files and its selected Preview target succeeds. A project with both Web and Native entries must select preview.target. Change preview.target only when the user explicitly asks to change the project target, and ensure the selected target has its required entry before running Preview; never claim Web support without a Web entry and compatible dependencies. Never search device-global paths or place credentials in project files, logs, sessions, bundles, or Preview output.',
  })
  await ctx.plugin(UserQuestionService)
  if (options.requestUserQuestions) {
    ctx.on('user-questions/request', async ({ questions, agent, signal }) => {
      try {
        return await options.requestUserQuestions!({
          ...(agent ? { sessionId: String(agent.id) } : {}),
          questions,
        }, signal)
      } catch (error) {
        if (signal?.aborted) throw new UserQuestionError('user question was cancelled', 'ASK_ABORTED', { cause: error })
        throw error
      }
    })
  }
  await ctx.plugin(ApprovalService, { policy: 'ask' })
  if (options.requestApproval) {
    ctx.on('approval/request', async (request, next) => {
      const outcome = await options.requestApproval!({
        sessionId: String(request.agent.id),
        toolName: request.toolName,
        ...(request.callId ? { callId: String(request.callId) } : {}),
        ...(request.reason ? { reason: request.reason } : {}),
      }, request.signal)
      return outcome ?? next()
    })
  }
  await ctx.plugin(WorkerThreadCodeRuntime, {
    computeMs: 5_000,
    maxWallMs: 30_000,
    maxOutputBytes: 256 * 1024,
    maxOldGenerationSizeMb: 64,
  })
  registerMobileWorkspaceTools(ctx, (sessionId) => workspaces.get(sessionId), {
    ...options.workspaceServices,
    ...(options.requestPackageInstall ? { requestPackageInstall: options.requestPackageInstall } : {}),
  })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(GoalService, { defaultMaxGoalRounds: 64 })
  await ctx.plugin(GoalRoundDriver)
  await ctx.plugin(ToolGoal)
  await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  await ctx.plugin(ToolSkill)
  await ctx.plugin(PlanModeController, {
    section: 'You are in plan mode. Inspect any attached project without modifying it; if no project is attached, plan from the conversation and available non-project context. Produce a decision-complete implementation plan, then call exit_plan_mode as the only final tool call so the user can review it on the phone. Continue implementation only after explicit plan approval.',
  })
  await ctx.plugin(TokenMeter)
  await ctx.plugin(ToolResultPruner, { thresholdChars: 8_192, headChars: 4_096, tailChars: 1_024 })
  await ctx.plugin(BasicCompactionEngine, {
    auto: options.mode === 'deepseek',
    thresholdRatio: 0.8,
    retainRatio: 0.16,
    maxTokens: 8_192,
    compactionRetries: 1,
  })
  await ctx.plugin(MobileCredentialProvider, options.secrets)
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: MOBILE_MAX_PARALLEL_TOOL_CALLS })

  if (options.mode === 'deterministic') {
    ctx.llm.registerAdapter(['runwhale-mock'], new DeterministicAdapter(options.deterministicReply ?? 'Done.'))
    return new MobileHarness(ctx, 'runwhale-mock', 'deterministic', workspaces, options.workspaceServices?.permissionModeFor ?? (() => 'review'))
  }

  const provider = options.provider ?? 'deepseek'
  const modelProfile = options.modelProfile
  const providers: Record<MobileModelProvider, LlmPiAi.PiAiProviderProfile> = {
    deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY' },
    openai: {
      apiKeyEnv: 'OPENAI_API_KEY',
      requestImageMaxBytes: OPENAI_MOBILE_REQUEST_IMAGE_MAX_BYTES,
      requestImagePixelBudget: OPENAI_MOBILE_REQUEST_IMAGE_PIXEL_BUDGET,
    },
    anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
    google: { apiKeyEnv: 'GOOGLE_API_KEY' },
  }
  providers[provider] = {
    ...providers[provider],
    ...(modelProfile?.baseURL ? { baseURL: modelProfile.baseURL } : {}),
    ...(modelProfile ? { models: modelProfile.models.map((entry) => ({ ...entry })) } : {}),
  }
  await ctx.plugin(LlmPiAi, { providers })
  const model = options.model?.trim() || MOBILE_PROVIDER_DEFAULT_MODELS[provider]
  if (!(await ctx.llm.listModels(provider)).some((entry) => entry.id === model)) throw new Error(`model ${provider}/${model} is not in the configured mobile catalog`)
  return new MobileHarness(ctx, provider, model, workspaces, options.workspaceServices?.permissionModeFor ?? (() => 'review'))
}

function terminalFailure(events: readonly SessionEvent[], hasAssistantMessage: boolean): MobileHarnessFailure | undefined {
  const ended = events.findLast((event) => event.type === 'turn/end')
  if (ended?.type === 'turn/end' && ended.data.reason.kind === 'aborted') return undefined
  if (ended?.type === 'turn/end' && ended.data.reason.kind === 'error') {
    const error = ended.data.reason.error
    return {
      ...(typeof error.code === 'string' ? { code: error.code } : {}),
      message: error.message,
    }
  }
  if (!hasAssistantMessage) return { code: 'EMPTY_RESPONSE', message: 'The model completed without an assistant response.' }
  return undefined
}

function goalRef(ref: { id: string; revision: number }): GoalRef {
  return { id: ref.id as GoalRef['id'], revision: ref.revision }
}

function portableGoal(goal: GoalView): AgentGoal {
  return {
    id: String(goal.id),
    revision: goal.revision,
    objective: goal.objective,
    phase: goal.phase,
    maxGoalRounds: goal.maxGoalRounds,
    roundsStarted: goal.roundsStarted,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
    activation: goal.activation,
    ...(goal.blockedReason ? { blockedReason: { ...goal.blockedReason } } : {}),
  }
}
