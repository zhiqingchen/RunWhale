import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PreviewEndpoint, PreviewTestRequest } from '@runwhale/mobile-protocol'
import { PreviewTesting } from '../src/preview-testing.js'

afterEach(() => vi.useRealTimers())

function testing() {
  let endpoint: PreviewEndpoint | undefined = { projectId: 'test-project', revision: 1, platform: 'ios', port: 1, token: 'fixture', bundleUrl: 'http://127.0.0.1:1/bundle' }
  const requests: PreviewTestRequest[] = []
  const bridge = new PreviewTesting(() => endpoint, request => requests.push(request))
  const claim = () => { const request = requests.at(-1)!; return bridge.claim(request.id, request.projectId, request.revision) }
  return { bridge, requests, claim, change: () => { endpoint = endpoint ? { ...endpoint, revision: endpoint.revision + 1 } : undefined } }
}

describe('Preview test request lifetime', () => {
  it('cancels unfinished evidence requests after a confirmed close and preserves the served endpoint', async () => {
    const { bridge, requests, claim } = testing()
    const inspect = bridge.query('test-project', { kind: 'inspect' }, new AbortController().signal)
    const cancelled = expect(inspect).rejects.toThrow('closed')
    claim()
    const closed = bridge.query('test-project', { kind: 'close' }, new AbortController().signal)
    claim()
    const request = requests.at(-1)!
    expect(bridge.complete(request.id, request.projectId, 1, { timestamp: 1, closed: true })).toBe(true)
    await expect(closed).resolves.toMatchObject({ closed: true, revision: 1 })
    await cancelled
    const reopened = bridge.query('test-project', { kind: 'inspect' }, new AbortController().signal)
    const cancellation = expect(reopened).rejects.toThrow('closed')
    bridge.cancelAll()
    await cancellation
  })
  it('claims once, confines results to the project/revision, and sanitizes runtime evidence', async () => {
    const { bridge, requests, claim } = testing()
    const result = bridge.query('test-project', { kind: 'logs', afterSequence: 0 }, new AbortController().signal)
    const request = requests[0]!
    expect(bridge.claim(request.id, 'other-project', 1)).toEqual({})
    expect(claim()).toEqual({ command: { kind: 'logs', afterSequence: 0 } })
    expect(claim()).toEqual({})
    expect(bridge.complete(request.id, request.projectId, 2, { timestamp: 1, logs: [] })).toBe(false)
    expect(bridge.complete(request.id, request.projectId, 1, { timestamp: 1, logs: [{ sequence: 1, timestamp: 1, level: 'error', message: 'Failure at http://127.0.0.1:1/bundle?token=fixture-private authorization=Bearer fixture-secret' }] })).toBe(true)
    expect(await result).toMatchObject({ projectId: 'test-project', revision: 1, platform: 'ios', logs: [{ message: 'Failure at <redacted-url> authorization=Bearer <redacted>' }] })
    expect(JSON.stringify(requests)).not.toContain('fixture-private')
    expect(bridge.complete(request.id, request.projectId, 1, { timestamp: 1, logs: [] })).toBe(false)
  })

  it('rejects stale results and cancellation without replaying the operation', async () => {
    const { bridge, requests, claim, change } = testing()
    const result = bridge.query('test-project', { kind: 'inspect' }, new AbortController().signal)
    const rejected = expect(result).rejects.toThrow('Preview changed')
    claim(); change()
    const request = requests[0]!
    expect(bridge.complete(request.id, request.projectId, 1, { timestamp: 1, snapshotId: 'old', nodes: [] })).toBe(false)
    await rejected
    const controller = new AbortController()
    const cancelled = bridge.query('test-project', { kind: 'screenshot' }, controller.signal)
    const cancellation = expect(cancelled).rejects.toThrow('cancelled')
    controller.abort()
    await cancellation
    expect(claim()).toEqual({})
  })

  it('times out missing views and rejects incomplete evidence instead of reporting success', async () => {
    vi.useFakeTimers()
    const { bridge, requests, claim } = testing()
    const result = bridge.query('test-project', { kind: 'inspect' }, new AbortController().signal)
    const timeout = expect(result).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(15_000)
    await timeout
    const image = bridge.query('test-project', { kind: 'screenshot' }, new AbortController().signal)
    const missing = expect(image).rejects.toThrow('requested test evidence')
    claim()
    const request = requests.at(-1)!
    expect(bridge.complete(request.id, request.projectId, 1, { timestamp: 1 })).toBe(false)
    await missing
    await expect(bridge.query('other-project', { kind: 'inspect' }, new AbortController().signal)).rejects.toThrow('Run this project')
  })
})
