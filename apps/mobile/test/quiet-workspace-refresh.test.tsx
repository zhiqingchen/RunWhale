import { createRequire } from 'node:module'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import HomeScreen from '../app/(tabs)/index'
import WorkspaceScreen from '../app/(tabs)/workspace'

const state = vi.hoisted(() => ({
  projects: [{ id: 'notes', name: 'Notes', description: '', files: [], updatedAt: 1 }],
  runtime: { info: {} as object | undefined, lastError: undefined as string | undefined, request: vi.fn() },
}))
vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', Image: 'Image', ScrollView: 'ScrollView', Pressable: 'Pressable', TextInput: 'TextInput',
  Platform: { OS: 'ios' }, StyleSheet: { create: (value: unknown) => value },
  useWindowDimensions: () => ({ width: 390 }), useColorScheme: () => 'light',
}))
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react')
  return { router: { push: vi.fn() }, useFocusEffect: (callback: () => () => void) => useEffect(callback, [callback]) }
})
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }))
vi.mock('heroui-native/button', async () => {
  const { createElement } = await import('react')
  return { Button: Object.assign(({ children, ...props }: { children: React.ReactNode }) => createElement('button', props, typeof children === 'function' ? null : children), { Label: 'span' }) }
})
vi.mock('heroui-native/alert', () => ({ Alert: Object.assign('Alert', { Content: 'Content', Description: 'Description', Indicator: 'Indicator' }) }))
vi.mock('heroui-native/spinner', () => ({ Spinner: 'Spinner' }))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('@/components/AppIcon', () => ({ AppIcon: 'AppIcon' }))
vi.mock('@/components/icons', () => ({ ChevronDown: '', ChevronRight: '', CircleEllipsis: '', Code2: '', FolderGit2: '', FolderInput: '', Pencil: '', Play: '', Plus: '', Share2: '', Smartphone: '', Trash2: '', History: '' }))
vi.mock('@/components/AppDialog', () => ({ AppDialog: () => null }))
vi.mock('@/components/PendingButton', () => ({ PendingButton: () => null }))
vi.mock('@/components/NewProjectButton', () => ({ NewProjectButton: () => null }))
vi.mock('@/components/PreviewPanel', () => ({ PreviewPanel: () => null }))
vi.mock('@/components/ProjectLoadFailure', () => ({ ProjectLoadFailure: 'ProjectLoadFailure' }))
vi.mock('@/i18n', () => ({ useI18n: () => ({ language: 'en', t: (key: string) => key }) }))
vi.mock('@/state/projects', () => ({ useProjects: () => ({ projects: state.projects, loadStatus: 'ready' }), projectFilePaths: () => [], isGitHubImportedProject: () => false }))
vi.mock('@/state/runtime', () => ({ useRuntime: () => state.runtime }))
vi.mock('@/utils/project-shortcut-storage', () => ({ removeProjectShortcutAppearance: vi.fn() }))

let tree: ReactTestRenderer
const nodeRequire = createRequire(import.meta.url)
const originalImageLoader = nodeRequire.extensions['.png']
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  nodeRequire.extensions['.png'] = (module) => { module.exports = 1 }
  state.projects = [{ id: 'notes', name: 'Notes', description: '', files: [], updatedAt: 1 }]
  state.runtime.info = {}
  state.runtime.lastError = undefined
  state.runtime.request.mockReset()
})
afterEach(async () => {
  await act(async () => tree?.unmount())
  if (originalImageLoader) nodeRequire.extensions['.png'] = originalImageLoader
  else delete nodeRequire.extensions['.png']
  vi.unstubAllGlobals()
})

function session(title: string) {
  return { projectId: 'notes', sessionId: 'session', title, preview: 'Saved summary', state: 'completed', updatedAt: 1, turnCount: 2 }
}
function requestSessions(promise: Promise<unknown>) {
  state.runtime.request.mockImplementation((method: string) => method === 'session.list' ? promise : Promise.resolve(method === 'host.snapshot' ? { snapshot: { state: 'running' } } : { events: [] }))
}
function content() { return JSON.stringify(tree.toJSON()) }

for (const [name, Screen] of [['Workspace', WorkspaceScreen], ['Home', HomeScreen]] as const) {
  it(`${name} preserves loaded sessions across reconnect, failed refresh, and successful replacement`, async () => {
    let finish!: (value: unknown) => void
    requestSessions(new Promise((resolve) => { finish = resolve }))
    await act(async () => { tree = create(<Screen />) })
    expect(content()).toContain('loadingSessions')
    await act(async () => finish([session('Original conversation')]))
    expect(content()).toContain('Original conversation')

    state.runtime.info = undefined
    await act(async () => tree.update(<Screen />))
    expect(content()).toContain('Original conversation')
    expect(content()).not.toContain('loadingSessions')

    let fail!: (error: Error) => void
    requestSessions(new Promise((_resolve, reject) => { fail = reject }))
    state.runtime.info = {}
    await act(async () => tree.update(<Screen />))
    expect(content()).toContain('Original conversation')
    expect(content()).not.toContain('Spinner')
    await act(async () => fail(new Error('Connection recovering')))
    expect(content()).toContain('Original conversation')
    expect(content()).not.toContain('sessionsLoadFailed')

    requestSessions(new Promise((resolve) => { finish = resolve }))
    state.runtime.info = {}
    await act(async () => tree.update(<Screen />))
    await act(async () => finish([session('Updated conversation')]))
    expect(content()).toContain('Updated conversation')
    expect(content()).not.toContain('Original conversation')

    requestSessions(new Promise((resolve) => { finish = resolve }))
    state.runtime.info = {}
    await act(async () => tree.update(<Screen />))
    await act(async () => finish([]))
    expect(content()).toContain('noSessions')
    expect(content()).not.toContain('Updated conversation')
  })
}
