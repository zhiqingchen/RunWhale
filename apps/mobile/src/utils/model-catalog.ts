import { MOBILE_DEFAULT_MODELS, type MobileModelProvider, type MobileModelProviderProfile } from '@runwhale/mobile-protocol'
import { DEEPSEEK_MODELS } from '@earendil-works/pi-ai/providers/deepseek.models'
import { OPENAI_MODELS } from '@earendil-works/pi-ai/providers/openai.models'
import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models'
import { GOOGLE_MODELS } from '@earendil-works/pi-ai/providers/google.models'
import { normalizedModelProfile } from './model-settings'

export { MOBILE_DEFAULT_MODELS }

const providers = Object.keys(MOBILE_DEFAULT_MODELS) as MobileModelProvider[]
const catalog = { deepseek: DEEPSEEK_MODELS, openai: OPENAI_MODELS, anthropic: ANTHROPIC_MODELS, google: GOOGLE_MODELS }

/** Installed harness models, with the product's preferred selection first. */
export const MOBILE_DEFAULT_MODEL_PROFILES = Object.fromEntries<MobileModelProviderProfile>(providers.map((provider) => {
  const models = Object.values(catalog[provider])
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => Number(b.id === MOBILE_DEFAULT_MODELS[provider]) - Number(a.id === MOBILE_DEFAULT_MODELS[provider]))
  return [provider, { models }]
})) as Record<MobileModelProvider, MobileModelProviderProfile>

export function cloneDefaultModelProfiles(): Record<MobileModelProvider, MobileModelProviderProfile> {
  return Object.fromEntries<MobileModelProviderProfile>(providers.map((provider) => [provider, {
    models: MOBILE_DEFAULT_MODEL_PROFILES[provider].models.map((entry) => ({ ...entry })),
  }])) as Record<MobileModelProvider, MobileModelProviderProfile>
}

/** Restore explicit custom profiles; omitted providers follow the installed catalog. */
export function restoreModelProfiles(value: unknown, version: unknown): Record<MobileModelProvider, MobileModelProviderProfile> {
  const profiles = cloneDefaultModelProfiles()
  if (version !== 2 || !value || typeof value !== 'object' || Array.isArray(value)) return profiles
  for (const provider of providers) {
    const candidate = (value as Record<string, unknown>)[provider]
    if (candidate === undefined) continue
    try {
      profiles[provider] = normalizedModelProfile(candidate)
    } catch { /* Invalid stored profiles fall back to this provider's catalog. */ }
  }
  return profiles
}

/** Persist only customizations so future harness upgrades can refresh defaults. */
export function modelProfileOverrides(profiles: Readonly<Record<MobileModelProvider, MobileModelProviderProfile>>): Partial<Record<MobileModelProvider, MobileModelProviderProfile>> {
  return Object.fromEntries(providers.filter((provider) =>
    JSON.stringify(profiles[provider]) !== JSON.stringify(MOBILE_DEFAULT_MODEL_PROFILES[provider]),
  ).map((provider) => [provider, profiles[provider]]))
}
