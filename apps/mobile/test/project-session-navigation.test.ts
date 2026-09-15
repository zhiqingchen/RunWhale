import { describe, expect, it } from 'vitest'
import { projectSessionSurfaceActionState } from '../src/utils/project-session-navigation'

describe('project session navigation', () => {
  it('disables Preview while its open or rebuild action is already running', () => {
    expect(projectSessionSurfaceActionState('agent', 'preview', true)).toEqual({ selected: false, busy: true, disabled: true })
    expect(projectSessionSurfaceActionState('files', 'files', true)).toEqual({ selected: true, busy: false, disabled: false })
    expect(projectSessionSurfaceActionState('agent', 'preview', false)).toEqual({ selected: false, busy: false, disabled: false })
  })
})
