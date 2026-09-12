export type Language = 'en' | 'zh-CN' | 'es' | 'fr' | 'ja'
export interface LanguageState {
  language: Language | undefined
  loading: boolean
  error: Error | undefined
}
/** Follow RunWhale's language. Outside RunWhale, use the system/browser language. */
export function useLanguage(): LanguageState
