import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectRunScreen from '../app/run/[id]'

const state = vi.hoisted(() => ({
  id: 'daily-notes',
  loadStatus: 'loading',
  projects: [] as Array<{ id: string; name: string }>,
  link: undefined as ((event: { url: string }) => void) | undefined,
  open: vi.fn(async () => undefined),
  replace: vi.fn(),
  retryLoad: vi.fn(async () => undefined),
}))

vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', Platform: { OS: 'web' }, StyleSheet: { create: (value: unknown) => value },
  Linking: { addEventListener: (_name: string, listener: typeof state.link) => {
    state.link = listener
    return { remove() { state.link = undefined } }
  } },
}))
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react')
  return { router: { replace: state.replace }, useLocalSearchParams: () => ({ id: state.id }), useFocusEffect: (callback: () => (() => void)) => useEffect(callback, [callback]) }
})
vi.mock('expo-image', () => ({ Image: 'Image' }))
vi.mock('heroui-native/button', async () => {
  const { createElement } = await import('react')
  return { Button: Object.assign(({ children }: { children: React.ReactNode }) => createElement('button', null, children), { Label: 'span' }) }
})
vi.mock('heroui-native/spinner', () => ({ Spinner: 'Spinner' }))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('@/components/AppIcon', () => ({ AppIcon: 'AppIcon' }))
vi.mock('@/components/icons', () => ({ ArrowLeft: 'ArrowLeft', Pencil: 'Pencil', Play: 'Play' }))
vi.mock('@/components/PendingButton', () => ({ PendingButton: ({ children }: { children: unknown }) => typeof children === 'function' ? children({ isPending: false }) : children }))
vi.mock('@/components/ProjectLoadFailure', () => ({ ProjectLoadFailure: 'ProjectLoadFailure' }))
vi.mock('@/components/PreviewPanel', async () => {
  const { createElement, forwardRef, useImperativeHandle } = await import('react')
  return { PreviewPanel: forwardRef((props: object, ref) => {
    useImperativeHandle(ref, () => ({ open: state.open }))
    return createElement('section', props)
  }) }
})
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/state/projects', () => ({ useProjects: () => state }))
vi.mock('@/theme/tokens', () => ({ useAppColors: () => ({}) }))
vi.mock('@/utils/project-shortcut-storage', () => ({ loadProjectShortcut: vi.fn() }))

let tree: ReactTestRenderer
const nodeRequire = createRequire(import.meta.url)
const originalImageLoader = nodeRequire.extensions['.png']
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // Metro handles this static image in the app; Node does not decode assets.
  nodeRequire.extensions['.png'] = (module) => { module.exports = 1 }
  state.id = 'daily-notes'
  state.loadStatus = 'loading'
  state.projects = []
  state.open.mockClear()
})
afterEach(async () => {
  await act(async () => tree?.unmount())
  if (originalImageLoader) nodeRequire.extensions['.png'] = originalImageLoader
  else delete nodeRequire.extensions['.png']
  vi.unstubAllGlobals()
})

describe('Home Screen launch route', () => {
  it('waits for local projects, then auto-opens Preview without mounting an editor', async () => {
    // The store can publish its project list before draft hydration is ready.
    state.projects = [{ id: state.id, name: 'Notes' }]
    await act(async () => { tree = create(<ProjectRunScreen />) })
    expect(tree.root.findAllByType('section')).toHaveLength(0)
    state.loadStatus = 'ready'
    await act(async () => tree.update(<ProjectRunScreen />))
    expect(tree.root.findByType('section').props).toMatchObject({ autoOpen: true, project: state.projects[0] })
  })

  it('reopens a minimized preview for the same link and ignores other projects', async () => {
    state.projects = [{ id: state.id, name: 'Notes' }]
    state.loadStatus = 'ready'
    await act(async () => { tree = create(<ProjectRunScreen />) })
    state.open.mockClear()
    await act(async () => { state.link?.({ url: 'runwhale://run/daily-notes' }) })
    expect(state.open).toHaveBeenCalledOnce()
    await act(async () => { state.link?.({ url: 'runwhale://run/other-project' }) })
    expect(state.open).toHaveBeenCalledOnce()
  })

  it('shows a missing-project explanation and never starts Preview for a deleted project', async () => {
    state.loadStatus = 'ready'
    await act(async () => { tree = create(<ProjectRunScreen />) })
    expect(tree.root.findAllByType('section')).toHaveLength(0)
    expect(JSON.stringify(tree.toJSON())).toContain('shortcutMissingProject')
  })
})
