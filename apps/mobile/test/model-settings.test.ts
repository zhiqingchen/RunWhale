import { describe, expect, it } from 'vitest'
import { normalizedModelProfile } from '../src/utils/model-settings'

describe('mobile model settings', () => {
  it('normalizes a custom endpoint and the curated DeepSeek Harness model fields', () => {
    expect(normalizedModelProfile({
      baseURL: '  http://127.0.0.1:8000/v1  ',
      models: [{ id: ' local-coder ', name: ' Local Coder ', contextWindow: '65536', maxTokens: '8192' }],
    })).toEqual({
      baseURL: 'http://127.0.0.1:8000/v1',
      models: [{ id: 'local-coder', name: 'Local Coder', contextWindow: 65536, maxTokens: 8192 }],
    })
  })

  it('rejects unusable endpoints, duplicate models, and invalid capacities', () => {
    expect(() => normalizedModelProfile({ baseURL: 'file:///tmp/model', models: [{ id: 'one' }] })).toThrow(/HTTP or HTTPS/)
    expect(() => normalizedModelProfile({ models: [{ id: 'one' }, { id: ' one ' }] })).toThrow(/unique/)
    expect(() => normalizedModelProfile({ models: [{ id: 'one', contextWindow: 0 }] })).toThrow(/positive integer/)
  })
})
