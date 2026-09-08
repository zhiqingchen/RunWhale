import { restorePreferences, usePreferencePolicy } from '#extensions'
import { MOBILE_PROVIDERS, isMobileModelProvider } from '@runwhale/mobile-protocol'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { type PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Appearance, Platform } from 'react-native'
import type { MobileAgentPreset, MobileModelProvider, MobileModelProviderProfile, MobilePermissionMode } from '@runwhale/mobile-protocol'
import { isMobilePermissionMode } from '@/utils/permission-mode'
import { createPreferenceStorageCoordinator } from '@/utils/preference-storage'
import { normalizedModelProfile } from '@/utils/model-settings'
import { cloneDefaultModelProfiles, MOBILE_DEFAULT_MODELS, modelProfileOverrides, restoreModelProfiles } from '@/utils/model-catalog'

import { PreferencesContext, type AppAppearance, type BusyMessageMode, type StoredPreferences } from './preference-context'

export { MOBILE_DEFAULT_MODELS } from '@/utils/model-catalog'

export { usePreferences } from './preference-context'
export type { AppAppearance, BusyMessageMode, StoredPreferences } from './preference-context'

const STORAGE_KEY = 'runwhale.preferences.v1'

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
        const provider = isMobileModelProvider(saved.modelProvider) ? saved.modelProvider : current.modelProvider
        const modelProfiles = restoreModelProfiles(saved.modelProfiles, saved.modelProfilesVersion)
        const availableModels = modelProfiles[provider].models.map((entry) => entry.id)
        const savedModel = typeof saved.model === 'string' ? saved.model.trim() : ''
        const next: StoredPreferences = restorePreferences(saved, {
          extensionState: saved.extensionState,
          busyMessageMode: saved.busyMessageMode === 'followup' || saved.busyMessageMode === 'steer' ? saved.busyMessageMode : current.busyMessageMode,
          modelProvider: provider,
          model: savedModel && (MOBILE_PROVIDERS[provider].managed || availableModels.includes(savedModel)) ? savedModel : availableModels[0] ?? MOBILE_DEFAULT_MODELS[provider],
          modelProfiles,
          appearance: saved.appearance === 'light' || saved.appearance === 'dark' || saved.appearance === 'system' ? saved.appearance : current.appearance,
          agentPreset: saved.agentPreset === 'standard' || saved.agentPreset === 'minimal' ? saved.agentPreset : current.agentPreset,
          permissionMode: isMobilePermissionMode(saved.permissionMode) ? saved.permissionMode : current.permissionMode,
        })
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
  const displayed = usePreferencePolicy(preferences, update)
  const setBusyMessageMode = useCallback((mode: BusyMessageMode) => {
    update((current) => ({ ...current, busyMessageMode: mode }))
  }, [update])
  const setModelProvider = useCallback((provider: MobileModelProvider) => {
    if (MOBILE_PROVIDERS[provider].managed && !displayed.modelProfiles[provider].models.length) return
    update((current) => ({ ...current, modelProvider: provider, model: displayed.modelProfiles[provider].models[0]?.id ?? MOBILE_DEFAULT_MODELS[provider] }))
  }, [update, displayed.modelProfiles])
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
  const value = useMemo(() => ({ ...displayed, persistenceError, retryPersistence: persistence.retryLatest, setBusyMessageMode, setModelProvider, setModel, setModelProfile, setAppearance, setAgentPreset, setPermissionMode }), [persistence.retryLatest, persistenceError, displayed, setBusyMessageMode, setModelProvider, setModel, setModelProfile, setAppearance, setAgentPreset, setPermissionMode])
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}
