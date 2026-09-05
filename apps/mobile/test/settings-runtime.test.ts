import { describe, expect, it } from 'vitest'
import { loadRuntimeEnvironment, runtimeSettingsPresentation, runtimeSettingsSummaryState, shouldLoadRuntimeEnvironment } from '../src/utils/settings-runtime'

describe('Runtime Settings presentation', () => {
  it('only reports a running summary after the RPC host is ready', () => {
    expect(runtimeSettingsSummaryState('running', false, false)).toBe('starting')
    expect(runtimeSettingsSummaryState('running', true, false)).toBe('running')
  })

  it('prioritizes runtime failures and preserves other native states', () => {
    expect(runtimeSettingsSummaryState('running', false, true)).toBe('failed')
    expect(runtimeSettingsSummaryState('running', true, true)).toBe('failed')
    expect(runtimeSettingsSummaryState('failed', true, false)).toBe('failed')
    expect(runtimeSettingsSummaryState('starting', false, false)).toBe('starting')
    expect(runtimeSettingsSummaryState('stopping', false, false)).toBe('stopping')
    expect(runtimeSettingsSummaryState('stopped', false, false)).toBe('stopped')
  })

  it('moves from an explicit loading state to the loaded npm version', () => {
    expect(runtimeSettingsPresentation({ status: 'loading' }, false)).toEqual({
      npmVersion: undefined,
      npmStatus: 'loading',
      failure: undefined,
      retryTarget: undefined,
    })
    expect(runtimeSettingsPresentation({ status: 'ready', npmVersion: '11.7.0' }, false)).toEqual({
      npmVersion: '11.7.0',
      npmStatus: 'ready',
      failure: undefined,
      retryTarget: undefined,
    })
  })

  it('uses the npm version published with the runtime host without loading environment details', () => {
    expect(shouldLoadRuntimeEnvironment('11.17.0')).toBe(false)
    expect(runtimeSettingsPresentation({ status: 'loading' }, false, '11.17.0')).toEqual({
      npmVersion: '11.17.0',
      npmStatus: 'ready',
      failure: undefined,
      retryTarget: undefined,
    })
  })

  it('falls back to the environment lookup for legacy host metadata', () => {
    expect(shouldLoadRuntimeEnvironment()).toBe(true)
  })

  it('presents a rejected environment lookup as failed and retryable', () => {
    expect(runtimeSettingsPresentation({ status: 'failed' }, false)).toEqual({
      npmVersion: undefined,
      npmStatus: 'failed',
      failure: 'environment',
      retryTarget: 'environment',
    })
  })

  it('prioritizes restarting a failed runtime while preserving a loaded npm version', () => {
    expect(runtimeSettingsPresentation({ status: 'ready', npmVersion: '11.7.0' }, true)).toEqual({
      npmVersion: '11.7.0',
      npmStatus: 'ready',
      failure: 'runtime',
      retryTarget: 'runtime',
    })
  })

  it('turns environment completion or failure into an explicit retry result', async () => {
    await expect(loadRuntimeEnvironment(async () => ({ npmVersion: '11.7.0' }))).resolves.toEqual({ status: 'ready', npmVersion: '11.7.0' })
    await expect(loadRuntimeEnvironment(async () => { throw new Error('host unavailable') })).resolves.toEqual({ status: 'failed' })
  })
})
