import { describe, expect, it } from 'vitest'
import { projectSessionNavigationContract, projectSessionSurfaceActionState } from '../src/utils/project-session-navigation'

describe('project session navigation', () => {
  it('keeps one visual contract in portrait and landscape layouts', () => {
    expect(projectSessionNavigationContract).toEqual({ headerMinHeight: 52, backActionSize: 44, surfaceActionSize: 44, actionVisualSize: 36 })
    expect(Math.min(
      projectSessionNavigationContract.backActionSize,
      projectSessionNavigationContract.surfaceActionSize,
    )).toBeGreaterThanOrEqual(44)
    expect(projectSessionNavigationContract.actionVisualSize).toBe(36)
    expect(projectSessionNavigationContract.actionVisualSize).toBeLessThan(projectSessionNavigationContract.surfaceActionSize)

    const compactIdentityWidth = 375 - (12 * 2) - projectSessionNavigationContract.backActionSize - (projectSessionNavigationContract.surfaceActionSize * 3 + 2 * 2) - (6 * 2)
    expect(compactIdentityWidth).toBeGreaterThanOrEqual(100)
  })

  it('disables Preview while its open or rebuild action is already running', () => {
    expect(projectSessionSurfaceActionState('agent', 'preview', true)).toEqual({ selected: false, busy: true, disabled: true })
    expect(projectSessionSurfaceActionState('files', 'files', true)).toEqual({ selected: true, busy: false, disabled: false })
    expect(projectSessionSurfaceActionState('agent', 'preview', false)).toEqual({ selected: false, busy: false, disabled: false })
  })
})
