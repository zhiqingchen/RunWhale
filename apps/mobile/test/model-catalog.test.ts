import { describe, expect, it } from 'vitest'
import { findPackageJSON } from 'node:module'
import { realpathSync } from 'node:fs'
import {
  cloneDefaultModelProfiles,
  MOBILE_DEFAULT_MODEL_PROFILES,
  modelProfileOverrides,
  restoreModelProfiles,
} from '../src/utils/model-catalog'

describe('harness model catalog preferences', () => {
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

  it('retains a custom model subset without a custom endpoint', () => {
    const custom = { models: [{ id: 'gpt-5.4-mini' }] }
    expect(restoreModelProfiles({ openai: custom }, 2).openai).toEqual(custom)
  })
})
