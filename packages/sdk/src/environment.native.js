import { NativeEventEmitter, TurboModuleRegistry } from 'react-native'

export function environment() {
  const settings = TurboModuleRegistry.get('RunWhaleSettings')
  return {
    url: undefined,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    ...(settings ? {
      readLanguage: () => settings.getLanguage(),
      subscribeLanguage: listener => {
        const subscription = new NativeEventEmitter(settings).addListener('runwhaleLanguageChanged', listener)
        return () => subscription.remove()
      },
    } : {}),
  }
}
