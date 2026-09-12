export const APP_LANGUAGES = ['en', 'zh-CN', 'es', 'fr', 'ja'] as const
export type AppLanguage = typeof APP_LANGUAGES[number]
export const APP_LANGUAGE_OPTIONS = [
  { key: 'en', label: 'English' },
  { key: 'zh-CN', label: '简体中文' },
  { key: 'es', label: 'Español' },
  { key: 'fr', label: 'Français' },
  { key: 'ja', label: '日本語' },
] satisfies { key: AppLanguage; label: string }[]

export function isAppLanguage(value: unknown): value is AppLanguage {
  return APP_LANGUAGES.some(language => language === value)
}

export function appLanguageForLocale(locale: string): AppLanguage {
  const base = locale.toLowerCase().split(/[-_]/)[0]
  return base === 'zh' ? 'zh-CN' : isAppLanguage(base) ? base : 'en'
}
