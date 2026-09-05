import { describe, expect, it } from 'vitest'
import { createMobileHarness, DEEPSEEK_MOBILE_MODEL, MOBILE_MAX_PARALLEL_TOOL_CALLS, MOBILE_PROVIDER_DEFAULT_MODELS, MobileCredentialProvider, MobileHarness, OPENAI_MOBILE_REQUEST_IMAGE_MAX_BYTES, OPENAI_MOBILE_REQUEST_IMAGE_PIXEL_BUDGET, type NativeSecretStore } from '../src/index.js'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

class MemorySecrets implements NativeSecretStore {
  values = new Map<string, string>()
  async get(key: string) { return this.values.get(key) }
  async set(key: string, value: string) { this.values.set(key, value) }
  async delete(key: string) { this.values.delete(key) }
}

class HangingAdapter extends LlmAdapter {
  private start!: () => void
  readonly started = new Promise<void>((resolve) => { this.start = resolve })

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.start()
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'partial' }
    await new Promise<void>((_resolve, reject) => {
      const abort = () => reject(new Error('aborted'))
      if (options.signal?.aborted) abort()
      else options.signal?.addEventListener('abort', abort, { once: true })
    })
  }
}

describe('DSH mobile profile', () => {
  it('delivers Preview results as plugin notices without creating user input or waking an idle session', async () => {
    const harness = await createMobileHarness({ mode: 'deterministic', secrets: new MemorySecrets() })
    try {
      await harness.run({ sessionId: 'preview-notice', prompt: 'Build the app' })
      expect(harness.notifyPreview('preview-notice', 'Preview failed on the device.')).toBe(true)
      expect(harness.pendingMessages('preview-notice')).toEqual([])
      const agent = harness.context.agents.get(SessionId('preview-notice'))!
      expect(agent.status).toBe('idle')
      expect(agent.inbox.nextStep[0]?.source).toEqual({ kind: 'plugin', plugin: 'runwhale-preview', form: 'notice', summary: 'Preview device result' })
      const continued = await harness.run({ sessionId: 'preview-notice', prompt: 'Continue' })
      expect(continued.events.filter((event) => event.type === 'user/message').map((event) => event.data.source)).toContainEqual({ kind: 'plugin', plugin: 'runwhale-preview', form: 'notice', summary: 'Preview device result' })
      expect(continued.events.filter((event) => event.type === 'turn/end')).toHaveLength(2)
    } finally { await harness.dispose() }
  })

  it('uses the real DSH agent loop with a deterministic replay adapter', async () => {
    const harness = await createMobileHarness({ mode: 'deterministic', secrets: new MemorySecrets(), deterministicReply: 'Completed request.' })
    expect(harness.context.tools.schemas().map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'read_file', 'read_files', 'write_file', 'write_files', 'list_files', 'typescript_diagnostics',
      'node_task', 'typescript_program', 'package_install', 'preview_run', 'preview_reload', 'preview_stop', 'preview_logs',
      'git_status', 'git_diff', 'git_add', 'git_commit', 'git_log', 'git_branch', 'git_checkout', 'git_remote', 'git_fetch', 'git_pull', 'git_push',
      'get_goal', 'create_goal', 'update_goal', 'todo_write', 'skill', 'exit_plan_mode',
    ]))
    const streamed: string[] = []
    const result = await harness.run({ sessionId: 'replay-project', prompt: 'Inspect the project', seed: [], onEvent: (event) => streamed.push(event.type) })
    expect(result.text).toBe('Completed request.')
    expect(result.events.some((event) => event.type === 'turn/end')).toBe(true)
    expect(streamed).toEqual(expect.arrayContaining(['turn/start', 'assistant/chunk', 'assistant/message', 'turn/end']))
    const continued = await harness.run({ sessionId: 'replay-project', prompt: 'Continue the inspection' })
    expect(continued.text).toBe('Completed request.')
    expect(continued.events.filter((event) => event.type === 'turn/end')).toHaveLength(2)
    const agent = harness.context.agents.get(SessionId('replay-project'))!
    const idle = new Promise<void>((resolve) => {
      const dispose = harness.context.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    expect(harness.message('replay-project', 'Check another file', 'followup')).toMatchObject({ accepted: true, messageId: expect.any(String) })
    await idle
    expect(agent.session.snapshotEvents().filter((event) => event.type === 'turn/end')).toHaveLength(3)
    await harness.dispose()
  })

  it('mounts durable plan, skill, compaction, goal, todo, approval, and code-runtime capabilities', async () => {
    const harness = await createMobileHarness({ mode: 'deterministic', secrets: new MemorySecrets(), deterministicReply: 'Ready.' })
    await harness.run({ sessionId: 'capability-session', prompt: 'Inspect the project' })
    expect(harness.setPlanMode('capability-session', true)).toMatchObject({ active: true, outcome: 'committed' })
    expect(harness.getPlanMode('capability-session')).toEqual({ active: true })
    const agent = harness.context.agents.get(SessionId('capability-session'))!
    expect(agent.session.snapshotEvents().some((event) => event.type === 'plan/mode')).toBe(true)
    expect((await harness.context.skills.list({ scope: agent })).map((skill) => skill.name)).toContain('mobile-project-workflow')
    expect(harness.context.compaction).toBeDefined()
    expect(harness.context.goals).toBeDefined()
    expect(harness.context.approval).toBeDefined()
    expect(harness.context.agentLoop.config.maxParallelToolCalls).toBe(MOBILE_MAX_PARALLEL_TOOL_CALLS)
    const workflow = await harness.context.skills.get('mobile-project-workflow', { scope: agent })
    expect(workflow?.content).toContain('batch coordinated file edits')
    expect(workflow?.content).toContain('automatically commits')
    const createdGoal = harness.createGoal('capability-session', 'Finish the mobile project', 8)
    expect(createdGoal).toMatchObject({ objective: 'Finish the mobile project', phase: 'active', maxGoalRounds: 8, activation: 'armed' })
    const editedGoal = harness.editGoal('capability-session', createdGoal, 'Finish and verify the mobile project', 9)
    const pausedGoal = harness.pauseGoal('capability-session', editedGoal)
    expect(pausedGoal.phase).toBe('paused')
    const resumedGoal = harness.resumeGoal('capability-session', pausedGoal)
    expect(resumedGoal).toMatchObject({ phase: 'active', activation: 'armed' })
    harness.clearGoal('capability-session', resumedGoal)
    expect(harness.getGoal('capability-session')).toBeUndefined()
    expect(harness.sessionEvents('capability-session').filter((event) => event.type === 'goal/change')).toHaveLength(5)
    const code = await harness.context.codeRuntime.run({
      program: 'const value: number = await api.double({ value: 21 }); console.log("worker", value); return { value };',
      bindings: [{ global: 'api', functions: { double: async (args) => Number((args as { value?: unknown }).value) * 2 } }],
    })
    expect(code).toMatchObject({ value: { value: 42 }, logs: ['worker 42'] })
    await harness.dispose()
  })

  it('forwards scoped user questions to the mobile host', async () => {
    let requestedSessionId: string | undefined
    const harness = await createMobileHarness({
      mode: 'deterministic',
      secrets: new MemorySecrets(),
      deterministicReply: 'Ready.',
      requestUserQuestions: async (request) => {
        requestedSessionId = request.sessionId
        return { answers: [{ id: 'direction', selected: ['Continue'] }] }
      },
    })
    await harness.run({ sessionId: 'question-session', prompt: 'Inspect the project' })

    const answer = await harness.context.userQuestions.ask({
      questions: [{ id: 'direction', question: 'Continue?', options: [{ label: 'Continue' }] }],
      agent: harness.context.agents.get(SessionId('question-session'))!,
    })

    expect(requestedSessionId).toBe('question-session')
    expect(answer).toEqual({ answers: [{ id: 'direction', selected: ['Continue'] }] })
    await harness.dispose()
  })

  it('rehydrates a durable session seed after a process restart', async () => {
    const options = { mode: 'deterministic' as const, secrets: new MemorySecrets(), deterministicReply: 'Continued.' }
    const first = await createMobileHarness(options)
    const initial = await first.run({ sessionId: 'durable-session', prompt: 'Create the game' })
    await first.dispose()
    const restarted = await createMobileHarness(options)
    const streamed: typeof initial.events[number][] = []
    const continued = await restarted.run({ sessionId: 'durable-session', prompt: 'Make it faster', seed: JSON.parse(JSON.stringify(initial.events)), onEvent: (event) => streamed.push(event) }
    )
    expect(streamed[0]).toMatchObject({
      type: 'session/end-seed',
      seq: initial.events.length,
    })
    expect(streamed.map((event) => event.seq)).toEqual(
      Array.from({ length: streamed.length }, (_, index) => initial.events.length + index),
    )
    expect(continued.events.filter((event) => event.type === 'turn/end')).toHaveLength(2)
    expect(continued.text).toBe('Continued.')
    await restarted.dispose()
  })

  it('retries a session whose first turn was interrupted before completion', async () => {
    const options = { mode: 'deterministic' as const, secrets: new MemorySecrets(), deterministicReply: 'Recovered.' }
    const first = await createMobileHarness(options)
    class PreviewAdapter extends LlmAdapter {
      constructor(private requested = false) { super() }
      async *stream(input: GenerateOptions): AsyncIterable<StreamChunk> {
        const pending = new Set<string>()
        for (const message of input.messages) for (const block of message.content) {
          if (block.type === 'tool-call') pending.add(block.id)
          if (block.type === 'tool-result') pending.delete(block.toolCallId)
        }
        if (pending.size) throw new Error('Provider rejected an unmatched tool call')
        if (!this.requested) {
          this.requested = true
          const id = ToolCallId('interrupted-preview')
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: 0, id, name: 'preview_run', argumentsDelta: '{}' }
          yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'preview_run', arguments: '{}' } }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
        } else {
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Recovered.' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
      }
    }
    first.context.llm.registerAdapter(['preview-test'], new PreviewAdapter())
    const preview = new MobileHarness(first.context, 'preview-test', 'test', new Map(), () => 'review')
    const initial = await preview.run({ sessionId: 'interrupted-first-turn', prompt: 'Create the game' })
    await first.dispose()
    const seed = initial.events.slice(0, initial.events.findIndex((event) => event.type === 'tool/result'))
    expect(seed.at(-1)?.type).toBe('tool/call')
    const restarted = await createMobileHarness(options)
    restarted.context.llm.registerAdapter(['preview-test'], new PreviewAdapter(true))
    const retry = new MobileHarness(restarted.context, 'preview-test', 'test', new Map(), () => 'review')
    const streamed: typeof initial.events[number][] = []
    try {
      const result = await retry.run({ sessionId: 'interrupted-first-turn', prompt: 'Create the game', seed: JSON.parse(JSON.stringify(seed)), onEvent: (event) => streamed.push(event) })
      expect(result.failure).toBeUndefined()
      expect(result.text).toBe('Recovered.')
      expect(result.events.find((event) => event.type === 'tool/result')).toMatchObject({
        data: { error: { code: 'TOOL_OUTCOME_UNKNOWN' }, message: { source: { callId: 'interrupted-preview' } } },
      })
      expect(result.events.slice(0, seed.length)).toEqual(seed)
      expect(streamed).toEqual(result.events.slice(seed.length))
      expect(result.events.map((event) => event.seq)).toEqual(result.events.map((_, index) => index))
      expect(result.events.filter((event) => event.type === 'turn/end')).toHaveLength(2)
    } finally { await restarted.dispose() }
  })

  it('does not start a DSH turn when the run signal is already cancelled', async () => {
    const harness = await createMobileHarness({ mode: 'deterministic', secrets: new MemorySecrets(), deterministicReply: 'Should not finish.' })
    const controller = new AbortController()
    controller.abort(new Error('user stopped Agent'))
    const result = await harness.run({ sessionId: 'cancelled-session', prompt: 'Start work', seed: [], signal: controller.signal })
    expect(result.failure).toBeUndefined()
    expect(result.events).toEqual([])
    await harness.dispose()
  })

  it('stops at idle and returns queued messages instead of waking another turn', async () => {
    const harness = await createMobileHarness({ mode: 'deterministic', secrets: new MemorySecrets(), deterministicReply: 'Should not finish.' })
    const running = harness.run({ sessionId: 'paused-session', prompt: 'Start work' })
    expect(harness.message('paused-session', 'Try this next', 'followup')).toMatchObject({ accepted: true, messageId: expect.any(String) })

    const cancelled = await harness.cancel('paused-session')
    const agent = harness.context.agents.get(SessionId('paused-session'))!
    expect(agent.status).toBe('idle')
    const result = await running

    expect(cancelled).toMatchObject({
      cancelled: true,
      restoredMessages: [{ text: 'Try this next', mode: 'followup' }],
    })
    expect(harness.pendingMessages('paused-session')).toEqual([])
    expect(result.events.filter((event) => event.type === 'turn/end')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ reason: expect.objectContaining({ kind: 'aborted' }) }) }),
    ])
    await harness.dispose()
  })

  it('restores a queued message already claimed by the active turn', async () => {
    const harness = await createMobileHarness({ mode: 'deterministic', secrets: new MemorySecrets() })
    const adapter = new HangingAdapter()
    harness.context.llm.registerAdapter(['runwhale-hang'], adapter)
    const blocking = new MobileHarness(harness.context, 'runwhale-hang', 'hang', new Map(), () => 'review')
    blocking.context.agentLoop.create(SessionId('claimed-queue-session'), { provider: 'runwhale-hang', model: 'hang' })

    const accepted = blocking.message('claimed-queue-session', 'Restore claimed work', 'followup')
    await adapter.started
    expect(blocking.pendingMessages('claimed-queue-session')).toEqual([])

    const cancelled = await blocking.cancel('claimed-queue-session')

    expect(cancelled).toMatchObject({
      cancelled: true,
      restoredMessages: [{ messageId: accepted.messageId, text: 'Restore claimed work', mode: 'followup' }],
    })
    expect(blocking.context.agents.get(SessionId('claimed-queue-session'))?.status).toBe('idle')
    await harness.dispose()
  })

  it('keeps credentials behind the mobile seam', async () => {
    const secrets = new MemorySecrets()
    const ctx = new Context()
    const provider = new MobileCredentialProvider(ctx, secrets)
    const ref = credentialRef('DEEPSEEK_API_KEY')
    await provider.set(ref, 'secret-value')
    expect(await provider.resolve(ref)).toMatchObject({ value: 'secret-value', source: 'native-secure-store' })
  })

  it('enforces read-only sessions before project writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-permissions-'))
    const harness = await createMobileHarness({
      mode: 'deterministic',
      secrets: new MemorySecrets(),
      deterministicReply: 'Ready.',
      requestApproval: async () => 'allowed-once',
      workspaceServices: { permissionModeFor: () => 'read-only' },
    })
    await harness.run({ sessionId: 'permission-session', prompt: 'Inspect', seed: [], projectRoot: root })
    const agent = harness.context.agents.get(SessionId('permission-session'))!
    const signal = new AbortController().signal
    const denied = await harness.context.tools.execute({ signal, callId: ToolCallId('readonly-write'), name: 'write_file', arguments: { path: 'blocked.txt', content: 'blocked' }, agent })
    expect(denied.isError).toBe(true)
    expect(JSON.stringify(denied.content)).toContain('read-only')
    await harness.dispose()
  })

  it('uses standard write approval before dependency installs and honors the session permission mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-package-permissions-'))
    const reviewRoot = join(root, 'review')
    const fullAccessRoot = join(root, 'full-access')
    const readOnlyRoot = join(root, 'read-only')
    await Promise.all([reviewRoot, fullAccessRoot, readOnlyRoot].map((directory) => mkdir(directory, { recursive: true })))
    const actions: string[] = []
    const approvalSignals: AbortSignal[] = []
    const requests: Array<{
      sessionId: string
      projectRoot: string
      dependencies: Record<string, string>
      offline: boolean | undefined
      signal: AbortSignal
    }> = []
    const harness = await createMobileHarness({
      mode: 'deterministic',
      secrets: new MemorySecrets(),
      deterministicReply: 'Ready.',
      requestApproval: async (request, signal) => {
        actions.push(`approve:${request.sessionId}:${request.toolName}:${request.reason}`)
        if (signal) approvalSignals.push(signal)
        return 'allowed-once'
      },
      requestPackageInstall: async (sessionId, projectRoot, dependencies, offline, signal) => {
        actions.push(`install:${sessionId}`)
        requests.push({ sessionId, projectRoot, dependencies, offline, signal })
        return {
          installId: `install-${sessionId}`,
          durationMs: 12,
          packages: 1,
          bytes: 128,
          offline: Boolean(offline),
        }
      },
      workspaceServices: {
        permissionModeFor: (sessionId) => sessionId === 'full-access-package-session'
          ? 'danger-full-access'
          : sessionId === 'read-only-package-session' ? 'read-only' : 'review',
      },
    })
    await harness.run({ sessionId: 'review-package-session', prompt: 'Inspect', seed: [], projectRoot: reviewRoot })
    await harness.run({ sessionId: 'full-access-package-session', prompt: 'Inspect', seed: [], projectRoot: fullAccessRoot })
    await harness.run({ sessionId: 'read-only-package-session', prompt: 'Inspect', seed: [], projectRoot: readOnlyRoot })

    const reviewSignal = new AbortController().signal
    const reviewAgent = harness.context.agents.get(SessionId('review-package-session'))!
    reviewAgent.session.append('turn/start', { turn: 2 })
    const review = await harness.context.tools.execute({
      signal: reviewSignal,
      callId: ToolCallId('review-package-install'),
      name: 'package_install',
      arguments: { name: 'three', version: '0.185.1', offline: true },
      agent: reviewAgent,
    })
    reviewAgent.session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    expect(review.isError, JSON.stringify(review.content)).not.toBe(true)
    expect(review.content).toEqual([expect.objectContaining({ text: expect.stringContaining('install-review-package-session') })])
    expect(actions).toEqual([
      'approve:review-package-session:package_install:three@0.185.1',
      'install:review-package-session',
    ])
    expect(approvalSignals).toEqual([reviewSignal])

    const fullAccessSignal = new AbortController().signal
    const fullAccess = await harness.context.tools.execute({
      signal: fullAccessSignal,
      callId: ToolCallId('full-access-package-install'),
      name: 'package_install',
      arguments: { name: 'three', version: '0.185.1' },
      agent: harness.context.agents.get(SessionId('full-access-package-session'))!,
    })
    expect(fullAccess.isError).not.toBe(true)
    expect(fullAccess.content).toEqual([expect.objectContaining({ text: expect.stringContaining('install-full-access-package-session') })])
    expect(actions).toEqual([
      'approve:review-package-session:package_install:three@0.185.1',
      'install:review-package-session',
      'install:full-access-package-session',
    ])

    expect(requests.map(({ signal: _signal, ...request }) => request)).toEqual([
      { sessionId: 'review-package-session', projectRoot: reviewRoot, dependencies: { three: '0.185.1' }, offline: true },
      { sessionId: 'full-access-package-session', projectRoot: fullAccessRoot, dependencies: { three: '0.185.1' }, offline: undefined },
    ])
    expect(requests[0]?.signal).toBe(reviewSignal)
    expect(requests[1]?.signal).toBe(fullAccessSignal)

    const readOnly = await harness.context.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('read-only-package-install'),
      name: 'package_install',
      arguments: { name: 'three', version: '0.185.1' },
      agent: harness.context.agents.get(SessionId('read-only-package-session'))!,
    })
    expect(readOnly.isError).toBe(true)
    expect(JSON.stringify(readOnly.content)).toContain('read-only')
    expect(requests).toHaveLength(2)
    expect(actions).toHaveLength(3)
    await harness.dispose()
  })

  it('batches related file reads and writes in one tool execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-batch-files-'))
    await writeFile(join(root, 'first.txt'), 'one')
    await writeFile(join(root, 'second.txt'), 'two')
    let approvals = 0
    const harness = await createMobileHarness({
      mode: 'deterministic',
      secrets: new MemorySecrets(),
      deterministicReply: 'Ready.',
      requestApproval: async () => { approvals += 1; return 'allowed-once' },
      workspaceServices: { permissionModeFor: () => 'danger-full-access' },
    })
    await harness.run({ sessionId: 'batch-session', prompt: 'Update both files', seed: [], projectRoot: root })
    const agent = harness.context.agents.get(SessionId('batch-session'))!
    const signal = new AbortController().signal
    const read = await harness.context.tools.execute({
      signal,
      callId: ToolCallId('batch-read'),
      name: 'read_files',
      arguments: { paths: ['first.txt', 'second.txt'] },
      agent,
    })
    expect(read.isError).not.toBe(true)
    expect(JSON.stringify(read.content)).toContain('one')
    expect(JSON.stringify(read.content)).toContain('two')

    const written = await harness.context.tools.execute({
      signal,
      callId: ToolCallId('batch-write'),
      name: 'write_files',
      arguments: { files: [{ path: 'first.txt', content: 'updated one' }, { path: 'second.txt', content: 'updated two' }] },
      agent,
    })
    expect(written.isError, JSON.stringify(written.content)).not.toBe(true)
    expect(approvals).toBe(0)
    expect(await readFile(join(root, 'first.txt'), 'utf8')).toBe('updated one')
    expect(await readFile(join(root, 'second.txt'), 'utf8')).toBe('updated two')
    await harness.dispose()
  })

  it('uses never approvals within app-container roots in Full Access while preserving the OS boundary', async () => {
    const appRoot = await mkdtemp(join(tmpdir(), 'runwhale-full-access-'))
    const projectRoot = join(appRoot, 'projects', 'project')
    const outsideRoot = await mkdtemp(join(tmpdir(), 'runwhale-outside-'))
    await mkdir(projectRoot, { recursive: true })
    let approvalRequests = 0
    const harness = await createMobileHarness({
      mode: 'deterministic',
      secrets: new MemorySecrets(),
      deterministicReply: 'Ready.',
      requestApproval: async () => { approvalRequests += 1; return 'rejected' },
      workspaceServices: {
        permissionModeFor: () => 'danger-full-access',
        fullAccessRootsFor: () => [appRoot],
      },
    })
    await harness.run({ sessionId: 'full-access-session', prompt: 'Inspect', seed: [], projectRoot: projectRoot })
    const agent = harness.context.agents.get(SessionId('full-access-session'))!
    expect(harness.context.approval.overrideOf(agent.session)).toBe('never')
    const signal = new AbortController().signal
    const appFile = join(appRoot, 'full-access.txt')
    const written = await harness.context.tools.execute({ signal, callId: ToolCallId('full-access-write'), name: 'write_file', arguments: { path: appFile, content: 'allowed' }, agent })
    expect(written.isError).not.toBe(true)
    expect(await readFile(appFile, 'utf8')).toBe('allowed')
    expect(approvalRequests).toBe(0)

    const outsideFile = join(outsideRoot, 'blocked.txt')
    const denied = await harness.context.tools.execute({ signal, callId: ToolCallId('full-access-outside'), name: 'write_file', arguments: { path: outsideFile, content: 'blocked' }, agent })
    expect(denied.isError).toBe(true)
    expect(JSON.stringify(denied.content)).toMatch(/outside|root|sandbox|escape/i)
    await harness.dispose()
  })

  it('selects a model present in the pinned pi-ai DeepSeek catalog', async () => {
    const harness = await createMobileHarness({ mode: 'deepseek', secrets: new MemorySecrets() })
    expect((await harness.context.llm.listModels('deepseek')).map((model) => model.id)).toContain(DEEPSEEK_MOBILE_MODEL)
    for (const provider of ['openai', 'anthropic', 'google'] as const) {
      expect((await harness.context.llm.listModels(provider)).map((model) => model.id)).toContain(MOBILE_PROVIDER_DEFAULT_MODELS[provider])
    }
    await harness.dispose()
  })

  it('aligns the OpenAI request image budget with accepted mobile attachments', () => {
    expect(OPENAI_MOBILE_REQUEST_IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024)
    expect(OPENAI_MOBILE_REQUEST_IMAGE_PIXEL_BUDGET).toBe(16_000_000)
  })

  it('materializes a custom endpoint and model list through the pi-ai profile', async () => {
    const harness = await createMobileHarness({
      mode: 'deepseek',
      secrets: new MemorySecrets(),
      provider: 'openai',
      model: 'private-coder',
      modelProfile: {
        baseURL: 'http://127.0.0.1:8000/v1',
        models: [{ id: 'private-coder', name: 'Private Coder', contextWindow: 65_536, maxTokens: 8_192 }],
      },
    })
    expect(await harness.context.llm.listModels('openai')).toEqual([
      expect.objectContaining({ id: 'private-coder', name: 'Private Coder' }),
    ])
    await harness.dispose()
  })
})
