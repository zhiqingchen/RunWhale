import { createHash, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { PackageInstallPlan } from '@runwhale/mobile-protocol'
import { assertRegistryDependency, validatePackageArchive, type ArchiveEntry, type PackageManifest } from './dependency-policy.js'

const PLAN_LIFETIME_MS = 10 * 60_000
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024
const DEFAULT_MAX_INSTALL_BYTES = 128 * 1024 * 1024
const MAX_TREE_ENTRIES = 50_000

interface PendingPlan {
  public: PackageInstallPlan
  root: string
  dependencies: Record<string, string>
  packageHash: string
  offline: boolean
}

export interface PackageInstallerOptions {
  npmRoot: string
  cacheRoot: string
  workerUrl?: URL
  maxInstallBytes?: number
}

export interface PackageInstallResult {
  installId: string
  state: 'completed' | 'failed' | 'cancelled'
  output: string
  durationMs: number
  packages: number
  bytes: number
  offline: boolean
  error?: string
}

export interface StartedPackageInstall {
  installId: string
  projectId: string
  result: Promise<PackageInstallResult>
}

interface PackageEvents {
  approval: [plan: PackageInstallPlan]
  output: [installId: string, chunk: string]
  state: [installId: string, state: 'running' | 'completed' | 'failed' | 'cancelled', detail?: unknown]
}

export class MobilePackageInstaller extends EventEmitter<PackageEvents> {
  private readonly plans = new Map<string, PendingPlan>()
  private readonly startingPlans = new Map<string, PendingPlan>()
  private readonly workers = new Map<string, { worker: Worker; projectId: string }>()
  private readonly cancelled = new Set<string>()

  constructor(private readonly options: PackageInstallerOptions) { super() }

  paths(): { npmRoot: string; cacheRoot: string } { return { npmRoot: resolve(this.options.npmRoot), cacheRoot: resolve(this.options.cacheRoot) } }

  hasProjectActivity(projectId: string): boolean {
    this.pruneExpiredPlans()
    return [...this.plans.values()].some((plan) => plan.public.projectId === projectId)
      || [...this.startingPlans.values()].some((plan) => plan.public.projectId === projectId)
      || [...this.workers.values()].some((active) => active.projectId === projectId)
  }

  async plan(projectId: string, root: string, dependencies: Record<string, string>, offline = false): Promise<PackageInstallPlan> {
    const plan = await this.createPlan(projectId, root, dependencies, offline)
    this.emit('approval', plan)
    return plan
  }

  async install(projectId: string, root: string, dependencies: Record<string, string>, offline = false): Promise<StartedPackageInstall> {
    const plan = await this.createPlan(projectId, root, dependencies, offline)
    return this.start(plan.planId)
  }

  private async createPlan(projectId: string, root: string, dependencies: Record<string, string>, offline: boolean): Promise<PackageInstallPlan> {
    const projectRoot = await realpath(root)
    const packagePath = join(projectRoot, 'package.json')
    const source = await readFile(packagePath, 'utf8')
    const manifest = parseProjectManifest(source)
    const entries = Object.entries(dependencies)
    if (entries.length === 0 || entries.length > 20) throw new Error('package plan must contain between 1 and 20 dependencies')
    const normalized: Record<string, string> = {}
    const changes: PackageInstallPlan['changes'] = []
    for (const [rawName, rawSpec] of entries) {
      const name = rawName.trim()
      const spec = rawSpec.trim()
      assertRegistryDependency(name, spec)
      normalized[name] = spec
      const previous = manifest.dependencies?.[name]
      if (previous !== spec) changes.push({ name, ...(previous ? { from: previous } : {}), to: spec })
    }
    if (changes.length === 0) throw new Error('requested dependencies are already present at the selected versions')
    const planId = `pkg-plan-${randomUUID()}`
    const publicPlan: PackageInstallPlan = { planId, projectId, changes, expiresAt: Date.now() + PLAN_LIFETIME_MS }
    this.plans.set(planId, {
      public: publicPlan,
      root: projectRoot,
      dependencies: normalized,
      packageHash: digest(source),
      offline,
    })
    return publicPlan
  }

  async start(planId: string): Promise<StartedPackageInstall> {
    const plan = this.plans.get(planId)
    this.plans.delete(planId)
    if (!plan) throw new Error('package install plan was not found or was already used')
    if (plan.public.expiresAt < Date.now()) throw new Error('package install plan expired')
    this.startingPlans.set(planId, plan)
    try {
      const currentPackage = await readFile(join(plan.root, 'package.json'), 'utf8')
      if (digest(currentPackage) !== plan.packageHash) throw new Error('package.json changed after approval was requested')

      const installId = `pkg-${randomUUID()}`
      const startedAt = Date.now()
      const staging = join(plan.root, '.runwhale', 'package-staging', installId)
      await rm(staging, { recursive: true, force: true })
      await mkdir(staging, { recursive: true })
      const manifest = parseProjectManifest(currentPackage)
      manifest.dependencies = { ...manifest.dependencies, ...plan.dependencies }
      await writeFile(join(staging, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
      try { await copyFile(join(plan.root, 'package-lock.json'), join(staging, 'package-lock.json')) } catch { /* npm creates the first lockfile */ }
      await mkdir(this.options.cacheRoot, { recursive: true })

      const worker = new Worker(this.options.workerUrl ?? new URL('./package-worker.js', import.meta.url), {
        workerData: {
          npmRoot: resolve(this.options.npmRoot),
          staging,
          cacheRoot: resolve(this.options.cacheRoot),
          offline: plan.offline,
        },
        env: {},
        execArgv: process.execArgv.filter((argument) => !argument.startsWith('--input-type')),
        resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 },
      })
      this.workers.set(installId, { worker, projectId: plan.public.projectId })
      this.startingPlans.delete(planId)
      this.emit('state', installId, 'running', { projectId: plan.public.projectId, offline: plan.offline })
      let output = ''
      let outputBytes = 0

      const result = new Promise<PackageInstallResult>((resolveResult) => {
        let settled = false
        const finish = async (error?: string): Promise<void> => {
          if (settled) return
          settled = true
          let validation: { packages: number; bytes: number } = { packages: 0, bytes: 0 }
          let finalError = error
          if (!finalError) {
            try {
              validation = await validateInstalledPackages(staging, plan.dependencies, this.options.maxInstallBytes)
              await publishInstall(plan.root, staging)
            } catch (caught) {
              finalError = caught instanceof Error ? caught.message : String(caught)
            }
          }
          await rm(staging, { recursive: true, force: true })
          this.workers.delete(installId)
          const cancelled = this.cancelled.delete(installId)
          const state = cancelled ? 'cancelled' : finalError ? 'failed' : 'completed'
          this.emit('state', installId, state, { projectId: plan.public.projectId, ...(finalError ? { error: finalError } : validation) })
          resolveResult({
            installId,
            state,
            output,
            durationMs: Date.now() - startedAt,
            ...validation,
            offline: plan.offline,
            ...(finalError ? { error: finalError } : {}),
          })
        }
        worker.on('message', (message: unknown) => {
          if (typeof message !== 'object' || message === null) return
          const record = message as Record<string, unknown>
          if (record.type === 'output' && typeof record.chunk === 'string') {
            const bytes = Buffer.byteLength(record.chunk)
            if (outputBytes + bytes > DEFAULT_MAX_OUTPUT_BYTES) {
              void worker.terminate()
              void finish(`npm output exceeded ${DEFAULT_MAX_OUTPUT_BYTES} bytes`)
              return
            }
            output += record.chunk
            outputBytes += bytes
            this.emit('output', installId, record.chunk)
          }
          if (record.type === 'done') void finish(typeof record.error === 'string' ? record.error : undefined)
        })
        worker.once('error', error => { void finish(error.message) })
        worker.once('exit', code => {
          if (!settled) void finish(this.cancelled.has(installId) ? 'package install cancelled' : `npm worker exited with code ${code}`)
        })
      })
      return { installId, projectId: plan.public.projectId, result }
    } finally {
      this.startingPlans.delete(planId)
    }
  }

  reject(planId: string): boolean { return this.plans.delete(planId) }

  async cancel(installId: string): Promise<boolean> {
    const active = this.workers.get(installId)
    if (!active) return false
    this.cancelled.add(installId)
    await active.worker.terminate()
    return true
  }

  private pruneExpiredPlans(): void {
    const now = Date.now()
    for (const [planId, plan] of this.plans) {
      if (plan.public.expiresAt < now) this.plans.delete(planId)
    }
  }
}

export async function validateInstalledPackages(staging: string, requested: Record<string, string>, maxInstallBytes = DEFAULT_MAX_INSTALL_BYTES): Promise<{ packages: number; bytes: number }> {
  const nodeModules = join(staging, 'node_modules')
  const root = await realpath(nodeModules)
  const lock = validateLockfile(JSON.parse(await readFile(join(staging, 'package-lock.json'), 'utf8')) as unknown)
  const rootEntry = lock.packages[''] as { dependencies?: Record<string, string> } | undefined
  for (const name of Object.keys(requested)) {
    if (!rootEntry?.dependencies?.[name]) throw new Error(`lockfile is missing approved dependency ${name}`)
  }
  let packages = 0
  let bytes = 0
  let entries = 0

  const visitNodeModules = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.bin') throw new Error('npm produced a forbidden executable bin directory')
      const absolute = join(directory, entry.name)
      if (entry.name === '.package-lock.json' && entry.isFile()) {
        const info = await lstat(absolute)
        if ((info.mode & 0o111) !== 0) throw new Error('node_modules lock metadata is executable')
        bytes += info.size
        if (bytes > maxInstallBytes) throw new Error(`installed dependencies exceed ${maxInstallBytes} bytes`)
        continue
      }
      if (entry.name.startsWith('@') && entry.isDirectory()) {
        for (const scoped of await readdir(absolute, { withFileTypes: true })) {
          if (!scoped.isDirectory()) throw new Error(`invalid scoped package entry: ${scoped.name}`)
          await visitPackage(join(absolute, scoped.name))
        }
      } else if (entry.isDirectory()) {
        await visitPackage(absolute)
      } else {
        throw new Error(`unexpected node_modules entry: ${entry.name}`)
      }
    }
  }

  const visitPackage = async (packageRoot: string): Promise<void> => {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as PackageManifest
    const archiveEntries: ArchiveEntry[] = []
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (++entries > MAX_TREE_ENTRIES) throw new Error(`installed dependency tree exceeds ${MAX_TREE_ENTRIES} entries`)
        const absolute = join(directory, entry.name)
        const path = relative(packageRoot, absolute).split(sep).join('/')
        if (entry.name === 'node_modules' && entry.isDirectory()) {
          await visitNodeModules(absolute)
          continue
        }
        const info = await lstat(absolute)
        if (info.isSymbolicLink()) {
          const target = await realpath(absolute)
          if (!inside(root, target)) throw new Error(`installed symlink escapes node_modules: ${path}`)
          archiveEntries.push({ path, size: 0, type: 'symlink', linkTarget: relative(dirname(absolute), target) })
        } else if (info.isDirectory()) {
          archiveEntries.push({ path, size: 0, type: 'directory' })
          await walk(absolute)
        } else if (info.isFile()) {
          // Registry tarballs sometimes preserve an executable bit on ordinary
          // source files. Bins and native/build entry points are rejected by
          // policy below, so normalize incidental mode metadata instead of
          // rolling back an otherwise safe package.
          if ((info.mode & 0o111) !== 0) await chmod(absolute, info.mode & ~0o111)
          bytes += info.size
          if (bytes > maxInstallBytes) throw new Error(`installed dependencies exceed ${maxInstallBytes} bytes`)
          archiveEntries.push({ path, size: info.size, type: 'file' })
        } else {
          throw new Error(`unsupported dependency entry type: ${path}`)
        }
      }
    }
    await walk(packageRoot)
    validatePackageArchive(manifest, archiveEntries)
    packages += 1
  }

  await visitNodeModules(nodeModules)
  return { packages, bytes }
}

function validateLockfile(value: unknown): { packages: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null) throw new Error('package-lock.json is not an object')
  const lock = value as { lockfileVersion?: unknown; packages?: unknown }
  if (lock.lockfileVersion !== 3 || typeof lock.packages !== 'object' || lock.packages === null) throw new Error('npm must produce a lockfileVersion 3 lockfile')
  for (const [path, raw] of Object.entries(lock.packages as Record<string, unknown>)) {
    if (!path || typeof raw !== 'object' || raw === null) continue
    const entry = raw as { resolved?: unknown; integrity?: unknown; link?: unknown }
    if (entry.link === true) throw new Error(`linked dependency is forbidden in lockfile: ${path}`)
    if (entry.resolved !== undefined) {
      if (typeof entry.resolved !== 'string' || typeof entry.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+=*$/.test(entry.integrity)) {
        throw new Error(`registry integrity is missing or invalid for ${path}`)
      }
      let resolved: URL
      try { resolved = new URL(entry.resolved) } catch { throw new Error(`non-registry lockfile source is forbidden for ${path}`) }
      if (resolved.protocol !== 'https:' || resolved.hostname !== 'registry.npmjs.org') throw new Error(`non-registry lockfile source is forbidden for ${path}`)
    }
  }
  return { packages: lock.packages as Record<string, unknown> }
}

async function publishInstall(projectRoot: string, staging: string): Promise<void> {
  const metadata = join(projectRoot, '.runwhale')
  const backup = join(metadata, `node_modules-backup-${basename(staging)}`)
  const targetModules = join(projectRoot, 'node_modules')
  const stagedModules = join(staging, 'node_modules')
  const hadModules = await exists(targetModules)
  await rm(backup, { recursive: true, force: true })
  if (hadModules) await rename(targetModules, backup)
  try {
    await rename(stagedModules, targetModules)
    await atomicCopy(join(staging, 'package.json'), join(projectRoot, 'package.json'))
    await atomicCopy(join(staging, 'package-lock.json'), join(projectRoot, 'package-lock.json'))
    await rm(backup, { recursive: true, force: true })
  } catch (error) {
    await rm(targetModules, { recursive: true, force: true })
    if (hadModules && await exists(backup)) await rename(backup, targetModules)
    throw error
  }
}

async function atomicCopy(source: string, destination: string): Promise<void> {
  const temporary = `${destination}.package-install.tmp`
  await copyFile(source, temporary)
  await rename(temporary, destination)
}

function parseProjectManifest(source: string): PackageManifest & { dependencies: Record<string, string>; [key: string]: unknown } {
  const value = JSON.parse(source) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('project package.json must contain an object')
  const manifest = value as PackageManifest & { dependencies?: Record<string, string>; [key: string]: unknown }
  const dependencies = manifest.dependencies ?? {}
  for (const [name, spec] of Object.entries(dependencies)) assertRegistryDependency(name, String(spec))
  return { ...manifest, dependencies }
}

function inside(root: string, path: string): boolean {
  const child = relative(root, path)
  return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }
async function exists(path: string): Promise<boolean> { try { await stat(path); return true } catch { return false } }
