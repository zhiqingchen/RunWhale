import AsyncStorage from '@react-native-async-storage/async-storage'
import { router, usePathname } from 'expo-router'
import { useEffect } from 'react'
import { useI18n } from '@/i18n'
import { usePreferences } from '@/state/preferences'
import { useProjects } from '@/state/projects'

export const ONBOARDING_STORAGE_KEY = 'runwhale.onboarding.v1'

export function FirstRunGuide() {
  const pathname = usePathname()
  const { languageReady } = useI18n()
  const { preferencesReady } = usePreferences()
  const { projects, loadStatus } = useProjects()
  const hasProjects = projects.length > 0

  useEffect(() => {
    if (pathname !== '/' || !languageReady || !preferencesReady || loadStatus !== 'ready') return
    let active = true
    void AsyncStorage.getItem(ONBOARDING_STORAGE_KEY).then(async (completed) => {
      if (!active || completed) return
      // Existing workspaces should keep opening directly after an app update.
      if (hasProjects) await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, 'completed')
      else router.replace('/onboarding')
    }).catch(() => { /* A storage read failure must not interrupt access to the workspace. */ })
    return () => { active = false }
  }, [pathname, languageReady, preferencesReady, loadStatus, hasProjects])

  return null
}
