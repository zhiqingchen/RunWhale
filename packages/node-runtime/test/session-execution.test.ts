import { afterEach, expect, it, vi } from 'vitest'
import { AgentSessionExecution } from '../src/session-execution.js'

afterEach(() => { vi.useRealTimers() })

it('checkpoints durable events once during token streaming and still flushes explicit state changes', async () => {
  vi.useFakeTimers()
  const write = vi.fn(async () => {})
  const publish = vi.fn()
  const execution = new AgentSessionExecution('project', 'session', {
    agent: { run: async () => ({ text: '' }) },
    acquireProject: async () => () => {},
    write, publish,
  })
  execution.begin('task')
  execution.initialize({ projectId: 'project', sessionId: 'session', title: 'Streaming', updatedAt: 0, state: 'running', events: [] })
  execution.phase = 'driving'
  const started = { type: 'turn/start', seq: 0, data: { turn: 1 } }
  execution.acceptEvent(started)

  for (let index = 0; index < 60; index++) {
    const chunk = { type: 'assistant/chunk', seq: 1, data: { chunk: { type: 'text-delta', index: 0, text: 'delta' } } }
    execution.acceptEvent(chunk)
    expect(publish).toHaveBeenLastCalledWith('task', chunk, 0)
    await vi.advanceTimersByTimeAsync(100)
  }
  expect(publish).toHaveBeenCalledTimes(61)
  expect(write).toHaveBeenCalledTimes(1)
  expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'running', events: [started] }))

  // Background and terminal state changes must flush even with no new events.
  await execution.persist('paused')
  expect(write).toHaveBeenCalledTimes(2)
  expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'paused', events: [started] }))
  const ended = { type: 'turn/end', seq: 1, data: { turn: 1, reason: { kind: 'completed' } } }
  execution.acceptEvent(ended)
  await execution.persist('completed')
  execution.finish()
  await vi.advanceTimersByTimeAsync(1_000)
  expect(write).toHaveBeenCalledTimes(3)
  expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'completed', events: [started, ended] }))
  await execution.dispose()
})
