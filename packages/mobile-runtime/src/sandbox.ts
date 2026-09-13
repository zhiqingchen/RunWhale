import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export class SandboxViolation extends Error {
  constructor(message: string, readonly code: 'OUTSIDE_ROOT' | 'SYMLINK' | 'CONFLICT') {
    super(message)
    this.name = 'SandboxViolation'
  }
}

export class MobileFileEditError extends Error {
  constructor(message: string, readonly code: 'FS_EDIT_NOT_FOUND' | 'FS_AMBIGUOUS_EDIT') {
    super(message)
    this.name = 'MobileFileEditError'
  }
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function versionOf(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function decodeText(content: Uint8Array): string {
  if (content.includes(0)) throw new TypeError('binary files cannot be read as text')
  return new TextDecoder('utf-8', { fatal: true }).decode(content)
}

function normalizeLineEndings(content: string): string {
  return content.replaceAll('\r\n', '\n')
}

function countMatches(content: string, search: string): number {
  let count = 0
  let offset = 0
  while ((offset = content.indexOf(search, offset)) !== -1) {
    count += 1
    offset += search.length
  }
  return count
}

// The host and Agent bundle separate copies of this module in the same isolate.
const writesKey = Symbol.for('@runwhale/mobile-runtime/file-writes')
const shared = globalThis as typeof globalThis & { [writesKey]?: Map<string, Promise<void>> }
const writes = shared[writesKey] ??= new Map<string, Promise<void>>()

async function withFileWrite<T>(target: string, operation: () => Promise<T>): Promise<T> {
  const previous = writes.get(target)
  let release!: () => void
  const next = new Promise<void>(resolve => { release = resolve })
  writes.set(target, next)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (writes.get(target) === next) writes.delete(target)
  }
}

export class MobileProjectFileSystem {
  private canonicalRoots: string[] | undefined

  constructor(private readonly roots: readonly string[]) {
    if (roots.length === 0 || roots.some(root => !isAbsolute(root))) {
      throw new TypeError('sandbox roots must contain absolute paths')
    }
  }

  async readText(path: string): Promise<{ content: string; version: string }> {
    const target = await this.resolveExisting(path)
    const info = await stat(target)
    if (!info.isFile()) throw new SandboxViolation('target is not a regular file', 'OUTSIDE_ROOT')
    const content = await readFile(target)
    return { content: decodeText(content), version: versionOf(content) }
  }

  async writeText(path: string, content: string, expectedVersion?: string): Promise<{ version: string }> {
    return this.writeBinary(path, Buffer.from(content, 'utf8'), { expectedVersion })
  }

  async editText(path: string, oldString: string, newString: string, expectedVersion: string, replaceAll = false, signal?: AbortSignal): Promise<{ version: string; replacements: number }> {
    if (!oldString) throw new TypeError('oldString must not be empty')
    if (oldString === newString) throw new TypeError('oldString and newString must differ')
    if (!expectedVersion) throw new TypeError('expectedVersion must not be empty')
    const target = await this.resolveForWrite(path)
    return withFileWrite(target, async () => {
      signal?.throwIfAborted()
      const info = await lstat(target)
      if (info.isSymbolicLink()) throw new SandboxViolation('writes through symlinks are forbidden', 'SYMLINK')
      if (!info.isFile()) throw new SandboxViolation('target is not a regular file', 'OUTSIDE_ROOT')
      const original = await readFile(target)
      if (versionOf(original) !== expectedVersion) throw new SandboxViolation('file changed since it was read', 'CONFLICT')
      const raw = decodeText(original)
      const content = normalizeLineEndings(raw)
      const search = normalizeLineEndings(oldString)
      const replacement = normalizeLineEndings(newString)
      const replacements = countMatches(content, search)
      if (replacements === 0) throw new MobileFileEditError('oldString was not found in the file', 'FS_EDIT_NOT_FOUND')
      if (!replaceAll && replacements > 1) {
        throw new MobileFileEditError(`oldString matched ${replacements} times; provide a more specific string or set replaceAll`, 'FS_AMBIGUOUS_EDIT')
      }
      const edited = replaceAll ? content.replaceAll(search, replacement) : content.replace(search, replacement)
      const crlfCount = raw.split('\r\n').length - 1
      const lfCount = raw.split('\n').length - 1 - crlfCount
      const bytes = Buffer.from(crlfCount > lfCount ? edited.replaceAll('\n', '\r\n') : edited, 'utf8')
      await this.publishBinary(target, bytes, { mode: info.mode & 0o777, signal })
      return { version: versionOf(bytes), replacements }
    })
  }

  async readBinary(path: string, maxBytes: number): Promise<{ content: Buffer; version: string; path: string }> {
    const target = await this.resolveExisting(path)
    const info = await stat(target)
    if (!info.isFile() || info.size < 1 || info.size > maxBytes) throw new Error('Image file is empty or exceeds the size limit')
    const content = await readFile(target)
    if (content.length > maxBytes) throw new Error('Image file exceeds the size limit')
    return { content, version: versionOf(content), path: target }
  }

  async assertNewFile(path: string): Promise<void> {
    const target = await this.resolveForWrite(path)
    try { await lstat(target) } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
      throw error
    }
    throw new SandboxViolation('Image already exists; choose a new path', 'CONFLICT')
  }

  async writeBinary(path: string, bytes: Uint8Array, options: { expectedVersion?: string | undefined; createOnly?: boolean; signal?: AbortSignal } = {}): Promise<{ version: string }> {
    const { expectedVersion, signal } = options
    const target = await this.resolveForWrite(path)
    return withFileWrite(target, async () => {
      signal?.throwIfAborted()
      let current: Buffer | undefined
      try {
        const info = await lstat(target)
        if (info.isSymbolicLink()) throw new SandboxViolation('writes through symlinks are forbidden', 'SYMLINK')
        if (!info.isFile()) throw new SandboxViolation('target is not a regular file', 'OUTSIDE_ROOT')
        current = await readFile(target)
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      if (expectedVersion !== undefined && (current === undefined || versionOf(current) !== expectedVersion)) {
        throw new SandboxViolation('file changed since it was read', 'CONFLICT')
      }
      if (options.createOnly && current !== undefined) throw new SandboxViolation('Image already exists; choose a new path', 'CONFLICT')
      await this.publishBinary(target, bytes, { signal })
      return { version: versionOf(bytes) }
    })
  }

  private async publishBinary(target: string, bytes: Uint8Array, options: { mode?: number; signal?: AbortSignal | undefined }): Promise<void> {
    await mkdir(dirname(target), { recursive: true })
    const canonicalParent = await realpath(dirname(target))
    await this.assertWithinRoot(canonicalParent)
    const destination = resolve(canonicalParent, basename(target))
    const temporary = `${destination}.runwhale-${randomBytes(8).toString('hex')}.tmp`
    let published = false
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(bytes)
        if (options.mode !== undefined) await handle.chmod(options.mode)
        await handle.sync()
      } finally {
        await handle.close()
      }
      options.signal?.throwIfAborted()
      await rename(temporary, destination)
      published = true
    } finally {
      if (!published) await unlink(temporary).catch(() => undefined)
    }
  }

  private async getRoots(): Promise<string[]> {
    this.canonicalRoots ??= await Promise.all(this.roots.map(root => realpath(root)))
    return this.canonicalRoots
  }

  private async resolveExisting(path: string): Promise<string> {
    const candidate = await this.candidate(path)
    await this.assertWithinRoot(candidate)
    const target = await realpath(candidate)
    await this.assertWithinRoot(target)
    return target
  }

  private async resolveForWrite(path: string): Promise<string> {
    const candidate = await this.candidate(path)
    let existing = dirname(candidate)
    while (true) {
      try {
        const canonical = await realpath(existing)
        await this.assertWithinRoot(canonical)
        const suffix = relative(existing, candidate)
        if (suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) {
          throw new SandboxViolation('write path escapes its existing parent', 'OUTSIDE_ROOT')
        }
        return resolve(canonical, suffix)
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        const parent = dirname(existing)
        if (parent === existing) throw new SandboxViolation('write path has no sandbox parent', 'OUTSIDE_ROOT')
        existing = parent
      }
    }
  }

  private async candidate(path: string): Promise<string> {
    if (path.length === 0 || path.includes('\0')) throw new SandboxViolation('invalid empty or NUL path', 'OUTSIDE_ROOT')
    const roots = await this.getRoots()
    return isAbsolute(path) ? resolve(path) : resolve(roots[0]!, path)
  }

  private async assertWithinRoot(candidate: string): Promise<void> {
    const roots = await this.getRoots()
    if (!roots.some(root => isWithin(root, candidate))) {
      throw new SandboxViolation(`path escapes the mobile sandbox: ${candidate}`, 'OUTSIDE_ROOT')
    }
  }
}
