import type { ReactNode } from 'react'
import type { StoredPreferences } from '@/state/preference-context'
import type { ModelAccess, ModelAccessContext, PreferenceUpdate } from '@/extension-types'

export function renderSlot(_name: string, _props?: object): ReactNode { return null }
export function restorePreferences(_saved: Record<string, unknown>, preferences: StoredPreferences): StoredPreferences { return preferences }
export function usePreferencePolicy(preferences: StoredPreferences, _update: PreferenceUpdate): StoredPreferences { return preferences }
const modelAccess: ModelAccess = { canSelectProvider: () => true, beforeRun: async () => {}, selectProvider: () => true }
export function useModelAccess(_context: ModelAccessContext): ModelAccess { return modelAccess }
