import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MobilePackageInstaller, PackageInstallResult, StartedPackageInstall } from '@runwhale/mobile-runtime/package-installer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunWhaleRuntimeHost } from '../src/runtime-host.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())) })

describe('lazy runtime preparation', () => {
  it('starts the host before preparing modules and retries a failed Preview preparation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-lazy-modules-'))
    const prepareModuleStore = vi.fn()
      .mockRejectedValueOnce(new Error('module preparation failed'))
      .mockResolvedValue(undefined)
    const host = new RunWhaleRuntimeHost({
      root,
      moduleStore: join(root, 'modules'),
      platform: 'ios',
      agent: { run: async () => ({ text: '' }) },
      prepareModuleStore,
    })
    const metro = (host as unknown as { metro: Record<string, unknown> }).metro
    Object.assign(metro, {
      bundle: async () => previewBundle('ios', 'globalThis.lazyModules = true\n'),
      serve: async () => ({ port: 41_001, token: 'lazy-modules', bundleUrl: 'http://127.0.0.1:41001/bundle' }),
      stop: async () => undefined,
    })
    const info = await host.start()
    cleanups.push(async () => { await host.stop(); await rm(root, { recursive: true, force: true }) })
    const rpc = rpcClient(info.origin, info.token)
    const projectId = 'lazy-modules'
    await writePreviewProject(root, projectId, host.snapshot().runtimeAbi)

    expect(prepareModuleStore).not.toHaveBeenCalled()
    await expect(rpc('host.snapshot', { afterSequence: 0 })).resolves.toMatchObject({ ok: true, result: { snapshot: { state: 'running' } } })
    await expect(rpc('host.environment', {})).resolves.toMatchObject({ ok: true, result: { npmVersion: 'unavailable', moduleStoreBytes: 0 } })
    await expect(rpc('preview.open', { projectId, platform: 'ios' })).resolves.toMatchObject({ ok: true, result: { status: 'missing' } })
    expect(prepareModuleStore).not.toHaveBeenCalled()

    await expect(rpc('preview.run', { projectId, platform: 'ios' })).resolves.toMatchObject({ error: { message: 'module preparation failed' } })
    await expect(rpc('preview.run', { projectId, platform: 'ios' })).resolves.toMatchObject({ ok: true, result: { projectId, platform: 'ios' } })
    expect(prepareModuleStore).toHaveBeenCalledTimes(2)

    const snapshot = await rpc('host.snapshot', { afterSequence: 0 })
    expect(snapshot.result.events.filter((event: any) => event.name === 'runtime.preparation').map((event: any) => event.data.state)).toEqual([
      'preparing',
      'failed',
      'preparing',
      'ready',
    ])
  })

  it('shares one npm preparation across concurrent package installs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-lazy-npm-'))
    let releasePreparation!: () => void
    const preparationBlocked = new Promise<void>((resolve) => { releasePreparation = resolve })
    const prepareNpm = vi.fn(async () => preparationBlocked)
    const start = vi.fn(async (planId: string): Promise<StartedPackageInstall> => ({
      installId: `install-${planId}`,
      projectId: 'package-project',
      result: Promise.resolve(packageResult(`install-${planId}`)),
    }))
    const packageInstaller = {
      on: vi.fn().mockReturnThis(),
      paths: () => ({ npmRoot: join(root, 'npm'), cacheRoot: join(root, 'npm-cache') }),
      start,
    } as unknown as MobilePackageInstaller
    const host = new RunWhaleRuntimeHost({
      root,
      moduleStore: join(root, 'modules'),
      platform: 'ios',
      agent: { run: async () => ({ text: '' }) },
      packageInstaller,
      prepareNpm,
    })
    const info = await host.start()
    cleanups.push(async () => { await host.stop(); await rm(root, { recursive: true, force: true }) })
    const rpc = rpcClient(info.origin, info.token)

    expect(prepareNpm).not.toHaveBeenCalled()
    await expect(rpc('host.environment', {})).resolves.toMatchObject({ ok: true, result: { npmVersion: 'unavailable' } })
    expect(prepareNpm).not.toHaveBeenCalled()
    const first = rpc('package.install', { planId: 'first' })
    const second = rpc('package.install', { planId: 'second' })
    await vi.waitFor(() => { expect(prepareNpm).toHaveBeenCalledTimes(1) })
    expect(start).not.toHaveBeenCalled()
    await expect(rpc('host.snapshot', { afterSequence: 0 })).resolves.toMatchObject({ ok: true, result: { snapshot: { state: 'running' } } })

    releasePreparation()
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ ok: true, result: { installId: 'install-first' } }),
      expect.objectContaining({ ok: true, result: { installId: 'install-second' } }),
    ])
    expect(start).toHaveBeenCalledTimes(2)
    expect(prepareNpm).toHaveBeenCalledTimes(1)
  })
})

function packageResult(installId: string): PackageInstallResult {
  return { installId, state: 'completed', output: '', durationMs: 0, packages: 0, bytes: 0, offline: false }
}

function rpcClient(origin: string, token: string) {
  return async (method: string, params: unknown): Promise<any> => fetch(`${origin}/rpc`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }),
  }).then((response) => response.json())
}

async function writePreviewProject(root: string, projectId: string, runtimeAbi: string): Promise<void> {
  const project = join(root, 'projects', projectId)
  await mkdir(project, { recursive: true })
  await writeFile(join(project, 'runwhale.json'), `${JSON.stringify({
    schemaVersion: 1,
    id: projectId,
    name: projectId,
    runtimeAbi: { ios: runtimeAbi },
    entry: { ios: 'index.tsx' },
    capabilities: [],
    tasks: {},
    source: { kind: 'local' },
  })}\n`)
}

function previewBundle(platform: 'ios', code: string) {
  return {
    platform,
    code,
    map: '{}',
    durationMs: 1,
    requestPath: '/index.bundle?platform=ios',
    codeBytes: Buffer.from(code),
  }
}
