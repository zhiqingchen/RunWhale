import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createMobileHarness, MobileHarness } from '@runwhale/dsh-mobile'
import { createSessionAgentDriver } from '../src/session-agent-driver.js'
import { RunWhaleRuntimeHost } from '../src/runtime-host.js'

type Adapter = Parameters<MobileHarness['context']['llm']['registerAdapter']>[1]
const { LlmAdapter } = await import(createRequire(new URL('../../dsh-mobile/package.json', import.meta.url)).resolve('@deepseek-ai/dsh-llm')) as { LlmAdapter: new () => Adapter }

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

class ControlledAdapter extends LlmAdapter {
  readonly entered = deferred()
  readonly finish = deferred()
  async *stream(options: Parameters<Adapter['stream']>[0]): ReturnType<Adapter['stream']> {
    this.entered.resolve()
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new Error('aborted'))
      if (options.signal?.aborted) abort()
      else options.signal?.addEventListener('abort', abort, { once: true })
      void this.finish.promise.then(resolve).finally(() => options.signal?.removeEventListener('abort', abort))
    })
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Completed.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Completed.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

it('keeps concurrent presets, session controls, and reconfiguration isolated', async () => {
  const created: Array<{ harness: MobileHarness; adapter: ControlledAdapter; dispose: ReturnType<typeof vi.spyOn> }> = []
  const secrets = { get: async () => undefined, set: async () => {}, delete: async () => {} }
  const driver = createSessionAgentDriver({
    secrets,
    deterministicReplay: true,
    harnessOptions: (mode, _provider, _model, _profile, preset) => ({ mode, secrets, persona: preset }),
    createHarness: async (options) => {
      const base = await createMobileHarness(options)
      const adapter = new ControlledAdapter()
      base.context.llm.registerAdapter(['preset-test'], adapter)
      const harness = new MobileHarness(base.context, 'preset-test', 'audit', new Map(), () => 'review')
      created.push({ harness, adapter, dispose: vi.spyOn(harness, 'dispose') })
      return harness
    },
  })
  cleanup.push(() => driver.dispose())
  const started = async (index: number) => {
    await vi.waitFor(() => expect(created[index]).toBeDefined())
    await created[index]!.adapter.entered.promise
    return created[index]!
  }
  const standard = driver.run({ sessionId: 'standard', prompt: 'First turn', seed: [], projectRoot: '/audit', planMode: false, provider: 'deepseek', agentPreset: 'standard' })
  const first = await started(0)
  const minimal = driver.run({ sessionId: 'minimal', prompt: 'Second turn', seed: [], projectRoot: '/audit', planMode: false, provider: 'deepseek', agentPreset: 'minimal' })
  const second = await started(1)
  expect(first.dispose).not.toHaveBeenCalled()
  expect(await driver.getGoal('standard')).toBeUndefined()
  await driver.setPlanMode('standard', true)
  const queued = await driver.message('standard', 'Follow up', 'followup')
  expect(queued.accepted).toBe(true)
  const updated = await driver.updateMessage('standard', queued.messageId!, 'Updated')
  expect(updated.accepted).toBe(true)
  expect(await driver.pendingMessages('standard')).toMatchObject([{ text: 'Updated' }])
  expect(await driver.pendingMessages('minimal')).toEqual([])
  expect(await driver.deleteMessage('standard', updated.messageId!)).toBe(true)
  expect(await driver.cancel('standard')).toMatchObject({ cancelled: true })
  const stopped = await standard
  first.adapter.finish.resolve()
  expect(second.dispose).not.toHaveBeenCalled()

  const switched = driver.run({ sessionId: 'standard', prompt: 'Resume with Minimal', seed: stopped.events, projectRoot: '/audit', planMode: false, provider: 'deepseek', agentPreset: 'minimal' })
  const third = await started(2)
  expect(first.dispose).toHaveBeenCalledOnce()
  expect(second.dispose).not.toHaveBeenCalled()
  third.adapter.finish.resolve()
  second.adapter.finish.resolve()
  expect(await switched).toMatchObject({ text: 'Completed.' })
  expect(await minimal).toMatchObject({ text: 'Completed.' })
  expect((await driver.sessionEvents('standard')).filter((event: any) => event.type === 'turn/end')).toHaveLength(2)
  await driver.releaseSession('standard')
  expect(third.dispose).toHaveBeenCalledOnce()
  expect(second.dispose).not.toHaveBeenCalled()
  await driver.releaseProject('/audit')
  expect(second.dispose).toHaveBeenCalledOnce()
  expect(await driver.sessionEvents('minimal')).toEqual([])
})

it('releases owned harnesses when sessions and projects are deleted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runwhale-preset-cleanup-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const agent = { run: async () => ({ text: '' }), releaseSession: vi.fn(async () => {}), releaseProject: vi.fn(async () => {}) }
  const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent })
  cleanup.push(() => host.stop())
  const info = await host.start()
  const rpc = async (method: string, params: object) => {
    const response = await fetch(`${info.origin}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }) })
    expect((await response.json() as { ok?: boolean }).ok).toBe(true)
  }
  await rpc('project.create', { id: 'audit', name: 'Audit' })
  await rpc('session.create', { projectId: 'audit', sessionId: 'session' })
  await rpc('session.delete', { projectId: 'audit', sessionId: 'session' })
  expect(agent.releaseSession).toHaveBeenCalledWith('session')
  await rpc('project.delete', { projectId: 'audit' })
  expect(agent.releaseProject).toHaveBeenCalledWith(join(root, 'projects', 'audit'))
})

it('restores a failed session Goal after restart without a model turn, and permits edit, resume, and clear', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runwhale-goal-recovery-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  let requests = 0
  const configurations: Array<{ provider: string; model: string }> = []
  const secrets = { get: async () => undefined, set: async () => {}, delete: async () => {} }
  class RecoveryAdapter extends LlmAdapter {
    async *stream(): ReturnType<Adapter['stream']> {
      requests += 1
      if (requests === 2) {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUDIT_FAILURE', message: 'The audit request failed.' } } }
        return
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Recovered.' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Recovered.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const start = async () => {
    const driver = createSessionAgentDriver({
      secrets, deterministicReplay: true,
      harnessOptions: (mode, provider, model) => { configurations.push({ provider, model }); return { mode, secrets } },
      createHarness: async (options) => {
        const base = await createMobileHarness(options)
        base.context.llm.registerAdapter(['recovery-audit'], new RecoveryAdapter())
        return new MobileHarness(base.context, 'recovery-audit', 'audit', new Map(), () => 'review')
      },
    })
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: driver })
    cleanup.push(() => host.stop())
    const info = await host.start()
    const rpc = async (method: string, params: object) => fetch(`${info.origin}/rpc`, {
      method: 'POST', headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }),
    }).then(response => response.json()) as Promise<any>
    return { host, rpc }
  }
  const scope = { projectId: 'recovery', sessionId: 'recovery-session' }
  const first = await start()
  await first.rpc('project.create', { id: scope.projectId, name: 'Recovery audit' })
  expect(await first.rpc('agent.run', { ...scope, prompt: 'Initialize' })).toMatchObject({ ok: true })
  expect(await first.rpc('agent.goal.create', { ...scope, objective: 'Survive a failed request', maxGoalRounds: 3 })).toMatchObject({ ok: true })
  await vi.waitFor(async () => expect(await first.rpc('session.read', scope)).toMatchObject({ result: { state: 'failed' } }))
  const before = (await first.rpc('session.read', scope)).result
  expect(requests).toBe(2)
  expect(before.events.findLast((event: any) => event.type === 'turn/end').data.reason.error).toMatchObject({ code: 'AUDIT_FAILURE', message: 'The audit request failed.' })
  await first.host.stop()

  const restarted = await start()
  const restored = await restarted.rpc('agent.goal.get', { ...scope, provider: 'openai', model: 'recovery-model' })
  expect(restored).toMatchObject({ result: { goal: { phase: 'active', activation: 'disarmed', roundsStarted: 1 } } })
  expect(configurations.at(-1)).toEqual({ provider: 'openai', model: 'recovery-model' })
  const after = (await restarted.rpc('session.read', scope)).result
  expect(after.state).toBe('failed')
  expect(after.events.filter((event: any) => event.type === 'user/message')).toEqual(before.events.filter((event: any) => event.type === 'user/message'))
  expect(requests).toBe(2)
  const goal = restored.result.goal
  expect(await restarted.rpc('agent.goal.edit', { ...scope, id: goal.id, revision: goal.revision, objective: '' })).toHaveProperty('error')
  expect(await restarted.rpc('session.read', scope)).toMatchObject({ result: { state: 'failed' } })
  const edited = await restarted.rpc('agent.goal.edit', { ...scope, id: goal.id, revision: goal.revision, objective: 'Recover explicitly' })
  expect(edited).toMatchObject({ result: { goal: { objective: 'Recover explicitly', activation: 'disarmed' } } })
  expect(requests).toBe(2)
  expect(await restarted.rpc('agent.goal.resume', { ...scope, id: goal.id, revision: edited.result.goal.revision })).toMatchObject({ ok: true })
  await vi.waitFor(async () => expect(await restarted.rpc('session.read', scope)).toMatchObject({ result: { state: 'completed' } }))
  expect(requests).toBe(4)
  const finished = (await restarted.rpc('agent.goal.get', scope)).result.goal
  expect(finished).toMatchObject({ phase: 'blocked', roundsStarted: 3 })
  expect(await restarted.rpc('agent.goal.clear', { ...scope, id: goal.id, revision: finished.revision })).toMatchObject({ result: { cleared: true } })
  expect(await restarted.rpc('agent.goal.get', scope)).toMatchObject({ result: {} })
})

it('preserves host-only failure details across reload and clears them when Retry succeeds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runwhale-retry-recovery-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const run = vi.fn()
    .mockRejectedValueOnce(Object.assign(new Error('  Connection closed.  '), { code: 'CONNECTION_CLOSED' }))
    .mockResolvedValueOnce({ text: 'Recovered.', events: [{ type: 'turn/end', data: { reason: { kind: 'stop' } } }] })
  const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'android', agent: { run } })
  cleanup.push(() => host.stop())
  const info = await host.start()
  const rpc = async (method: string, params: object) => fetch(`${info.origin}/rpc`, {
    method: 'POST', headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }),
  }).then(response => response.json()) as Promise<any>
  const scope = { projectId: 'recovery', sessionId: 'retry-session' }
  await rpc('project.create', { id: scope.projectId, name: 'Retry audit' })
  expect(await rpc('agent.run', { ...scope, prompt: 'Try' })).toHaveProperty('error')
  expect(await rpc('session.read', { ...scope, surfaceOnly: true })).toMatchObject({ result: { state: 'failed', failure: { code: 'CONNECTION_CLOSED', message: 'Connection closed.' } } })
  expect(await rpc('agent.run', { ...scope, prompt: 'Try' })).toMatchObject({ ok: true })
  const retried = (await rpc('session.read', { ...scope, surfaceOnly: true })).result
  expect(retried.state).toBe('completed')
  expect(retried.failure).toBeUndefined()
})

it('preserves the durable transcript when Retry is rejected before credentials are synced after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runwhale-retry-credentials-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const secrets = { get: async () => undefined, set: async () => {}, delete: async () => {} }
  const createHarness = vi.fn(createMobileHarness)
  const start = async (deterministicReplay: boolean) => {
    const driver = createSessionAgentDriver({
      secrets, deterministicReplay, createHarness,
      harnessOptions: (mode) => ({ mode, secrets, deterministicReply: 'Saved work.' }),
    })
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: driver })
    cleanup.push(() => host.stop())
    const info = await host.start()
    const rpc = async (method: string, params: object) => fetch(`${info.origin}/rpc`, {
      method: 'POST', headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }),
    }).then(response => response.json()) as Promise<any>
    return { host, rpc }
  }
  const scope = { projectId: 'recovery', sessionId: 'saved-session' }
  const first = await start(true)
  await first.rpc('project.create', { id: scope.projectId, name: 'Retry audit' })
  expect(await first.rpc('agent.run', { ...scope, prompt: 'Preserve this request' })).toMatchObject({ ok: true })
  const saved = (await first.rpc('session.read', scope)).result
  expect(saved.events.some((event: any) => event.type === 'assistant/message')).toBe(true)
  await first.host.stop()
  createHarness.mockClear()

  const restarted = await start(false)
  expect(await restarted.rpc('agent.run', { ...scope, prompt: 'Retry the last request', provider: 'openai' })).toMatchObject({ error: { message: 'MISSING_CREDENTIAL: Configure a openai API key in Settings before running the Agent.' } })
  const failed = (await restarted.rpc('session.read', scope)).result
  expect(failed).toMatchObject({ state: 'failed', failure: { code: 'MISSING_CREDENTIAL' } })
  expect(failed.events).toEqual(saved.events)
  expect(createHarness).not.toHaveBeenCalled()
})
