import type { MobileModelProvider } from '@runwhale/mobile-protocol'

const PROVIDER_CREDENTIAL_REFERENCES = {
  deepseek: 'ref:DEEPSEEK_API_KEY',
  openai: 'ref:OPENAI_API_KEY',
  anthropic: 'ref:ANTHROPIC_API_KEY',
  google: 'ref:GOOGLE_API_KEY',
} as const satisfies Record<MobileModelProvider, string>

export function providerCredentialRef(provider: MobileModelProvider): string {
  return PROVIDER_CREDENTIAL_REFERENCES[provider]
}
