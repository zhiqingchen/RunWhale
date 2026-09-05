import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { x as extractTar } from 'tar'

export const EMBEDDED_NPM_VERSION = '11.17.0'

export async function prepareModuleStore(root: string, destination: string): Promise<void> {
  await removeStaleStages(root, '.module-store-stage-')
  const archive = join(root, 'runwhale-module-store.tgz')
  if (!(await exists(archive))) {
    if (await exists(join(destination, 'expo/package.json'))) return
    throw new Error('shared module store archive is missing')
  }
  const bundleVersionPath = join(root, '.runwhale-bundle-version')
  const installedBundleVersionPath = join(destination, '.runwhale-bundle-version')
  try {
    const [bundleVersion, installedBundleVersion] = await Promise.all([
      readFile(bundleVersionPath, 'utf8'),
      readFile(installedBundleVersionPath, 'utf8'),
    ])
    if (bundleVersion === installedBundleVersion && await exists(join(destination, 'expo/package.json'))) return
  } catch { /* first launch, an upgrade, or an incomplete prior extraction */ }
  const archiveDigest = await sha256File(archive)
  try {
    const installedDigest = (await readFile(join(destination, '.runwhale-module-store.sha256'), 'utf8')).trim()
    if (installedDigest === archiveDigest && await exists(join(destination, 'expo/package.json'))) {
      if (await exists(bundleVersionPath)) await copyFile(bundleVersionPath, installedBundleVersionPath)
      return
    }
  } catch { /* first launch, an upgrade, or an incomplete prior extraction */ }
  const staging = join(root, `.module-store-stage-${process.pid}`)
  await mkdir(staging, { recursive: true })
  try {
    await extractTar({ cwd: staging, file: archive, strict: true })
    if (!(await exists(join(staging, 'expo/package.json')))) throw new Error('shared module store archive is invalid')
    await writeFile(join(staging, '.runwhale-module-store.sha256'), `${archiveDigest}\n`, { mode: 0o600 })
    if (await exists(bundleVersionPath)) await copyFile(bundleVersionPath, join(staging, '.runwhale-bundle-version'))
    await rm(destination, { recursive: true, force: true })
    await rename(staging, destination)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

export async function prepareEmbeddedNpm(root: string, destination: string): Promise<string> {
  await removeStaleStages(root, '.npm-stage-')
  try {
    const manifest = JSON.parse(await readFile(join(destination, 'package.json'), 'utf8')) as { version?: unknown }
    if (manifest.version === EMBEDDED_NPM_VERSION) return EMBEDDED_NPM_VERSION
  } catch { /* first launch or an incomplete prior extraction */ }
  const archive = join(root, 'runwhale-npm.tgz')
  if (!(await exists(archive))) throw new Error('embedded npm archive is missing')
  const staging = join(root, `.npm-stage-${process.pid}`)
  await mkdir(staging, { recursive: true })
  try {
    await extractTar({ cwd: staging, file: archive, strict: true })
    const manifest = JSON.parse(await readFile(join(staging, 'package.json'), 'utf8')) as { version?: unknown }
    if (manifest.version !== EMBEDDED_NPM_VERSION) throw new Error(`embedded npm version is ${String(manifest.version)}, expected ${EMBEDDED_NPM_VERSION}`)
    await rm(destination, { recursive: true, force: true })
    await mkdir(dirname(destination), { recursive: true })
    await rename(staging, destination)
    return EMBEDDED_NPM_VERSION
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

async function removeStaleStages(root: string, prefix: string): Promise<void> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  await Promise.all(entries
    .filter((entry) => entry.name.startsWith(prefix) && (entry.isDirectory() || entry.isSymbolicLink()))
    .map((entry) => rm(join(root, entry.name), { recursive: true, force: true })))
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}
