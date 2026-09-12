import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPreferenceStorageCoordinator } from '@/utils/preference-storage'
import { translateMessage, type MessageKey } from './messages'
import { appLanguageForLocale, isAppLanguage, type AppLanguage } from '@runwhale/mobile-protocol'
export type { AppLanguage } from '@runwhale/mobile-protocol'

const STORAGE_KEY = 'runwhale.language.v1'

interface I18nContextValue {
  language: AppLanguage
  languageReady: boolean
  persistenceError?: string
  retryPersistence(): Promise<void>
  setLanguage(language: AppLanguage): void
  t(key: MessageKey, values?: Record<string, string | number>): string
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined)

function systemLanguage(): AppLanguage {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase()
  return appLanguageForLocale(locale)
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [languageReady, setLanguageReady] = useState(false)
  const [language, setLanguageState] = useState<AppLanguage>(systemLanguage)
  const [persistenceError, setPersistenceError] = useState<string>()
  const persistence = useMemo(() => createPreferenceStorageCoordinator(
    (failure) => setPersistenceError(failure?.message),
  ), [])
  useEffect(() => {
    let active = true
    void persistence.hydrate(() => AsyncStorage.getItem(STORAGE_KEY), (saved) => {
      if (active && isAppLanguage(saved)) setLanguageState(saved)
    }).finally(() => { if (active) setLanguageReady(true) })
    return () => { active = false }
  }, [persistence])
  const setLanguage = useCallback((next: AppLanguage) => {
    setLanguageState(next)
    void persistence.persist(next, (value) => AsyncStorage.setItem(STORAGE_KEY, value)).catch(() => undefined)
  }, [persistence])
  const t = useCallback((key: MessageKey, values?: Record<string, string | number>) => {
    return translateMessage(language, key, values)
  }, [language])
  const value = useMemo(() => ({ language, languageReady, persistenceError, retryPersistence: persistence.retryLatest, setLanguage, t }), [language, languageReady, persistence.retryLatest, persistenceError, setLanguage, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside I18nProvider')
  return value
}
