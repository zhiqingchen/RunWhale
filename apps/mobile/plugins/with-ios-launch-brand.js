const { readFile, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { withAppDelegate, withFinalizedMod } = require('@expo/config-plugins')

module.exports = function withIosLaunchBrand(config) {
  config = withAppDelegate(config, (project) => {
    if (project.modResults.language !== 'swift') throw new Error('RunWhale requires a Swift AppDelegate')
    // Remove the previous logo animation from projects regenerated without --clean.
    project.modResults.contents = project.modResults.contents.replace(
      /  \/\/ RunWhale animates Expo's existing native splash without extending its lifetime\.\r?\n  override func customize\(_ rootView: UIView\) \{[\s\S]*?\r?\n  \}\r?\n\r?\n/,
      '',
    )
    return project
  })
  return withFinalizedMod(config, ['ios', async (project) => {
    const storyboardPath = path.join(project.modRequest.platformProjectRoot, project.modRequest.projectName, 'SplashScreen.storyboard')
    let storyboard = await readFile(storyboardPath, 'utf8')
    if (!storyboard.includes('id="EXPO-SplashScreen"') || !storyboard.includes('id="EXPO-ContainerView"')) {
      throw new Error('iOS splash logo and container are unavailable')
    }
    // The artwork includes the brand name. Remove the old title on incremental prebuilds.
    storyboard = storyboard
      .replace(/^[ \t]*<label\b[^>]*id="RUNWHALE-LaunchName"[^>]*>[\s\S]*?<\/label>\r?\n/gm, '')
      .replace(/^[ \t]*<constraint\b[^>]*id="RUNWHALE-LaunchName-(?:top|center)"[^>]*\/>\r?\n/gm, '')
    await writeFile(storyboardPath, storyboard)
    return project
  }])
}
