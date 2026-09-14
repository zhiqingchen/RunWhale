import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ModelSettings, type ModelCredentialState } from '../src/screens/settings/ModelSettings'

const fixtures = vi.hoisted(() => ({
  read: vi.fn<() => Promise<string | null>>(),
  persist: vi.fn(),
  request: vi.fn(),
  t: (key: string) => key,
  preferences: {
    modelProvider: 'openai', model: 'test-model',
    modelProfiles: { openai: { models: [{ id: 'test-model' }] } },
    setModelProvider: vi.fn(), setModel: vi.fn(), setModelProfile: vi.fn(),
  },
}))

type TestProps = { children?: ReactNode; [key: string]: unknown }

vi.mock('#extensions', () => ({ renderSlot: () => undefined }))
vi.mock('@/components/AppDialog', () => ({ AppDialog: () => null }))
vi.mock('@/components/AppIcon', () => ({ AppIcon: 'AppIcon' }))
vi.mock('@/components/ProviderIcon', () => ({ ProviderIcon: 'ProviderIcon' }))
vi.mock('@/components/icons', () => ({ ChevronDown: 'ChevronDown', CircleCheck: 'CircleCheck', Globe: 'Globe', Image: 'Image', Plus: 'Plus', Trash2: 'Trash2' }))
vi.mock('@/components/PendingButton', () => ({
  PendingButton: ({ children, ...props }: { children: (state: { isPending: boolean }) => ReactNode; isPending: boolean }) => createElement('Button', props, children({ isPending: props.isPending })),
}))
vi.mock('heroui-native/button', () => ({
  Button: Object.assign(({ children, ...props }: TestProps) => createElement('Button', props, children), { Label: 'Label' }),
}))
vi.mock('heroui-native/alert', () => ({
  Alert: Object.assign(({ children, ...props }: TestProps) => createElement('Alert', props, children), { Content: 'AlertContent', Description: 'AlertDescription', Indicator: 'AlertIndicator' }),
}))
vi.mock('heroui-native/spinner', () => ({ Spinner: 'Spinner' }))
vi.mock('expo-secure-store', () => ({ getItemAsync: fixtures.read, setItemAsync: fixtures.persist, deleteItemAsync: vi.fn(), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' }))
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: fixtures.t }) }))
vi.mock('@/state/preferences', () => ({ usePreferences: () => fixtures.preferences }))
vi.mock('@/state/runtime', () => ({ useRuntime: () => ({ request: fixtures.request }) }))
vi.mock('@/theme/tokens', () => ({ useAppColors: () => ({}) }))
vi.mock('@/screens/settings/settings-styles', () => ({ useSettingsStyles: () => ({}) }))
vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn() }, Keyboard: { dismiss: vi.fn() },
  Platform: { OS: 'ios' }, Text: 'Text', TextInput: 'TextInput', View: 'View',
  useWindowDimensions: () => ({ width: 390, fontScale: 1 }),
}))

let tree: ReactTestRenderer | undefined
const onStateChange = vi.fn<(state: ModelCredentialState) => void>()
const latestState = () => onStateChange.mock.lastCall?.[0]
const input = () => tree!.root.findByType('TextInput' as never)
const button = (testID: string) => tree!.root.findAll((node) => typeof node.type === 'string' && node.props.testID === testID)[0]!

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fixtures.read.mockReset().mockResolvedValue(null)
  fixtures.persist.mockReset().mockResolvedValue(undefined)
  fixtures.request.mockReset().mockResolvedValue(undefined)
  onStateChange.mockClear()
})

afterEach(async () => {
  await act(async () => { tree?.unmount() })
  tree = undefined
  vi.unstubAllGlobals()
})

async function mount() {
  await act(async () => {
    tree = create(<ModelSettings variant="onboarding" onInputBlur={() => undefined} onInputFocus={() => undefined} onCredentialStateChange={onStateChange} />)
  })
}

it('reports an existing key as configured only after the runtime activates it', async () => {
  fixtures.read.mockResolvedValue('test-provider-credential')
  let activate!: () => void
  fixtures.request.mockImplementation(() => new Promise<void>((resolve) => { activate = resolve }))
  await mount()
  expect(latestState()).toEqual({ configured: false, busy: true, saving: false, hasDraft: false })
  await act(async () => { activate() })
  expect(latestState()).toEqual({ configured: true, busy: false, saving: false, hasDraft: false })
  expect(input().props.placeholder).toBe('keySaved')
  expect(fixtures.persist).not.toHaveBeenCalled()
})

it('keeps onboarding unconfigured when secure lookup fails', async () => {
  fixtures.read.mockRejectedValue(new Error('secure storage unavailable'))
  await mount()
  expect(latestState()).toEqual({ configured: false, busy: false, saving: false, hasDraft: false })
  expect(fixtures.request).not.toHaveBeenCalled()
})

it('keeps a persisted key unconfigured after activation fails and allows another save', async () => {
  await mount()
  await act(async () => { input().props.onChangeText('test-provider-credential') })
  expect(latestState()).toEqual({ configured: false, busy: false, saving: false, hasDraft: true })
  fixtures.request.mockRejectedValueOnce(new Error('runtime unavailable'))
  await act(async () => { button('model-api-key-save').props.onPress() })
  expect(fixtures.persist).toHaveBeenCalledOnce()
  expect(onStateChange).toHaveBeenCalledWith({ configured: false, busy: true, saving: true, hasDraft: true })
  expect(latestState()).toEqual({ configured: false, busy: false, saving: false, hasDraft: false })
  await act(async () => { button('model-api-key-save').props.onPress() })
  expect(latestState()).toEqual({ configured: true, busy: false, saving: false, hasDraft: false })
  expect(input().props.value).toBe('')
})

it('preserves the existing settings lookup without activating the stored key again', async () => {
  fixtures.read.mockResolvedValue('test-provider-credential')
  await act(async () => {
    tree = create(<ModelSettings onInputBlur={() => undefined} onInputFocus={() => undefined} />)
  })
  expect(fixtures.request).not.toHaveBeenCalled()
})
