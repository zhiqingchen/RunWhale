import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeProvider, useRuntime } from '../src/state/runtime'

const native = vi.hoisted(() => ({
  state: 'running',
  appState: 'active',
  onAppState: undefined as ((state: string) => void) | undefined,
  onNodeState: undefined as ((snapshot: { state: string }) => void) | undefined,
  startBundled: vi.fn(async () => ({ state: 'running' })),
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: {
    get currentState() { return native.appState },
    addEventListener: (_event: string, listener: typeof native.onAppState) => {
      native.onAppState = listener
      return { remove: () => { native.onAppState = undefined } }
    },
  },
}))
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null }))
vi.mock('@runwhale/node-host', () => ({
  NodeHost: {
    snapshot: () => ({ state: native.state }),
    startBundled: native.startBundled,
    readHostInfo: () => JSON.stringify({ port: 4100, origin: 'http://127.0.0.1:4100', websocketUrl: 'ws://127.0.0.1:4100/events', token: 'fixture', nodeVersion: '24.19.0' }),
    takeNativePreviewDiagnostic: () => null,
    addListener: (_event: string, listener: typeof native.onNodeState) => {
      native.onNodeState = listener
      return { remove: () => { native.onNodeState = undefined } }
    },
  },
}))

class EventSocket {
  static latest: EventSocket
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((message: { data: string }) => void) | null = null
  constructor() { EventSocket.latest = this }
  close() { this.onclose?.() }
}

let runtime: ReturnType<typeof useRuntime>
let tree: ReactTestRenderer | undefined
let reachable: boolean
let hostState: string
let suspendedSignals: AbortSignal[]
let hang: boolean

function ObserveRuntime() {
  runtime = useRuntime()
  return null
}

async function advance(milliseconds: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds) })
}

async function changeAppState(state: string) {
  await act(async () => {
    native.appState = state
    native.onAppState?.(state)
  })
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('WebSocket', EventSocket)
  native.state = 'running'
  native.appState = 'active'
  native.startBundled.mockClear()
  reachable = true
  hang = false
  hostState = 'running'
  suspendedSignals = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    if (hang) {
      suspendedSignals.push(init.signal as AbortSignal)
      return new Promise<Response>(() => undefined)
    }
    if (!reachable) throw new Error('Could not connect to the server')
    const { method } = JSON.parse(init.body as string) as { method: string }
    return {
      ok: true,
      json: async () => ({ ok: true, result: method === 'host.snapshot'
        ? { snapshot: { state: hostState, lastEventSequence: 0 }, events: [] }
        : {} }),
    }
  }))
  await act(async () => { tree = create(<RuntimeProvider><ObserveRuntime /></RuntimeProvider>) })
  expect(runtime.info).toBeDefined()
})

afterEach(async () => {
  await act(async () => { tree?.unmount() })
  tree = undefined
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function loseConnection() {
  reachable = false
  await act(async () => { EventSocket.latest.close() })
  await advance(8_000)
  expect(runtime.info).toBeUndefined()
  expect(runtime.lastError).toContain('connection lost')
}

describe('iOS runtime connection recovery', () => {
  it('keeps a failed retry visible and settles it within the reconnect deadline', async () => {
    await loseConnection()
    const connectionError = runtime.lastError
    let settled = false
    await act(async () => { void runtime.retryRuntime().then(() => { settled = true }) })

    expect(runtime.lastError).toBe(connectionError)
    expect(settled).toBe(false)
    await advance(30_000)
    expect(settled).toBe(true)
    expect(runtime.info).toBeUndefined()
    expect(runtime.lastError).toMatch(/timed out|did not become ready/)
  })

  it('clears a connection error only after Retry verifies the host', async () => {
    await loseConnection()
    reachable = true
    await act(async () => { await runtime.retryRuntime() })
    expect(runtime.info).toBeDefined()
    expect(runtime.lastError).toBeUndefined()
    expect(native.startBundled).not.toHaveBeenCalled()
  })

  it('aborts a suspended foreground probe and reconnects when iOS becomes active', async () => {
    hang = true
    await act(async () => { EventSocket.latest.close() })
    await advance(500)
    expect(suspendedSignals).toHaveLength(1)
    await changeAppState('inactive')
    expect(suspendedSignals[0]?.aborted).toBe(true)

    hang = false
    await changeAppState('background')
    await changeAppState('active')
    await advance(3_000)
    expect(runtime.info).toBeDefined()
    expect(runtime.lastError).toBeUndefined()
    expect(native.startBundled).not.toHaveBeenCalled()
  })

  it('does not republish a reachable host that has stopped', async () => {
    hostState = 'stopped'
    await act(async () => { EventSocket.latest.close() })
    await advance(8_000)
    expect(runtime.info).toBeUndefined()
    expect(runtime.lastError).toBeDefined()
  })
})
