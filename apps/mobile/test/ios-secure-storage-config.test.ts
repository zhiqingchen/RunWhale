import { describe, expect, it } from 'vitest'
import appConfig from '../app.json'

describe('iOS secure storage configuration', () => {
  it('keeps the app-private Keychain access group in the canonical Expo config', () => {
    expect(appConfig.expo.ios.entitlements['keychain-access-groups']).toEqual([
      `$(AppIdentifierPrefix)${appConfig.expo.ios.bundleIdentifier}`,
    ])
  })
})
