const { readFile, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { withAppDelegate, withFinalizedMod } = require('@expo/config-plugins')

const animation = `  // RunWhale animates Expo's existing native splash without extending its lifetime.
  override func customize(_ rootView: UIView) {
    super.customize(rootView)
    guard !UIAccessibility.isReduceMotionEnabled,
          let splash = (rootView as? RCTSurfaceHostingProxyRootView)?.loadingView,
          let mark = splash.subviews.compactMap({ $0 as? UIImageView }).first,
          let name = splash.subviews.compactMap({ $0 as? UILabel }).first(where: { $0.text == "RunWhale" }) else { return }

    let float = CABasicAnimation(keyPath: "transform.translation.y")
    float.fromValue = 0
    float.toValue = -6
    float.duration = 1.4
    float.autoreverses = true
    float.repeatCount = .infinity
    float.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
    mark.layer.add(float, forKey: "runwhale.float")

    let breath = CABasicAnimation(keyPath: "opacity")
    breath.fromValue = 1
    breath.toValue = 0.65
    breath.duration = 1.4
    breath.autoreverses = true
    breath.repeatCount = .infinity
    breath.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
    name.layer.add(breath, forKey: "runwhale.breath")
  }

`

module.exports = function withIosLaunchBrand(config) {
  config = withAppDelegate(config, (project) => {
    if (project.modResults.language !== 'swift') throw new Error('RunWhale requires a Swift AppDelegate')
    let contents = project.modResults.contents
    const marker = '  // Extension point for config-plugins\n'
    if (!contents.includes('forKey: "runwhale.float"')) {
      if (!contents.includes(marker)) throw new Error('iOS ReactNativeDelegate extension point is unavailable')
      contents = contents.replace(marker, marker + '\n' + animation)
    }
    project.modResults.contents = contents
    return project
  })
  return withFinalizedMod(config, ['ios', async (project) => {
    const storyboardPath = path.join(project.modRequest.platformProjectRoot, project.modRequest.projectName, 'SplashScreen.storyboard')
    let storyboard = await readFile(storyboardPath, 'utf8')
    if (!storyboard.includes('id="EXPO-SplashScreen"') || !storyboard.includes('id="EXPO-ContainerView"')) {
      throw new Error('iOS splash logo and container are unavailable')
    }
    // Expo rebuilds the container constraints on every prebuild.
    storyboard = storyboard
      .replace(/^[ \t]*<label\b[^>]*id="RUNWHALE-LaunchName"[^>]*>[\s\S]*?<\/label>\r?\n/gm, '')
      .replace(/^[ \t]*<constraint\b[^>]*id="RUNWHALE-LaunchName-(?:top|center)"[^>]*\/>\r?\n/gm, '')
    storyboard = storyboard.replace('</subviews>', `    <label opaque="NO" userInteractionEnabled="NO" contentMode="left" text="RunWhale" textAlignment="center" translatesAutoresizingMaskIntoConstraints="NO" id="RUNWHALE-LaunchName">
                                <rect key="frame" x="96.5" y="548" width="200" height="36"/>
                                <fontDescription key="fontDescription" type="system" weight="bold" pointSize="28"/>
                                <color key="textColor" systemColor="labelColor"/>
                            </label>
                        </subviews>`)
    storyboard = storyboard.replace('</constraints>', `    <constraint firstItem="RUNWHALE-LaunchName" firstAttribute="top" secondItem="EXPO-SplashScreen" secondAttribute="bottom" constant="12" id="RUNWHALE-LaunchName-top"/>
                            <constraint firstItem="RUNWHALE-LaunchName" firstAttribute="centerX" secondItem="EXPO-ContainerView" secondAttribute="centerX" id="RUNWHALE-LaunchName-center"/>
                        </constraints>`)
    if (!storyboard.includes('<systemColor name="labelColor">')) storyboard = storyboard.replace('</resources>', `    <systemColor name="labelColor">
            <color white="0.0" alpha="1" colorSpace="custom" customColorSpace="genericGamma22GrayColorSpace"/>
        </systemColor>
    </resources>`)
    await writeFile(storyboardPath, storyboard)
    return project
  }])
}
