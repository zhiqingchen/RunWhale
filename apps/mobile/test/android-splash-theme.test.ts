import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const withNodeNdk = require('../plugins/with-node-ndk')

describe('Android splash screen', () => {
  it('preserves color at semitransparent edges when resizing the square splash image', async () => {
    const splashRequire = createRequire(require.resolve('expo-splash-screen/package.json'))
    const imageRequire = createRequire(splashRequire.resolve('@expo/image-utils/package.json'))
    const Jimp = imageRequire('jimp-compact')
    const { resize } = imageRequire('./build/jimp')
    const input = new Jimp(2, 2, 0xc0804080)
    const image = await resize({ input }, { width: 4, height: 4, fit: 'contain' })
    expect(Jimp.intToRGBA(image.getPixelColor(2, 2))).toEqual({ r: 192, g: 128, b: 64, a: 128 })
  })

  it('restores AppCompat before creating the activity', async () => {
    const config = withNodeNdk({ name: 'RunWhale', slug: 'runwhale' })
    const contents = `import expo.modules.splashscreen.SplashScreenManager
import android.os.Bundle
class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // setTheme(R.style.AppTheme)
    SplashScreenManager.registerOnActivity(this)
    super.onCreate(null)
  }
  /**
   * Returns the name of the main component registered from JavaScript.
   */
}`
    const project = { ...config, modRequest: {}, modResults: { language: 'kt', contents } }
    const result = await config.mods.android.mainActivity(project)
    const generated = result.modResults.contents
    expect(generated).toMatch(/^    setTheme\(R\.style\.AppTheme\)$/m)
    expect(generated.indexOf('    setTheme(')).toBeLessThan(generated.indexOf('    super.onCreate('))
  })
})
