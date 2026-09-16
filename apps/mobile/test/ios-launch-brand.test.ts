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

it('preserves the native title and its constraints after Expo regenerates the splash storyboard', async () => {
  const cache = path.resolve(__dirname, '../../../.cache')
  await mkdir(cache, { recursive: true })
  const directory = await mkdtemp(path.join(cache, 'native-launch-test-'))
  const config = withIosLaunchBrand({ name: 'RunWhale', slug: 'runwhale' })
  const project = { ...config, modRequest: { platformProjectRoot: directory, projectName: 'RunWhale' } }
  const storyboardPath = path.join(directory, 'RunWhale/SplashScreen.storyboard')
  const splash = { image: 'logo.png', imageWidth: 220, resizeMode: 'contain', backgroundColor: '#F7F9FF' }
  try {
    await mkdir(path.dirname(storyboardPath))
    await writeFile(storyboardPath, toString(applySplashScreenStoryboard(await getTemplateAsync(), splash)))
    await config.mods.ios.finalized(project)
    const first = await readFile(storyboardPath, 'utf8')
    const regenerated = applySplashScreenStoryboard(await new Parser().parseStringPromise(first), splash)
    await writeFile(storyboardPath, toString(regenerated))
    await config.mods.ios.finalized(project)
    const result = await readFile(storyboardPath, 'utf8')
    expect(result.match(/id="RUNWHALE-LaunchName"/g)).toHaveLength(1)
    expect(result.match(/id="RUNWHALE-LaunchName-top"/g)).toHaveLength(1)
    expect(result.match(/id="RUNWHALE-LaunchName-center"/g)).toHaveLength(1)
    expect(result.match(/<systemColor name="labelColor">/g)).toHaveLength(1)
    expect(result).toContain('text="RunWhale"')
  } finally {
    await rm(directory, { recursive: true })
  }
})

it('decorates the existing native splash without introducing another visibility gate', async () => {
  const config = withIosLaunchBrand({ name: 'RunWhale', slug: 'runwhale' })
  const contents = 'class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {\n  // Extension point for config-plugins\n}\n'
  const project = { ...config, modRequest: {}, modResults: { language: 'swift', contents } }
  const result = await config.mods.ios.appDelegate(project)
  const generated = result.modResults.contents
  expect(generated).toContain('super.customize(rootView)')
  expect(generated).toContain('RCTSurfaceHostingProxyRootView)?.loadingView')
  expect(generated).not.toMatch(/hide\(|preventAutoHide|asyncAfter/)
  const repeated = await config.mods.ios.appDelegate({ ...project, modResults: { language: 'swift', contents: generated } })
  expect(repeated.modResults.contents).toBe(generated)
})
