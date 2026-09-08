import { MOBILE_PROVIDERS, type MobileModelProvider } from '@runwhale/mobile-protocol'

export function providerCredentialRef(provider: MobileModelProvider): string {
  return `ref:${MOBILE_PROVIDERS[provider].credentialKey}`
}

export function providerHasManagedCredential(provider: MobileModelProvider): boolean {
  return MOBILE_PROVIDERS[provider].managed === true
}

export function resolveProviderCredential(key: string): string | undefined {
  return Object.values(MOBILE_PROVIDERS).find(provider => `ref:${provider.credentialKey}` === key)?.credentialValue
}
