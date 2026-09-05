const { readFile, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { AndroidConfig, withAndroidStyles, withAppBuildGradle, withEntitlementsPlist, withFinalizedMod, withGradleProperties, withMainActivity, withMainApplication, withProjectBuildGradle, withXcodeProject } = require('@expo/config-plugins')

const NDK_VERSION = '27.2.12479018'
const ASYNC_STORAGE_DB_SIZE_MB = '64'

function disableExpoAndroidSplashLock(contents) {
  return contents
    .replace('import expo.modules.splashscreen.SplashScreenManager\n\n', '')
    .replace('    SplashScreenManager.registerOnActivity(this)\n', '    // RunWhale keeps its native overlay visible until the initial React root renders.\n')
    .replace('    // setTheme(R.style.AppTheme);\n', '    setTheme(R.style.AppTheme)\n')
}

module.exports = function withNodeNdk(config) {
  config = withEntitlementsPlist(config, (project) => {
    const key = 'com.apple.developer.associated-domains'
    const current = Array.isArray(project.modResults[key]) ? project.modResults[key] : []
    project.modResults[key] = [...new Set([...current, 'applinks:share.runwhale.dev'])]
    return project
  })
  config = withProjectBuildGradle(config, (project) => {
    if (project.modResults.language !== 'groovy') throw new Error('RunWhale requires a Groovy Android root build.gradle')
    const marker = 'buildscript {'
    const declaration = `buildscript {\n  ext {\n    ndkVersion = '${NDK_VERSION}'\n  }`
    if (!project.modResults.contents.includes(`ndkVersion = '${NDK_VERSION}'`)) {
      if (!project.modResults.contents.includes(marker)) throw new Error('Android root buildscript block is unavailable')
      project.modResults.contents = project.modResults.contents.replace(marker, declaration)
    }
    return project
  })
  config = withGradleProperties(config, (project) => {
    const properties = {
      reactNativeArchitectures: 'arm64-v8a',
      AsyncStorage_db_size_in_MB: ASYNC_STORAGE_DB_SIZE_MB,
    }
    for (const [key, value] of Object.entries(properties)) {
      const existing = project.modResults.find((item) => item.type === 'property' && item.key === key)
      if (existing) existing.value = value
      else project.modResults.push({ type: 'property', key, value })
    }
    return project
  })
  config = withMainApplication(config, (project) => {
    if (project.modResults.language !== 'kt') throw new Error('RunWhale requires a Kotlin MainApplication')
    let contents = project.modResults.contents
    if (!contents.includes('import com.runwhale.nodehost.NodeHostBootstrap')) {
      contents = contents.replace('import android.content.res.Configuration', 'import android.content.res.Configuration\nimport com.runwhale.nodehost.NodeHostBootstrap')
    }
    if (!contents.includes('NodeHostBootstrap.startBundled(this)')) {
      contents = contents.replace('    super.onCreate()\n', '    super.onCreate()\n    NodeHostBootstrap.startBundled(this)\n')
    }
    project.modResults.contents = contents
    return project
  })
  config = withMainActivity(config, (project) => {
    if (project.modResults.language !== 'kt') throw new Error('RunWhale requires a Kotlin MainActivity')
    let contents = disableExpoAndroidSplashLock(project.modResults.contents)
    if (!contents.includes('import android.view.Gravity')) {
      contents = contents.replace('import android.os.Bundle', `import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.core.content.ContextCompat
import com.facebook.react.devsupport.DefaultDevLoadingViewImplementation`)
    }
    if (!contents.includes('private var whaleSplashOverlay')) {
      contents = contents.replace('class MainActivity : ReactActivity() {', 'class MainActivity : ReactActivity() {\n  private var whaleSplashOverlay: View? = null')
    }
    if (!contents.includes('installWhaleSplashOverlay()')) {
      contents = contents.replace('    super.onCreate(null)\n', '    DefaultDevLoadingViewImplementation.setDevLoadingEnabled(false)\n    super.onCreate(null)\n    installWhaleSplashOverlay()\n')
    }
    if (!contents.includes('private fun installWhaleSplashOverlay')) {
      const marker = '  /**\n   * Returns the name of the main component registered from JavaScript.'
      const implementation = `  private fun installWhaleSplashOverlay() {
    val content = findViewById<ViewGroup>(android.R.id.content)
    val overlay = FrameLayout(this).apply {
      setBackgroundColor(ContextCompat.getColor(this@MainActivity, R.color.splashscreen_background))
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    }
    val imageWidth = (220 * resources.displayMetrics.density).toInt()
    val mark = ImageView(this).apply {
      setImageResource(R.drawable.splashscreen_logo)
      scaleType = ImageView.ScaleType.FIT_CENTER
    }
    overlay.addView(mark, FrameLayout.LayoutParams(imageWidth, imageWidth, Gravity.CENTER))
    content.addView(overlay, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    whaleSplashOverlay = overlay

    content.viewTreeObserver.addOnGlobalLayoutListener(object : ViewTreeObserver.OnGlobalLayoutListener {
      override fun onGlobalLayout() {
        if (!hasRenderedReactChild(content, overlay)) return
        content.viewTreeObserver.removeOnGlobalLayoutListener(this)
        overlay.animate().alpha(0f).setDuration(220).withEndAction {
          content.removeView(overlay)
          DefaultDevLoadingViewImplementation.setDevLoadingEnabled(true)
          if (whaleSplashOverlay === overlay) whaleSplashOverlay = null
        }.start()
      }
    })
  }

  private fun hasRenderedReactChild(view: View, overlay: View): Boolean {
    if (view === overlay || view !is ViewGroup) return false
    val className = view.javaClass.name
    if ((className.contains("ReactSurfaceView") || className.contains("ReactRootView")) && view.childCount > 0) return true
    for (index in 0 until view.childCount) {
      if (hasRenderedReactChild(view.getChildAt(index), overlay)) return true
    }
    return false
  }

`
      if (!contents.includes(marker)) throw new Error('Android MainActivity component marker is unavailable')
      contents = contents.replace(marker, implementation + marker)
    }
    project.modResults.contents = contents
    return project
  })
  config = withAndroidStyles(config, (project) => {
    project.modResults = AndroidConfig.Styles.assignStylesValue(project.modResults, {
      add: true,
      name: 'android:windowBackground',
      value: '@drawable/ic_launcher_background',
      parent: AndroidConfig.Styles.getAppThemeGroup(),
    })
    return project
  })
  config = withXcodeProject(config, (project) => {
    const version = config.version ?? '1.0.0'
    for (const entry of Object.values(project.modResults.pbxXCBuildConfigurationSection())) {
      if (entry && typeof entry === 'object' && entry.buildSettings) entry.buildSettings.MARKETING_VERSION = version
    }
    return project
  })
  config = withFinalizedMod(config, ['android', async (project) => {
    const packageName = project.android?.package
    if (!packageName) throw new Error('RunWhale requires an Android package name')
    const mainActivity = path.join(project.modRequest.platformProjectRoot, 'app/src/main/java', ...packageName.split('.'), 'MainActivity.kt')
    const contents = await readFile(mainActivity, 'utf8')
    await writeFile(mainActivity, disableExpoAndroidSplashLock(contents))
    return project
  }])
  return withAppBuildGradle(config, (project) => {
    if (project.modResults.language !== 'groovy') throw new Error('RunWhale requires a Groovy Android app build.gradle')
    let contents = project.modResults.contents
    const variableMarker = "def enableMinifyInReleaseBuilds = (findProperty('android.enableMinifyInReleaseBuilds') ?: false).toBoolean()"
    if (!contents.includes('def releaseStorePath =')) {
      contents = contents.replace(variableMarker, `${variableMarker}\ndef releaseStorePath = findProperty('runwhale.release.storeFile') ?: System.getenv('RUNWHALE_ANDROID_STORE_FILE')\ndef releaseStorePassword = findProperty('runwhale.release.storePassword') ?: System.getenv('RUNWHALE_ANDROID_STORE_PASSWORD')\ndef releaseKeyAlias = findProperty('runwhale.release.keyAlias') ?: System.getenv('RUNWHALE_ANDROID_KEY_ALIAS')\ndef releaseKeyPassword = findProperty('runwhale.release.keyPassword') ?: System.getenv('RUNWHALE_ANDROID_KEY_PASSWORD')`)
    }
    const debugSigning = `        debug {\n            storeFile file('debug.keystore')\n            storePassword 'android'\n            keyAlias 'androiddebugkey'\n            keyPassword 'android'\n        }`
    if (!contents.includes("signingConfigs.findByName('release')")) {
      contents = contents.replace(debugSigning, `${debugSigning}\n        if (releaseStorePath && releaseStorePassword && releaseKeyAlias && releaseKeyPassword) {\n            release {\n                storeFile file(releaseStorePath)\n                storePassword releaseStorePassword\n                keyAlias releaseKeyAlias\n                keyPassword releaseKeyPassword\n            }\n        }`)
      contents = contents.replace(/\s*\/\/ Caution! In production,[\s\S]*?signingConfig signingConfigs\.debug/u, `\n            if (signingConfigs.findByName('release')) {\n                signingConfig signingConfigs.release\n            } else if (System.getenv('CI') == 'true' && gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }) {\n                throw new GradleException('Release signing credentials are required in CI')\n            } else {\n                signingConfig signingConfigs.debug\n            }`)
    }
    project.modResults.contents = contents
    return project
  })
}
