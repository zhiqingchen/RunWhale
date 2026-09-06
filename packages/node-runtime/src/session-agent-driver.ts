import type { MobileHarness, MobileHarnessOptions, MobileImageInput } from '@runwhale/dsh-mobile'
import { MOBILE_DEFAULT_MODELS, type MobileAgentPreset, type MobileModelProvider, type MobileModelProviderProfile } from '@runwhale/mobile-protocol'
import type { AgentDriver, AgentRunOptions, AgentSessionLoadOptions } from './agent-driver.js'

interface SessionAgentDriverOptions {
  createHarness(options: MobileHarnessOptions): Promise<MobileHarness>
  harnessOptions(mode: MobileHarnessOptions['mode'], provider: MobileModelProvider, model: string, modelProfile: MobileModelProviderProfile | undefined, preset: MobileAgentPreset): MobileHarnessOptions
  secrets: MobileHarnessOptions['secrets']
  deterministicReplay?: boolean
}

export function createSessionAgentDriver(options: SessionAgentDriverOptions) {
  const { secrets, harnessOptions } = options
  const sessions = new Map<string, { key: string; harness: MobileHarness; projectRoot: string | undefined; unsubscribe: () => void }>()
  const switching = new Map<string, Promise<void>>()
  const observers = new Map<string, Set<(event: unknown) => void>>()
  const backgroundPaused = new Set<string>()
  let disposed = false

  async function sessionHarness(sessionId: string): Promise<MobileHarness | undefined> {
    await switching.get(sessionId)
    return sessions.get(sessionId)?.harness
  }

  async function requireSessionHarness(sessionId: string): Promise<MobileHarness> {
    const harness = await sessionHarness(sessionId)
    if (!harness) throw new Error('Agent harness is unavailable')
    return harness
  }

  async function releaseSession(sessionId: string): Promise<void> {
    await switching.get(sessionId)?.catch(() => undefined)
    const previous = sessions.get(sessionId)
    sessions.delete(sessionId)
    backgroundPaused.delete(sessionId)
    previous?.unsubscribe()
    await previous?.harness.dispose()
  }
  async function configureSession({ sessionId, projectRoot, provider = 'deepseek', model, modelProfile, agentPreset = 'standard' }: AgentSessionLoadOptions, desired: MobileHarnessOptions['mode']): Promise<MobileHarness> {
    const selectedModel = model?.trim() || MOBILE_DEFAULT_MODELS[provider]
    const desiredKey = JSON.stringify([desired, provider, selectedModel, modelProfile, agentPreset])
    if (disposed) throw new Error('Agent driver is disposed')
    // Configuration changes belong to this session, including while other
    // sessions are running or still initializing their own harnesses.
    const change = (switching.get(sessionId) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const previous = sessions.get(sessionId)
      if (previous?.key === desiredKey && previous.projectRoot === projectRoot) return
      const harness = await options.createHarness(harnessOptions(desired, provider, selectedModel, modelProfile, agentPreset))
      previous?.unsubscribe()
      await previous?.harness.dispose()
      const unsubscribe = harness.observeSession(sessionId, (event) => {
        for (const listener of observers.get(sessionId) ?? []) listener(event)
      })
      sessions.set(sessionId, { key: desiredKey, harness, projectRoot, unsubscribe })
    })
    switching.set(sessionId, change)
    try {
      await change
    } finally {
      if (switching.get(sessionId) === change) switching.delete(sessionId)
    }
    return requireSessionHarness(sessionId)
  }

  const agent = {
    async loadSession(input: AgentSessionLoadOptions) {
      if (await sessionHarness(input.sessionId)) return
      const hasCredential = Boolean(await secrets.get(providerCredentialRef(input.provider ?? 'deepseek')))
      const mode = !hasCredential && options.deterministicReplay ? 'deterministic' : 'deepseek'
      const harness = await configureSession(input, mode)
      await harness.loadSession(input)
    },
    observeSession(sessionId: string, onEvent: (event: unknown) => void) {
      const listeners = observers.get(sessionId) ?? new Set()
      observers.set(sessionId, listeners)
      listeners.add(onEvent)
      return () => {
        listeners.delete(onEvent)
        if (listeners.size === 0) observers.delete(sessionId)
      }
    },
    async whenIdle(sessionId: string) { await (await sessionHarness(sessionId))?.whenIdle(sessionId) },
    async pause(sessionId: string) { backgroundPaused.add(sessionId); await (await sessionHarness(sessionId))?.pause(sessionId) },
    async resume(sessionId: string, signal?: AbortSignal) {
      backgroundPaused.delete(sessionId)
      const harness = await requireSessionHarness(sessionId)
      if (backgroundPaused.has(sessionId)) {
        await harness.pause(sessionId)
        return { text: '', events: harness.sessionEvents(sessionId) }
      }
      return harness.resume(sessionId, signal)
    },
    async run({ sessionId, prompt, seed, projectRoot, signal, onEvent, planMode, provider = 'deepseek', model, agentPreset = 'standard', attachments = [], modelProfile, startPaused }: AgentRunOptions) {
      if (startPaused) backgroundPaused.add(sessionId)
      else backgroundPaused.delete(sessionId)
      const selectedModel = model?.trim() || MOBILE_DEFAULT_MODELS[provider]
      const hasCredential = Boolean(await secrets.get(providerCredentialRef(provider)))
      const testReplayEnabled = options.deterministicReplay === true
      if (!hasCredential && !testReplayEnabled) {
        // Admission failed before a harness could restore the durable seed.
        // Let the host retain that transcript instead of replacing it with an
        // empty session snapshot during Retry after a runtime restart.
        throw Object.assign(new Error(`Configure a ${provider} API key in Settings before running the Agent.`), { code: 'MISSING_CREDENTIAL' })
      }
      const desired = hasCredential ? 'deepseek' : 'deterministic'
      const harness = await configureSession({ sessionId, projectRoot, provider, model: selectedModel, modelProfile, agentPreset }, desired)
      return harness.run({ sessionId, prompt, seed, projectRoot, signal, onEvent, planMode, attachments, startPaused: backgroundPaused.has(sessionId) })
    },
    async cancel(sessionId: string) {
      backgroundPaused.delete(sessionId)
      const harness = await sessionHarness(sessionId)
      return harness?.cancel(sessionId) ?? { cancelled: false, restoredMessages: [] }
    },
    async message(sessionId: string, prompt: string, mode: 'followup' | 'steer') {
      const harness = await sessionHarness(sessionId)
      return harness?.message(sessionId, prompt, mode) ?? { accepted: false }
    },
    async notifyPreview(sessionId: string, message: string) {
      return (await sessionHarness(sessionId))?.notifyPreview(sessionId, message) ?? false
    },
    async pendingMessages(sessionId: string) {
      const harness = await sessionHarness(sessionId)
      return harness?.pendingMessages(sessionId) ?? []
    },
    async updateMessage(sessionId: string, messageId: string, prompt: string) {
      const harness = await sessionHarness(sessionId)
      return harness?.updateMessage(sessionId, messageId, prompt) ?? { accepted: false }
    },
    async deleteMessage(sessionId: string, messageId: string) {
      const harness = await sessionHarness(sessionId)
      return harness?.deleteMessage(sessionId, messageId) ?? false
    },
    async setPlanMode(sessionId: string, active: boolean) {
      const harness = await requireSessionHarness(sessionId)
      return harness.setPlanMode(sessionId, active)
    },
    async getGoal(sessionId: string) {
      const harness = await requireSessionHarness(sessionId)
      return harness.getGoal(sessionId)
    },
    async createGoal(sessionId: string, objective: string, maxGoalRounds?: number) {
      const harness = await requireSessionHarness(sessionId)
      return harness.createGoal(sessionId, objective, maxGoalRounds)
    },
    async editGoal(sessionId: string, ref: { id: string; revision: number }, objective?: string, maxGoalRounds?: number) {
      const harness = await requireSessionHarness(sessionId)
      return harness.editGoal(sessionId, ref, objective, maxGoalRounds)
    },
    async pauseGoal(sessionId: string, ref: { id: string; revision: number }) {
      const harness = await requireSessionHarness(sessionId)
      return harness.pauseGoal(sessionId, ref)
    },
    async resumeGoal(sessionId: string, ref: { id: string; revision: number }) {
      const harness = await requireSessionHarness(sessionId)
      return harness.resumeGoal(sessionId, ref)
    },
    async clearGoal(sessionId: string, ref: { id: string; revision: number }) {
      const harness = await requireSessionHarness(sessionId)
      harness.clearGoal(sessionId, ref)
    },
    async sessionEvents(sessionId: string) {
      return (await sessionHarness(sessionId))?.sessionEvents(sessionId) ?? []
    },
    releaseSession,
    async releaseProject(projectRoot: string) {
      await Promise.all([...sessions].filter(([, session]) => session.projectRoot === projectRoot).map(([id]) => releaseSession(id)))
    },
    async dispose() {
      disposed = true
      await Promise.allSettled(switching.values())
      await Promise.all([...sessions.keys()].map(releaseSession))
    },
  }
  return agent satisfies AgentDriver
}

function providerCredentialRef(provider: MobileModelProvider): string {
  if (provider === 'openai') return 'ref:OPENAI_API_KEY'
  if (provider === 'anthropic') return 'ref:ANTHROPIC_API_KEY'
  if (provider === 'google') return 'ref:GOOGLE_API_KEY'
  return 'ref:DEEPSEEK_API_KEY'
}
