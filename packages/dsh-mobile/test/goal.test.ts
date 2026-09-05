import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { createMobileHarness, MobileHarness } from '../src/index.js'

const harnesses: MobileHarness[] = []
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.dispose()))
})

async function setup() {
  const harness = await createMobileHarness({
    mode: 'deterministic',
    deterministicReply: 'Audit response.',
    secrets: { get: async () => undefined, set: async () => {}, delete: async () => {} },
  })
  harnesses.push(harness)
  await harness.run({ sessionId: 'goal-audit', prompt: 'Initialize the audit session' })
  return harness
}

class GoalToolAdapter extends LlmAdapter {
  private call = 0
  constructor(private readonly next: () => { name: string; args: Record<string, unknown> } | undefined) { super() }
  async *stream(): AsyncIterable<StreamChunk> {
    const tool = this.next()
    if (tool) {
      const id = ToolCallId(`goal-audit-${++this.call}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: tool.name, argumentsDelta: JSON.stringify(tool.args) }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: tool.name, arguments: JSON.stringify(tool.args) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Audit round finished.' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Audit round finished.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

describe('Mobile Goal lifecycle with the real continuation driver', () => {
  it('requires a loaded session and rejects empty objectives and invalid caps', async () => {
    const harness = await setup()
    expect(() => harness.getGoal('missing')).toThrow()
    expect(() => harness.createGoal('missing', 'Audit')).toThrow()
    for (const objective of ['', ' \n\t ']) expect(() => harness.createGoal('goal-audit', objective)).toThrow()
    for (const cap of [0, -1, 1.5, NaN, Infinity]) expect(() => harness.createGoal('goal-audit', 'Audit', cap)).toThrow()
    expect(harness.getGoal('goal-audit')).toBeUndefined()
  })

  it('uses the mobile default cap and supports edit, pause, resume, and clear', async () => {
    const harness = await setup()
    const created = harness.createGoal('goal-audit', '  Verify the goal  ')
    expect(created).toMatchObject({ objective: 'Verify the goal', maxGoalRounds: 64, phase: 'active', activation: 'armed', roundsStarted: 0 })
    const edited = harness.editGoal('goal-audit', created, 'Verify the full lifecycle', 5)
    const paused = harness.pauseGoal('goal-audit', edited)
    expect(paused).toMatchObject({ objective: 'Verify the full lifecycle', maxGoalRounds: 5, phase: 'paused', activation: 'disarmed', revision: created.revision + 2 })
    const resumed = harness.resumeGoal('goal-audit', paused)
    expect(resumed).toMatchObject({ phase: 'active', activation: 'armed' })
    harness.clearGoal('goal-audit', resumed)
    expect(harness.getGoal('goal-audit')).toBeUndefined()
    expect(harness.sessionEvents('goal-audit').filter((event) => event.type === 'goal/change').map((event) => event.data.operation)).toEqual(['create', 'edit', 'pause', 'resume', 'clear'])
  })

  it('rejects duplicate goals and stale mutations without changing durable state', async () => {
    const harness = await setup()
    const created = harness.createGoal('goal-audit', 'Original')
    const paused = harness.pauseGoal('goal-audit', created)
    const eventCount = harness.sessionEvents('goal-audit').length
    expect(() => harness.createGoal('goal-audit', 'Replacement')).toThrow()
    expect(() => harness.editGoal('goal-audit', created, 'Stale edit')).toThrow()
    expect(() => harness.pauseGoal('goal-audit', created)).toThrow()
    expect(() => harness.resumeGoal('goal-audit', created)).toThrow()
    expect(() => harness.clearGoal('goal-audit', created)).toThrow()
    expect(harness.getGoal('goal-audit')).toEqual(paused)
    expect(harness.sessionEvents('goal-audit')).toHaveLength(eventCount)
  })

  it('continues automatically, stops exactly at the round cap, and requires more capacity to resume', async () => {
    const harness = await setup()
    harness.createGoal('goal-audit', 'Exercise three automatic rounds', 3)
    await vi.waitFor(() => expect(harness.getGoal('goal-audit')).toMatchObject({ phase: 'blocked', activation: 'disarmed', roundsStarted: 3, blockedReason: { code: 'round-limit' } }))
    const capped = harness.getGoal('goal-audit')!
    expect(() => harness.resumeGoal('goal-audit', capped)).toThrow()
    const rounds = harness.sessionEvents('goal-audit').filter((event) => event.type === 'user/message' && event.data.source.kind === 'goal' && event.data.source.round > 0)
    expect(rounds.map((event) => event.type === 'user/message' && event.data.source.kind === 'goal' ? event.data.source.round : undefined)).toEqual([1, 2, 3])
    const extended = harness.editGoal('goal-audit', capped, undefined, 4)
    harness.resumeGoal('goal-audit', extended)
    await vi.waitFor(() => expect(harness.getGoal('goal-audit')).toMatchObject({ phase: 'blocked', roundsStarted: 4 }))
  })

  it('completes an automatic round and allows a new goal with a new identity', async () => {
    const harness = await setup()
    const agent = harness.context.agents.get(SessionId('goal-audit'))!
    const unsubscribe = harness.context.on('session/event', (session, event) => {
      if (session.id !== SessionId('goal-audit') || event.type !== 'user/message' || event.data.source.kind !== 'goal' || event.data.source.round !== 1) return
      queueMicrotask(() => {
        const current = harness.context.goals.get(agent)!
        harness.context.goals.complete(agent, current)
      })
    })
    const created = harness.createGoal('goal-audit', 'Complete after the first admitted round', 4)
    await vi.waitFor(() => expect(harness.getGoal('goal-audit')).toMatchObject({ phase: 'complete', roundsStarted: 1, activation: 'disarmed' }))
    unsubscribe()
    const replacement = harness.createGoal('goal-audit', 'Second goal', 2)
    expect(replacement.id).not.toBe(created.id)
    expect(replacement.roundsStarted).toBe(0)
    harness.clearGoal('goal-audit', replacement)
  })

  it('preserves a blocker through editing and removes it only when resumed', async () => {
    const harness = await setup()
    const created = harness.createGoal('goal-audit', 'Need an owner fact', 4)
    const agent = harness.context.agents.get(SessionId('goal-audit'))!
    const current = harness.context.goals.get(agent)!
    harness.context.goals.block(agent, current, { code: 'owner-fact', message: 'Owner fact is unavailable.' })
    const blocked = harness.getGoal('goal-audit')!
    const edited = harness.editGoal('goal-audit', blocked, 'Clarified objective')
    expect(edited).toMatchObject({ id: created.id, phase: 'blocked', blockedReason: { code: 'owner-fact' } })
    const resumed = harness.resumeGoal('goal-audit', edited)
    expect(resumed.blockedReason).toBeUndefined()
    harness.clearGoal('goal-audit', resumed)
  })

  it('rehydrates an active goal after restart without silently rearming it', async () => {
    const first = await setup()
    const created = first.createGoal('goal-audit', 'Survive restart', 4)
    first.context.goals.disarm(first.context.agents.get(SessionId('goal-audit'))!)
    const seed = JSON.parse(JSON.stringify(first.sessionEvents('goal-audit')))
    await first.dispose()
    harnesses.splice(harnesses.indexOf(first), 1)
    const restarted = await setup()
    await restarted.run({ sessionId: 'restored-goal', prompt: 'Read the restored state', seed: seed })
    const restored = restarted.getGoal('restored-goal')!
    expect(restored).toMatchObject({ id: created.id, phase: 'active', activation: 'disarmed', roundsStarted: 0, objective: 'Survive restart' })
    const resumed = restarted.resumeGoal('restored-goal', restored)
    expect(resumed.activation).toBe('armed')
    restarted.clearGoal('restored-goal', resumed)
  })

  it('isolates goal state and compare-and-set references between sessions', async () => {
    const harness = await setup()
    await harness.run({ sessionId: 'other-audit', prompt: 'Initialize another session' })
    const created = harness.createGoal('goal-audit', 'First session')
    const paused = harness.pauseGoal('goal-audit', created)
    expect(harness.getGoal('other-audit')).toBeUndefined()
    expect(() => harness.clearGoal('other-audit', paused)).toThrow()
    expect(harness.getGoal('goal-audit')).toEqual(paused)
  })

  it('creates, reads, and completes a goal through actual model tool calls', async () => {
    const base = await setup()
    let step = 0
    const harness = new MobileHarness(base.context, 'goal-tool-audit', 'audit', new Map(), () => 'review')
    base.context.llm.registerAdapter(['goal-tool-audit'], new GoalToolAdapter(() => {
      step += 1
      if (step === 1) return { name: 'create_goal', args: { objective: 'Verify goal tools', max_goal_rounds: 3 } }
      if (step === 3) return { name: 'get_goal', args: {} }
      if (step === 4) {
        const goal = harness.getGoal('goal-tools')!
        return { name: 'update_goal', args: { goal_id: goal.id, revision: goal.revision, action: 'complete' } }
      }
    }))
    await harness.run({ sessionId: 'goal-tools', prompt: 'Create a goal to verify goal tools, with at most three rounds.' })
    await vi.waitFor(() => expect(harness.getGoal('goal-tools')).toMatchObject({ phase: 'complete', roundsStarted: 1, activation: 'disarmed' }))
    expect(harness.sessionEvents('goal-tools').filter((event) => event.type === 'tool/call').map((event) => event.data.name)).toEqual(['create_goal', 'get_goal', 'update_goal'])
  })

  it('rejects model-reported blocking before three automatic rounds', async () => {
    const base = await setup()
    const harness = new MobileHarness(base.context, 'goal-block-audit', 'audit', new Map(), () => 'review')
    const attempted = new Set<number>()
    let readRound: number | undefined
    base.context.llm.registerAdapter(['goal-block-audit'], new GoalToolAdapter(() => {
      const goal = harness.getGoal('goal-block-tools')
      if (!goal) return { name: 'create_goal', args: { objective: 'Wait for the owner fact', max_goal_rounds: 4 } }
      if (goal.phase !== 'active' || goal.roundsStarted === 0 || attempted.has(goal.roundsStarted)) return
      if (readRound !== goal.roundsStarted) {
        readRound = goal.roundsStarted
        return { name: 'get_goal', args: {} }
      }
      attempted.add(goal.roundsStarted)
      return { name: 'update_goal', args: { goal_id: goal.id, revision: goal.revision, action: 'blocked', blocked_reason: 'The same owner fact is still unavailable.' } }
    }))
    await harness.run({ sessionId: 'goal-block-tools', prompt: 'Create a goal to wait for the owner fact, with at most four rounds.' })
    await vi.waitFor(() => expect(harness.getGoal('goal-block-tools')).toMatchObject({ phase: 'blocked', roundsStarted: 3, blockedReason: { code: 'model-reported' } }))
    expect([...attempted]).toEqual([1, 2, 3])
    const results = harness.sessionEvents('goal-block-tools').filter((event) => event.type === 'tool/result')
    expect(results.filter((event) => JSON.stringify(event.data).includes('GOAL_TOOL_BLOCK_THRESHOLD'))).toHaveLength(2)
  })

  it.each(['cancel', 'pause', 'clear'] as const)('stops future automatic rounds after %s during an active request', async (action) => {
    const base = await setup()
    let started!: () => void
    const requestStarted = new Promise<void>((resolve) => { started = resolve })
    class WaitingAdapter extends LlmAdapter {
      async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        started()
        yield { type: 'block-start', index: 0, blockType: 'text' }
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(options.signal?.reason ?? new Error('Stopped'))
          if (options.signal?.aborted) abort()
          else options.signal?.addEventListener('abort', abort, { once: true })
        })
      }
    }
    base.context.llm.registerAdapter(['goal-stop-audit'], new WaitingAdapter())
    const harness = new MobileHarness(base.context, 'goal-stop-audit', 'audit', new Map(), () => 'review')
    const agent = base.context.agentLoop.create(SessionId('goal-stop'), { provider: 'goal-stop-audit', model: 'audit' })
    harness.createGoal('goal-stop', 'Exercise stop during a goal round', 3)
    await requestStarted
    const current = harness.getGoal('goal-stop')!
    expect(current.roundsStarted).toBe(1)
    if (action === 'pause') harness.pauseGoal('goal-stop', current)
    if (action === 'clear') harness.clearGoal('goal-stop', current)
    expect(await harness.cancel('goal-stop')).toMatchObject({ cancelled: true })
    expect(agent.status).toBe('idle')
    if (action === 'clear') expect(harness.getGoal('goal-stop')).toBeUndefined()
    else expect(harness.getGoal('goal-stop')).toMatchObject({ phase: 'paused', activation: 'disarmed', roundsStarted: 1 })
    expect(harness.pendingMessages('goal-stop')).toEqual([])
  })
})
