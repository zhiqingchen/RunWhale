import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { BuiltinModelProvider, MobileModelDefinition } from '@runwhale/mobile-protocol'

export interface ProviderAdapter {
  profile: PiAiProviderProfile
  requireCatalog?: boolean
  exclusive?: boolean
  mapModel?(model: MobileModelDefinition): NonNullable<PiAiProviderProfile['models']>[number]
  searchProvider?(model: string): BuiltinModelProvider
  searchTimeoutMs?: number
  imageTimeoutMs?: number
}
