import { createRequire } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMobileHarness, MobileHarness } from '@runwhale/dsh-mobile'
import { RunWhaleRuntimeHost } from '../src/runtime-host.js'

let host: RunWhaleRuntimeHost
let harness: MobileHarness
let root: string
const projectId = 'goal-audit'
const sessionId = 'goal-audit-session'
afterEach(async () => { await host?.stop(); await harness?.dispose(); if (root) await rm(root, { recursive: true, force: true }) })
async function setup() {
  root = await mkdtemp(join(tmpdir(), 'runwhale-goal-integration-'))
  harness = await createMobileHarness({ mode: 'deterministic', deterministicReply: 'Audit response', secrets: { get: async () => undefined, set: async () => {}, delete: async () => {} } })
  type Adapter = Parameters<typeof harness.context.llm.registerAdapter>[1]
  const { LlmAdapter } = await import(createRequire(new URL('../../dsh-mobile/package.json', import.meta.url)).resolve('@deepseek-ai/dsh-llm')) as { LlmAdapter: new () => Adapter }
  class SlowAdapter extends LlmAdapter {
    async *stream(): ReturnType<Adapter['stream']> {
      await new Promise(resolve => setTimeout(resolve, 60))
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Audit response' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Audit response' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  harness.context.llm.registerAdapter(['goal-audit'], new SlowAdapter())
  harness = new MobileHarness(harness.context, 'goal-audit', 'audit', new Map(), () => 'review')
  host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'android', agent: {
    run: ({ sessionId: id, prompt, seed, projectRoot, signal, onEvent, planMode }) => harness.run({ sessionId: id, prompt: prompt, seed: seed, projectRoot: projectRoot, signal: signal, onEvent: onEvent, planMode: planMode }),
    observeSession: (id, onEvent) => harness.observeSession(id, onEvent),
    whenIdle: (id) => harness.whenIdle(id),
    getGoal: (id) => harness.getGoal(id), createGoal: (id, objective, cap) => harness.createGoal(id, objective, cap),
    editGoal: (id, ref, objective, cap) => harness.editGoal(id, ref, objective, cap),
    pauseGoal: (id, ref) => harness.pauseGoal(id, ref), resumeGoal: (id, ref) => harness.resumeGoal(id, ref),
    clearGoal: (id, ref) => harness.clearGoal(id, ref), sessionEvents: (id) => harness.sessionEvents(id),
    cancel: (id) => harness.cancel(id),
  } })
  const info = await host.start()
  const rpc = async (method: string, params: Record<string, unknown> = {}) => fetch(`${info.origin}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }) }).then(r => r.json()) as Promise<any>
  expect(await rpc('project.create', { id: projectId, name: 'Goal audit' })).toMatchObject({ ok: true })
  expect(await rpc('agent.run', { projectId, sessionId, prompt: 'Initialize' })).toMatchObject({ ok: true })
  return rpc
}

// Exercise the real mobile harness through the host, including idle Goal admission.
it('publishes and persists automatic rounds after creating an idle goal', async () => {
  const rpc = await setup()
  expect(await rpc('agent.goal.create', { projectId, sessionId, objective: 'Exercise three rounds', maxGoalRounds: 3 })).toMatchObject({ ok: true })
  await vi.waitFor(() => expect(harness.getGoal(sessionId)).toMatchObject({ phase: 'blocked', roundsStarted: 3 }))
  await vi.waitFor(async () => expect((await rpc('session.read', { projectId, sessionId })).result.state).toBe('completed'))
  const durable = (await rpc('session.read', { projectId, sessionId })).result.events
  const live = (await rpc('host.snapshot', { afterSequence: 0 })).result.events
  const actual = {
    memoryRounds: harness.getGoal(sessionId)!.roundsStarted,
    persistedRounds: durable.filter((event: any) => event.type === 'user/message' && event.data.source?.kind === 'goal' && event.data.source.round > 0).length,
    publishedRoundEnds: live.filter((event: any) => event.name === 'agent.state' && event.data.state === 'turn/end').length - 1,
    persistedPhase: durable.findLast((event: any) => event.type === 'goal/change')?.data.goal?.phase,
  }
  expect(actual).toEqual({ memoryRounds: 3, persistedRounds: 3, publishedRoundEnds: 3, persistedPhase: 'blocked' })
})

it('validates Goal RPC inputs and project/session scope before mutation', async () => {
  const rpc = await setup()
  for (const params of [{ objective: '' }, { objective: 'ok', maxGoalRounds: 0 }, { objective: 'ok', maxGoalRounds: 10001 }, { objective: 'ok', maxGoalRounds: 1.5 }]) {
    expect(await rpc('agent.goal.create', { projectId, sessionId, ...params })).toHaveProperty('error')
  }
  expect(harness.getGoal(sessionId)).toBeUndefined()
  expect(await rpc('agent.goal.get', { projectId: 'other', sessionId })).toHaveProperty('error')
  expect(await rpc('agent.goal.create', { projectId, sessionId: 'unloaded', objective: 'Audit' })).toHaveProperty('error')
})

it('keeps automatic goal work cancellable and prevents deleting its project', async () => {
  const rpc = await setup()
  await rpc('agent.goal.create', { projectId, sessionId, objective: 'Exercise running ownership', maxGoalRounds: 20 })
  await vi.waitFor(() => expect(harness.getGoal(sessionId)?.roundsStarted).toBeGreaterThan(0))
  expect(await rpc('project.delete', { projectId })).toHaveProperty('error')
  let release!: () => void
  const draining = new Promise<void>((resolve) => { release = resolve })
  let entered!: () => void
  const cancelling = new Promise<void>((resolve) => { entered = resolve })
  const cancelHarness = harness.cancel.bind(harness)
  vi.spyOn(harness, 'cancel').mockImplementation(async (id) => { entered(); await draining; return cancelHarness(id) })
  const cancellation = rpc('agent.cancel', { projectId, sessionId })
  await cancelling
  expect(await rpc('project.delete', { projectId })).toHaveProperty('error')
  release()
  expect(await cancellation).toMatchObject({ result: { outcome: 'accepted' } })
  expect(await rpc('project.delete', { projectId })).toMatchObject({ result: { deleted: true } })
})

it('suspends automatic Goal work and checkpoints it without stopping Node', async () => {
  const rpc = await setup()
  await rpc('agent.goal.create', { projectId, sessionId, objective: 'Continue until suspended', maxGoalRounds: 20 })
  await vi.waitFor(() => expect(harness.getGoal(sessionId)?.roundsStarted).toBeGreaterThan(0))
  expect(await rpc('host.suspend')).toMatchObject({ result: { suspended: true } })
  expect(await rpc('host.suspend')).toMatchObject({ result: { suspended: true } })
  const goal = harness.getGoal(sessionId)!
  expect(goal.activation).toBe('disarmed')
  const rounds = goal.roundsStarted
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(harness.getGoal(sessionId)?.roundsStarted).toBe(rounds)
  expect(await rpc('session.read', { projectId, sessionId })).toMatchObject({ result: { state: 'aborted' } })
  expect(await rpc('host.snapshot')).toMatchObject({ result: { snapshot: { state: 'running' } } })
})
