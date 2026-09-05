import { posix } from 'node:path'

export interface PackageManifest {
  name?: string
  version?: string
  bin?: unknown
  gypfile?: boolean
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

export interface ArchiveEntry {
  path: string
  size: number
  type: 'file' | 'directory' | 'symlink'
  linkTarget?: string
}

export interface DependencyPolicyOptions {
  maxPackageBytes?: number
  maxFileBytes?: number
}

export class DependencyRejected extends Error {
  constructor(message: string, readonly reason: string) {
    super(message)
    this.name = 'DependencyRejected'
  }
}

const UNSAFE_SPEC = /^(?:file:|link:|workspace:|portal:|patch:|catalog:|git(?:\+|:)|github:|https?:|ssh:|[A-Za-z]:[\\/]|[./])|(?:^|\/)\.\.(?:\/|$)/i
const GITHUB_SHORTHAND = /^[a-z0-9_.-]+\/[a-z0-9_.-]+(?:#.*)?$/i
const NATIVE_FILE = /(?:^|\/)(?:binding\.gyp|[^/]+\.node)$/i
const EXECUTABLE_FILE = /(?:^|\/)(?:node-gyp|prebuild-install|cmake-js)(?:$|\.)/i

export function assertRegistryDependency(name: string, spec: string): void {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) {
    throw new DependencyRejected(`invalid registry package name: ${name}`, 'INVALID_NAME')
  }
  if (UNSAFE_SPEC.test(spec) || GITHUB_SHORTHAND.test(spec) || spec.trim().length === 0) {
    throw new DependencyRejected(`${name} uses a forbidden non-registry spec`, 'NON_REGISTRY_SPEC')
  }
}

export function validatePackageArchive(
  manifest: PackageManifest,
  entries: readonly ArchiveEntry[],
  options: DependencyPolicyOptions = {},
): void {
  const maxPackageBytes = options.maxPackageBytes ?? 25 * 1024 * 1024
  const maxFileBytes = options.maxFileBytes ?? 8 * 1024 * 1024
  if (manifest.gypfile || manifest.bin !== undefined) {
    throw new DependencyRejected('native build metadata and executable bins are forbidden', 'NATIVE_OR_EXECUTABLE')
  }
  for (const [name, spec] of Object.entries({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
    assertRegistryDependency(name, spec)
  }
  let total = 0
  for (const entry of entries) {
    const normalized = posix.normalize(entry.path.replaceAll('\\', '/'))
    if (normalized.startsWith('../') || normalized === '..' || normalized.startsWith('/')) {
      throw new DependencyRejected(`archive path escapes package root: ${entry.path}`, 'PATH_TRAVERSAL')
    }
    if (entry.size < 0 || !Number.isSafeInteger(entry.size) || entry.size > maxFileBytes) {
      throw new DependencyRejected(`archive entry is too large: ${entry.path}`, 'PACKAGE_TOO_LARGE')
    }
    total += entry.size
    if (total > maxPackageBytes) throw new DependencyRejected('package exceeds unpacked size limit', 'PACKAGE_TOO_LARGE')
    if (NATIVE_FILE.test(normalized) || EXECUTABLE_FILE.test(normalized)) {
      throw new DependencyRejected(`native or executable payload is forbidden: ${entry.path}`, 'NATIVE_OR_EXECUTABLE')
    }
    if (entry.type === 'symlink') {
      const target = posix.normalize(posix.join(posix.dirname(normalized), entry.linkTarget ?? ''))
      if (target.startsWith('../') || target === '..' || target.startsWith('/')) {
        throw new DependencyRejected(`symlink escapes package root: ${entry.path}`, 'SYMLINK_ESCAPE')
      }
    }
  }
}
