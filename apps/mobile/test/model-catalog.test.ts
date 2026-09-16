import { describe, expect, it } from 'vitest'
import { findPackageJSON } from 'node:module'
import { realpathSync } from 'node:fs'
import {
  cloneDefaultModelProfiles,
  MOBILE_DEFAULT_MODEL_PROFILES,
  MOBILE_DEFAULT_MODELS,
  modelProfileOverrides,
  matchesModelPattern,
  restoreModelProfiles,
  selectCatalogModels,
} from '../src/utils/model-catalog'

describe('harness model catalog preferences', () => {
  it('matches whole model IDs with literal punctuation and * wildcards', () => {
    expect(matchesModelPattern('gpt-4o-mini', 'gpt-4o-*')).toBe(true)
    expect(matchesModelPattern('gpt-4o-2024-08-06', 'gpt-4o-*')).toBe(true)
    expect(matchesModelPattern('gpt-4o', 'gpt-4o-*')).toBe(false)
    expect(matchesModelPattern('custom-gpt-4o-mini', 'gpt-4o-*')).toBe(false)
    expect(matchesModelPattern('gpt-5.4-mini', 'gpt-5.4-mini')).toBe(true)
    expect(matchesModelPattern('gpt-5x4-mini', 'gpt-5.4-mini')).toBe(false)
    expect(matchesModelPattern('gpt-5.4-mini', '*5.4*mini')).toBe(true)
  })

  it('filters catalog entries and stably prioritizes the preferred model without mutating the input', () => {
    const models = [
      { id: 'keep-first', name: 'First' },
      { id: 'old-1', name: 'Retired' },
      { id: 'keep-last', name: 'Last' },
      { id: 'preferred', name: 'Preferred' },
      { id: 'model.1', name: 'Excluded literal' },
      { id: 'modelx1', name: 'Kept literal' },
    ]
    const original = structuredClone(models)
    expect(selectCatalogModels(models, 'preferred', ['old-*', 'model.1'])).toEqual([
      { id: 'preferred', name: 'Preferred' },
      { id: 'keep-first', name: 'First' },
      { id: 'keep-last', name: 'Last' },
      { id: 'modelx1', name: 'Kept literal' },
    ])
    expect(models).toEqual(original)
    expect(selectCatalogModels(models, 'missing', [])).toEqual(models)
  })

  it('keeps the installed preferred model available without filtering custom profiles', () => {
    expect(MOBILE_DEFAULT_MODEL_PROFILES.openai.models[0]?.id).toBe(MOBILE_DEFAULT_MODELS.openai)
    const custom = { models: [{ id: 'gpt-4o' }] }
    expect(restoreModelProfiles({ openai: custom }, 2).openai).toEqual(custom)
  })

  it('uses the same pi-ai package as the embedded harness', () => {
    const runtime = new URL('../../../packages/dsh-mobile/package.json', import.meta.url)
    const harness = realpathSync(findPackageJSON('@deepseek-ai/dsh-llm-pi-ai', runtime)!)
    expect(realpathSync(findPackageJSON('@earendil-works/pi-ai', import.meta.url)!))
      .toBe(realpathSync(findPackageJSON('@earendil-works/pi-ai', harness)!))
  })

  it('does not persist default catalogs, allowing upgrades to supply new models', () => {
    const stored = modelProfileOverrides(cloneDefaultModelProfiles())
    expect(stored).toEqual({})
    expect(restoreModelProfiles(stored, 2)).toEqual(MOBILE_DEFAULT_MODEL_PROFILES)
  })

  it('resets model profiles from the old unpublished preferences format', () => {
    const legacy = { deepseek: { models: [{ id: 'old-model' }] } }
    expect(restoreModelProfiles(legacy, undefined)).toEqual(MOBILE_DEFAULT_MODEL_PROFILES)
  })

  it('preserves custom endpoints, models, and limits while defaults follow the catalog', () => {
    const custom = { baseURL: 'https://gateway.example/v1', models: [{ id: 'my-model', name: 'My model', contextWindow: 65536, maxTokens: 8192 }] }
    const profiles = restoreModelProfiles({ openai: custom }, 2)
    expect(profiles.openai).toEqual(custom)
    const stored = modelProfileOverrides(profiles)
    expect(stored).toEqual({ openai: custom })
    expect(restoreModelProfiles(stored, 2)).toEqual(profiles)
    profiles.openai = cloneDefaultModelProfiles().openai
    expect(modelProfileOverrides(profiles)).toEqual({})
  })

  it('migrates legacy custom endpoints so saved credentials keep their intended provider', () => {
    const custom = { baseURL: 'https://gateway.example', models: [{ id: 'gpt-5.6-sol' }] }
    expect(restoreModelProfiles({ openai: custom }, undefined).openai).toEqual(custom)
  })

  it('retains a custom model subset without a custom endpoint', () => {
    const custom = { models: [{ id: 'gpt-5.4-mini' }] }
    expect(restoreModelProfiles({ openai: custom }, 2).openai).toEqual(custom)
  })
})
