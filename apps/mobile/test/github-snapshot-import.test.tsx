import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitHubSnapshotImportScreen } from '../src/components/GitHubSnapshotImportScreen'

const state = vi.hoisted(() => ({
  info: undefined as object | undefined,
  loadStatus: 'ready',
  importGithubSnapshot: vi.fn(),
  addProject: vi.fn(),
  replace: vi.fn(),
}))
vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', ScrollView: 'ScrollView', Linking: { openURL: vi.fn() },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
}))
vi.mock('expo-router', () => ({ router: { replace: state.replace } }))
vi.mock('heroui-native/button', async () => {
  const { createElement } = await import('react')
  return { Button: Object.assign(({ children }: { children: React.ReactNode }) => createElement('Button', null, children), { Label: 'Label' }) }
})
vi.mock('heroui-native/spinner', () => ({ Spinner: 'Spinner' }))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('@/components/AppIcon', () => ({ AppIcon: 'AppIcon' }))
vi.mock('@/components/icons', () => ({ CircleCheck: 'check', CircleX: 'x', ExternalLink: 'link', FolderGit2: 'folder', ShieldAlert: 'shield' }))
vi.mock('@/components/PendingButton', async () => {
  const { createElement } = await import('react')
  return { PendingButton: ({ children, ...props }: { children: (state: object) => React.ReactNode }) => createElement('button', props, children(props)) }
})
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/state/projects', () => ({ useProjects: () => state }))
vi.mock('@/state/runtime', () => ({ useRuntime: () => state }))
vi.mock('@/theme/tokens', () => ({ controlSize: {}, radius: {}, typeScale: {}, useAppColors: () => ({}) }))

const reference = { owner: 'runwhale', repo: 'demo', commit: 'a'.repeat(40) }
let tree: ReactTestRenderer
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  state.info = undefined
  state.importGithubSnapshot.mockReset()
})
afterEach(async () => {
  await act(async () => tree?.unmount())
  vi.unstubAllGlobals()
})

describe('GitHub snapshot import readiness', () => {
  it('waits for runtime activation even when local projects have already loaded', async () => {
    await act(async () => { tree = create(<GitHubSnapshotImportScreen initialReference={reference} />) })
    expect(tree.root.findByType('button').props.isDisabled).toBe(true)
    expect(JSON.stringify(tree.toJSON())).toContain('githubImportWaitingForRuntime')
    await act(async () => { tree.root.findByType('button').props.onPress() })
    expect(state.importGithubSnapshot).not.toHaveBeenCalled()

    state.info = {}
    await act(async () => tree.update(<GitHubSnapshotImportScreen initialReference={reference} />))
    expect(tree.root.findByType('button').props.isDisabled).toBe(false)
    const project = { id: 'demo', name: 'Demo', files: [] }
    state.importGithubSnapshot.mockResolvedValue(project)
    await act(async () => { tree.root.findByType('button').props.onPress() })
    expect(state.importGithubSnapshot).toHaveBeenCalledOnce()
    expect(state.addProject).toHaveBeenCalledWith(project)
    expect(state.replace).toHaveBeenCalledWith({ pathname: '/workspace/[id]', params: { id: project.id } })
  })
})
