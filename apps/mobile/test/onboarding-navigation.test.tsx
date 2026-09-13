import { createRequire } from 'node:module'
import { createElement, useEffect, useState, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OnboardingScreen } from '../src/screens/OnboardingScreen'
import type { ModelCredentialState } from '../src/screens/settings/ModelSettings'
import type { OnboardingSubscriptionProps } from '../src/extension-types'

const fixtures = vi.hoisted(() => ({
  persist: vi.fn<() => Promise<void>>(),
  request: vi.fn<() => Promise<{ configured: boolean }>>(),
  replay: undefined as string | undefined,
  routes: ['/onboarding'],
  scrollTo: vi.fn(),
  subscription: false,
  colors: {},
}))

type TestProps = { children?: ReactNode; [key: string]: unknown }
type ScrollEvent = { nativeEvent: { contentOffset: { x: number } } }

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { setItem: fixtures.persist } }))
vi.mock('#extensions', () => ({
  renderSlot: (name: string, props?: OnboardingSubscriptionProps) => fixtures.subscription && name === 'onboarding.subscription'
    ? createElement('Subscription', props)
    : null,
}))
vi.mock('expo-router', () => {
  const router = {
    dismissTo(path: string) {
      const index = fixtures.routes.lastIndexOf(path)
      if (index >= 0) fixtures.routes.splice(index + 1)
      else fixtures.routes.splice(-1, 1, path)
    },
    push: (path: string) => { fixtures.routes.push(path) },
    replace: (path: string) => { fixtures.routes.splice(-1, 1, path) },
    canGoBack: () => fixtures.routes.length > 1,
    back: () => { fixtures.routes.pop() },
  }
  return {
    useRouter: () => router,
    useLocalSearchParams: () => ({ replay: fixtures.replay }),
    useFocusEffect: (callback: () => () => void) => useEffect(callback, [callback]),
  }
})
vi.mock('@/components/AppIcon', () => ({ AppIcon: 'AppIcon' }))
vi.mock('@/components/icons', () => ({ ArrowLeft: 'ArrowLeft', ChevronRight: 'ChevronRight', KeyRound: 'KeyRound', ShieldCheck: 'ShieldCheck' }))
vi.mock('@/components/FirstRunGuide', () => ({ ONBOARDING_STORAGE_KEY: 'runwhale.onboarding.v1' }))
vi.mock('@/components/OnboardingScene', () => ({ OnboardingScene: 'OnboardingScene' }))
vi.mock('@/screens/settings/ModelSettings', () => ({
  ModelSettings: (props: TestProps) => {
    const [draft, setDraft] = useState('')
    return createElement('ModelSettings', { ...props, draft, onDraftChange: setDraft })
  },
}))
vi.mock('@/hooks/useFocusedInputScroll', () => ({ useFocusedInputScroll: () => ({}) }))
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/state/preferences', () => ({ usePreferences: () => ({ modelProvider: 'openai', preferencesReady: true }) }))
vi.mock('@/state/runtime', () => ({ useRuntime: () => ({ info: true, request: fixtures.request }) }))
vi.mock('@/theme/tokens', () => ({ useAppColors: () => fixtures.colors }))
vi.mock('heroui-native/button', () => ({
  Button: Object.assign(({ children, ...props }: TestProps) => createElement('Button', props, children), { Label: 'Label' }),
}))
vi.mock('heroui-native/spinner', () => ({ Spinner: 'Spinner' }))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('react-native', () => {
  class Value {
    value: number
    constructor(value: number) { this.value = value }
    setValue(value: number) { this.value = value }
    interpolate() { return this.value }
  }
  return {
    Animated: {
      Value, View: 'AnimatedView', ScrollView: 'AnimatedScrollView',
      event: (mapping: { nativeEvent: { contentOffset: { x: Value } } }[], options: { listener?(event: ScrollEvent): void }) => (event: ScrollEvent) => {
        mapping[0]!.nativeEvent.contentOffset.x.setValue(event.nativeEvent.contentOffset.x)
        options.listener?.(event)
      },
    },
    BackHandler: { addEventListener: () => ({ remove() {} }) },
    Keyboard: { dismiss() {}, addListener: () => ({ remove() {} }) }, Platform: { OS: 'android' },
    StyleSheet: { create: (styles: unknown) => styles },
    Image: 'Image', KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  }
})

const nodeRequire = createRequire(import.meta.url)
const originalImageLoader = nodeRequire.extensions['.png']
let tree: ReactTestRenderer | undefined
const hosts = (testID: string) => tree!.root.findAll((node) => typeof node.type === 'string' && node.props.testID === testID)
const host = (testID: string) => hosts(testID)[0]!
const carousel = () => host('onboarding-carousel')
const scrollEvent = (page: number): ScrollEvent => ({ nativeEvent: { contentOffset: { x: page * 390 } } })

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  nodeRequire.extensions['.png'] = (module) => { module.exports = 1 }
  fixtures.persist.mockReset().mockResolvedValue(undefined)
  fixtures.request.mockReset().mockResolvedValue({ configured: false })
  fixtures.scrollTo.mockClear()
  fixtures.subscription = false
  fixtures.replay = undefined
  fixtures.routes = ['/onboarding']
})

afterEach(async () => {
  await act(async () => { tree?.unmount() })
  tree = undefined
  if (originalImageLoader) nodeRequire.extensions['.png'] = originalImageLoader
  else delete nodeRequire.extensions['.png']
  vi.unstubAllGlobals()
})

async function mount() {
  await act(async () => {
    tree = create(<OnboardingScreen />, {
      createNodeMock: (element) => element.type === 'AnimatedScrollView' ? { scrollTo: fixtures.scrollTo } : null,
    })
  })
}

async function settlePage(page: number) {
  await act(async () => { carousel().props.onMomentumScrollEnd(scrollEvent(page)) })
}

async function press(testID: string) {
  const target = host(testID)
  expect(String(target.type) === 'Pressable' ? target.props.disabled : target.props.isDisabled).toBe(false)
  await act(async () => { host(testID).props.onPress() })
}

it('shows no Next or create action on the introductory pages before setup', async () => {
  await mount()
  for (const page of [0, 1, 2]) {
    await settlePage(page)
    expect(hosts('onboarding-next')).toHaveLength(0)
    expect(hosts('onboarding-create')).toHaveLength(0)
  }
  await settlePage(3)
  expect(hosts('onboarding-create')).toHaveLength(1)
})

it('scrolls to a tapped pagination dot without changing the selected page before momentum ends', async () => {
  await mount()
  fixtures.scrollTo.mockClear()
  await press('onboarding-page-2')
  expect(fixtures.scrollTo).toHaveBeenCalledExactlyOnceWith({ x: 780, animated: true })
  expect(host('onboarding-page-0').props.accessibilityState.selected).toBe(true)
  expect(host('onboarding-page-2').props.accessibilityState.selected).toBe(false)

  await act(async () => { carousel().props.onScroll(scrollEvent(1.6)) })
  expect(host('onboarding-page-0').props.accessibilityState.selected).toBe(true)
  await settlePage(2)
  expect(host('onboarding-page-0').props.accessibilityState.selected).toBe(false)
  expect(host('onboarding-page-2').props.accessibilityState.selected).toBe(true)
})

it('keeps the pager scrollable while dragging into the key page and commits only when it settles', async () => {
  await mount()
  await settlePage(2)
  await act(async () => { carousel().props.onScroll(scrollEvent(2.6)) })
  expect(carousel().props.scrollEnabled).toBe(true)
  expect(tree!.root.findAllByType('ModelSettings' as never)).toHaveLength(0)

  await settlePage(3)
  expect(carousel().props.scrollEnabled).toBe(false)
  expect(tree!.root.findAllByType('ModelSettings' as never)).toHaveLength(1)
})

it('opens project creation above Home after completing the guide with a configured model', async () => {
  fixtures.request.mockResolvedValue({ configured: true })
  await mount()
  await settlePage(2)
  await press('onboarding-create')
  expect(fixtures.persist).toHaveBeenCalledWith('runwhale.onboarding.v1', 'completed')
  expect(fixtures.routes).toEqual(['/(tabs)', '/new'])
})

it('preserves the Home exit when creating a project before adding an API key', async () => {
  await mount()
  await settlePage(3)
  await act(async () => {
    tree!.root.findByType('ModelSettings' as never).props.onCredentialStateChange({ configured: false, busy: false, saving: false, hasDraft: false } satisfies ModelCredentialState)
  })
  expect(host('onboarding-create').props.isDisabled).toBe(true)
  await press('onboarding-later')
  expect(fixtures.routes).toEqual(['/(tabs)', '/new'])
})

it('keeps completion in the guide until storage succeeds and allows retry after failure', async () => {
  fixtures.request.mockResolvedValue({ configured: true })
  let fail!: (error: Error) => void
  fixtures.persist.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject }))
  await mount()
  await settlePage(2)
  await press('onboarding-create')
  expect(fixtures.routes).toEqual(['/onboarding'])
  expect(host('onboarding-create').props.isDisabled).toBe(true)

  await act(async () => { fail(new Error('storage unavailable')) })
  expect(fixtures.routes).toEqual(['/onboarding'])
  expect(tree!.root.findAll((node) => String(node.type) === 'Text' && node.props.children === 'onboardingStorageError')).toHaveLength(1)
  await press('onboarding-create')
  expect(fixtures.persist).toHaveBeenCalledTimes(2)
  expect(fixtures.routes).toEqual(['/(tabs)', '/new'])
})

it('inserts the subscription before API key setup and preserves the key draft when returning', async () => {
  fixtures.subscription = true
  await mount()
  expect(hosts('onboarding-page-4')).toHaveLength(1)
  expect(hosts('onboarding-page-5')).toHaveLength(0)
  expect(tree!.root.findByType('Subscription' as never).props.active).toBe(false)

  await settlePage(3)
  const subscription = tree!.root.findByType('Subscription' as never)
  expect(subscription.props.active).toBe(true)
  expect(hosts('onboarding-create')).toHaveLength(0)
  expect(tree!.root.findAllByType('ModelSettings' as never)).toHaveLength(0)
  fixtures.scrollTo.mockClear()
  await act(async () => { subscription.props.onUseApiKey() })
  expect(fixtures.scrollTo).toHaveBeenCalledExactlyOnceWith({ x: 1560, animated: true })
  expect(host('onboarding-page-3').props.accessibilityState.selected).toBe(true)

  await settlePage(4)
  const modelSettings = tree!.root.findByType('ModelSettings' as never)
  await act(async () => { modelSettings.props.onDraftChange('unsaved-test-draft') })
  expect(hosts('onboarding-create')).toHaveLength(1)
  expect(subscription.props.active).toBe(false)
  await press('onboarding-page-3')
  await settlePage(3)
  expect(subscription.props.active).toBe(true)
  expect(tree!.root.findByType('ModelSettings' as never)).toBe(modelSettings)
  expect(modelSettings.props.draft).toBe('unsaved-test-draft')

  await act(async () => { subscription.props.onUseApiKey() })
  await settlePage(4)
  expect(tree!.root.findByType('ModelSettings' as never)).toBe(modelSettings)
  expect(modelSettings.props.draft).toBe('unsaved-test-draft')
})

it('ends at the subscription with a create action when a model is already configured', async () => {
  fixtures.subscription = true
  fixtures.request.mockResolvedValue({ configured: true })
  await mount()
  expect(hosts('onboarding-page-3')).toHaveLength(1)
  expect(hosts('onboarding-page-4')).toHaveLength(0)
  await settlePage(2)
  expect(hosts('onboarding-create')).toHaveLength(0)
  await settlePage(3)
  const subscription = tree!.root.findByType('Subscription' as never)
  expect(subscription.props.active).toBe(true)
  expect(subscription.props.onUseApiKey).toBeUndefined()
  expect(tree!.root.findAllByType('ModelSettings' as never)).toHaveLength(0)
  await press('onboarding-create')
  expect(fixtures.routes).toEqual(['/(tabs)', '/new'])
})

it.each([false, true])('skips without creating a project when replay is %s', async (replay) => {
  if (replay) {
    fixtures.replay = '1'
    fixtures.routes = ['/settings/about', '/onboarding']
  }
  await mount()
  await press('onboarding-skip')
  expect(fixtures.persist).toHaveBeenCalledWith('runwhale.onboarding.v1', 'completed')
  expect(fixtures.routes).toEqual([replay ? '/settings/about' : '/(tabs)'])
})
