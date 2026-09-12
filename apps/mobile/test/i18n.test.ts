import { describe, expect, it } from 'vitest'
import { messages, translateMessage } from '../src/i18n/messages'
import { appLanguageForLocale } from '@runwhale/mobile-protocol'

describe('app languages', () => {
  it.each(Object.entries(messages))('%s translates all messages and preserves interpolation', (_locale, dictionary) => {
    expect(Object.keys(dictionary).sort()).toEqual(Object.keys(messages.en).sort())
    for (const key of Object.keys(messages.en) as (keyof typeof messages.en)[]) {
      expect(dictionary[key].trim(), key).not.toBe('')
      expect(dictionary[key].match(/\{\w+\}/g)?.sort() ?? [], key).toEqual(messages.en[key].match(/\{\w+\}/g)?.sort() ?? [])
    }
  })
  it('falls back to English for unsupported languages and missing translations', () => {
    expect(translateMessage('de', 'updatedAt', { date: '2026-09-12' })).toBe('Updated 2026-09-12')
    const original = messages.es.updatedAt
    try {
      Reflect.deleteProperty(messages.es, 'updatedAt')
      expect(translateMessage('es', 'updatedAt', { date: '2026-09-12' })).toBe('Updated 2026-09-12')
    } finally { messages.es.updatedAt = original }
  })
  it.each([['es-MX', 'es'], ['fr-CA', 'fr'], ['ja-JP', 'ja'], ['zh-Hant', 'zh-CN'], ['de', 'en']])('maps %s to %s', (locale, language) => {
    expect(appLanguageForLocale(locale)).toBe(language)
  })
})
