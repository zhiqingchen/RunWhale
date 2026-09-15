import { describe, expect, it } from 'vitest'
import { runExclusiveAction } from '../src/utils/action-progress'

describe('asynchronous action progress', () => {
  it('synchronously rejects duplicate work and unlocks after completion or failure', async () => {
    const guard = { current: false }
    let release!: () => void
    const first = runExclusiveAction(guard, () => new Promise<string>((resolve) => { release = () => resolve('created') }))

    await expect(runExclusiveAction(guard, async () => 'duplicate')).resolves.toBeUndefined()
    expect(guard.current).toBe(true)
    release()
    await expect(first).resolves.toBe('created')
    expect(guard.current).toBe(false)

    await expect(runExclusiveAction(guard, async () => { throw new Error('retryable') })).rejects.toThrow('retryable')
    expect(guard.current).toBe(false)
    await expect(runExclusiveAction(guard, async () => 'retried')).resolves.toBe('retried')
  })
})
