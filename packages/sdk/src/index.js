import { useSyncExternalStore } from 'react'
import { environment } from './environment.js'
import { createLanguageStore } from './language-store.js'

const store = createLanguageStore(environment)

/** @returns {import('./index.js').LanguageState} */
export function useLanguage() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
