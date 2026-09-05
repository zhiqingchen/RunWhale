import type { ProjectSessionSurface } from './project-session-navigation'

export const workspaceProjectCardLayout = {
  cardBorderWidth: 1,
  cardPadding: 13,
  headerGap: 10,
  actionGap: 0,
  minimumTouchTarget: 40,
} as const

export const workspaceProjectCardAccessibilityContract = {
  containerAccessible: false,
  projectActionsRole: 'button',
  newSessionRole: 'button',
} as const

export function workspaceProjectColumns(width: number): 1 | 2 | 3 {
  if (width >= 1_120) return 3
  if (width >= 720) return 2
  return 1
}

export function workspaceProjectCardWidth(width: number, horizontalPadding = 18, gap = 12): number {
  const columns = workspaceProjectColumns(width)
  return Math.max(0, (width - horizontalPadding * 2 - gap * (columns - 1)) / columns)
}

export type WorkspaceFilePane = 'browser' | 'editor'

export type WorkspaceProjectLoadStatus = 'loading' | 'failed' | 'ready'

export type WorkspaceProjectRouteState = 'loading' | 'failed' | 'missing' | 'ready'

export type WorkspaceAndroidBackAction = 'show-file-browser' | 'show-agent' | 'propagate'

export type WorkspaceEditorContentState = 'file' | 'empty'

export type WorkspacePreviewPresentation = 'hidden' | 'split' | 'full'

export const WORKSPACE_PREVIEW_OPEN_REQUEST = 'open' as const

export const WORKSPACE_COLLAPSED_SESSION_COUNT = 5

export function workspaceVisibleSessions<T>(sessions: readonly T[], expanded: boolean): readonly T[] {
  return expanded ? sessions : sessions.slice(0, WORKSPACE_COLLAPSED_SESSION_COUNT)
}

export function workspacePreviewAutoOpenRequested(request: string | undefined): boolean {
  return request === WORKSPACE_PREVIEW_OPEN_REQUEST
}

export function workspaceEditorContentState(fileSelected: boolean): WorkspaceEditorContentState {
  return fileSelected ? 'file' : 'empty'
}

export function workspaceSupportsEmbeddedPreview(platform: string, isPad: boolean): boolean {
  return platform === 'ios' && isPad
}

export function workspaceProjectOpenActionState(sessionLoadStatus: 'loading' | 'loaded' | 'failed'): { busy: boolean; disabled: boolean } {
  const busy = sessionLoadStatus === 'loading'
  return { busy, disabled: busy }
}

export function workspaceProjectRouteState(projectLoadStatus: WorkspaceProjectLoadStatus, projectFound: boolean): WorkspaceProjectRouteState {
  if (projectFound) return 'ready'
  if (projectLoadStatus === 'failed') return 'failed'
  return projectLoadStatus === 'ready' ? 'missing' : 'loading'
}

export function workspacePreferredFilePath(
  files: readonly { path: string; content?: string }[],
  recentFiles: readonly string[] = [],
): string {
  const availablePaths = new Set(files.map((file) => file.path))
  const recentPath = recentFiles.find((path) => availablePaths.has(path))
  if (recentPath) return recentPath

  const manifest = files.find((file) => file.path === 'runwhale.json')
  if (manifest?.content) {
    try {
      const parsed = JSON.parse(manifest.content) as { entry?: unknown }
      if (parsed.entry && typeof parsed.entry === 'object' && !Array.isArray(parsed.entry)) {
        const entryPath = Object.values(parsed.entry).find((value): value is string => typeof value === 'string' && availablePaths.has(value))
        if (entryPath) return entryPath
      }
    } catch { /* A malformed manifest remains available for manual repair. */ }
  }

  return files[0]?.path ?? ''
}

export function workspaceAndroidBackAction(surface: ProjectSessionSurface, split: boolean, compactPane: WorkspaceFilePane): WorkspaceAndroidBackAction {
  if (surface !== 'files') return 'propagate'
  if (!split && compactPane === 'editor') return 'show-file-browser'
  return 'show-agent'
}

export function workspaceFilePaneVisibility(width: number, compactPane: WorkspaceFilePane): { split: boolean; browser: boolean; editor: boolean } {
  const split = width >= 820
  return {
    split,
    browser: split || compactPane === 'browser',
    editor: split || compactPane === 'editor',
  }
}
