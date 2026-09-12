import { useSyncExternalStore } from 'react'
import { environment } from './environment.native.js'
import { createLanguageStore } from './language-store.js'

const store = createLanguageStore(environment)

export function useLanguage() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
