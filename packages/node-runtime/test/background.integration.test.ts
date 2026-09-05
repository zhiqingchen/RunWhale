import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createMobileHarness, MobileHarness } from '@runwhale/dsh-mobile'
import { createSessionAgentDriver } from '../src/session-agent-driver.js'
import { RunWhaleRuntimeHost } from '../src/runtime-host.js'

type Adapter = Parameters<MobileHarness['context']['llm']['registerAdapter']>[1]
const { LlmAdapter } = await import(createRequire(new URL('../../dsh-mobile/package.json', import.meta.url)).resolve('@deepseek-ai/dsh-llm')) as { LlmAdapter: new () => Adapter }
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function setup(platform: 'ios' | 'android' = 'ios', initialization?: Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'runwhale-background-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  let requests = 0
  const releases: Array<() => void> = []
  const secrets = { get: async () => undefined, set: async () => {}, delete: async () => {} }
  class SlowAdapter extends LlmAdapter {
    async *stream(options: Parameters<Adapter['stream']>[0]): ReturnType<Adapter['stream']> {
      requests += 1
      await new Promise<void>((resolve) => {
        releases.push(resolve)
        if (options.signal?.aborted) resolve()
        else options.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Finished.' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Finished.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const createDriver = () => createSessionAgentDriver({
    secrets, deterministicReplay: true,
    harnessOptions: () => ({ mode: 'deterministic', secrets }),
    createHarness: async (options) => {
      await initialization
      const original = await createMobileHarness(options)
      original.context.llm.registerAdapter(['background-test'], new SlowAdapter())
      return new MobileHarness(original.context, 'background-test', 'test', new Map(), () => 'review')
    },
  })
  const driver = createDriver()
  let host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform, agent: driver })
  cleanup.push(() => host.stop())
  let info = await host.start()
  const rpc = async (method: string, params: object = {}) => {
    const response = await fetch(`${info.origin}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }) })
    const envelope = await response.json() as any
    if (!envelope.ok) throw new Error(JSON.stringify(envelope.error))
    return envelope.result
  }
  await rpc('project.create', { id: 'project', name: 'Background test' })
  const session = { projectId: 'project', sessionId: 'session' }
  const start = () => rpc('agent.run', { ...session, prompt: 'Do the work once' })
  const record = () => rpc('session.read', session)
  const restart = async () => {
    await host.stop()
    host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform, agent: createDriver() })
    info = await host.start()
  }
  const reconnect = async (revision: number) => {
    info = await host.reconnectTransport()
    await host.foreground(revision)
  }
  return { host, driver, rpc, session, start, record, root, restart, reconnect, requests: () => requests, release: () => releases.splice(0).forEach((release) => release()) }
}

it('continues a paused session exactly once after replacing the localhost listener', async () => {
  const test = await setup()
  const running = test.start()
  await vi.waitFor(() => expect(test.requests()).toBe(1))
  await test.rpc('host.background', { revision: 1, graceMs: 0 })
  await running
  expect((await test.record()).state).toBe('paused')
  await test.reconnect(2)
  await vi.waitFor(() => expect(test.requests()).toBe(2))
  await test.reconnect(3)
  expect(test.requests()).toBe(2)
  test.release()
  await vi.waitFor(async () => expect((await test.record()).state).toBe('completed'))
  const events = (await test.record()).events
  expect(events.filter((event: any) => event.type === 'user/message' && event.data.source?.kind === 'user')).toHaveLength(1)
  expect(events.filter((event: any) => event.type === 'user/message' && event.data.source?.plugin === 'runwhale-background')).toHaveLength(1)
})

it('finishes a short background switch without cancelling or starting another request', async () => {
  const test = await setup()
  const running = test.start()
  await vi.waitFor(() => expect(test.requests()).toBe(1))
  const background = test.rpc('host.background', { revision: 1, graceMs: 1000 })
  await test.rpc('host.foreground', { revision: 2 })
  expect(await background).toEqual({ suspended: false })
  expect(await test.rpc('host.background', { revision: 1, graceMs: 0 })).toEqual({ suspended: false })
  test.release()
  await running
  expect((await test.record()).state).toBe('completed')
  expect(test.requests()).toBe(1)
})

it('checkpoints, resumes once with context, and preserves the original user message', async () => {
  const test = await setup()
  const running = test.start()
  await vi.waitFor(() => expect(test.requests()).toBe(1))
  await test.rpc('host.background', { revision: 1, graceMs: 0 })
  await running
  expect((await test.record()).state).toBe('paused')
  const durable = JSON.parse(await readFile(join(test.root, 'projects/project/.runwhale/sessions/session.json'), 'utf8'))
  expect(durable.state).toBe('paused')
  expect(durable.events.findLast((event: any) => event.type === 'turn/end').data.reason).toMatchObject({ kind: 'aborted', reason: { kind: 'hook' } })
  await Promise.all([test.rpc('host.foreground', { revision: 2 }), test.rpc('host.foreground', { revision: 3 })])
  await vi.waitFor(() => expect(test.requests()).toBe(2))
  test.release()
  await vi.waitFor(async () => expect((await test.record()).state).toBe('completed'))
  const events = (await test.record()).events
  expect(events.filter((event: any) => event.type === 'user/message' && event.data.source?.kind === 'user')).toHaveLength(1)
  expect(events.filter((event: any) => event.type === 'user/message' && event.data.source?.plugin === 'runwhale-background')).toHaveLength(1)
})

it('preserves queued input at pause and lets a user stop prevent foreground resumption', async () => {
  const test = await setup()
  const running = test.start()
  await vi.waitFor(() => expect(test.requests()).toBe(1))
  await test.rpc('agent.message', { ...test.session, prompt: 'Then check the result', mode: 'followup' })
  await test.rpc('host.background', { revision: 1, graceMs: 0 })
  await running
  expect((await test.rpc('agent.message.list', test.session)).messages).toEqual([expect.objectContaining({ text: 'Then check the result' })])
  expect(await test.rpc('agent.cancel', test.session)).toMatchObject({ outcome: 'accepted', restoredMessages: [expect.objectContaining({ text: 'Then check the result' })] })
  await test.rpc('host.foreground', { revision: 2 })
  expect((await test.record()).state).toBe('aborted')
  expect(test.requests()).toBe(1)
})

it('keeps Android work running when an iOS lifecycle message arrives', async () => {
  const test = await setup('android')
  const running = test.start()
  await vi.waitFor(() => expect(test.requests()).toBe(1))
  expect(await test.rpc('host.background', { revision: 1, graceMs: 0 })).toEqual({ suspended: false })
  expect((await test.record()).state).toBe('running')
  test.release()
  await running
})

it('keeps a not-yet-admitted prompt through backgrounding during harness initialization', async () => {
  let initialized!: () => void
  const initialization = new Promise<void>((resolve) => { initialized = resolve })
  const test = await setup('ios', initialization)
  const pause = vi.spyOn(test.driver, 'pause')
  const running = test.start()
  await vi.waitFor(async () => expect((await test.record()).state).toBe('running'))
  const background = test.rpc('host.background', { revision: 1, graceMs: 0 })
  await vi.waitFor(() => expect(pause).toHaveBeenCalled())
  initialized()
  await background
  await running
  expect((await test.record()).state).toBe('paused')
  expect(test.requests()).toBe(0)
  await test.rpc('host.foreground', { revision: 2 })
  await vi.waitFor(() => expect(test.requests()).toBe(1))
  test.release()
  await vi.waitFor(async () => expect((await test.record()).state).toBe('completed'))
  expect((await test.record()).events.filter((event: any) => event.type === 'user/message' && event.data.source?.kind === 'user')).toHaveLength(1)
})

it('leaves a restarted paused session parked until explicit continuation', async () => {
  const test = await setup()
  const running = test.start()
  await vi.waitFor(() => expect(test.requests()).toBe(1))
  await test.rpc('host.background', { revision: 1, graceMs: 0 })
  await running
  await test.restart()
  await test.rpc('host.foreground', { revision: 2 })
  expect(test.requests()).toBe(1)
  expect((await test.record()).state).toBe('paused')
  const continuation = test.rpc('agent.resume', test.session)
  await vi.waitFor(() => expect(test.requests()).toBe(2))
  test.release()
  await continuation
  expect((await test.record()).state).toBe('completed')
})

it('resumes automatic Goal work without changing its objective or resetting its budget', async () => {
  const test = await setup()
  const initial = test.start()
  await vi.waitFor(() => expect(test.requests()).toBe(1))
  test.release()
  await initial
  await test.rpc('agent.goal.create', { ...test.session, objective: 'Complete the existing goal', maxGoalRounds: 3 })
  await vi.waitFor(() => expect(test.requests()).toBe(2))
  await test.rpc('host.background', { revision: 1, graceMs: 0 })
  expect((await test.record()).state).toBe('paused')
  await test.rpc('host.foreground', { revision: 2 })
  await vi.waitFor(() => expect(test.requests()).toBe(3))
  expect((await test.rpc('agent.goal.get', test.session)).goal).toMatchObject({ objective: 'Complete the existing goal', maxGoalRounds: 3, roundsStarted: 2, activation: 'armed' })
  await test.rpc('agent.cancel', test.session)
  expect((await test.record()).state).toBe('aborted')
})

it('honors a newer background transition while foreground recovery is still starting', async () => {
  const test = await setup()
  const running = test.start()
  await vi.waitFor(() => expect(test.requests()).toBe(1))
  await test.rpc('host.background', { revision: 1, graceMs: 0 })
  await running
  await Promise.all([
    test.rpc('host.foreground', { revision: 2 }),
    test.rpc('host.background', { revision: 3, graceMs: 0 }),
  ])
  expect((await test.record()).state).toBe('paused')
  await test.rpc('agent.cancel', test.session)
  const requests = test.requests()
  await test.rpc('host.foreground', { revision: 4 })
  expect((await test.record()).state).toBe('aborted')
  expect(test.requests()).toBe(requests)
})
