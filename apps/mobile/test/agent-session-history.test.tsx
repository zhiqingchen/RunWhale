import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { MOBILE_HOST_PROTOCOL_VERSION, type AgentSessionRecord } from '@runwhale/mobile-protocol'
import { useAgentSession } from '../src/hooks/useAgentSession'
import type { AgentPanelProps } from '../src/hooks/agent-panel-types'

const fixtures = vi.hoisted(() => ({
  info: {}, request: vi.fn(), t: (key: string) => key,
  preferences: {
    modelProvider: 'openai', model: 'test-model', modelProfiles: { openai: { models: [] } },
    agentPreset: 'standard', permissionMode: 'review',
  },
}))

vi.mock('@/components/icons', () => ({ Camera: 'Camera', File: 'File', Image: 'Image', ListPlus: 'ListPlus', Target: 'Target' }))
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: fixtures.t }) }))
vi.mock('@/state/preferences', () => ({ usePreferences: () => fixtures.preferences, MOBILE_DEFAULT_MODELS: { openai: 'test-model' } }))
vi.mock('@/state/runtime', () => ({ useRuntime: () => ({ info: fixtures.info, request: fixtures.request }) }))
vi.mock('expo-router', () => ({ useRouter: () => ({}) }))
vi.mock('react-native', () => ({ Keyboard: { dismiss: vi.fn() } }))
vi.mock('@/hooks/useAgentComposer', () => ({ useAgentComposer: () => ({ prompt: '', attachments: [], projectPaths: [] }) }))

let session: ReturnType<typeof useAgentSession>
let tree: ReactTestRenderer | undefined
let props: AgentPanelProps

function ObserveSession() {
  session = useAgentSession(props)
  return null
}

afterEach(async () => {
  await act(async () => { tree?.unmount() })
  tree = undefined
  vi.unstubAllGlobals()
})

async function mountSession() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const record: AgentSessionRecord = { projectId: 'project', sessionId: 'session', title: 'History', updatedAt: 1, state: 'paused', events: [] }
  fixtures.request.mockReset().mockImplementation(async (method: string) => {
    if (method === 'session.read') return record
    if (method === 'agent.message.list') return { messages: [] }
    if (method === 'agent.goal.get') return {}
    throw new Error(`Unexpected request: ${method}`)
  })
  props = {
    projectId: 'project', initialSessionId: 'session', sessionSummaries: [],
    sessionSummariesRefreshing: false, sessionSummaryStatus: 'ready',
    events: [{ v: MOBILE_HOST_PROTOCOL_VERSION, type: 'event', sequence: 1, timestamp: 1,
      name: 'agent.state', data: { projectId: 'project', sessionId: 'session', state: 'paused' } }],
    onRun: vi.fn(),
  }
  await act(async () => { tree = create(<ObserveSession />) })
  return record
}

it('shares concurrent reads without refreshing for session-list presentation changes', async () => {
  await mountSession()
  const reads = () => fixtures.request.mock.calls.filter(([method]) => method === 'session.read').length
  const before = reads()
  props = { ...props, sessionSummariesRefreshing: true }
  await act(async () => { tree!.update(<ObserveSession />) })
  props = { ...props, sessionSummariesRefreshing: false, sessionSummaries: [] }
  await act(async () => { tree!.update(<ObserveSession />) })
  expect(reads()).toBe(before)
  await act(async () => { await Promise.all([session.refreshSessionHistory(), session.refreshSessionHistory()]) })
  expect(reads()).toBe(before + 1)
})

it('lets a superseded reader await the newer snapshot while it is still pending', async () => {
  const record = await mountSession()
  const release: Array<(record: AgentSessionRecord) => void> = []
  const originalRequest = fixtures.request.getMockImplementation()!
  fixtures.request.mockImplementation((method: string) => method === 'session.read'
    ? new Promise<AgentSessionRecord>(resolve => { release.push(resolve) }) : originalRequest(method))
  let older!: Promise<AgentSessionRecord | undefined>
  let newer!: Promise<AgentSessionRecord | undefined>
  await act(async () => { older = session.refreshSessionHistory() })
  const events = props.events!
  props = { ...props, events: [...events, { ...events[0]!, sequence: 2,
    data: { projectId: 'project', sessionId: 'session', state: 'running' } }] }
  await act(async () => { tree!.update(<ObserveSession />) })
  await act(async () => { newer = session.refreshSessionHistory() })
  let olderSettled = false
  void older.then(() => { olderSettled = true })
  await act(async () => { release[0]!(record) })
  expect(olderSettled).toBe(false)
  const latest: AgentSessionRecord = { ...record, state: 'running', taskId: 'resumed' }
  await act(async () => { release[1]!(latest); await Promise.all([older, newer]) })
  expect(await older).toBe(latest)
  expect(session.sessionRecord).toBe(latest)
})
