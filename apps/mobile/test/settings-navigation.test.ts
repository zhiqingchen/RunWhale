import { describe, expect, it } from 'vitest'
import { SETTINGS_DETAILS, isSettingsDetail, returnToSettingsHome, settingsDetailRoutes, settingsHomeRoute } from '../src/utils/settings-routes'

describe('Settings detail navigation', () => {
  it('places every detail outside the tab route', () => {
    expect(settingsHomeRoute).toBe('/(tabs)/settings')
    expect(SETTINGS_DETAILS).toEqual(['general', 'models', 'presets', 'plugins', 'runtime', 'ssh'])
    expect(Object.values(settingsDetailRoutes)).toEqual([
      '/settings/general',
      '/settings/models',
      '/settings/presets',
      '/settings/plugins',
      '/settings/runtime',
      '/settings/ssh',
    ])
    expect(Object.values(settingsDetailRoutes).every((route) => route.startsWith('/settings/'))).toBe(true)
  })

  it('rejects unknown dynamic route values', () => {
    expect(isSettingsDetail('models')).toBe(true)
    expect(isSettingsDetail('unknown')).toBe(false)
    expect(isSettingsDetail(['models'])).toBe(false)
  })

  it('handles every back action by dismissing directly to Settings home', () => {
    const dismissed: string[] = []
    expect(returnToSettingsHome({ dismissTo: (href) => dismissed.push(href) })).toBe(true)
    expect(dismissed).toEqual([settingsHomeRoute])
  })
})
