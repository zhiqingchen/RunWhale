import { describe, expect, it } from 'vitest'
import { WORKSPACE_COLLAPSED_SESSION_COUNT, WORKSPACE_PREVIEW_OPEN_REQUEST, workspaceAndroidBackAction, workspaceEditorContentState, workspaceFilePaneVisibility, workspacePreferredFilePath, workspacePreviewAutoOpenRequested, workspaceProjectCardWidth, workspaceProjectColumns, workspaceProjectOpenActionState, workspaceProjectRouteState, workspaceSupportsEmbeddedPreview, workspaceVisibleSessions } from '../src/utils/workspace-layout'

describe('Workspace project card layout', () => {
  it('recognizes cache-first auto-open requests for routed Preview entry points', () => {
    expect(WORKSPACE_PREVIEW_OPEN_REQUEST).toBe('open')
    expect(workspacePreviewAutoOpenRequested(WORKSPACE_PREVIEW_OPEN_REQUEST)).toBe(true)
    expect(workspacePreviewAutoOpenRequested('run')).toBe(false)
  })

  it('uses one, two, and three independent columns at phone and tablet widths', () => {
    expect(workspaceProjectColumns(390)).toBe(1)
    expect(workspaceProjectColumns(820)).toBe(2)
    expect(workspaceProjectColumns(1_366)).toBe(3)
  })

  it('keeps cards inside the padded viewport with consistent gaps', () => {
    expect(workspaceProjectCardWidth(390)).toBe(354)
    expect(workspaceProjectCardWidth(820)).toBe(386)
    expect(workspaceProjectCardWidth(1_366)).toBeCloseTo(435.333, 3)
  })

  it('shows only the five most recent sessions until the project list is expanded', () => {
    const sessions = ['newest', 'second', 'third', 'fourth', 'fifth', 'sixth']

    expect(WORKSPACE_COLLAPSED_SESSION_COUNT).toBe(5)
    expect(workspaceVisibleSessions(sessions, false)).toEqual(sessions.slice(0, 5))
    expect(workspaceVisibleSessions(sessions, true)).toEqual(sessions)
    expect(workspaceVisibleSessions(sessions.slice(0, 5), false)).toEqual(sessions.slice(0, 5))
  })

  it('uses one Files pane below 820 points and the split editor at wider sizes', () => {
    expect(workspaceFilePaneVisibility(375, 'browser')).toEqual({ split: false, browser: true, editor: false })
    expect(workspaceFilePaneVisibility(819, 'editor')).toEqual({ split: false, browser: false, editor: true })
    expect(workspaceFilePaneVisibility(820, 'browser')).toEqual({ split: true, browser: true, editor: true })
  })

  it('reserves embedded split/full Preview for iPad', () => {
    expect(workspaceSupportsEmbeddedPreview('ios', true)).toBe(true)
    expect(workspaceSupportsEmbeddedPreview('ios', false)).toBe(false)
    expect(workspaceSupportsEmbeddedPreview('android', true)).toBe(false)
  })

  it('distinguishes project hydration from a genuinely missing project', () => {
    expect(workspaceProjectRouteState('loading', false)).toBe('loading')
    expect(workspaceProjectRouteState('failed', false)).toBe('failed')
    expect(workspaceProjectRouteState('loading', true)).toBe('ready')
    expect(workspaceProjectRouteState('failed', true)).toBe('ready')
    expect(workspaceProjectRouteState('ready', true)).toBe('ready')
    expect(workspaceProjectRouteState('ready', false)).toBe('missing')
  })

  it('opens the most relevant project file instead of a bookkeeping file', () => {
    const files = [
      { path: '.gitignore', content: '' },
      { path: 'runwhale.json', content: JSON.stringify({ entry: { web: 'src/main.tsx' } }) },
      { path: 'src/main.tsx', content: 'export {}' },
      { path: 'src/recent.ts', content: 'export {}' },
    ]

    expect(workspacePreferredFilePath(files)).toBe('src/main.tsx')
    expect(workspacePreferredFilePath(files, ['missing.ts', 'src/recent.ts'])).toBe('src/recent.ts')
    expect(workspacePreferredFilePath([{ path: '.gitignore', content: '' }])).toBe('.gitignore')
    expect(workspacePreferredFilePath([])).toBe('')
  })

  it('keeps zero-file editor states explicit across compact and split layouts', () => {
    expect(workspaceFilePaneVisibility(375, 'editor')).toEqual({ split: false, browser: false, editor: true })
    expect(workspaceEditorContentState(false)).toBe('empty')
    expect(workspaceEditorContentState(true)).toBe('file')
  })

  it('disables project Open only while session summaries are loading', () => {
    expect(workspaceProjectOpenActionState('loading')).toEqual({ busy: true, disabled: true })
    expect(workspaceProjectOpenActionState('loaded')).toEqual({ busy: false, disabled: false })
    expect(workspaceProjectOpenActionState('failed')).toEqual({ busy: false, disabled: false })
  })

  it('applies the Android back hierarchy only while Files is active', () => {
    expect(workspaceAndroidBackAction('files', false, 'editor')).toBe('show-file-browser')
    expect(workspaceAndroidBackAction('files', false, 'browser')).toBe('show-agent')
    expect(workspaceAndroidBackAction('files', true, 'editor')).toBe('show-agent')
    expect(workspaceAndroidBackAction('agent', false, 'editor')).toBe('propagate')
    expect(workspaceAndroidBackAction('preview', false, 'editor')).toBe('propagate')
  })
})
