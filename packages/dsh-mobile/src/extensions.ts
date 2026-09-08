import type { MobileModelProvider } from '@runwhale/mobile-protocol'
import type { ProviderAdapter } from './provider-adapter.js'

export function providerAdapter(_provider: MobileModelProvider): ProviderAdapter | undefined { return undefined }
