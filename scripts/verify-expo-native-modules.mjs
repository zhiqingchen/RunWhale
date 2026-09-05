import { NATIVE_PREVIEW_TEMPLATE_DEPENDENCIES } from '../packages/mobile-protocol/src/native-preview-modules.ts'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const nodeHostPackagePath = resolve(root, 'native/node-host/package.json')
const nodeHostPodspecPath = resolve(root, 'native/node-host/RunWhaleNodeHost.podspec')
const bundledPath = resolve(root, 'apps/mobile/node_modules/expo/bundledNativeModules.json')
const catalogPath = resolve(root, 'packages/mobile-protocol/src/native-preview-modules.json')
const mobilePackagePath = resolve(root, 'apps/mobile/package.json')
const moduleStorePackagePath = resolve(root, 'packages/runtime-module-store/package.json')
const bundled = JSON.parse(await readFile(bundledPath, 'utf8'))
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
const expected = {
  'react-native-reanimated': '4.5.1',
  'react-native-worklets': '0.10.1',
  'react-native-screens': '~4.26.0',
  'react-native-webview': '13.16.1',
  '@react-native-async-storage/async-storage': '2.2.0',
  '@shopify/react-native-skia': '2.6.2',
  'expo-file-system': '~57.0.6',
}
for (const [name, version] of Object.entries(expected)) {
  if (bundled[name] !== version) throw new Error(`${name}: Expo 57 bundles ${bundled[name]}, expected ${version}`)
}
const nodeHostPackage = JSON.parse(await readFile(nodeHostPackagePath, 'utf8'))
const mobilePackage = JSON.parse(await readFile(mobilePackagePath, 'utf8'))
const moduleStorePackage = JSON.parse(await readFile(moduleStorePackagePath, 'utf8'))
const nodeHostPodspec = await readFile(nodeHostPodspecPath, 'utf8')
const podspecVersion = nodeHostPodspec.match(/^\s*s\.version\s*=\s*['"]([^'"]+)['"]/m)?.[1]
if (podspecVersion !== nodeHostPackage.version) {
  throw new Error(`RunWhaleNodeHost podspec version ${podspecVersion ?? 'missing'} does not match package version ${nodeHostPackage.version}`)
}
if (mobilePackage.dependencies.expo !== catalog.expoSdkVersion || nodeHostPackage.peerDependencies.expo !== catalog.expoSdkVersion) {
  throw new Error('Native Preview Expo version does not match the app and node-host peer dependency')
}
if (mobilePackage.dependencies['react-native'] !== catalog.reactNativeVersion || nodeHostPackage.peerDependencies['react-native'] !== catalog.reactNativeVersion) {
  throw new Error('Native Preview React Native version does not match the app and node-host peer dependency')
}
for (const module of catalog.modules) {
  if (mobilePackage.dependencies[module.name] !== module.version) {
    throw new Error(`app dependency ${module.name} must be pinned to ${module.version}`)
  }
  if (moduleStorePackage.dependencies[module.name] !== module.version) {
    throw new Error(`module-store dependency ${module.name} must be pinned to ${module.version}`)
  }
}
for (const [name, version] of Object.entries(NATIVE_PREVIEW_TEMPLATE_DEPENDENCIES)) {
  if (mobilePackage.dependencies[name] !== version || moduleStorePackage.dependencies[name] !== version) {
    throw new Error(`template dependency ${name} must match app and module-store versions: ${version}`)
  }
}
for (const name of catalog.internalModules) {
  if (moduleStorePackage.dependencies[name] === undefined) {
    throw new Error(`internal Native Preview dependency is missing from the shared store: ${name}`)
  }
}
for (const name of catalog.blockedModules) {
  if (moduleStorePackage.dependencies[name] !== undefined) {
    throw new Error(`blocked Native Preview module is present in the shared store: ${name}`)
  }
}
const androidProvider = await readFile(resolve(root, 'native/node-host/android/src/main/java/com/runwhale/nodehost/NativePreviewReactPackages.kt'), 'utf8')
const iosProvider = await readFile(resolve(root, 'native/node-host/ios/NativePreviewExpoModulesProvider.swift'), 'utf8')
for (const [name, androidClasses, iosClasses] of [
  ['expo-audio', ['expo.modules.audio.AudioModule'], ['AudioModule']],
  ['expo-contacts', ['expo.modules.contacts.ContactsModule', 'expo.modules.contacts.next.ContactsNextModule'], ['ContactsModule', 'ContactAccessButtonModule', 'ContactsNextModule']],
  ['expo-file-system', ['expo.modules.filesystem.FileSystemModule', 'expo.modules.filesystem.legacy.FileSystemLegacyModule'], ['FileSystemModule', 'FileSystemLegacyModule']],
  ['expo-image-picker', ['expo.modules.imagepicker.ImagePickerModule'], ['ImagePickerModule']],
  ['expo-local-authentication', ['expo.modules.localauthentication.LocalAuthenticationModule'], ['LocalAuthenticationModule']],
  ['expo-location', ['expo.modules.location.LocationModule'], ['LocationModule']],
  ['expo-maps', ['expo.modules.maps.MapsModule', 'expo.modules.maps.GoogleMapsModule', 'expo.modules.maps.StreetViewModule'], ['MapsModule', 'AppleMapsModule']],
  ['expo-media-library', ['expo.modules.medialibrary.MediaLibraryModule', 'expo.modules.medialibrary.next.MediaLibraryNextModule'], ['MediaLibraryModule', 'MediaLibraryNextModule']],
  ['expo-video', ['expo.modules.video.VideoModule'], ['VideoModule']],
]) {
  if (!catalog.modules.some((module) => module.name === name)) {
    throw new Error(`${name} is missing from the Native Preview catalog`)
  }
  if (androidClasses.some((className) => !androidProvider.includes(`"${className}"`))
    || iosClasses.some((className) => !iosProvider.includes(`"${className}"`))) {
    throw new Error(`${name} is missing from a Native Preview platform provider`)
  }
}
const androidScope = await readFile(resolve(root, 'native/node-host/android/src/main/java/com/runwhale/nodehost/NativePreviewProjectScope.kt'), 'utf8')
const iosBridge = await readFile(resolve(root, 'native/node-host/ios/NativePreviewBridge.mm'), 'utf8')
const metroRuntime = await readFile(resolve(root, 'packages/node-runtime/src/metro-runtime.ts'), 'utf8')
if (!androidProvider.includes('NativePreviewStorageModule::class.java')
  || !iosProvider.includes('NativePreviewStorageModule.self')) {
  throw new Error('project-scoped AsyncStorage is missing from a Native Preview platform provider')
}
if (!metroRuntime.includes("return '@runwhale/native-preview-shims/async-storage'")
  || !catalog.modules.some((module) => module.name === '@react-native-async-storage/async-storage')) {
  throw new Error('AsyncStorage is not routed through the Native Preview compatibility module')
}
if (androidProvider.includes('AsyncStoragePackage') || iosBridge.includes('RNCAsyncStorage')) {
  throw new Error('Native Preview must not expose the process-wide AsyncStorage native module')
}
if (!androidScope.includes('override val isScoped = true')
  || !iosBridge.includes('RunWhaleCreateNativePreviewAppContext')) {
  throw new Error('Native Preview FileSystem is missing a project-scoped platform context')
}
if (/allowedModuleClasses[\s\S]*PedometerModule[\s\S]*allowedServiceClasses/.test(androidProvider) || iosProvider.includes('"PedometerModule"')) {
  throw new Error('Native Preview must not expose Pedometer because its activity permission is blocked')
}
console.log(JSON.stringify({
  sdk: 57,
  verified: expected,
  nodeHostVersion: nodeHostPackage.version,
  nativePreviewModules: catalog.modules.length,
  runtimeAbi: catalog.runtimeAbi,
}, null, 2))
