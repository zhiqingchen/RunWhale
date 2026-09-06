export type PreviewTarget = 'native' | 'web'

export interface ActivePreview {
  target: PreviewTarget
  bundleUrl: string
  revision: number
  pageUrl?: string
  opened: boolean
}

export interface PreviewLifecycleState {
  selectedTarget: PreviewTarget
  active?: ActivePreview
  webVisible: boolean
  operation?: 'run' | 'open' | 'stop'
  error?: string
}

export type PreviewLifecycleAction =
  | { type: 'configure-target'; target: PreviewTarget }
  | { type: 'open-requested' }
  | { type: 'run-started' }
  | { type: 'bundle-ready'; target: PreviewTarget; bundleUrl: string; revision?: number; pageUrl?: string }
  | { type: 'open-started'; bundleUrl: string }
  | { type: 'content-opened'; bundleUrl: string }
  | { type: 'content-failed'; bundleUrl?: string; message: string }
  | { type: 'dismiss-error' }
  | { type: 'launch-cancelled' }
  | { type: 'preview-closed' }
  | { type: 'minimize-web' }
  | { type: 'stop-started' }
  | { type: 'stopped' }

export function initialPreviewLifecycleState(selectedTarget: PreviewTarget = 'web'): PreviewLifecycleState {
  return { selectedTarget, webVisible: false }
}

export function previewLifecycleReducer(state: PreviewLifecycleState, action: PreviewLifecycleAction): PreviewLifecycleState {
  switch (action.type) {
    case 'configure-target':
      if (state.selectedTarget === action.target) return state
      return { ...state, selectedTarget: action.target, webVisible: false, error: undefined }
    case 'open-requested':
      return { ...state, webVisible: false, operation: 'open', error: undefined }
    case 'run-started':
      return { ...state, webVisible: false, operation: 'run', error: undefined }
    case 'bundle-ready':
      return {
        ...state,
        active: {
          target: action.target,
          bundleUrl: action.bundleUrl,
          revision: action.revision ?? 0,
          ...(action.pageUrl ? { pageUrl: action.pageUrl } : {}),
          opened: false,
        },
        webVisible: action.target === 'web',
        operation: 'open',
        error: undefined,
      }
    case 'open-started':
      if (state.active?.bundleUrl !== action.bundleUrl) return state
      return {
        ...state,
        active: { ...state.active, opened: false },
        webVisible: state.active.target === 'web',
        operation: 'open',
        error: undefined,
      }
    case 'content-opened':
      if (state.active?.bundleUrl !== action.bundleUrl) return state
      if (state.operation === 'run') return state
      if (state.error !== undefined && state.operation === undefined) return state
      return { ...state, active: { ...state.active, opened: true }, operation: undefined, error: undefined }
    case 'content-failed':
      if (action.bundleUrl && state.active?.bundleUrl !== action.bundleUrl) return state
      if (action.bundleUrl && state.operation === 'run') return state
      if (state.error === action.message && !state.webVisible && state.operation === undefined) return state
      return {
        ...state,
        active: action.bundleUrl && state.active ? { ...state.active, opened: false } : state.active,
        webVisible: false,
        operation: undefined,
        error: action.message,
      }
    case 'dismiss-error':
      if (state.error === undefined) return state
      return { ...state, error: undefined }
    case 'launch-cancelled':
      return { ...state, operation: undefined, error: undefined }
    case 'preview-closed':
      return { ...state, webVisible: false, operation: undefined, error: undefined }
    case 'minimize-web':
      return { ...state, webVisible: false, operation: state.operation === 'open' ? undefined : state.operation }
    case 'stop-started':
      return { ...state, operation: 'stop', error: undefined }
    case 'stopped':
      return { selectedTarget: state.selectedTarget, webVisible: false }
  }
}

export function selectedActivePreview(state: PreviewLifecycleState): ActivePreview | undefined {
  return state.active?.target === state.selectedTarget ? state.active : undefined
}

export function webPreviewPageUrl(bundleUrl: string): string {
  const page = new URL(bundleUrl)
  const port = Number(page.port)
  if (page.protocol !== 'http:' || page.hostname !== '127.0.0.1' || !Number.isInteger(port) || port < 1 || port > 65_535 || !page.searchParams.get('token')) {
    throw new Error('Web Preview requires a token-protected localhost URL')
  }
  page.pathname = '/'
  page.hash = ''
  page.searchParams.delete('platform')
  return page.toString()
}
