import { access, lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'

const input = resolve(process.argv[2] ?? '')
if (!input) throw new Error('module store root is required')
const root = await realpath(input)
const codegenStub = `'use strict'\nmodule.exports = function runwhalePrecompiledCodegen() { return { name: 'runwhale-precompiled-react-native-codegen' } }\n`
const maximumBytes = 320 * 1024 * 1024
const maximumFiles = 36_000
const forbiddenDirectories = new Set([
  '@expo/expo-modules-macros-plugin/apple',
  '@shopify/react-native-skia/android',
  '@shopify/react-native-skia/apple',
  '@shopify/react-native-skia/cpp',
  '@shopify/react-native-skia/libs',
  'hermes-compiler/hermesc',
  'react-native-skia-android',
  'react-native-skia-apple-ios',
  'react-native-skia-apple-macos',
  'react-native-skia-apple-tvos',
])
let codegenPluginCount = 0
let fileCount = 0
let totalBytes = 0

await Promise.all([
  'react-native/Libraries/Core/setUpReactDevTools.js',
  'react-native/src/private/devsupport/rndevtools/ReactDevToolsSettingsManager.android.js',
  'react-native/src/private/devsupport/rndevtools/ReactDevToolsSettingsManager.ios.js',
].map(async (required) => {
  try {
    await access(resolve(root, required))
  } catch {
    throw new Error(`module store is missing required React Native source: ${required}`)
  }
}))
await visit(root)
if (codegenPluginCount === 0) throw new Error('module store is missing the React Native Codegen Babel plugin')
if (totalBytes > maximumBytes) {
  throw new Error(`module store payload is ${totalBytes} bytes across ${fileCount} files; limit is ${maximumBytes} bytes`)
}
if (fileCount > maximumFiles) {
  throw new Error(`module store contains ${fileCount} files; limit is ${maximumFiles}`)
}
validatePrecompiledReactNativeSource()
console.log(`Validated embedded module store: ${fileCount} files, ${totalBytes} bytes`)

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    const info = await lstat(path)
    const local = relative(root, path).split(sep).join('/')
    if ((info.isDirectory() || info.isSymbolicLink()) && (entry.name === 'prebuilds' || entry.name === 'local-maven-repo' || forbiddenDirectories.has(local))) {
      throw new Error(`module store contains build-only payload: ${local}`)
    }
    if (info.isFile() && entry.name.endsWith('.map')) throw new Error(`module store contains build-only source map: ${local}`)
    if ((info.isDirectory() || info.isSymbolicLink()) && entry.name === 'babel-plugin-codegen' && basename(directory) === '@react-native') {
      const manifest = JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8'))
      if (manifest.name !== '@react-native/babel-plugin-codegen') throw new Error(`unexpected package at ${path}`)
      if (await readFile(resolve(path, 'index.js'), 'utf8') !== codegenStub) {
        throw new Error(`module store contains an active React Native Codegen Babel plugin: ${path}`)
      }
      codegenPluginCount += 1
    }
    if (info.isSymbolicLink()) {
      const target = await realpath(path)
      const targetLocal = relative(root, target)
      if (targetLocal === '..' || targetLocal.startsWith(`..${sep}`) || isAbsolute(targetLocal)) {
        throw new Error(`module store link escapes its root: ${path} -> ${target}`)
      }
    } else if (info.isDirectory()) {
      await visit(path)
    } else if (info.isFile()) {
      fileCount += 1
      totalBytes += info.size
    }
  }
}

function validatePrecompiledReactNativeSource() {
  const moduleRequire = createRequire(resolve(root, 'babel-preset-expo/package.json'))
  const babel = moduleRequire('@babel/core')
  const expoPreset = moduleRequire('babel-preset-expo')
  const source = resolve(root, 'react-native/src/private/specs_DEPRECATED/components/AndroidDrawerLayoutNativeComponent.js')
  const result = babel.transformFileSync(source, {
    babelrc: false,
    configFile: false,
    presets: [[expoPreset, {}]],
    caller: {
      name: 'metro',
      bundler: 'metro',
      platform: 'android',
      supportsStaticESM: true,
      isDev: true,
      isServer: false,
      isReactServer: false,
      isNodeModule: true,
    },
    sourceMaps: false,
    compact: false,
  })
  if (result?.code == null) throw new Error('Babel could not re-transform precompiled React Native source')
}
