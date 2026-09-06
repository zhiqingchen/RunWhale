import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MOBILE_HOST_PROTOCOL_VERSION, type AgentSessionRecord, type HostEvent } from '@runwhale/mobile-protocol'
import { useAgentSession } from '../src/hooks/useAgentSession'
import type { AgentPanelProps } from '../src/hooks/agent-panel-types'
import type { AgentImageDraft } from '../src/utils/agent-image'
import { RuntimeTransportError } from '../src/utils/runtime-request'

const fixtures = vi.hoisted(() => ({
  request: vi.fn(),
  push: vi.fn(),
  clearDraft: vi.fn(),
  preferences: {
    busyMessageMode: 'followup', modelProvider: 'openai', model: 'test-model',
    modelProfiles: { openai: { models: [] }, deepseek: { models: [] } },
    agentPreset: 'standard', permissionMode: 'review', setModelProvider: vi.fn(),
  },
  info: {},
  t: (key: string) => key,
}))

vi.mock('@/components/icons', () => ({ Camera: 'Camera', File: 'File', Image: 'Image', ListPlus: 'ListPlus', Target: 'Target' }))
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: fixtures.t }) }))
vi.mock('@/state/preferences', () => ({
  usePreferences: () => fixtures.preferences,
  MOBILE_DEFAULT_MODELS: { openai: 'test-model', deepseek: 'another-model' },
}))
vi.mock('@/state/runtime', () => ({ useRuntime: () => ({ info: fixtures.info, request: fixtures.request }) }))
vi.mock('expo-router', () => ({ useRouter: () => ({ push: fixtures.push }) }))
vi.mock('react-native', () => ({ Keyboard: { dismiss: vi.fn() } }))
vi.mock('@/hooks/useAgentComposer', async () => {
  const { useState } = await import('react')
  return { useAgentComposer: () => {
    const [prompt, updatePrompt] = useState('')
    const [attachments, setAttachments] = useState<AgentImageDraft[]>([])
    return { prompt, updatePrompt, attachments, setAttachments,
      draftCoordinator: { clear: fixtures.clearDraft }, draftKey: 'draft', projectPaths: [] }
  } }
})

let session: ReturnType<typeof useAgentSession>
let tree: ReactTestRenderer | undefined
let record: AgentSessionRecord
let props: AgentPanelProps

function ObserveSession() {
  session = useAgentSession(props)
  return null
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fixtures.preferences.modelProvider = 'openai'
  fixtures.preferences.model = 'test-model'
  fixtures.push.mockClear()
  fixtures.info = {}
  fixtures.clearDraft.mockReset().mockResolvedValue(undefined)
  record = {
    projectId: 'project', sessionId: 'session', title: 'Game', updatedAt: 1, state: 'failed',
    failure: { code: 'AUTH', message: 'Authentication failed (401)' },
    events: [
      { type: 'turn/start', seq: 1, data: { turn: 1 } },
      { type: 'user/message', seq: 2, data: { message: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Make it more complex' }] } } },
      { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'error', error: { code: 'AUTH', message: 'Authentication failed (401)' } } } },
    ],
  }
  fixtures.request.mockReset().mockImplementation(async (method: string) => {
    if (method === 'session.read') return record
    if (method === 'agent.message.list') return { messages: [] }
    if (method === 'agent.goal.get') return {}
    if (method === 'credential.status') return { configured: true }
    throw new Error(`Unexpected request: ${method}`)
  })
  props = {
    projectId: 'project', initialSessionId: 'session', sessionSummaries: [],
    sessionSummariesRefreshing: false, sessionSummaryStatus: 'ready', events: [],
    onRun: vi.fn(async () => ({ sessionId: 'session', taskId: 'retry-task' })),
  }
})

afterEach(async () => {
  await act(async () => { tree?.unmount() })
  tree = undefined
  vi.unstubAllGlobals()
})

async function mountQueuedSession() {
  record = { ...record, state: 'running', taskId: 'original-task', failure: undefined }
  const request = fixtures.request.getMockImplementation()!
  fixtures.request.mockImplementation(async (method: string) => {
    if (method === 'agent.message.list') return { messages: [{ messageId: 'queued', text: 'Move the button up', mode: 'steer' }] }
    return request(method)
  })
  await act(async () => { tree = create(<ObserveSession />) })
  expect(session.visibleQueued).toHaveLength(1)
  await act(async () => {
    session.transitionQueueAction({ type: 'start', messageId: 'queued', action: 'delete' })
    session.setPendingDestructiveAction({ kind: 'delete-queued-message', messageId: 'queued' })
  })
}

it('retires a queue row and its delete dialog across background resume, even after live events expire', async () => {
  await mountQueuedSession()
  props = { ...props, events: [{
    v: 1, type: 'event', sequence: 1, timestamp: 1, name: 'agent.message',
    data: { projectId: 'project', sessionId: 'session', taskId: 'resumed-task', messageId: 'queued' },
  }] }
  await act(async () => { tree!.update(<ObserveSession />) })
  expect(session.visibleQueued).toEqual([])
  expect(session.pendingDestructiveAction).toBeUndefined()
  expect(session.queueActions).toEqual({})

  props = { ...props, events: [] }
  await act(async () => { tree!.update(<ObserveSession />) })
  expect(session.visibleQueued).toEqual([])
})

it('clears a stale queued row when deletion confirms it is already absent', async () => {
  await mountQueuedSession()
  fixtures.request.mockResolvedValueOnce({ deleted: false })
  await act(async () => { await session.confirmDestructiveAction() })
  expect(fixtures.request).toHaveBeenLastCalledWith('agent.message.delete', {
    projectId: 'project', sessionId: 'session', messageId: 'queued',
  })
  expect(session.visibleQueued).toEqual([])
  expect(session.pendingDestructiveAction).toBeUndefined()
  expect(session.destructiveActionError).toBeUndefined()
  expect(session.queueActions).toEqual({})
})

it('keeps a queued row and deletion retry available when the request fails', async () => {
  await mountQueuedSession()
  fixtures.request.mockRejectedValueOnce(new Error('Connection lost'))
  await act(async () => { await session.confirmDestructiveAction() })
  expect(session.visibleQueued).toHaveLength(1)
  expect(session.pendingDestructiveAction).toBeDefined()
  expect(session.destructiveActionBusy).toBe(false)
  expect(session.destructiveActionError).toBe('Connection lost')

  fixtures.request.mockResolvedValueOnce({ deleted: true })
  await act(async () => { await session.confirmDestructiveAction() })
  expect(session.visibleQueued).toEqual([])
  expect(session.pendingDestructiveAction).toBeUndefined()
})

it('retries a restored failed turn with the selected provider and releases the submission guard', async () => {
  await act(async () => { tree = create(<ObserveSession />) })
  expect(session.sessionRetryAvailable).toBe(true)
  expect(session.retryPending).toBe(false)
  expect(session.retryPrompt).toBe('Make it more complex')

  fixtures.preferences.modelProvider = 'deepseek'
  fixtures.preferences.model = 'another-model'
  await act(async () => { tree!.update(<ObserveSession />) })
  await act(async () => { await session.runPrompt(session.retryPrompt) })

  expect(fixtures.request).toHaveBeenCalledWith('credential.status', { provider: 'deepseek' })
  expect(props.onRun).toHaveBeenCalledWith(expect.objectContaining({
    sessionId: 'session', prompt: 'Make it more complex', provider: 'deepseek', model: 'another-model',
  }))
  expect(session.retryPending).toBe(false)
  await act(async () => { await session.runPrompt(session.retryPrompt) })
  expect(props.onRun).toHaveBeenCalledTimes(2)
})

it('keeps Retry available after another authentication failure and opens model settings directly', async () => {
  props.onRun = vi.fn(async () => { throw new Error('AUTH: Authentication failed (401)') })
  await act(async () => { tree = create(<ObserveSession />) })
  await act(async () => { await session.runPrompt(session.retryPrompt) })
  expect(session.recoveryMessage).toBe('AUTH: Authentication failed (401)')
  expect(session.retryPending).toBe(false)
  expect(session.sessionRetryAvailable).toBe(true)

  await act(async () => { session.openCredentialSettings() })
  expect(fixtures.push).toHaveBeenCalledWith('/settings/models')
  await act(async () => { await session.runPrompt(session.retryPrompt) })
  expect(props.onRun).toHaveBeenCalledTimes(2)
})

it('clears a lost run response after history confirms the task is running without resubmitting', async () => {
  record.taskId = 'previous-task'
  props.onRun = vi.fn(async () => {
    record = { ...record, taskId: 'current-task', state: 'running', failure: undefined }
    throw new RuntimeTransportError(new Error('The network connection was lost.'), 'agent.run')
  })
  await act(async () => { tree = create(<ObserveSession />) })
  await act(async () => { await session.runPrompt(session.retryPrompt) })
  expect(session.running).toBe(true)
  expect(session.error).toBeUndefined()
  expect(session.runConnectionIssue).toBeUndefined()
  expect(props.onRun).toHaveBeenCalledOnce()
})

it('retains an uncertain connection notice until the current attempt can be confirmed', async () => {
  record.taskId = 'previous-task'
  props.onRun = vi.fn(async () => {
    throw new RuntimeTransportError(new Error('The network connection was lost.'), 'agent.run')
  })
  await act(async () => { tree = create(<ObserveSession />) })
  await act(async () => { await session.runPrompt(session.retryPrompt) })
  expect(session.error).toBeUndefined()
  expect(session.runConnectionIssue).toBeDefined()
  record = { ...record, taskId: 'current-task', state: 'completed', failure: undefined }
  await act(async () => { await session.refreshSessionHistory() })
  expect(session.runConnectionIssue).toBeUndefined()
  expect(props.onRun).toHaveBeenCalledOnce()
})

it('restores authentication recovery when a dropped response is later confirmed as an authentication failure', async () => {
  record.taskId = 'previous-task'
  props.onRun = vi.fn(async () => {
    throw new RuntimeTransportError(new Error('The network connection was lost.'), 'agent.run')
  })
  await act(async () => { tree = create(<ObserveSession />) })
  await act(async () => { await session.runPrompt(session.retryPrompt) })
  expect(session.runConnectionIssue).toBeDefined()

  record = { ...record, taskId: 'current-task', state: 'failed', failure: { code: 'AUTH', message: 'The current credential was rejected.' } }
  await act(async () => { await session.refreshSessionHistory() })
  expect(session.runConnectionIssue).toBeUndefined()
  expect(session.recoveryMessage).toBe('AUTH: The current credential was rejected.')
  expect(session.sessionRetryAvailable).toBe(true)
  expect(session.retryPending).toBe(false)
  await act(async () => { session.openCredentialSettings() })
  expect(fixtures.push).toHaveBeenCalledWith('/settings/models')
  expect(props.onRun).toHaveBeenCalledOnce()
})

function lifecycle(sequence: number, state: string): HostEvent {
  return { v: MOBILE_HOST_PROTOCOL_VERSION, type: 'event', sequence, timestamp: sequence,
    name: 'agent.state', data: { projectId: 'project', sessionId: 'session', state } }
}

it('uses the current Interrupted snapshot instead of a historical Paused event', async () => {
  record.state = 'interrupted'
  props.events = [lifecycle(10, 'paused')]
  await act(async () => { tree = create(<ObserveSession />) })
  expect(session.recoveryState).toBe('interrupted')
  await act(async () => { await session.retrySession() })
  expect(props.onRun).toHaveBeenCalledWith(expect.objectContaining({ resume: false, prompt: 'Make it more complex' }))
})

it('rechecks Continue at tap time, retries the latest human message, and preserves the unsent draft', async () => {
  record.state = 'paused'
  await act(async () => { tree = create(<ObserveSession />) })
  const draftImage: AgentImageDraft = { sourcePath: '/cache/unsent.jpg', name: 'unsent.jpg', mediaType: 'image/jpeg' }
  await act(async () => {
    session.composer.updatePrompt('Unsent next request')
    session.composer.setAttachments([draftImage])
  })
  record = { ...record, state: 'interrupted', events: [...record.events,
    { type: 'user/message', data: { message: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Move the buttons up' }] } } },
    { type: 'user/message', data: { message: { source: { kind: 'hook' }, content: [{ type: 'text', text: 'Background recovery context' }] } } },
  ] }
  await act(async () => { await session.retrySession() })
  expect(props.onRun).toHaveBeenCalledWith(expect.objectContaining({ resume: false, prompt: 'Move the buttons up', attachments: [] }))
  expect(session.composer.prompt).toBe('Unsent next request')
  expect(session.composer.attachments).toEqual([draftImage])
  expect(fixtures.clearDraft).not.toHaveBeenCalled()
})

it('keeps recovery progress visible until a paused session actually starts and ignores repeated taps', async () => {
  record = { ...record, state: 'paused', taskId: 'previous' }
  let finish!: (result: { sessionId: string; taskId: string }) => void
  props.onRun = vi.fn(() => new Promise<{ sessionId: string; taskId: string }>(resolve => { finish = resolve }))
  await act(async () => { tree = create(<ObserveSession />) })
  let recovery!: Promise<void>
  await act(async () => { recovery = session.retrySession() })
  expect(session.retryPending).toBe(true)
  expect(session.sessionRetryAvailable).toBe(true)
  expect(props.onRun).toHaveBeenCalledWith(expect.objectContaining({ resume: true, prompt: '', attachments: [] }))
  await act(async () => { await session.retrySession() })
  expect(props.onRun).toHaveBeenCalledOnce()
  record = { ...record, state: 'running', taskId: 'current' }
  props.events = [lifecycle(1, 'running')]
  await act(async () => { tree!.update(<ObserveSession />) })
  expect(session.running).toBe(true)
  expect(session.sessionRetryAvailable).toBe(false)
  record = { ...record, state: 'completed' }
  await act(async () => { finish({ sessionId: 'session', taskId: 'current' }); await recovery })
  expect(session.retryPending).toBe(false)
})

it.each(['running', 'completed'] as const)('does not resend when fresh recovery status is %s', async state => {
  record.state = 'paused'
  await act(async () => { tree = create(<ObserveSession />) })
  record = { ...record, state }
  await act(async () => { await session.retrySession() })
  expect(props.onRun).not.toHaveBeenCalled()
  expect(session.retryPending).toBe(false)
  expect(session.sessionRetryAvailable).toBe(false)
  expect(session.running).toBe(state === 'running')
  expect(session.error).toBeUndefined()
})

it('shows a failed recovery check and allows another tap without discarding the transcript', async () => {
  record.state = 'paused'
  await act(async () => { tree = create(<ObserveSession />) })
  fixtures.request.mockRejectedValueOnce(new Error('Connection unavailable'))
  await act(async () => { await session.retrySession() })
  expect(session.recoveryMessage).toBe('Connection unavailable')
  expect(session.sessionRecord?.events).toEqual(record.events)
  expect(session.sessionRetryAvailable).toBe(true)
  expect(session.retryPending).toBe(false)
  expect(props.onRun).not.toHaveBeenCalled()
  await act(async () => { await session.retrySession() })
  expect(props.onRun).toHaveBeenCalledOnce()
})

it.each(['event', 'snapshot'] as const)('releases a suspended onRun on terminal %s evidence and ignores its late result', async evidence => {
  record = { ...record, state: 'paused', taskId: 'previous' }
  let finish!: (result: { sessionId: string; taskId: string }) => void
  props.onRun = vi.fn(() => new Promise<{ sessionId: string; taskId: string }>(resolve => { finish = resolve }))
  await act(async () => { tree = create(<ObserveSession />) })
  let recovery!: Promise<void>
  await act(async () => { recovery = session.retrySession() })
  record = { ...record, state: 'paused', taskId: 'current' }
  await act(async () => {
    if (evidence === 'event') {
      props.events = [lifecycle(1, 'paused')]
      tree!.update(<ObserveSession />)
    } else await session.refreshSessionHistory()
  })
  await act(async () => { await recovery })
  expect(session.retryPending).toBe(false)
  expect(session.sessionRetryAvailable).toBe(true)
  await act(async () => { finish({ sessionId: 'stale-session', taskId: 'current' }) })
  expect(session.sessionId).toBe('session')
  props.onRun = vi.fn(async () => ({ sessionId: 'session', taskId: 'next' }))
  await act(async () => { tree!.update(<ObserveSession />) })
  await act(async () => { await session.retrySession() })
  expect(props.onRun).toHaveBeenCalledOnce()
})

it('releases the first submission when a terminal snapshot arrives without lifecycle events', async () => {
  record = { ...record, state: 'idle', taskId: undefined, events: [], failure: undefined }
  let finish!: (result: { sessionId: string; taskId: string }) => void
  props.onRun = vi.fn(() => new Promise<{ sessionId: string; taskId: string }>(resolve => { finish = resolve }))
  await act(async () => { tree = create(<ObserveSession />) })
  let submission!: Promise<void>
  await act(async () => { submission = session.runPrompt('Create a game') })
  record = { ...record, state: 'completed', taskId: 'first-task' }
  await act(async () => { await session.refreshSessionHistory() })
  const pendingAfterSnapshot = session.retryPending
  // Settle the mock even on regression so the test leaves no pending submission.
  await act(async () => { finish({ sessionId: 'session', taskId: 'first-task' }); await submission })
  expect(pendingAfterSnapshot).toBe(false)
})

it('refreshes a remounted runtime snapshot even when its event sequence restarts', async () => {
  record.state = 'paused'
  props.events = [lifecycle(100, 'paused')]
  await act(async () => { tree = create(<ObserveSession />) })
  record = { ...record, state: 'interrupted' }
  fixtures.info = {}
  props.events = []
  await act(async () => { tree!.update(<ObserveSession />) })
  expect(session.recoveryState).toBe('interrupted')
  props.events = [lifecycle(1, 'running')]
  await act(async () => { tree!.update(<ObserveSession />) })
  expect(session.running).toBe(true)
})

it('uses the newer running snapshot when a recovery read finishes out of order', async () => {
  record.state = 'paused'
  await act(async () => { tree = create(<ObserveSession />) })
  let release!: () => void
  const pendingMessages = new Promise<{ messages: [] }>(resolve => { release = () => resolve({ messages: [] }) })
  const originalRequest = fixtures.request.getMockImplementation()!
  let delayList = true
  fixtures.request.mockImplementation((method: string) => {
    if (method === 'agent.message.list' && delayList) { delayList = false; return pendingMessages }
    return originalRequest(method)
  })
  let recovery!: Promise<void>
  await act(async () => { recovery = session.retrySession() })
  record = { ...record, state: 'running', taskId: 'already-resumed' }
  props = { ...props, events: [lifecycle(1, 'running')] }
  await act(async () => { tree!.update(<ObserveSession />) })
  await act(async () => { await session.refreshSessionHistory() })
  await act(async () => { release(); await recovery })
  expect(props.onRun).not.toHaveBeenCalled()
  expect(session.running).toBe(true)
  expect(session.error).toBeUndefined()
})


it('shares concurrent history reads and does not refresh for session-list presentation changes', async () => {
  record.taskId = 'previous-task'
  props.onRun = vi.fn(async () => { throw new RuntimeTransportError(new Error('Connection lost'), 'agent.run') })
  await act(async () => { tree = create(<ObserveSession />) })
  await act(async () => { await session.retrySession() })
  const reads = () => fixtures.request.mock.calls.filter(([method]) => method === 'session.read').length
  const before = reads()
  props = { ...props, sessionSummariesRefreshing: true }
  await act(async () => { tree!.update(<ObserveSession />) })
  props = { ...props, sessionSummariesRefreshing: false, sessionSummaries: [] }
  await act(async () => { tree!.update(<ObserveSession />) })
  expect(reads()).toBe(before)
  await act(async () => {
    await Promise.all([session.refreshSessionHistory(), session.refreshSessionHistory()])
  })
  expect(reads()).toBe(before + 1)
})
