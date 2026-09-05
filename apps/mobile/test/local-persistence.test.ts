import { describe, expect, it, vi } from 'vitest'
import {
  localPersistenceErrors,
  retryLocalPersistence,
  type LocalPersistenceSource,
} from '../src/utils/local-persistence'

function source(
  error: string | undefined,
  retry: () => Promise<void> = vi.fn(() => Promise.resolve()),
): LocalPersistenceSource {
  return { error, retry }
}

describe('local persistence orchestration', () => {
  it('returns non-empty deduplicated errors in source order', () => {
    expect(localPersistenceErrors([
      source(undefined),
      source(''),
      source('   '),
      source('Preferences could not be saved.'),
      source('Language could not be saved.'),
      source('Preferences could not be saved.'),
    ], 'Device storage reported an unknown error.')).toEqual([
      'Device storage reported an unknown error.',
      'Preferences could not be saved.',
      'Language could not be saved.',
    ])
  })

  it('retries only currently failing sources', async () => {
    const healthyRetry = vi.fn(() => Promise.resolve())
    const emptyRetry = vi.fn(() => Promise.resolve())
    const failingRetry = vi.fn(() => Promise.resolve())

    await expect(retryLocalPersistence([
      source(undefined, healthyRetry),
      source('', emptyRetry),
      source('Save failed.', failingRetry),
    ])).resolves.toBeUndefined()

    expect(healthyRetry).not.toHaveBeenCalled()
    expect(emptyRetry).toHaveBeenCalledOnce()
    expect(failingRetry).toHaveBeenCalledOnce()
  })

  it('represents simultaneous failures in one message list', () => {
    expect(localPersistenceErrors([
      source('Project save failed.'),
      source('Preference save failed.'),
      source('Language save failed.'),
    ], 'Unknown failure.')).toEqual([
      'Project save failed.',
      'Preference save failed.',
      'Language save failed.',
    ])
  })

  it('waits for every started retry before rejecting with the first reason', async () => {
    const firstReason = new Error('first retry failed')
    const secondReason = new Error('second retry failed')
    let rejectFirst!: (reason: Error) => void
    let rejectSecond!: (reason: Error) => void
    let settled = false
    const first = source('First failed.', () => new Promise<void>((_resolve, reject) => { rejectFirst = reject }))
    const second = source('Second failed.', () => new Promise<void>((_resolve, reject) => { rejectSecond = reject }))
    const retry = retryLocalPersistence([first, second]).finally(() => { settled = true })

    await Promise.resolve()
    rejectFirst(firstReason)
    await Promise.resolve()
    expect(settled).toBe(false)
    rejectSecond(secondReason)

    await expect(retry).rejects.toBe(firstReason)
  })

  it('does nothing when no source is failing', async () => {
    const retry = vi.fn(() => Promise.resolve())

    await expect(retryLocalPersistence([source(undefined, retry)])).resolves.toBeUndefined()
    expect(retry).not.toHaveBeenCalled()
  })
})
