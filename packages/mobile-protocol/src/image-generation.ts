import { MOBILE_PROVIDERS } from './model-providers.js'
import type { MobileModelProvider, MobileModelProviderProfile } from './types.js'

/** Each OpenAI agent model may use the provider's separate gpt-image-2 tool. */
export function supportsModelImageGeneration(provider: MobileModelProvider, model: string, profile?: MobileModelProviderProfile): boolean {
  return MOBILE_PROVIDERS[provider].imageGeneration === true && Boolean(model.trim()) && (profile?.models.find((entry) => entry.id === model)?.imageGeneration ?? provider === 'openai')
}

export function isProjectImagePath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length <= 512
    && !path.includes('\\') && !path.includes('\0') && !path.includes(':')
    && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && !part.startsWith('.'))
    && /\.(png|jpe?g|webp)$/i.test(path)
}
