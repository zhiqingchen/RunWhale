import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const lock = JSON.parse(await readFile(resolve(root, 'upstreams.lock.json'), 'utf8'))
if (lock.schemaVersion !== 2) throw new Error(`Unsupported upstream lock schema: ${lock.schemaVersion}`)

const runtime = lock.packages.nodeMobileRuntime
for (const [label, commit] of [
  ['runtime source', runtime.source.commit],
  ['Node base', runtime.source.baseCommit],
  ['mobile upstream', runtime.source.mobileUpstreamCommit],
]) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`nodeMobileRuntime: invalid ${label} commit pin`)
}

const hostPackagePath = resolve(root, 'native/node-host/package.json')
const hostPackage = JSON.parse(await readFile(hostPackagePath, 'utf8'))
const dependencyVersion = hostPackage.dependencies?.[runtime.package.name]
if (dependencyVersion !== runtime.package.version) {
  throw new Error(
    `${runtime.package.name} must be an exact ${runtime.package.version} dependency in native/node-host/package.json; found ${dependencyVersion ?? 'missing'}`,
  )
}

const installedManifestPath = resolve(
  root,
  'native/node-host/node_modules',
  runtime.package.name,
  'runtime-manifest.json',
)
let installedManifest
try {
  installedManifest = JSON.parse(await readFile(installedManifestPath, 'utf8'))
} catch (error) {
  if (error?.code === 'ENOENT') {
    throw new Error(
      `${runtime.package.name}@${runtime.package.version} is not installed for native/node-host; run "pnpm install" before verifying upstreams`,
    )
  }
  throw error
}

for (const [label, actual, expected] of [
  ['package name', installedManifest.package?.name, runtime.package.name],
  ['package version', installedManifest.package?.version, runtime.package.version],
  ['Node version', installedManifest.runtime?.node, runtime.runtime.node],
  ['npm version', installedManifest.runtime?.npm, runtime.runtime.npm],
  ['source repository', installedManifest.source?.repository, runtime.source.repository],
  ['source commit', installedManifest.source?.commit, runtime.source.commit],
  ['Node base repository', installedManifest.source?.baseRepository, runtime.source.baseRepository],
  ['Node base commit', installedManifest.source?.baseCommit, runtime.source.baseCommit],
  [
    'mobile upstream repository',
    installedManifest.source?.mobileUpstreamRepository,
    runtime.source.mobileUpstreamRepository,
  ],
  [
    'mobile upstream commit',
    installedManifest.source?.mobileUpstreamCommit,
    runtime.source.mobileUpstreamCommit,
  ],
  ['Android ABI', installedManifest.android?.abi, runtime.android.abi],
  ['Android minimum API', installedManifest.android?.minimumApi, runtime.android.minimumApi],
  ['Android NDK version', installedManifest.android?.ndkVersion, runtime.android.ndkVersion],
  ['Android STL', installedManifest.android?.stl, runtime.android.stl],
  ['Apple minimum iOS', installedManifest.apple?.minimumIos, runtime.apple.minimumIos],
]) {
  if (actual !== expected) {
    throw new Error(
      `${runtime.package.name} runtime-manifest ${label} mismatch: expected ${expected}, found ${actual ?? 'missing'}`,
    )
  }
}

const appleSlices = installedManifest.apple?.slices
if (!Array.isArray(appleSlices) || appleSlices.length !== 2) {
  throw new Error(
    `${runtime.package.name} runtime-manifest Apple slice contract mismatch: expected 2 slices, ` +
      `found ${Array.isArray(appleSlices) ? appleSlices.length : 'missing'}`,
  )
}

const deviceSlice = appleSlices.filter(
  (slice) => slice.platform === 'ios' && slice.variant === 'device',
)
const simulatorSlice = appleSlices.filter(
  (slice) => slice.platform === 'ios' && slice.variant === 'simulator',
)
for (const [label, slices, expected] of [
  ['Apple device architectures', deviceSlice, runtime.apple.deviceArchitectures],
  ['Apple simulator architectures', simulatorSlice, runtime.apple.simulatorArchitectures],
]) {
  const actual = slices.length === 1 ? slices[0].architectures : undefined
  if (!Array.isArray(actual) || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${runtime.package.name} runtime-manifest ${label} mismatch: expected ${JSON.stringify(expected)}, ` +
        `found ${JSON.stringify(actual)}`,
    )
  }
}

console.log(`${runtime.package.name}: ${runtime.package.version} (${runtime.source.commit})`)
