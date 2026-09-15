import { access, mkdir, mkdtemp, readFile, readlink, readdir, rm, stat, statfs, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { c as createTar } from 'tar'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareEmbeddedNpm, prepareModuleStore } from '../src/runtime-assets.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const filesystem = await importOriginal<typeof import('node:fs/promises')>()
  return { ...filesystem, statfs: vi.fn(filesystem.statfs) }
})
afterEach(() => { vi.mocked(statfs).mockReset() })

describe('embedded runtime assets', () => {
  it.each(['module-store', 'npm'] as const)('checks expanded %s bytes before staging and preserves an existing installation on low space', async (kind) => {
    const cache = join(import.meta.dirname, '../../../.cache')
    await mkdir(cache, { recursive: true })
    const root = await mkdtemp(join(cache, 'runtime-low-storage-'))
    const source = join(root, 'source')
    const destination = join(root, 'installed')
    const manifestPath = kind === 'module-store' ? 'expo/package.json' : 'package.json'
    const archive = join(root, `runwhale-${kind}.tgz`)
    const prepare = kind === 'module-store' ? prepareModuleStore : prepareEmbeddedNpm
    try {
      await mkdir(join(source, 'expo'), { recursive: true })
      await mkdir(join(destination, 'expo'), { recursive: true })
      await writeFile(join(source, manifestPath), '{"version":"11.17.0"}')
      await writeFile(join(source, 'payload'), Buffer.alloc(512 * 1024))
      await writeFile(join(destination, manifestPath), '{"version":"older"}')
      await createTar({ cwd: source, file: archive, gzip: true }, ['.'])
      const availableBytes = 16 * 1024 * 1024 + 128 * 1024
      expect((await stat(archive)).size).toBeLessThan(128 * 1024)
      const space = await statfs(root)
      vi.mocked(statfs).mockResolvedValueOnce({ ...space, bavail: Math.floor(availableBytes / space.bsize) })

      await expect(prepare(root, destination)).rejects.toThrow('Not enough available storage')

      expect(await readFile(join(destination, manifestPath), 'utf8')).toBe('{"version":"older"}')
      expect((await readdir(root)).some((name) => name.includes('-stage-'))).toBe(false)
      await expect(access(join(destination, 'payload'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('preserves module bytes and relative package links across streamed extraction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-streamed-assets-'))
    const source = join(root, 'source')
    const destination = join(root, 'node_modules')
    const content = Buffer.alloc(256 * 1024, 'runtime-source')
    try {
      await mkdir(join(source, 'expo'), { recursive: true })
      await mkdir(join(source, '.bin'))
      await writeFile(join(source, 'expo/package.json'), '{"name":"expo"}\n')
      await writeFile(join(source, 'expo/index.js'), content)
      await symlink('../expo/index.js', join(source, '.bin/expo'))
      await createTar({ cwd: source, file: join(root, 'runwhale-module-store.tgz'), gzip: true }, ['.'])

      await prepareModuleStore(root, destination)

      expect(await readFile(join(destination, 'expo/index.js'))).toEqual(content)
      expect(await readlink(join(destination, '.bin/expo'))).toBe('../expo/index.js')
      expect(await readFile(join(destination, '.bin/expo'))).toEqual(content)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects an escaping archive link and keeps the installed module store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-invalid-assets-'))
    const source = join(root, 'source')
    const destination = join(root, 'node_modules')
    try {
      await mkdir(join(destination, 'expo'), { recursive: true })
      await writeFile(join(destination, 'expo/package.json'), '{"name":"installed-expo"}\n')
      await mkdir(source)
      await symlink('../outside', join(source, 'escape'))
      await writeFile(join(root, 'outside'), 'untouched')
      await createTar({ cwd: source, file: join(root, 'runwhale-module-store.tgz'), gzip: true }, ['escape'])

      await expect(prepareModuleStore(root, destination)).rejects.toThrow()

      expect(await readFile(join(root, 'outside'), 'utf8')).toBe('untouched')
      expect(JSON.parse(await readFile(join(destination, 'expo/package.json'), 'utf8')).name).toBe('installed-expo')
      expect((await readdir(root)).some((name) => name.startsWith('.module-store-stage-'))).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('removes abandoned module-store extraction stages before reusing an installed store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-runtime-assets-'))
    const source = join(root, 'module-store-source')
    const destination = join(root, 'node_modules')
    const stale = join(root, '.module-store-stage-abandoned')
    try {
      await mkdir(join(source, 'expo'), { recursive: true })
      await writeFile(join(source, 'expo/package.json'), '{"name":"expo"}\n')
      await createTar({ cwd: source, file: join(root, 'runwhale-module-store.tgz'), gzip: true }, ['.'])

      await prepareModuleStore(root, destination)
      await mkdir(stale)
      await writeFile(join(stale, 'partial'), 'incomplete\n')
      vi.mocked(statfs).mockRejectedValue(new Error('Reusable assets must not query disk space'))
      await prepareModuleStore(root, destination)

      await expect(access(join(destination, 'expo/package.json'))).resolves.toBeUndefined()
      await expect(access(stale)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('removes abandoned npm extraction stages even when npm is already installed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-runtime-npm-'))
    const source = join(root, 'npm-source')
    const destination = join(root, '.runwhale/npm')
    const stale = join(root, '.npm-stage-abandoned')
    try {
      await mkdir(source)
      await writeFile(join(source, 'package.json'), '{"name":"npm","version":"11.17.0"}\n')
      await createTar({ cwd: source, file: join(root, 'runwhale-npm.tgz'), gzip: true }, ['.'])

      await prepareEmbeddedNpm(root, destination)
      await mkdir(stale)
      await writeFile(join(stale, 'partial'), 'incomplete\n')
      vi.mocked(statfs).mockRejectedValue(new Error('Reusable assets must not query disk space'))
      await expect(prepareEmbeddedNpm(root, destination)).resolves.toBe('11.17.0')

      await expect(access(stale)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
