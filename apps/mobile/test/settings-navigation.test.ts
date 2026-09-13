import { describe, expect, it } from 'vitest'
import { SETTINGS_DETAILS, isSettingsDetail, settingsDetailRoutes, settingsHomeRoute } from '../src/utils/settings-routes'
import { returnFromSecondaryPage } from '../src/utils/secondary-page-navigation'

describe('Settings detail navigation', () => {
  it('places every detail outside the tab route', () => {
    expect(settingsHomeRoute).toBe('/(tabs)/settings')
    expect(SETTINGS_DETAILS).toEqual(['general', 'models', 'presets', 'plugins', 'runtime', 'ssh', 'about'])
    expect(Object.values(settingsDetailRoutes)).toEqual([
      '/settings/general',
      '/settings/models',
      '/settings/presets',
      '/settings/plugins',
      '/settings/runtime',
      '/settings/ssh',
      '/settings/about',
    ])
    expect(Object.values(settingsDetailRoutes).every((route) => route.startsWith('/settings/'))).toBe(true)
  })

  it('rejects unknown dynamic route values', () => {
    expect(isSettingsDetail('models')).toBe(true)
    expect(isSettingsDetail('unknown')).toBe(false)
    expect(isSettingsDetail(['models'])).toBe(false)
  })

  it('returns to the previous page, or Settings home for a direct link', () => {
    const actions: string[] = []
    const router = {
      canGoBack: () => true,
      back: () => { actions.push('back') },
      replace: (href: string) => { actions.push(href) },
    }
    expect(returnFromSecondaryPage(router, settingsHomeRoute)).toBe(true)
    expect(actions).toEqual(['back'])

    router.canGoBack = () => false
    expect(returnFromSecondaryPage(router, settingsHomeRoute)).toBe(true)
    expect(actions).toEqual(['back', settingsHomeRoute])
  })
})
