import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const requested = (process.argv[2] || process.env.RELEASE_VERSION || process.env.GITHUB_REF_NAME || '').replace(/^v/u, '')
assert.match(requested, /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u, 'Provide an App Store release version such as 0.1.0')

const appConfig = JSON.parse(readFileSync('apps/mobile/app.json', 'utf8'))
const androidPath = 'apps/mobile/android/app/build.gradle'
const iosPath = 'apps/mobile/ios/RunWhale.xcodeproj/project.pbxproj'
const androidVersion = existsSync(androidPath) ? readFileSync(androidPath, 'utf8').match(/versionName\s+["']([^"']+)["']/u)?.[1] : undefined
const iosVersions = existsSync(iosPath) ? [...readFileSync(iosPath, 'utf8').matchAll(/MARKETING_VERSION = ([^;]+);/gu)].map((match) => match[1]) : []

assert.equal(appConfig.expo?.version, requested, `apps/mobile/app.json must match release version ${requested}`)
assert.equal(appConfig.expo?.ios?.bundleIdentifier, 'app.runwhale.mobile', 'apps/mobile/app.json must use the release iOS bundle identifier')
assert.equal(appConfig.expo?.ios?.deploymentTarget, '16.4', 'apps/mobile/app.json must keep the minimum iOS version at 16.4')
assert.equal(
  appConfig.expo?.ios?.infoPlist?.ITSAppUsesNonExemptEncryption,
  false,
  'apps/mobile/app.json must set ITSAppUsesNonExemptEncryption to the Boolean value false',
)
if (androidVersion) assert.equal(androidVersion, requested, `Android versionName must match ${requested}`)
iosVersions.forEach((version) => assert.equal(version, requested, `iOS MARKETING_VERSION must match ${requested}`))

console.log(`Release version ${requested} and export-compliance declaration are consistent`)
