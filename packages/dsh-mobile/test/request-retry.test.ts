import { afterEach, expect, it, vi } from 'vitest'
import { createMobileHarness, type MobileHarness } from '../src/index.js'

const IDLE_MS = 90_000
let harness: MobileHarness | undefined
let currentRun: ReturnType<MobileHarness['run']> | undefined
let sessionId: string
const releaseStalled: Array<() => void> = []

afterEach(async () => {
  for (const release of releaseStalled.splice(0)) release()
  if (harness && currentRun) {
    await harness.cancel(sessionId)
    await currentRun
  }
  await harness?.dispose()
  harness = undefined
  currentRun = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it.each([
  { afterRetry: false, stage: 'headers' }, { afterRetry: false, stage: 'body' },
  { afterRetry: true, stage: 'headers' }, { afterRetry: true, stage: 'body' },
])('settles an unresponsive $stage transport even if it ignores abort (after retry: $afterRetry)', async ({ afterRetry, stage }) => {
  const agent = await createHarness()
  const signals: AbortSignal[] = []
  const request = vi.fn(async (_url: unknown, init: RequestInit) => {
    signals.push(init.signal!)
    if (afterRetry && signals.length === 1) return new Response('{"error":{"message":"Service unavailable"}}', { status: 503 })
    if (stage === 'headers') return new Promise<Response>((_resolve, reject) => {
      releaseStalled.push(() => reject(new Error('Fixture released')))
    })
    // A wedged transport can leave the read pending even after cancellation.
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(sse({ content: 'Writing the game.' }))
      releaseStalled.push(() => controller.error(new Error('Fixture released')))
    } }), { headers: { 'Content-Type': 'text/event-stream' } })
  })
  vi.stubGlobal('fetch', request)
  sessionId = `unresponsive-${afterRetry}`
  let settled = false
  currentRun = agent.run({ sessionId, prompt: 'Create a game' }).then(result => { settled = true; return result })
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
  await vi.advanceTimersByTimeAsync(3 * IDLE_MS + 10_000)
  expect(signals.at(-1)?.aborted).toBe(true)
  expect(settled).toBe(true)
  expect((await currentRun).failure?.code).toBe('TIMEOUT')
})

it.each([false, true])('stops a wedged read, accepts a new turn, and ignores late output (after retry: %s)', async afterRetry => {
  const agent = await createHarness()
  const signals: AbortSignal[] = []
  const request = vi.fn(async (_url: unknown, init: RequestInit) => {
    signals.push(init.signal!)
    if (afterRetry && signals.length === 1) return new Response('{"error":{"message":"Service unavailable"}}', { status: 503 })
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(sse({ content: 'Writing the game.' }))
      releaseStalled.push(() => {
        controller.enqueue(sse({ content: 'LATE OUTPUT' }))
        controller.close()
      })
    } }), { headers: { 'Content-Type': 'text/event-stream' } })
  })
  vi.stubGlobal('fetch', request)
  sessionId = `stop-wedged-${afterRetry}`
  currentRun = agent.run({ sessionId, prompt: 'Create a game' })
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
  await vi.advanceTimersByTimeAsync(1_000)
  let cancelled = false
  const stop = agent.cancel(sessionId).then(result => { cancelled = result.cancelled })
  await vi.advanceTimersByTimeAsync(0)
  expect(cancelled).toBe(true)
  await stop
  expect((await currentRun).events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
  expect(signals.at(-1)?.aborted).toBe(true)

  request.mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(sse({ content: 'Recovered.' }))
    controller.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'))
    controller.close()
  } }), { headers: { 'Content-Type': 'text/event-stream' } }))
  currentRun = agent.run({ sessionId, prompt: 'Continue' })
  for (const release of releaseStalled.splice(0)) release()
  const recovered = await currentRun
  expect(recovered.failure).toBeUndefined()
  expect(recovered.text).toBe('Recovered.')
  expect(JSON.stringify(recovered.events)).not.toContain('LATE OUTPUT')
  expect(recovered.events.filter(event => event.type === 'turn/end')).toHaveLength(2)
})

async function createHarness() {
  harness = await createMobileHarness({
    mode: 'deepseek', provider: 'deepseek', model: 'deepseek-v4-flash',
    secrets: { get: async () => 'fixture', set: async () => {}, delete: async () => {} },
    modelProfile: { baseURL: 'https://provider.invalid/v1', models: [{ id: 'deepseek-v4-flash' }] },
  })
  vi.useFakeTimers()
  return harness
}

function sse(delta: Record<string, unknown>) {
  return new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
}

it.each(['headers', 'body'] as const)('bounds a stalled retry while waiting for %s and settles the turn', async stage => {
  const agent = await createHarness()
  const signals: AbortSignal[] = []
  const request = vi.fn(async (_url: unknown, init: RequestInit) => {
    const signal = init.signal!
    signals.push(signal)
    if (signals.length === 1) return new Response('{"error":{"message":"Service unavailable"}}', { status: 503 })
    if (stage === 'headers') return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(sse({ content: 'Writing the game.' }))
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } })
  })
  vi.stubGlobal('fetch', request)
  sessionId = `retry-${stage}`
  const run = currentRun = agent.run({ sessionId, prompt: 'Create a game' })
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  await vi.advanceTimersByTimeAsync(1_000)
  expect(request).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(IDLE_MS + 2_000)
  expect(signals[1]?.aborted).toBe(true)
  expect(request).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(IDLE_MS + 2_000)
  const result = await run
  expect(request).toHaveBeenCalledTimes(3)
  expect(signals[2]?.aborted).toBe(true)
  expect(result.failure?.code).toBe('TIMEOUT')
  expect(result.events.filter(event => event.type === 'llm/retry')).toHaveLength(2)
  expect(result.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
  expect(result.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'error' } } })
})

it('keeps a long response alive while tool arguments continue arriving, and stops promptly on cancellation', async () => {
  const agent = await createHarness()
  let body!: ReadableStreamDefaultController<Uint8Array>
  let signal!: AbortSignal
  const request = vi.fn(async (_url: unknown, init: RequestInit) => {
    signal = init.signal!
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller
        controller.enqueue(sse({ content: 'Writing the game.' }))
        controller.enqueue(sse({ tool_calls: [{ index: 0, id: 'write-game', type: 'function', function: { name: 'write_file', arguments: '{"path":"index.tsx","content":"' } }] }))
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } })
  })
  vi.stubGlobal('fetch', request)
  sessionId = 'active-stream'
  const run = currentRun = agent.run({ sessionId, prompt: 'Create a game' })
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
  for (let index = 0; index < 4; index++) {
    await vi.advanceTimersByTimeAsync(60_000)
    body.enqueue(sse({ tool_calls: [{ index: 0, function: { arguments: 'more code' } }] }))
    await vi.advanceTimersByTimeAsync(0)
    expect(signal.aborted).toBe(false)
  }
  expect(await agent.cancel('active-stream')).toMatchObject({ cancelled: true })
  const result = await run
  expect(signal.aborted).toBe(true)
  expect(request).toHaveBeenCalledOnce()
  expect(result.events.some(event => event.type === 'llm/retry')).toBe(false)
  expect(result.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
})

it('cancels retry backoff without starting another request', async () => {
  const agent = await createHarness()
  const request = vi.fn(async () => new Response('{"error":{"message":"Service unavailable"}}', { status: 503 }))
  vi.stubGlobal('fetch', request)
  sessionId = 'cancel-retry'
  let retryScheduled = false
  const run = currentRun = agent.run({ sessionId, prompt: 'Create a game', onEvent(event) {
    if (event.type === 'llm/retry') retryScheduled = true
  } })
  await vi.waitFor(() => expect(retryScheduled).toBe(true))
  expect(await agent.cancel(sessionId)).toMatchObject({ cancelled: true })
  const result = await run
  await vi.advanceTimersByTimeAsync(IDLE_MS)
  expect(request).toHaveBeenCalledOnce()
  expect(result.events.some(event => event.type === 'llm/retry-started')).toBe(false)
  expect(result.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
})
