import { describe, expect, it } from 'vitest'
import { nativeRuntimeRecoveryAction, publishRuntimeHost, runtimeBootPollingAction, runtimeConnectionRecoveryAllowed, runtimeHostPublicationReady, runtimeLifecycleAttemptActive, runtimeStartupScreen } from '../src/utils/runtime-startup'

const runningState = {
  isWeb: false,
  nativeState: 'running',
  hasHostInfo: false,
} as const

describe('Runtime startup presentation', () => {
  it('keeps content visible while host publication is pending', () => {
    expect(runtimeStartupScreen(runningState)).toBe('content')
  })

  it('lets a native failure override stale published host information', () => {
    expect(runtimeStartupScreen({
      ...runningState,
      nativeState: 'failed',
      hasHostInfo: true,
    })).toBe('failed')
  })

  it('keeps content visible while native recovery is pending', () => {
    expect(runtimeStartupScreen({
      ...runningState,
      nativeState: 'stopped',
      hasHostInfo: true,
    })).toBe('content')
  })

  it('shows a confirmed connection error as a failure while the endpoint is unavailable', () => {
    expect(runtimeStartupScreen({
      ...runningState,
      hostError: 'connection lost',
    })).toBe('failed')
  })
})

describe('Runtime host recovery', () => {
  it('pauses localhost recovery across iOS suspension states', () => {
    expect(runtimeConnectionRecoveryAllowed('active')).toBe(true)
    expect(runtimeConnectionRecoveryAllowed(null)).toBe(true)
    expect(runtimeConnectionRecoveryAllowed('unknown')).toBe(true)
    expect(runtimeConnectionRecoveryAllowed('inactive')).toBe(false)
    expect(runtimeConnectionRecoveryAllowed('background')).toBe(false)
    expect(runtimeConnectionRecoveryAllowed('extension')).toBe(false)
  })

  it('does not revive a suspended lifecycle attempt after the app returns active', () => {
    expect(runtimeLifecycleAttemptActive('active', 4, 4)).toBe(true)
    expect(runtimeLifecycleAttemptActive('inactive', 4, 4)).toBe(false)
    expect(runtimeLifecycleAttemptActive('background', 4, 4)).toBe(false)
    expect(runtimeLifecycleAttemptActive('active', 4, 5)).toBe(false)
  })


  it('publishes invalidation and recovery to both the synchronous reference and UI state', () => {
    const firstHost = { origin: 'http://127.0.0.1:4100' }
    const recoveredHost = { origin: 'http://127.0.0.1:4200' }
    const reference = { current: firstHost as typeof firstHost | undefined }
    let rendered = firstHost as typeof firstHost | undefined

    publishRuntimeHost(reference, (value) => { rendered = value }, undefined)
    expect(reference.current).toBeUndefined()
    expect(rendered).toBeUndefined()

    publishRuntimeHost(reference, (value) => { rendered = value }, recoveredHost)
    expect(reference.current).toBe(recoveredHost)
    expect(rendered).toBe(recoveredHost)
  })

  it('never calls the process-wide Node entry point again after it stops', () => {
    expect(nativeRuntimeRecoveryAction({ nativeState: 'failed', hasHostInfo: true, bootInFlight: false })).toBe('none')
    expect(nativeRuntimeRecoveryAction({ nativeState: 'stopped', hasHostInfo: false, bootInFlight: false })).toBe('none')
    expect(nativeRuntimeRecoveryAction({ nativeState: 'failed', hasHostInfo: true, bootInFlight: true })).toBe('none')
  })

  it('validates an externally restored running host when no boot is active', () => {
    expect(nativeRuntimeRecoveryAction({ nativeState: 'running', hasHostInfo: false, bootInFlight: false })).toBe('boot')
    expect(nativeRuntimeRecoveryAction({ nativeState: 'running', hasHostInfo: true, bootInFlight: false })).toBe('none')
  })

  it('surfaces native termination without retrying the one-shot Node entry point', () => {
    expect(runtimeBootPollingAction('starting')).toBe('continue')
    expect(runtimeBootPollingAction('running')).toBe('continue')
    expect(runtimeBootPollingAction('failed')).toBe('fail')
    expect(runtimeBootPollingAction('stopped')).toBe('fail')
  })

  it('publishes a host only when both RPC and native state are running', () => {
    expect(runtimeHostPublicationReady('running', 'running')).toBe(true)
    expect(runtimeHostPublicationReady('stopping', 'running')).toBe(false)
    expect(runtimeHostPublicationReady('running', 'stopping')).toBe(false)
    expect(runtimeHostPublicationReady('failed', 'running')).toBe(false)
  })
})
