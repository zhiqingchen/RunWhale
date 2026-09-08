import { createContext, useContext } from 'react'
import type { MobileAgentPreset, MobileModelProvider, MobileModelProviderProfile, MobilePermissionMode } from '@runwhale/mobile-protocol'

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

export interface StoredPreferences {
  extensionState?: unknown
  busyMessageMode: BusyMessageMode
  modelProvider: MobileModelProvider
  model: string
  modelProfiles: Record<MobileModelProvider, MobileModelProviderProfile>
  appearance: AppAppearance
  agentPreset: MobileAgentPreset
  permissionMode: MobilePermissionMode
}

export const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined)

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext)
  if (!value) throw new Error('usePreferences must be used inside PreferencesProvider')
  return value
}
