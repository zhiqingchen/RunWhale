import type { MobileModelProvider, MobileModelProviderProfile } from './types.js'

/** Explicit overrides support custom model aliases without assuming all compatible APIs support search. */
export function supportsModelWebSearch(provider: MobileModelProvider, model: string, profile?: MobileModelProviderProfile): boolean {
  const override = profile?.models.find((entry) => entry.id === model)?.webSearch
  if (override !== undefined) return Boolean(model.trim()) && override
  if (provider === 'anthropic') return /^(claude-(sonnet|opus|haiku)-[45]([.-]|$)|claude-3-(5|7)-sonnet-)/.test(model)
  if (provider === 'google') return /^gemini-(2\.0-flash(?!-lite)|2\.5-(pro|flash)|3([.-]))/.test(model) && !/(embedding|live|audio|tts|robotics|computer-use)/.test(model)
  return provider === 'deepseek'
    ? /^deepseek-v4-(flash|pro)(-vision-exp)?$/.test(model)
    : /^(gpt-5([.-]|$)|gpt-6([.-]|$)|gpt-4\.1([.-]|$)|gpt-4o($|-20)|o[34]($|-))/.test(model)
}
