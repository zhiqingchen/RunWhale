import { afterEach, describe, expect, it, vi } from 'vitest'
import { RUNTIME_BOOT_PROBE_TIMEOUT_MS, RUNTIME_BOOT_TIMEOUT_MS, RUNTIME_CREDENTIAL_READ_TIMEOUT_MS, RUNTIME_REQUEST_TIMEOUT_GRACE_MS, runtimeBootStepTimeoutMs, runtimeRequestTimeoutMs, withClientDeadline } from '../src/utils/runtime-request'
import { retireEndedAgentRun } from '../src/utils/agent-recovery'
import { latestAgentLifecycleState } from '../src/utils/agent-lifecycle'
import { MOBILE_HOST_PROTOCOL_VERSION, type HostEvent } from '@runwhale/mobile-protocol'
import { runExclusiveAction } from '../src/utils/action-progress'

afterEach(() => {
  vi.useRealTimers()
})

describe('runtime client request deadlines', () => {
  it.each(['aborted', 'failed', 'completed', 'paused'] as const)('unlocks Retry when a %s run leaves its transport suspended', async (state) => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const guard = { current: false }
    let transportSignal: AbortSignal | undefined
    const run = runExclusiveAction(guard, () => withClientDeadline(605_000, async (signal) => {
      transportSignal = signal
      return new Promise<void>(() => undefined)
    }, () => new Error('timeout'), controller.signal))
    await Promise.resolve()
    expect(guard.current).toBe(true)
    const rejection = expect(run).rejects.toMatchObject({ code: 'ABORTED' })
    const event: HostEvent = { v: MOBILE_HOST_PROTOCOL_VERSION, type: 'event', name: 'agent.state', sequence: 12, timestamp: 1, data: { projectId: 'project', sessionId: 'session', state } }
    retireEndedAgentRun(controller, latestAgentLifecycleState([event], 'project', 'session', 12))
    expect(guard.current).toBe(true)
    expect(controller.signal.aborted).toBe(false)
    retireEndedAgentRun(controller, latestAgentLifecycleState([event], 'project', 'session', 11))

    await rejection
    expect(transportSignal?.aborted).toBe(true)
    expect(guard.current).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    const retry = vi.fn(async () => 'started')
    await expect(runExclusiveAction(guard, retry)).resolves.toBe('started')
    expect(retry).toHaveBeenCalledOnce()
  })

  it('does not send an already cancelled request', async () => {
    const controller = new AbortController()
    const reason = new Error('stopped')
    controller.abort(reason)
    const operation = vi.fn(async () => 'sent')
    await expect(withClientDeadline(50, operation, () => new Error('timeout'), controller.signal)).rejects.toBe(reason)
    expect(operation).not.toHaveBeenCalled()
  })

  it('preserves cancellation on React Native signals without a reason', async () => {
    const controller = new AbortController()
    Object.defineProperty(controller.signal, 'reason', { get: () => undefined })
    const pending = withClientDeadline(50, () => new Promise(() => undefined), () => new Error('timeout'), controller.signal)
    const rejection = expect(pending).rejects.toMatchObject({ code: 'ABORTED', message: 'Request cancelled' })
    controller.abort()
    await rejection
  })

  it('keeps client deadlines aligned with host request classes', () => {
    expect(runtimeRequestTimeoutMs('host.snapshot')).toBe(30_000)
    expect(runtimeRequestTimeoutMs('preview.run')).toBe(5 * 60_000)
    expect(runtimeRequestTimeoutMs('agent.run')).toBe(10 * 60_000)
    expect(RUNTIME_REQUEST_TIMEOUT_GRACE_MS).toBe(5_000)
  })

  it('caps startup steps by both the probe limit and absolute boot deadline', () => {
    expect(RUNTIME_BOOT_TIMEOUT_MS).toBe(3 * 60_000)
    expect(RUNTIME_BOOT_PROBE_TIMEOUT_MS).toBe(2_000)
    expect(RUNTIME_CREDENTIAL_READ_TIMEOUT_MS).toBe(5_000)
    expect(runtimeBootStepTimeoutMs(10_000, 2_000, 7_000)).toBe(2_000)
    expect(runtimeBootStepTimeoutMs(10_000, 2_000, 9_500)).toBe(500)
    expect(runtimeBootStepTimeoutMs(10_000, 2_000, 10_001)).toBe(0)
  })

  it('aborts and rejects an operation that never settles', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const pending = withClientDeadline(
      50,
      async (currentSignal) => {
        signal = currentSignal
        return new Promise<string>(() => undefined)
      },
      () => new Error('runtime request timed out'),
    )
    const rejection = expect(pending).rejects.toThrow('runtime request timed out')

    await vi.advanceTimersByTimeAsync(50)

    await rejection
    expect(signal?.aborted).toBe(true)
  })

  it('preserves the deadline error when aborting also rejects the operation', async () => {
    vi.useFakeTimers()
    const timeoutError = Object.assign(new Error('runtime request timed out'), { code: 'TIMEOUT' })
    const pending = withClientDeadline(50, async (signal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('transport aborted')), { once: true })
    }), () => timeoutError)
    const rejection = expect(pending).rejects.toBe(timeoutError)

    await vi.advanceTimersByTimeAsync(50)

    await rejection
  })

  it('clears the deadline after success', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    await expect(withClientDeadline(50, async (currentSignal) => {
      signal = currentSignal
      return 'ready'
    }, () => new Error('too late'))).resolves.toBe('ready')

    await vi.advanceTimersByTimeAsync(50)
    expect(signal?.aborted).toBe(false)
  })
})
