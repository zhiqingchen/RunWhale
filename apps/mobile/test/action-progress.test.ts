import { describe, expect, it } from 'vitest'
import { actionErrorPresentation, actionProgressPresentation, runExclusiveAction } from '../src/utils/action-progress'

describe('asynchronous action progress', () => {
  it('keeps an available idle action enabled without showing progress', () => {
    expect(actionProgressPresentation(false, true)).toEqual({
      showSpinner: false,
      accessibilityLiveRegion: 'polite',
      accessibilityState: { busy: false, disabled: false },
    })
  })

  it('shows progress, announces busy state, and prevents duplicate actions while running', () => {
    expect(actionProgressPresentation(true, false)).toEqual({
      showSpinner: true,
      accessibilityLiveRegion: 'polite',
      accessibilityState: { busy: true, disabled: true },
    })
  })

  it('disables an unavailable idle action without presenting it as busy', () => {
    expect(actionProgressPresentation(false, false)).toEqual({
      showSpinner: false,
      accessibilityLiveRegion: 'polite',
      accessibilityState: { busy: false, disabled: true },
    })
  })

  it('presents asynchronous action failures as assertive HeroUI danger alerts', () => {
    expect(actionErrorPresentation).toEqual({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'assertive',
      status: 'danger',
    })
  })

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
