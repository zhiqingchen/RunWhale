import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FirstRunGuide, ONBOARDING_STORAGE_KEY } from '../src/components/FirstRunGuide'

const state = vi.hoisted(() => ({
  pathname: '/',
  languageReady: true,
  preferencesReady: true,
  loadStatus: 'ready',
  projects: [] as { id: string }[],
  read: vi.fn<() => Promise<string | null>>(),
  persist: vi.fn(),
  replace: vi.fn(),
}))

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: state.read, setItem: state.persist } }))
vi.mock('#extensions', () => ({ onboardingEnabled: true }))
vi.mock('expo-router', () => ({ router: { replace: state.replace }, usePathname: () => state.pathname }))
vi.mock('@/i18n', () => ({ useI18n: () => ({ languageReady: state.languageReady }) }))
vi.mock('@/state/preferences', () => ({ usePreferences: () => ({ preferencesReady: state.preferencesReady }) }))
vi.mock('@/state/projects', () => ({ useProjects: () => ({ projects: state.projects, loadStatus: state.loadStatus }) }))

let tree: ReactTestRenderer | undefined

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  state.pathname = '/'
  state.languageReady = true
  state.preferencesReady = true
  state.loadStatus = 'ready'
  state.projects = []
  state.read.mockReset().mockResolvedValue(null)
  state.persist.mockReset().mockResolvedValue(undefined)
  state.replace.mockReset()
})

afterEach(async () => {
  await act(async () => { tree?.unmount() })
  tree = undefined
  vi.unstubAllGlobals()
})

async function mount() {
  await act(async () => { tree = create(<FirstRunGuide />) })
}

it.each(['language', 'preferences', 'projects'] as const)('waits for %s hydration before guiding a fresh home workspace', async (pending) => {
  if (pending === 'language') state.languageReady = false
  if (pending === 'preferences') state.preferencesReady = false
  if (pending === 'projects') state.loadStatus = 'loading'
  await mount()
  expect(state.replace).not.toHaveBeenCalled()

  state.languageReady = true
  state.preferencesReady = true
  state.loadStatus = 'ready'
  await act(async () => { tree!.update(<FirstRunGuide />) })
  expect(state.replace).toHaveBeenCalledExactlyOnceWith('/onboarding')
  expect(state.persist).not.toHaveBeenCalled()
})

it('keeps a completed guide on the home screen', async () => {
  state.read.mockResolvedValue('completed')
  await mount()
  expect(state.replace).not.toHaveBeenCalled()
  expect(state.persist).not.toHaveBeenCalled()
})

it('preserves an existing workspace and records the guide as completed', async () => {
  state.projects = [{ id: 'existing-project' }]
  await mount()
  expect(state.replace).not.toHaveBeenCalled()
  expect(state.persist).toHaveBeenCalledExactlyOnceWith(ONBOARDING_STORAGE_KEY, 'completed')
})

it.each(['/run/my-app', '/g/owner/repository/revision'])('preserves a fresh launch directly to %s', async (pathname) => {
  state.pathname = pathname
  await mount()
  expect(state.replace).not.toHaveBeenCalled()
  expect(state.persist).not.toHaveBeenCalled()
})

it('does not redirect a route opened while the completion check is pending', async () => {
  let finishRead!: (value: string | null) => void
  state.read.mockImplementation(() => new Promise((resolve) => { finishRead = resolve }))
  await mount()

  state.pathname = '/workspace/my-app'
  await act(async () => { tree!.update(<FirstRunGuide />) })
  await act(async () => { finishRead(null) })
  expect(state.replace).not.toHaveBeenCalled()
  expect(state.persist).not.toHaveBeenCalled()
})
