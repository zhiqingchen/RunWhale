import type { MobileModelProvider } from '@runwhale/mobile-protocol'
import type { ProviderAdapter } from './provider-adapter.js'
import type { Context } from '@deepseek-ai/cordis'
import type { MobileWorkspaceServices } from './tools-mobile.js'

export function providerAdapter(_provider: MobileModelProvider): ProviderAdapter | undefined { return undefined }

export function registerHarnessExtensions(_ctx: Context, _workspaceFor: (sessionId: string) => string | undefined, _services: MobileWorkspaceServices): void {}
