import type { MobileModelProvider, MobileModelProviderProfile } from '@runwhale/mobile-protocol'
import type { StoredPreferences } from '@/state/preference-context'

export type PreferenceUpdate = (change: (current: StoredPreferences) => StoredPreferences) => void
export interface ModelAccessContext {
  modelProfiles: Readonly<Record<MobileModelProvider, MobileModelProviderProfile>>
  language: string
}
export interface ModelAccess {
  canSelectProvider(provider: MobileModelProvider): boolean
  beforeRun(provider: MobileModelProvider, model: string): Promise<void>
  selectProvider(provider: MobileModelProvider): boolean
}
