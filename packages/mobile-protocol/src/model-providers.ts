import { additionalProviders } from '#extensions'
import type { AdditionalModelProviders } from '#extensions'
import type { ModelProviderDefinition } from './provider-types.js'

export type BuiltinModelProvider = 'deepseek' | 'openai' | 'anthropic' | 'google'
export type MobileModelProvider = BuiltinModelProvider | keyof AdditionalModelProviders
export const MOBILE_PROVIDERS: Readonly<Record<MobileModelProvider, ModelProviderDefinition>> = Object.freeze({
  ...additionalProviders,
  deepseek: { name: 'DeepSeek', defaultModel: 'deepseek-v4-flash', credentialKey: 'DEEPSEEK_API_KEY', baseURL: 'https://api.deepseek.com' },
  openai: { name: 'OpenAI', imageGeneration: true, defaultModel: 'gpt-5.4-mini', credentialKey: 'OPENAI_API_KEY', baseURL: 'https://api.openai.com/v1' },
  anthropic: { name: 'Anthropic', agentName: 'Claude', defaultModel: 'claude-sonnet-4-6', credentialKey: 'ANTHROPIC_API_KEY', baseURL: 'https://api.anthropic.com/v1' },
  google: { name: 'Google', agentName: 'Gemini', defaultModel: 'gemini-3.5-flash', credentialKey: 'GOOGLE_API_KEY', baseURL: 'https://generativelanguage.googleapis.com/v1beta' },
})
export const MOBILE_DEFAULT_MODELS = Object.freeze(Object.fromEntries(Object.entries(MOBILE_PROVIDERS).map(([id, provider]) => [id, provider.defaultModel]))) as Readonly<Record<MobileModelProvider, string>>
export function isMobileModelProvider(value: unknown): value is MobileModelProvider {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MOBILE_PROVIDERS, value)
}
