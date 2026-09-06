import { describe, expect, it } from 'vitest'
import type { HostEvent } from '@runwhale/mobile-protocol'
import { liveAgentMessageIds, projectTranscriptUserMessages, queuedMessagesAwaitingConsumption, reconcileSubmittedTranscriptPrompt, transcriptUserMessageId, unresolvedTranscriptPrompt } from '../src/utils/transcript-user'

function message(text: string, source: Record<string, unknown>) {
  return { content: [{ type: 'text', text }], source }
}

describe('User transcript projection', () => {
  it('gives repeated human prompts distinct identities while excluding injected and replacement messages', () => {
    const messages = projectTranscriptUserMessages([
      { type: 'user/message', seq: 1, data: message('same prompt', { kind: 'user' }) },
      { type: 'user/message', seq: 2, data: message('injected', { kind: 'plugin', plugin: 'runtime' }) },
      { type: 'user/message', seq: 3, data: message('same prompt', { kind: 'user' }) },
      { type: 'user/message', seq: 4, data: message('replacement', { kind: 'user' }), surfaceOp: { op: 'replace', start: 1, end: 2 } },
    ])

    expect(messages).toEqual([
      { id: transcriptUserMessageId(1), text: 'same prompt' },
      { id: transcriptUserMessageId(2), text: 'same prompt' },
    ])
  })

  it('keeps an optimistic prompt until the durable row with the same identity arrives', () => {
    const pending = { id: transcriptUserMessageId(1), text: 'first prompt' }
    const durable = projectTranscriptUserMessages([
      { type: 'user/message', seq: 1, data: message('first prompt', { kind: 'user' }) },
    ])

    expect(unresolvedTranscriptPrompt([], pending)).toBe(pending)
    expect(durable[0]?.id).toBe(pending.id)
    expect(unresolvedTranscriptPrompt(durable, pending)).toBeUndefined()
  })

  it('does not resolve a repeated prompt against an older row with the same text', () => {
    const durable = projectTranscriptUserMessages([
      { type: 'user/message', seq: 1, data: message('same prompt', { kind: 'user' }) },
    ])
    const pending = { id: transcriptUserMessageId(2), text: 'same prompt' }

    expect(unresolvedTranscriptPrompt(durable, pending)).toBe(pending)
  })

  it('scopes consumed message IDs and keeps a claimed row hidden if its RPC response arrives later', () => {
    const event = (sequence: number, sessionId: string, taskId: string, messageId: string): HostEvent => ({
      v: 1,
      type: 'event',
      sequence,
      timestamp: sequence,
      name: 'agent.message',
      data: { projectId: 'project', sessionId, taskId, messageId },
    })
    const ids = liveAgentMessageIds([
      event(1, 'session', 'task', 'consumed'),
      event(2, 'other-session', 'task', 'other-session'),
      event(3, 'session', 'resumed-task', 'consumed-after-resume'),
      { ...event(4, 'session', 'task', 'other-project'), data: { projectId: 'other-project', sessionId: 'session', messageId: 'other-project' } },
    ], { projectId: 'project', sessionId: 'session' })
    const queued = [{ messageId: 'pending' }, { messageId: 'consumed' }, { messageId: 'consumed-after-resume' }]

    expect([...ids]).toEqual(['consumed', 'consumed-after-resume'])
    expect(queuedMessagesAwaitingConsumption(queued, ids)).toEqual([{ messageId: 'pending' }])
  })

  it('reconciles a submitted prompt only with history from its own session', () => {
    const pending = { sessionId: 'session-a', id: transcriptUserMessageId(1), revision: 1, text: 'first prompt' }
    const durable = [{ id: transcriptUserMessageId(1), text: 'first prompt' }]

    expect(reconcileSubmittedTranscriptPrompt(pending, {
      sessionId: 'session-b',
      messages: durable,
      state: 'completed',
      settleRevision: 1,
    })).toBe(pending)
    expect(reconcileSubmittedTranscriptPrompt(pending, {
      sessionId: 'session-a',
      messages: durable,
      state: 'running',
    })).toBeUndefined()
  })

  it('retains an unconfirmed running prompt and retires it after a confirmed terminal refresh', () => {
    const pending = { sessionId: 'session-a', id: transcriptUserMessageId(1), revision: 2, text: 'first prompt' }

    expect(reconcileSubmittedTranscriptPrompt(pending, {
      sessionId: 'session-a',
      messages: [],
      state: 'running',
      settleRevision: 2,
    })).toBe(pending)
    expect(reconcileSubmittedTranscriptPrompt(pending, {
      sessionId: 'session-a',
      messages: [],
      state: 'failed',
      settleRevision: 1,
    })).toBe(pending)
    expect(reconcileSubmittedTranscriptPrompt(pending, {
      sessionId: 'session-a',
      messages: [],
      state: 'failed',
      settleRevision: 2,
    })).toBeUndefined()
  })
})
