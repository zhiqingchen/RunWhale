import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export class SandboxViolation extends Error {
  constructor(message: string, readonly code: 'OUTSIDE_ROOT' | 'SYMLINK' | 'CONFLICT') {
    super(message)
    this.name = 'SandboxViolation'
  }
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function versionOf(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
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
    if (content.includes(0)) throw new TypeError('binary files cannot be read as text')
    return { content: new TextDecoder('utf-8', { fatal: true }).decode(content), version: versionOf(content) }
  }

  async writeText(path: string, content: string, expectedVersion?: string): Promise<{ version: string }> {
    const bytes = Buffer.from(content, 'utf8')
    let target = await this.resolveForWrite(path)
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
    await mkdir(dirname(target), { recursive: true })
    const canonicalParent = await realpath(dirname(target))
    await this.assertWithinRoot(canonicalParent)
    target = resolve(canonicalParent, basename(target))
    const temporary = `${target}.runwhale-${randomBytes(8).toString('hex')}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(temporary, target)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
    return { version: versionOf(bytes) }
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
