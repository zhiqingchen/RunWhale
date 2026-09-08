import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  LibraryApp,
  LibraryInstallInput,
  PreviewPlatform,
  ReleaseTransfer,
} from '@runwhale/mobile-protocol'
import { NATIVE_PREVIEW_RUNTIME_ABI } from '@runwhale/mobile-protocol'
import type { MetroBundle } from './metro-runtime.js'
import { findSecretLeaks } from '@runwhale/mobile-runtime'
import { isNativeAssets, nativeAssetDirectory } from './native-assets.js'

const MAX_BYTES = 32 * 1024 * 1024
const ASSET_ROOT = 'file:///__runwhale_release_assets__'
interface Package {
  format: 'runwhale-app-v1'
  platform: PreviewPlatform
  runtimeAbi: typeof NATIVE_PREVIEW_RUNTIME_ABI
  code: string
  assets: Record<string, string>
  webDocument?: MetroBundle['webDocument']
}
export const releaseHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function identifier(value: string) {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(value)) throw new Error('Invalid app identifier')
  return value
}
export function encodeRelease(bundle: MetroBundle): Buffer {
  if (
    findSecretLeaks(bundle.code).length ||
    /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(bundle.code)
  )
    throw new Error('Remove embedded credentials before publishing this app')
  let code = bundle.code
  if (bundle.nativeAssets)
    code = code.split(pathToFileURL(bundle.nativeAssets.directory).href).join(ASSET_ROOT)
  const result = Buffer.from(
    JSON.stringify({
      format: 'runwhale-app-v1',
      platform: bundle.platform,
      runtimeAbi: NATIVE_PREVIEW_RUNTIME_ABI,
      code,
      assets: bundle.nativeAssets?.files ?? {},
      ...(bundle.webDocument ? { webDocument: bundle.webDocument } : {}),
    } satisfies Package),
  )
  if (result.length > MAX_BYTES) throw new Error('App package exceeds 32 MiB')
  return result
}
export function decodeRelease(
  bytes: Buffer,
  root: string,
  platform: PreviewPlatform,
  host: 'ios' | 'android',
): MetroBundle {
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Invalid app package size')
  const pkg = JSON.parse(bytes.toString()) as Package
  if (
    pkg.format !== 'runwhale-app-v1' ||
    pkg.platform !== platform ||
    !['web', 'ios', 'android'].includes(platform) ||
    (platform !== 'web' && platform !== host) ||
    pkg.runtimeAbi?.[host] !== NATIVE_PREVIEW_RUNTIME_ABI[host] ||
    typeof pkg.code !== 'string' ||
    !isNativeAssets({ directory: root, files: pkg.assets })
  )
    throw new Error(
      'App package is incompatible or damaged. Update RunWhale or contact its creator.',
    )
  if (
    pkg.webDocument &&
    (typeof pkg.webDocument.html !== 'string' ||
      !pkg.webDocument.assets ||
      typeof pkg.webDocument.assets !== 'object' ||
      !Object.entries(pkg.webDocument.assets).every(
        ([path, asset]) =>
          path.startsWith('/') &&
          !path.includes('..') &&
          asset &&
          typeof asset.content === 'string' &&
          typeof asset.contentType === 'string' &&
          !/[\r\n]/.test(asset.contentType),
      ))
  )
    throw new Error('Invalid web app assets')
  const directory = nativeAssetDirectory(root)
  const code = pkg.code.split(ASSET_ROOT).join(pathToFileURL(directory).href)
  return {
    platform,
    code,
    map: '',
    durationMs: 0,
    requestPath: `/.runwhale/metro-${platform}-entry.bundle`,
    ...(Object.keys(pkg.assets).length ? { nativeAssets: { directory, files: pkg.assets } } : {}),
    ...(pkg.webDocument ? { webDocument: pkg.webDocument } : {}),
  }
}
export class AppLibrary {
  private transfers = new Map<
    string,
    { data: Buffer; expected?: LibraryInstallInput; offset: number; touched: number }
  >()
  constructor(
    private root: string,
    private host: 'ios' | 'android',
  ) {}
  private expire() {
    for (const [id, t] of this.transfers)
      if (Date.now() - t.touched > 10 * 60_000) this.transfers.delete(id)
  }
  export(bundle: MetroBundle): ReleaseTransfer {
    this.expire()
    if (this.transfers.size >= 2) throw new Error('Finish the current transfer first')
    const data = encodeRelease(bundle)
    const id = randomUUID()
    this.transfers.set(id, { data, offset: data.length, touched: Date.now() })
    return { id, bytes: data.length, sha256: releaseHash(data) }
  }
  read(id: string, offset: number) {
    const t = this.transfers.get(id)
    if (!t || t.expected || !Number.isSafeInteger(offset) || offset < 0 || offset > t.data.length)
      throw new Error('Invalid release transfer')
    t.touched = Date.now()
    return {
      chunk: t.data.subarray(offset, offset + 48000).toString('base64'),
      done: offset + 48000 >= t.data.length,
    }
  }
  begin(input: LibraryInstallInput) {
    identifier(input.appId)
    identifier(input.versionId)
    if (
      !['web', 'ios', 'android'].includes(input.platform) ||
      !/^[a-f0-9]{64}$/.test(input.sha256) ||
      !Number.isSafeInteger(input.bytes) ||
      input.bytes < 1 ||
      input.bytes > MAX_BYTES ||
      (input.temporary !== undefined && typeof input.temporary !== 'boolean') ||
      (input.expiresAt !== undefined && (!input.temporary || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Date.now())) ||
      !input.name ||
      input.name.length > 80
    )
      throw new Error('Invalid installation')
    this.expire()
    if (this.transfers.size >= 2) throw new Error('Finish the current transfer first')
    const id = randomUUID()
    this.transfers.set(id, {
      data: Buffer.alloc(input.bytes),
      expected: input,
      offset: 0,
      touched: Date.now(),
    })
    return { id }
  }
  chunk(id: string, offset: number, chunk: string) {
    const t = this.transfers.get(id)
    if (
      !t?.expected ||
      offset !== t.offset ||
      typeof chunk !== 'string' ||
      chunk.length > 64000 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk)
    )
      throw new Error('Invalid transfer chunk')
    const bytes = Buffer.from(chunk, 'base64')
    if (!bytes.length || t.offset + bytes.length > t.data.length)
      throw new Error('Invalid transfer size')
    bytes.copy(t.data, t.offset)
    t.offset += bytes.length
    t.touched = Date.now()
    return { offset: t.offset }
  }
  discard(id: string) {
    this.transfers.delete(id)
    return { discarded: true as const }
  }
  private directory(appId: string, temporary = false) {
    return join(this.root, (temporary ? 'temp-' : 'app-') + identifier(appId))
  }
  async commit(id: string): Promise<LibraryApp> {
    const t = this.transfers.get(id)
    if (!t?.expected || t.offset !== t.data.length) throw new Error('Download is incomplete')
    const input = t.expected
    if (releaseHash(t.data) !== input.sha256) {
      this.discard(id)
      throw new Error('Download integrity check failed')
    }
    const root = this.directory(input.appId, Boolean(input.temporary))
    decodeRelease(t.data, root, input.platform, this.host)
    const app: LibraryApp = {
      appId: input.appId,
      versionId: input.versionId,
      name: input.name,
      platform: input.platform,
      sha256: input.sha256,
      installedAt: Date.now(),
      temporary: Boolean(input.temporary),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    }
    await mkdir(root, { recursive: true })
    const temporary = join(root, `${id}.tmp`)
    try {
      await writeFile(temporary, JSON.stringify({ app, package: t.data.toString() }), {
        mode: 0o600,
      })
      await rename(temporary, join(root, 'installed.json'))
    } finally {
      this.discard(id)
      await rm(temporary, { force: true })
    }
    return app
  }
  async list(): Promise<LibraryApp[]> {
    await mkdir(this.root, { recursive: true })
    const result: LibraryApp[] = []
    for (const name of await readdir(this.root))
      if (name.startsWith('app-')) {
        try {
          const data = JSON.parse(await readFile(join(this.root, name, 'installed.json'), 'utf8'))
          result.push({ ...data.app, temporary: false })
        } catch {
          /* Incomplete installs are not listed. */
        }
      }
    return result.sort((a, b) => b.installedAt - a.installedAt)
  }
  async open(appId: string, temporary = false) {
    const root = await realpath(this.directory(appId, temporary))
    const data = JSON.parse(await readFile(join(root, 'installed.json'), 'utf8')) as {
      app: LibraryApp
      package: string
    }
    if (data.app.expiresAt !== undefined && Date.now() >= data.app.expiresAt) {
      await this.remove(appId, temporary)
      throw new Error('Temporary app expired. Install a new copy.')
    }
    const bytes = Buffer.from(data.package)
    if (releaseHash(bytes) !== data.app.sha256)
      throw new Error('Installed app is damaged. Download it again.')
    return {
      app: { ...data.app, temporary },
      bundle: decodeRelease(bytes, root, data.app.platform, this.host),
    }
  }
  async remove(appId: string, temporary = false) {
    await rm(this.directory(appId, temporary), { recursive: true, force: true })
    return { removed: true as const }
  }
}
