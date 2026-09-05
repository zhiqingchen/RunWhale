import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Appearance, Platform } from 'react-native'
import type { MobileAgentPreset, MobileModelProvider, MobileModelProviderProfile, MobilePermissionMode } from '@runwhale/mobile-protocol'
import { isMobilePermissionMode } from '@/utils/permission-mode'
import { createPreferenceStorageCoordinator } from '@/utils/preference-storage'
import { normalizedModelProfile } from '@/utils/model-settings'
import { cloneDefaultModelProfiles, MOBILE_DEFAULT_MODELS, modelProfileOverrides, restoreModelProfiles } from '@/utils/model-catalog'

export { MOBILE_DEFAULT_MODELS } from '@/utils/model-catalog'

export type BusyMessageMode = 'followup' | 'steer'
export type AppAppearance = 'system' | 'light' | 'dark'

interface PreferencesContextValue {
  persistenceError?: string
  retryPersistence(): Promise<void>
  busyMessageMode: BusyMessageMode
  setBusyMessageMode(mode: BusyMessageMode): void
  modelProvider: MobileModelProvider
  model: string
  modelProfiles: Readonly<Record<MobileModelProvider, MobileModelProviderProfile>>
  setModelProvider(provider: MobileModelProvider): void
  setModel(model: string): void
  setModelProfile(provider: MobileModelProvider, profile: MobileModelProviderProfile): void
  appearance: AppAppearance
  setAppearance(appearance: AppAppearance): void
  agentPreset: MobileAgentPreset
  setAgentPreset(preset: MobileAgentPreset): void
  permissionMode: MobilePermissionMode
  setPermissionMode(mode: MobilePermissionMode): void
}

interface StoredPreferences {
  busyMessageMode: BusyMessageMode
  modelProvider: MobileModelProvider
  model: string
  modelProfiles: Record<MobileModelProvider, MobileModelProviderProfile>
  appearance: AppAppearance
  agentPreset: MobileAgentPreset
  permissionMode: MobilePermissionMode
}

const STORAGE_KEY = 'runwhale.preferences.v1'
const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined)

export function PreferencesProvider({ children }: PropsWithChildren) {
  const [preferences, setPreferences] = useState<StoredPreferences>({ busyMessageMode: 'followup', modelProvider: 'deepseek', model: MOBILE_DEFAULT_MODELS.deepseek, modelProfiles: cloneDefaultModelProfiles(), appearance: 'system', agentPreset: 'standard', permissionMode: 'review' })
  const [persistenceError, setPersistenceError] = useState<string>()
  const preferencesRef = useRef(preferences)
  const persistence = useMemo(() => createPreferenceStorageCoordinator(
    (failure) => setPersistenceError(failure?.message),
  ), [])
  useEffect(() => {
    let active = true
    void persistence.hydrate(() => AsyncStorage.getItem(STORAGE_KEY), (value) => {
      if (!active) return
      try {
        const saved = JSON.parse(value ?? '{}') as Partial<Record<keyof StoredPreferences | 'modelProfilesVersion', unknown>>
        const current = preferencesRef.current
        const provider = isProvider(saved.modelProvider) ? saved.modelProvider : current.modelProvider
        const modelProfiles = restoreModelProfiles(saved.modelProfiles, saved.modelProfilesVersion)
        const availableModels = modelProfiles[provider].models.map((entry) => entry.id)
        const savedModel = typeof saved.model === 'string' ? saved.model.trim() : ''
        const next: StoredPreferences = {
          busyMessageMode: saved.busyMessageMode === 'followup' || saved.busyMessageMode === 'steer' ? saved.busyMessageMode : current.busyMessageMode,
          modelProvider: provider,
          model: savedModel && availableModels.includes(savedModel) ? savedModel : availableModels[0] ?? MOBILE_DEFAULT_MODELS[provider],
          modelProfiles,
          appearance: saved.appearance === 'light' || saved.appearance === 'dark' || saved.appearance === 'system' ? saved.appearance : current.appearance,
          agentPreset: saved.agentPreset === 'standard' || saved.agentPreset === 'minimal' ? saved.agentPreset : current.agentPreset,
          permissionMode: isMobilePermissionMode(saved.permissionMode) ? saved.permissionMode : current.permissionMode,
        }
        preferencesRef.current = next
        setPreferences(next)
      } catch { /* malformed local preferences fall back to safe defaults */ }
    })
    return () => { active = false }
  }, [persistence])
  useEffect(() => {
    if (Platform.OS !== 'web') Appearance.setColorScheme(preferences.appearance === 'system' ? 'unspecified' : preferences.appearance)
  }, [preferences.appearance])
  const update = useCallback((change: (current: StoredPreferences) => StoredPreferences) => {
    const next = change(preferencesRef.current)
    preferencesRef.current = next
    setPreferences(next)
    const stored = { ...next, modelProfilesVersion: 2, modelProfiles: modelProfileOverrides(next.modelProfiles) }
    void persistence.persist(JSON.stringify(stored), (value) => AsyncStorage.setItem(STORAGE_KEY, value)).catch(() => undefined)
  }, [persistence])
  const setBusyMessageMode = useCallback((mode: BusyMessageMode) => {
    update((current) => ({ ...current, busyMessageMode: mode }))
  }, [update])
  const setModelProvider = useCallback((provider: MobileModelProvider) => {
    update((current) => ({ ...current, modelProvider: provider, model: current.modelProfiles[provider].models[0]?.id ?? MOBILE_DEFAULT_MODELS[provider] }))
  }, [update])
  const setModel = useCallback((model: string) => { update((current) => ({ ...current, model: model.trim() })) }, [update])
  const setModelProfile = useCallback((provider: MobileModelProvider, profile: MobileModelProviderProfile) => {
    const normalized = normalizedModelProfile(profile)
    update((current) => {
      const modelProfiles = { ...current.modelProfiles, [provider]: normalized }
      const model = current.modelProvider === provider && !normalized.models.some((entry) => entry.id === current.model)
        ? normalized.models[0]!.id
        : current.model
      return { ...current, modelProfiles, model }
    })
  }, [update])
  const setAppearance = useCallback((appearance: AppAppearance) => { update((current) => ({ ...current, appearance })) }, [update])
  const setAgentPreset = useCallback((agentPreset: MobileAgentPreset) => { update((current) => ({ ...current, agentPreset })) }, [update])
  const setPermissionMode = useCallback((permissionMode: MobilePermissionMode) => { update((current) => ({ ...current, permissionMode })) }, [update])
  const value = useMemo(() => ({ ...preferences, persistenceError, retryPersistence: persistence.retryLatest, setBusyMessageMode, setModelProvider, setModel, setModelProfile, setAppearance, setAgentPreset, setPermissionMode }), [persistence.retryLatest, persistenceError, preferences, setBusyMessageMode, setModelProvider, setModel, setModelProfile, setAppearance, setAgentPreset, setPermissionMode])
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext)
  if (!value) throw new Error('usePreferences must be used inside PreferencesProvider')
  return value
}

function isProvider(value: unknown): value is MobileModelProvider {
  return value === 'deepseek' || value === 'openai' || value === 'anthropic' || value === 'google'
}
