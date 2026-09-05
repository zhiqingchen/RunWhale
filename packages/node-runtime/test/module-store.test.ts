import { execFile } from 'node:child_process'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
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
