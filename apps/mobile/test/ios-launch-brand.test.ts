import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const withIosLaunchBrand = require('../plugins/with-ios-launch-brand')
const splashRequire = createRequire(require.resolve('expo-splash-screen/package.json'))
const { getTemplateAsync } = splashRequire('./plugin/build/withIosSplashScreenStoryboard')
const { applySplashScreenStoryboard } = splashRequire('./plugin/build/withIosSplashScreenStoryboardImage')
const { toString } = splashRequire('./plugin/build/InterfaceBuilder')
const { Parser } = splashRequire('xml2js')
const { getIosSplashConfig } = splashRequire('./plugin/build/getIosSplashConfig')
const app = require('../app.json').expo

it('shows the full-screen artwork without retaining the old title after repeated prebuilds', async () => {
  const cache = path.resolve(__dirname, '../../../.cache')
  await mkdir(cache, { recursive: true })
  const directory = await mkdtemp(path.join(cache, 'native-launch-test-'))
  const config = withIosLaunchBrand({ name: 'RunWhale', slug: 'runwhale' })
  const project = { ...config, modRequest: { platformProjectRoot: directory, projectName: 'RunWhale' } }
  const storyboardPath = path.join(directory, 'RunWhale/SplashScreen.storyboard')
  const splash = getIosSplashConfig(app.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen')[1])
  try {
    await mkdir(path.dirname(storyboardPath))
    const template = toString(applySplashScreenStoryboard(await getTemplateAsync(), splash))
      .replace('</subviews>', '<label text="RunWhale" id="RUNWHALE-LaunchName"><rect key="frame"/></label>\n</subviews>')
    await writeFile(storyboardPath, template)
    await config.mods.ios.finalized(project)
    const first = await readFile(storyboardPath, 'utf8')
    const regenerated = applySplashScreenStoryboard(await new Parser().parseStringPromise(first), splash)
    await writeFile(storyboardPath, toString(regenerated))
    await config.mods.ios.finalized(project)
    const result = await readFile(storyboardPath, 'utf8')
    expect(splash.image).toBe('./assets/images/runwhale-splash.png')
    expect(result).toContain('image="SplashScreenLegacy" contentMode="scaleAspectFill"')
    expect(result).not.toContain('RUNWHALE-LaunchName')
    const storyboard = await new Parser().parseStringPromise(result)
    const view = storyboard.document.scenes[0].scene[0].objects[0].viewController[0].view[0]
    expect(view.constraints[0].constraint.map((constraint: { $: { firstAttribute: string } }) => constraint.$.firstAttribute)).toEqual(['top', 'leading', 'trailing', 'bottom'])
  } finally {
    await rm(directory, { recursive: true })
  }
})

it('removes the old logo animation without adding a splash visibility gate', async () => {
  const config = withIosLaunchBrand({ name: 'RunWhale', slug: 'runwhale' })
  const contents = `class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  // RunWhale animates Expo's existing native splash without extending its lifetime.
  override func customize(_ rootView: UIView) {
    super.customize(rootView)
    mark.layer.add(float, forKey: "runwhale.float")
  }

  override func sourceURL(for bridge: RCTBridge) -> URL? { bridge.bundleURL }
}
`
  const project = { ...config, modRequest: {}, modResults: { language: 'swift', contents } }
  const result = await config.mods.ios.appDelegate(project)
  const generated = result.modResults.contents
  expect(generated).not.toContain('customize(')
  expect(generated).toContain('override func sourceURL(')
  expect(generated).not.toMatch(/hide\(|preventAutoHide|asyncAfter/)
  const repeated = await config.mods.ios.appDelegate({ ...project, modResults: { language: 'swift', contents: generated } })
  expect(repeated.modResults.contents).toBe(generated)
})
