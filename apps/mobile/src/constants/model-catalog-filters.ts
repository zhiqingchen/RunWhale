import type { MobileModelProvider } from '@runwhale/mobile-protocol'

/** Exclude default catalog IDs with case-sensitive, whole-ID patterns. Only * is a wildcard. */
export const MODEL_CATALOG_FILTERS: Partial<Record<MobileModelProvider, { exclude: readonly string[] }>> = {
  openai: {
    exclude: [
      // Older generations and dated GPT-4o snapshots; keep GPT-4o mini.
      'gpt-4', 'gpt-4-*', 'gpt-4.1*', 'gpt-4o', 'gpt-4o-2*',
      'gpt-5', 'gpt-5-mini',
      'gpt-5.1', 'gpt-5.1-*', 'gpt-5.2', 'gpt-5.2-*', 'gpt-5.3', 'gpt-5.3-*',
      'o1', 'o1-*', 'o3', 'o3-*', 'o4-mini',
      // Specialized variants are available through custom model profiles.
      '*-chat-latest', '*-pro', '*-nano', '*-codex*', 'gpt-realtime-*',
    ],
  },
}
