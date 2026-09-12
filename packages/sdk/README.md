# RunWhale SDK

React hooks for RunWhale capabilities. `@runwhale/sdk` is built into RunWhale Preview. For standalone React or Expo development, install `@runwhale/sdk@0.1.1`.

```tsx
import { Text } from 'react-native'
import { useLanguage } from '@runwhale/sdk'

function Greeting() {
  const { language, loading, error } = useLanguage()
  if (loading) return null
  if (error && !language) return <Text>Language unavailable</Text>
  const messages = { en: 'Hello', 'zh-CN': '你好', es: 'Hola', fr: 'Bonjour', ja: 'こんにちは' }
  return <Text>{messages[language!]}</Text>
}
```

`useLanguage()` returns `{ language, loading, error }`. Language follows RunWhale settings and updates mounted components automatically. The hook shares its connection across components and disconnects when the last consumer unmounts. During a connection failure it keeps the last known language, reports an error, and reconnects. Outside RunWhale it uses the system/browser locale, with English for unsupported languages. Supply translated content in your app; the SDK does not translate text or modify preferences.

Native Preview reads a read-only native settings module and subscribes to language changes, including when running a cached release bundle. Older native hosts without this module use the system language. Web Preview uses its local language endpoint; older hosts without that endpoint report an upgrade error alongside the system language. Upgrade RunWhale to synchronize its language setting.
