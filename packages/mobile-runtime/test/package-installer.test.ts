import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MobilePackageInstaller, validateInstalledPackages } from '../src/package-installer.js'

describe('mobile package installer', () => {
  it('creates a one-use approval plan and detects package.json changes before install', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-package-plan-'))
    await mkdir(join(root, '.runwhale'), { recursive: true })
    await writeFile(join(root, 'package.json'), '{"name":"game","version":"1.0.0"}\n')
    const installer = new MobilePackageInstaller({ npmRoot: join(root, 'npm'), cacheRoot: join(root, 'cache') })
    const approval = vi.fn()
    installer.on('approval', approval)
    const plan = await installer.plan('game', root, { 'is-number': '7.0.0' })
    expect(approval).toHaveBeenCalledWith(plan)
    expect(plan.changes).toEqual([{ name: 'is-number', to: '7.0.0' }])
    await writeFile(join(root, 'package.json'), '{"name":"changed","version":"1.0.0"}\n')
    await expect(installer.start(plan.planId)).rejects.toThrow(/changed after approval/)
  })

  it('installs directly without approval and exposes the owning project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-package-direct-'))
    const project = join(root, 'project')
    await mkdir(join(project, '.runwhale'), { recursive: true })
    await writeFile(join(project, 'package.json'), '{"name":"project","version":"1.0.0"}\n')
    const installer = new MobilePackageInstaller({
      npmRoot: join(root, 'npm'),
      cacheRoot: join(root, 'cache'),
      workerUrl: new URL('./fixtures/package-worker-cache.ts', import.meta.url),
    })
    const approval = vi.fn()
    installer.on('approval', approval)

    const install = await installer.install('direct-project', project, { 'is-number': '7.0.0' }, false)
    expect(install.projectId).toBe('direct-project')
    expect(await install.result).toMatchObject({ installId: install.installId, state: 'completed', offline: false, packages: 1 })
    expect(approval).not.toHaveBeenCalled()

    const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
    expect(manifest.dependencies).toMatchObject({ 'is-number': '7.0.0' })
    await expect(readFile(join(project, 'node_modules', 'is-number', 'index.js'), 'utf8')).resolves.toContain('module.exports')
  })

  it('validates registry integrity and removes executable bits from ordinary package files', async () => {
    const staging = await mkdtemp(join(tmpdir(), 'runwhale-package-tree-'))
    const packageRoot = join(staging, 'node_modules', 'safe-package')
    await mkdir(packageRoot, { recursive: true })
    await writeFile(join(packageRoot, 'package.json'), '{"name":"safe-package","version":"1.0.0"}\n')
    const payload = join(packageRoot, 'index.js')
    await writeFile(payload, 'export default true\n')
    await writeFile(join(staging, 'package-lock.json'), `${JSON.stringify({
      name: 'test',
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { 'safe-package': '1.0.0' } },
        'node_modules/safe-package': { version: '1.0.0', resolved: 'https://registry.npmjs.org/safe-package/-/safe-package-1.0.0.tgz', integrity: 'sha512-YQ==' },
      },
    })}\n`)
    await chmod(payload, 0o755)
    await expect(validateInstalledPackages(staging, { 'safe-package': '1.0.0' })).resolves.toMatchObject({ packages: 1 })
    expect((await stat(payload)).mode & 0o111).toBe(0)
  })

  it('reuses the verified dependency cache for an offline project reopen', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-package-offline-'))
    const cacheRoot = join(root, 'cache')
    const createProject = async (name: string) => {
      const project = join(root, name)
      await mkdir(join(project, '.runwhale'), { recursive: true })
      await writeFile(join(project, 'package.json'), `${JSON.stringify({ name, version: '1.0.0' })}\n`)
      return project
    }
    const installer = new MobilePackageInstaller({
      npmRoot: join(root, 'npm'),
      cacheRoot,
      workerUrl: new URL('./fixtures/package-worker-cache.ts', import.meta.url),
    })
    const online = await installer.start((await installer.plan('online', await createProject('online'), { 'is-number': '7.0.0' })).planId)
    expect(await online.result).toMatchObject({ offline: false, packages: 1 })
    expect(await readFile(join(cacheRoot, 'fixture-registry-cache'), 'utf8')).toBe('cached\n')
    const offline = await installer.start((await installer.plan('offline', await createProject('offline'), { 'is-number': '7.0.0' }, true)).planId)
    expect(await offline.result).toMatchObject({ offline: true, packages: 1 })
  })

  it('reports pending and running activity only for the owning project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-package-activity-'))
    const project = join(root, 'project')
    await mkdir(join(project, '.runwhale'), { recursive: true })
    await writeFile(join(project, 'package.json'), '{"name":"project","version":"1.0.0"}\n')
    const holdingWorker = new URL(`data:text/javascript,${encodeURIComponent('setInterval(() => undefined, 1000)')}`)
    const installer = new MobilePackageInstaller({
      npmRoot: join(root, 'npm'),
      cacheRoot: join(root, 'cache'),
      workerUrl: holdingWorker,
    })

    const rejectedPlan = await installer.plan('project', project, { 'is-number': '7.0.0' })
    expect(installer.hasProjectActivity('project')).toBe(true)
    expect(installer.hasProjectActivity('sibling')).toBe(false)
    expect(installer.reject(rejectedPlan.planId)).toBe(true)
    expect(installer.hasProjectActivity('project')).toBe(false)

    const install = await installer.start((await installer.plan('project', project, { 'is-number': '7.0.0' })).planId)
    expect(installer.hasProjectActivity('project')).toBe(true)
    await expect(installer.cancel(install.installId)).resolves.toBe(true)
    await expect(install.result).resolves.toMatchObject({ installId: install.installId, state: 'cancelled' })
    expect(installer.hasProjectActivity('project')).toBe(false)
  })
})
