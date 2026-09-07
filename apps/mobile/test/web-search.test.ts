import { describe, expect, it } from 'vitest'
import { webSearchSources, webSourceUrl } from '../src/utils/web-search'
import { normalizedModelProfile } from '../src/utils/model-settings'

describe('search sources and settings', () => {
  it('preserves independent search and image capabilities', () => {
    expect(normalizedModelProfile({ models: [{ id: 'gpt-5.6-sol', webSearch: false, imageGeneration: true }] }).models[0]).toMatchObject({ webSearch: false, imageGeneration: true })
    expect(() => normalizedModelProfile({ models: [{ id: 'custom', webSearch: 'yes' }] })).toThrow('boolean')
  })
  it('restores only safe clickable source URLs from durable tool metadata', () => {
    expect(webSearchSources({ sources: [{ url: 'https://example.com/news', title: 'News' }, { url: 'javascript:alert(1)' }, { url: 'file:///private' }, { url: 'https://secret@example.com' }] })).toEqual([{ url: 'https://example.com/news', title: 'News' }])
    expect(webSourceUrl('<https://example.com/news>')).toBe('https://example.com/news')
    expect(webSourceUrl('runwhale://run/private')).toBeUndefined()
  })
})
