import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface NativeAssets {
  directory: string
  files: Record<string, string>
}

export function nativeAssetDirectory(root: string): string {
  return join(root, '.runwhale', 'cache', 'native-assets')
}

// Metro loads asset plugins from disk, including in the embedded module store.
// Keep image bytes outside JavaScript and retain Expo's standard fileUris metadata.
export async function nativeAssetPluginPath(store: string, root: string, allowedRoots: readonly string[]): Promise<string> {
  const source = `
const { createHash } = require('node:crypto');
const { readFile, realpath } = require('node:fs/promises');
const { relative, isAbsolute, sep, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const roots = ${JSON.stringify(allowedRoots)};
module.exports = async asset => {
  const fileUris = await Promise.all(asset.files.map(async file => {
    const path = await realpath(file);
    if (!roots.some(root => {
      const part = relative(root, path);
      return part === '' || (part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part));
    })) throw new Error('Native Preview asset is outside the project/module store');
    const hash = createHash('sha256').update(await readFile(path)).digest('hex');
    return pathToFileURL(join(${JSON.stringify(nativeAssetDirectory(root))}, hash + '.' + asset.type)).href;
  }));
  return { ...asset, fileUris, runwhaleLocalAsset: true };
};
`
  const directory = join(store, '.cache', 'runwhale')
  const path = join(directory, `native-assets-${sha256(Buffer.from(source)).slice(0, 16)}.cjs`)
  await mkdir(directory, { recursive: true })
  await writeFile(path, source)
  return path
}

export async function collectNativeAssets(root: string, assets: readonly { files: readonly string[] }[]): Promise<NativeAssets> {
  const directory = nativeAssetDirectory(root)
  const files: Record<string, string> = {}
  let size = 0
  for (const asset of assets) {
    const metadata = asset as typeof asset & { fileUris: string[] }
    for (const [index, source] of asset.files.entries()) {
      const path = fileURLToPath(metadata.fileUris[index]!)
      const name = path.slice(directory.length + 1)
      if (join(directory, name) !== path || !isAssetName(name)) throw new Error('Invalid Native Preview asset path')
      const bytes = await readFile(source)
      if (!name.startsWith(`${sha256(bytes)}.`)) throw new Error('Project asset changed while Preview was building; run Preview again')
      if (files[name] !== undefined) continue
      size += bytes.byteLength
      if (size > 64 * 1024 * 1024) throw new Error('Native Preview assets exceed the 64 MiB limit')
      files[name] = bytes.toString('base64')
    }
  }
  return { directory, files }
}

export function isNativeAssets(value: unknown): value is NativeAssets {
  if (typeof value !== 'object' || value === null) return false
  const assets = value as NativeAssets
  return typeof assets.directory === 'string'
    && typeof assets.files === 'object' && assets.files !== null && !Array.isArray(assets.files)
    && Object.entries(assets.files).every(([name, content]) => isAssetName(name)
      && typeof content === 'string' && name.startsWith(`${sha256(Buffer.from(content, 'base64'))}.`))
}

export async function materializeNativeAssets(assets: NativeAssets): Promise<void> {
  await mkdir(assets.directory, { recursive: true })
  // Never follow a project-created link when publishing asset snapshots.
  if (await realpath(assets.directory) !== assets.directory) throw new Error('Native Preview asset directory must not be a symbolic link')
  for (const [name, content] of Object.entries(assets.files)) {
    await writeFile(join(assets.directory, name), Buffer.from(content, 'base64'), { flag: 'wx', mode: 0o600 }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
      const path = join(assets.directory, name)
      if (await realpath(path) !== path || sha256(await readFile(path)) !== name.slice(0, 64)) {
        throw new Error('Native Preview asset snapshot is damaged')
      }
    })
  }
}

function isAssetName(name: string): boolean {
  return /^[0-9a-f]{64}\.[a-zA-Z0-9]+$/.test(name)
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Install before project imports; React Native and expo-asset retain density selection. */
export const nativeAssetSource = `
const resolveAssetSource = require('react-native/Libraries/Image/resolveAssetSource').default;
resolveAssetSource.addCustomSourceTransformer(resolver => {
  if (!resolver.asset.runwhaleLocalAsset) return null;
  const scale = resolveAssetSource.pickScale(resolver.asset.scales, require('react-native').PixelRatio.get());
  const index = resolver.asset.scales.indexOf(scale);
  return resolver.fromSource(resolver.asset.fileUris[index]);
});
`
