import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { webPreviewTestingScript } from '../src/web-preview-testing.js'

describe('Web Preview console capture', () => {
  it('preserves the console, bounds retention, and reports cursor gaps and uncaught failures', () => {
    const messages: Array<{ result: { logs: Array<{ message: string; level: string }>; nextSequence: number; gap: boolean } }> = []
    const listeners = new Map<string, (event: unknown) => void>()
    const original = vi.fn()
    const context: Record<string, any> = {
      console: { log: original, info: original, warn: original, error: original, debug: original },
      document: {}, MutationObserver: class { observe() {} takeRecords() { return [] } },
      addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback),
      ReactNativeWebView: { postMessage: (data: string) => messages.push(JSON.parse(data)) },
    }
    context.window = context
    runInNewContext(webPreviewTestingScript, context)
    runInNewContext(webPreviewTestingScript, context)
    for (let i = 0; i < 105; i++) context.console.log(`entry ${i}`)
    listeners.get('unhandledrejection')!({ reason: { stack: 'async failure' } })
    context.__runwhalePreviewTest('logs', { kind: 'logs', afterSequence: 0 })
    expect(original).toHaveBeenCalledTimes(105)
    expect(messages[0]!.result).toMatchObject({ nextSequence: 106, gap: true })
    expect(messages[0]!.result.logs).toHaveLength(100)
    expect(messages[0]!.result.logs.at(-1)).toEqual(expect.objectContaining({ level: 'error', message: 'async failure' }))
    context.__runwhalePreviewTest('next', { kind: 'logs', afterSequence: 106 })
    expect(messages[1]!.result.logs).toEqual([])
    context.console.error('x'.repeat(9000))
    context.__runwhalePreviewTest('bounded', { kind: 'logs', afterSequence: 106 })
    expect(messages[2]!.result.logs[0]!.message.length).toBeLessThanOrEqual(2048)
  })
})

function inspectionBridge() {
  const messages: Array<{ result: Record<string, any> }> = []
  const listeners = new Map<string, () => void>()
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 }
  const button = {
    tagName: 'BUTTON', children: [], textContent: 'Play', isConnected: true,
    scrollHeight: 200, clientHeight: 100,
    getAttribute: () => null,
    getBoundingClientRect: vi.fn(() => rect),
    click: vi.fn(),
  }
  let pendingMutation = false
  let observing = false
  let notifyMutation: () => void
  const observe = vi.fn(() => { observing = true })
  const disconnect = vi.fn(() => { observing = false; pendingMutation = false })
  const getComputedStyle = vi.fn(() => ({ visibility: 'visible', display: 'block', opacity: '1', overflowY: 'auto' }))
  const context: Record<string, any> = {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    document: { body: button, elementFromPoint: () => button },
    MutationObserver: class {
      constructor(callback: () => void) { notifyMutation = callback }
      observe = observe
      disconnect = disconnect
      takeRecords() {
        const records = pendingMutation ? [{}] : []
        pendingMutation = false
        return records
      }
    },
    addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
    ReactNativeWebView: { postMessage: (data: string) => messages.push(JSON.parse(data)) },
    getComputedStyle,
    innerHeight: 800, innerWidth: 400, devicePixelRatio: 2,
  }
  context.window = context
  runInNewContext(webPreviewTestingScript, context)
  const command = (value: Record<string, unknown>) => {
    context.__runwhalePreviewTest('test', value)
    return messages.at(-1)!.result
  }
  return {
    button, command, disconnect, getComputedStyle, listeners, observe,
    observing: () => observing,
    mutate(deliver = true) {
      if (!observing) return
      pendingMutation = true
      if (deliver) { pendingMutation = false; notifyMutation() }
    },
  }
}

describe('Web Preview inspection overhead', () => {
  it('tracks DOM changes only while an actionable snapshot exists', () => {
    const bridge = inspectionBridge()
    expect(bridge.observe).not.toHaveBeenCalled()
    expect(bridge.listeners.has('scroll')).toBe(false)
    bridge.command({ kind: 'logs', afterSequence: 0 })
    expect(bridge.observing()).toBe(false)

    const snapshot = bridge.command({ kind: 'inspect' })
    expect(bridge.observing()).toBe(true)
    bridge.mutate()
    expect(bridge.observing()).toBe(false)
    expect(bridge.listeners.has('scroll')).toBe(false)
    expect(bridge.listeners.has('resize')).toBe(false)
    expect(bridge.command({ kind: 'action', snapshotId: snapshot.snapshotId, nodeId: 'n1', action: 'press' }).error).toContain('stale')
    expect(bridge.button.click).not.toHaveBeenCalled()

    const refreshed = bridge.command({ kind: 'inspect' })
    expect(bridge.observing()).toBe(true)
    expect(bridge.command({ kind: 'action', snapshotId: refreshed.snapshotId, nodeId: 'n1', action: 'press' }).performed).toBe(true)
    expect(bridge.button.click).toHaveBeenCalledOnce()
    expect(bridge.observing()).toBe(false)
  })

  it.each(['pending mutation', 'scroll', 'resize', 'close'])('rejects actions after %s and stops observing', (change) => {
    const bridge = inspectionBridge()
    const snapshot = bridge.command({ kind: 'inspect' })
    if (change === 'pending mutation') bridge.mutate(false)
    else if (change === 'close') expect(bridge.command({ kind: 'close' }).closed).toBe(true)
    else bridge.listeners.get(change)!()
    expect(bridge.command({ kind: 'action', snapshotId: snapshot.snapshotId, nodeId: 'n1', action: 'press' }).error).toContain('stale')
    expect(bridge.button.click).not.toHaveBeenCalled()
    expect(bridge.observing()).toBe(false)
  })

  it('reads layout and computed style once per node for inspection and action', () => {
    const bridge = inspectionBridge()
    const snapshot = bridge.command({ kind: 'inspect' })
    expect(snapshot.nodes).toEqual([expect.objectContaining({
      id: 'n1', role: 'button', text: 'Play', visible: true, actions: ['press', 'scroll'],
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    })])
    expect(bridge.button.getBoundingClientRect).toHaveBeenCalledOnce()
    expect(bridge.getComputedStyle).toHaveBeenCalledOnce()
    bridge.command({ kind: 'action', snapshotId: snapshot.snapshotId, nodeId: 'n1', action: 'press' })
    expect(bridge.button.getBoundingClientRect).toHaveBeenCalledTimes(2)
    expect(bridge.getComputedStyle).toHaveBeenCalledTimes(2)
  })
})
