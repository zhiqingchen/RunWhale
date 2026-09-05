import { readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, join, relative } from 'node:path'

const moduleStore = process.argv[2]
if (!moduleStore) throw new Error('module store root is required')

// Expo 57's Babel preset uses the WASM-backed Hermes parser for sources that
// carry an @flow pragma. iOS runs embedded Node with V8 lite/jitless, where
// WebAssembly is intentionally unavailable. Compile the fixed runtime catalog
// once while assembling the host so device Metro only sees plain JavaScript.
const packageRoots = [
  'react-native',
  'react-native-web',
  '@react-native',
  'react-devtools-core',
  '@react-native-masked-view',
  '@expo',
  'styleq',
  'shallowequal',
  'jsc-safe-url',
]

const moduleRequire = createRequire(join(moduleStore, 'babel-preset-expo/package.json'))
const babel = moduleRequire('@babel/core')
const expoPreset = moduleRequire('babel-preset-expo')
const files = []
const codegenPlugins = new Set()

for (const packageRoot of packageRoots) await collectFlowSources(join(moduleStore, packageRoot))
await collectCodegenPlugins(moduleStore)

const babelOptions = {
  babelrc: false,
  configFile: false,
  presets: [[expoPreset, {}]],
  caller: {
    name: 'metro',
    bundler: 'metro',
    supportsStaticESM: true,
    isDev: true,
    isServer: false,
    isReactServer: false,
    isNodeModule: true,
  },
  sourceMaps: false,
  compact: false,
}

for (const file of files) {
  const result = babel.transformFileSync(file, babelOptions)
  if (result?.code == null) throw new Error(`Babel returned no output for ${relative(moduleStore, file)}`)
  // Some code generators contain an @flow pragma as data. Preserve its
  // runtime value with an escape while preventing the on-device Babel plugin
  // from selecting the WASM parser merely because the byte sequence exists.
  const jitlessSource = result.code.replaceAll('@flow', '@flo\\u0077')
  if (/@flow/.test(jitlessSource)) throw new Error(`Flow pragma remained in ${relative(moduleStore, file)}`)
  await writeFile(file, `${jitlessSource}\n`)
}

// Codegen has already consumed the catalog's Flow types above. Metro runs
// transforms in isolated workers, so make every copy resolvable from a Babel
// preset intentionally empty. A hoisted deployment can retain a nested copy
// when the preset and React Native resolve different patch versions.
if (codegenPlugins.size === 0) throw new Error('React Native Codegen Babel plugin is missing from the module store')
const codegenStub = `'use strict'\nmodule.exports = function runwhalePrecompiledCodegen() { return { name: 'runwhale-precompiled-react-native-codegen' } }\n`
await Promise.all([...codegenPlugins].map((plugin) => writeFile(join(plugin, 'index.js'), codegenStub)))

console.log(`Precompiled ${files.length} Flow sources and disabled ${codegenPlugins.size} Codegen plugin copies for mobile jitless Metro`)

async function collectFlowSources(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await collectFlowSources(path)
    } else if (/\.(?:js|jsx)$/.test(entry.name) && /@flow/.test(await readFile(path, 'utf8'))) {
      files.push(path)
    }
  }
}

async function collectCodegenPlugins(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const path = join(directory, entry.name)
    if (entry.name === 'babel-plugin-codegen' && basename(directory) === '@react-native') {
      const manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'))
      if (manifest.name !== '@react-native/babel-plugin-codegen') {
        throw new Error(`Unexpected package at ${relative(moduleStore, path)}`)
      }
      codegenPlugins.add(await realpath(path))
      continue
    }
    if (entry.isDirectory()) await collectCodegenPlugins(path)
  }
}
