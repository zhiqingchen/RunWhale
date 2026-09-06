import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

const execute = promisify(execFile)
const repository = resolve(import.meta.dirname, '../../..')
const externalModuleStore = process.env.RUNWHALE_TEST_MODULE_STORE
const moduleStore = resolve(externalModuleStore ?? join(repository, 'packages/runtime-module-store/node_modules'))
const additionalWatchRoots = externalModuleStore ? [] : [resolve(repository, 'node_modules/.pnpm')]

describe('embedded module store', () => {
  it('preserves host source-map composition after runtime packaging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-host-source-map-'))
    const hostRequire = createRequire(join(repository, 'apps/mobile/package.json'))
    const compose = hostRequire.resolve('react-native/scripts/compose-source-maps.js')
    const packager = join(root, 'packager.map')
    const compiler = join(root, 'compiler.map')
    const output = join(root, 'composed.map')
    try {
      await writeFile(packager, JSON.stringify({ version: 3, sources: ['original.js'], names: [], mappings: 'AAAA' }))
      await writeFile(compiler, JSON.stringify({ version: 3, sources: ['index.android.bundle'], names: [], mappings: 'AAAA' }))
      await execute(process.execPath, [compose, packager, compiler, '-o', output])
      expect(JSON.parse(await readFile(output, 'utf8')).sources).toEqual(['original.js'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('bundles every exposed Native Preview module using only the isolated store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-module-store-runner-'))
    const runner = join(root, 'smoke.mjs')
    try {
      await symlink(moduleStore, join(root, 'node_modules'), 'dir')
      await build({
        entryPoints: [resolve(import.meta.dirname, 'fixtures/module-store-smoke.ts')],
        outfile: runner,
        bundle: true,
        platform: 'node',
        target: 'node24',
        format: 'esm',
        external: [
          '@expo/metro',
          '@expo/metro/*',
          '@expo/metro-config',
          '@expo/metro-config/*',
          'typescript',
        ],
      })
      const { stdout } = await execute(process.execPath, [runner, moduleStore, ...additionalWatchRoots], {
        cwd: repository,
        env: { ...process.env, NODE_ENV: 'development' },
        maxBuffer: 1024 * 1024,
        timeout: 240_000,
      })
      expect(JSON.parse(stdout.trim())).toEqual({ android: true, ios: true })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 250_000)
})
