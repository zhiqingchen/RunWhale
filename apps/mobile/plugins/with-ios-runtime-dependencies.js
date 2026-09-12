const { withAppDelegate, withPodfile } = require('@expo/config-plugins')

const guard = `  # Prebuilt React/Expo binaries load ReactNativeDependencies dynamically.
  # A failed artifact probe must not silently substitute static source pods.
  if ReactNativeDependenciesUtils.build_react_native_deps_from_source() &&
      (!ReactNativeCoreUtils.build_rncore_from_source() || ENV['EXPO_USE_PRECOMPILED_MODULES'] == '1')
    raise 'RunWhale requires ReactNativeDependencies.framework with prebuilt React/Expo. Check the React Native artifact download and rerun pod install; do not archive this mixed configuration.'
  end

`

module.exports = function withIosRuntimeDependencies(config) {
  config = withPodfile(config, (project) => {
    const marker = '  post_install do |installer|'
    const contents = project.modResults.contents
    if (!contents.includes(guard)) {
      if (!contents.includes(marker)) throw new Error('iOS Podfile post_install hook is unavailable')
      project.modResults.contents = contents.replace(marker, guard + marker)
    }
    return project
  })
  return withAppDelegate(config, (project) => {
    // RN 0.86 prebuilt headers omit RCTBridge. The bridgeless host uses bundleURL().
    if (project.modResults.language === 'swift') {
      project.modResults.contents = project.modResults.contents.replace(
        /  override func sourceURL\(for bridge: RCTBridge\) -> URL\? \{\n    \/\/ needed to return the correct URL for expo-dev-client\.\n    bridge\.bundleURL \?\? bundleURL\(\)\n  \}\n\n/,
        '',
      )
    }
    return project
  })
}
