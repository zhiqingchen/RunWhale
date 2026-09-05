import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { c as createTar } from 'tar'
import { describe, expect, it } from 'vitest'
import { prepareEmbeddedNpm, prepareModuleStore } from '../src/runtime-assets.js'

describe('embedded runtime assets', () => {
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
