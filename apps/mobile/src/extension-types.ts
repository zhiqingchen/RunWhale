import type { MobileModelProvider, MobileModelProviderProfile } from '@runwhale/mobile-protocol'
import type { StoredPreferences } from '@/state/preference-context'

export type PreferenceUpdate = (change: (current: StoredPreferences) => StoredPreferences) => void
export type StudioOperation = 'project_create' | 'preview_build'
export type StudioOperationTarget = 'expo' | 'web' | 'repository' | 'ios' | 'android'
export type StudioOperationOutcome = 'success' | 'failure' | 'cancelled'
export interface ModelAccessContext {
  modelProfiles: Readonly<Record<MobileModelProvider, MobileModelProviderProfile>>
  language: string
}
export interface ModelAccess {
  canSelectProvider(provider: MobileModelProvider): boolean
  beforeRun(provider: MobileModelProvider, model: string): Promise<void>
  selectProvider(provider: MobileModelProvider): boolean
}
