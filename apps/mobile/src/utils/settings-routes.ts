export const SETTINGS_DETAILS = ['general', 'models', 'presets', 'plugins', 'runtime', 'ssh', 'about'] as const

export type SettingsDetail = (typeof SETTINGS_DETAILS)[number]

export const settingsHomeRoute = '/(tabs)/settings' as const

export interface SettingsHomeRouter {
  dismissTo(href: typeof settingsHomeRoute): void
}

export function returnToSettingsHome(router: SettingsHomeRouter): true {
  router.dismissTo(settingsHomeRoute)
  return true
}

export const settingsDetailRoutes: Record<SettingsDetail, `/settings/${SettingsDetail}`> = {
  general: '/settings/general',
  models: '/settings/models',
  presets: '/settings/presets',
  plugins: '/settings/plugins',
  runtime: '/settings/runtime',
  ssh: '/settings/ssh',
  about: '/settings/about',
}

export function isSettingsDetail(value: unknown): value is SettingsDetail {
  return typeof value === 'string' && (SETTINGS_DETAILS as readonly string[]).includes(value)
}
