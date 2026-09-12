import { isAppLanguage, type AppLanguage } from '@runwhale/mobile-protocol'
import en from './en.json'
import zhCN from './zh-CN.json'
import es from './es.json'
import fr from './fr.json'
import ja from './ja.json'

export type MessageKey = keyof typeof en

export const messages: Record<AppLanguage, Record<MessageKey, string>> = {
  en, 'zh-CN': zhCN, es, fr, ja,
}

export function translateMessage(language: string, key: MessageKey, values?: Record<string, string | number>): string {
  const dictionary = messages[isAppLanguage(language) ? language : 'en']
  let message = dictionary[key] || messages.en[key]
  for (const [name, value] of Object.entries(values ?? {})) message = message.replaceAll(`{${name}}`, String(value))
  return message
}
