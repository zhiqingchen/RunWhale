import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import appConfig from '../app.json'

const resolveAppConfig = createRequire(import.meta.url)('../app.config.js')

afterEach(() => vi.unstubAllEnvs())

describe('community app identity', () => {
  it.each([
    ['', 'app.runwhale.community'],
    [undefined, 'app.runwhale.community'],
    ['org.example.runwhale', 'org.example.runwhale'],
  ])('resolves BUNDLE_ID=%s consistently across native settings', (value, expected) => {
    vi.stubEnv('BUNDLE_ID', value)
    const config = resolveAppConfig({ config: appConfig.expo })

    expect(config.ios.bundleIdentifier).toBe(expected)
    expect(config.android.package).toBe(expected)
    expect(config.ios.entitlements['keychain-access-groups']).toEqual([
      `$(AppIdentifierPrefix)${expected}`,
    ])
    expect(config.ios.infoPlist.BGTaskSchedulerPermittedIdentifiers).toEqual([`${expected}.agent.*`])
    expect(config.ios.entitlements['com.apple.developer.associated-domains']).toEqual(
      appConfig.expo.ios.entitlements['com.apple.developer.associated-domains'],
    )
    expect(config.ios.infoPlist.ITSAppUsesNonExemptEncryption).toBe(false)
  })
})
