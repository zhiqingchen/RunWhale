import { access, mkdir, mkdtemp, readFile, readlink, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { c as createTar } from 'tar'
import { describe, expect, it } from 'vitest'
import { prepareEmbeddedNpm, prepareModuleStore } from '../src/runtime-assets.js'

describe('embedded runtime assets', () => {
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
      await expect(prepareEmbeddedNpm(root, destination)).resolves.toBe('11.17.0')

      await expect(access(stale)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
