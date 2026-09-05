import catalog from './native-preview-modules.json' with { type: 'json' }
import type { RuntimePlatform } from './types.js'

export interface NativePreviewModule {
  name: string
  version: string
  platforms: readonly RuntimePlatform[]
}

export const NATIVE_PREVIEW_EXPO_SDK_VERSION = catalog.expoSdkVersion
export const NATIVE_PREVIEW_REACT_NATIVE_VERSION = catalog.reactNativeVersion
export const NATIVE_PREVIEW_MODULES: readonly NativePreviewModule[] = Object.freeze(
  catalog.modules.map((module) => Object.freeze({
    name: module.name,
    version: module.version,
    platforms: Object.freeze(module.platforms as RuntimePlatform[]),
  })),
)
export const NATIVE_PREVIEW_INTERNAL_MODULES: ReadonlySet<string> = new Set(catalog.internalModules)
export const NATIVE_PREVIEW_BLOCKED_MODULES: ReadonlySet<string> = new Set(catalog.blockedModules)

export function nativePreviewModulesFor(platform: RuntimePlatform): readonly NativePreviewModule[] {
  return NATIVE_PREVIEW_MODULES.filter((module) => module.platforms.includes(platform))
}

export function nativePreviewPackageName(request: string): string {
  if (!request.startsWith('@')) return request.split('/', 1)[0] ?? request
  const [scope, name] = request.split('/', 3)
  return scope && name ? `${scope}/${name}` : request
}

export function isNativePreviewBuiltIn(request: string, platform: RuntimePlatform): boolean {
  const name = nativePreviewPackageName(request)
  return NATIVE_PREVIEW_INTERNAL_MODULES.has(name) || nativePreviewModulesFor(platform).some((module) => module.name === name)
}

/** The existing starter surface, with versions owned by the shared catalog. */
export const NATIVE_PREVIEW_TEMPLATE_DEPENDENCIES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(catalog.modules.filter((module) => !('template' in module && module.template === false)).map(({ name, version }) => [name, version])),
)
