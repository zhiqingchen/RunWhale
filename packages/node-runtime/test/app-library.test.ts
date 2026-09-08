import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { AppLibrary, decodeRelease, encodeRelease, releaseHash } from '../src/app-library.js'
import type { MetroBundle } from '../src/metro-runtime.js'
import { nativeAssetDirectory } from '../src/native-assets.js'
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })))
})
const bundle = (code = 'first'): MetroBundle => ({
  platform: 'web',
  code,
  map: '',
  durationMs: 0,
  requestPath: '/.runwhale/metro-web-entry.bundle',
})
describe('finished app library', () => {
  it('moves native assets to the receiving device and rejects incompatible bundles', () => {
    const bytes = Buffer.from('image')
    const name = releaseHash(bytes) + '.png'
    const directory = nativeAssetDirectory('/creator/project')
    const packed = encodeRelease({
      ...bundle(JSON.stringify(pathToFileURL(join(directory, name)).href)),
      platform: 'ios',
      nativeAssets: { directory, files: { [name]: bytes.toString('base64') } },
    })
    expect(packed.toString()).not.toContain('/creator/project')
    const decoded = decodeRelease(packed, '/recipient/apps/test', 'ios', 'ios')
    expect(decoded.code).toContain('/recipient/apps/test/.runwhale/cache/native-assets/')
    expect(() => decodeRelease(packed, '/recipient', 'android', 'android')).toThrow(/incompatible/)
  })
  it('installs atomically, keeps old version after corrupt update, survives restart, isolates temporary copies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-library-'))
    roots.push(root)
    const library = new AppLibrary(root, 'ios')
    async function install(code: string, versionId: string, temporary = false) {
      const data = encodeRelease(bundle(code))
      const { id } = library.begin({
        appId: 'sample-app',
        versionId,
        name: 'Timer',
        platform: 'web',
        sha256: releaseHash(data),
        bytes: data.length,
        temporary,
      })
      library.chunk(id, 0, data.toString('base64'))
      return library.commit(id)
    }
    await install('first', 'version-one')
    expect((await new AppLibrary(root, 'ios').open('sample-app')).bundle.code).toBe('first')
    const data = encodeRelease(bundle('broken'))
    const transfer = library.begin({
      appId: 'sample-app',
      versionId: 'version-two',
      name: 'Timer',
      platform: 'web',
      sha256: '0'.repeat(64),
      bytes: data.length,
    })
    library.chunk(transfer.id, 0, data.toString('base64'))
    await expect(library.commit(transfer.id)).rejects.toThrow(/integrity/)
    expect((await library.open('sample-app')).app.versionId).toBe('version-one')
    await writeFile(join(root, 'app-sample-app', 'user-data'), 'keep')
    await install('second', 'version-two')
    expect(await readFile(join(root, 'app-sample-app', 'user-data'), 'utf8')).toBe('keep')
    await install('private', 'version-three', true)
    expect((await library.open('sample-app')).bundle.code).toBe('second')
    expect((await library.open('sample-app', true)).bundle.code).toBe('private')
    expect(await library.list()).toHaveLength(1)
    await library.remove('sample-app', true)
    expect(await library.list()).toHaveLength(1)
  })
  it('expires a temporary install without removing the persistent app', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-library-'))
    roots.push(root)
    const library = new AppLibrary(root, 'ios')
    const data = encodeRelease(bundle())
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    for (const temporary of [false, true]) {
      const transfer = library.begin({ appId: 'sample-app', versionId: 'version-one', name: 'Timer', platform: 'web', sha256: releaseHash(data), bytes: data.length, temporary, ...(temporary ? { expiresAt: now + 1000 } : {}) })
      library.chunk(transfer.id, 0, data.toString('base64'))
      await library.commit(transfer.id)
    }
    vi.mocked(Date.now).mockReturnValue(now + 1000)
    await expect(library.open('sample-app', true)).rejects.toThrow('Temporary app expired')
    expect((await library.open('sample-app')).app.temporary).toBe(false)
    expect(await library.list()).toHaveLength(1)
  })
  it('rejects path escape and out-of-order chunks', async () => {
    const library = new AppLibrary('/unused', 'ios')
    const input = {
      appId: '../escape',
      versionId: 'version-one',
      name: 'Timer',
      platform: 'web' as const,
      sha256: 'a'.repeat(64),
      bytes: 3,
    }
    expect(() => library.begin(input)).toThrow(/identifier/)
    const { id } = library.begin({ ...input, appId: 'safe-app' })
    expect(() => library.chunk(id, 1, 'YWJj')).toThrow()
    expect(() => library.chunk(id, 0, 'YWJjZA==')).toThrow()
  })
})
