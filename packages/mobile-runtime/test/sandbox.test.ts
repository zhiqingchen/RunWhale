import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileProjectFileSystem, SandboxViolation } from '../src/sandbox.js'

let root: string

beforeEach(async () => {
  const cache = resolve(import.meta.dirname, '../../../.cache')
  await mkdir(cache, { recursive: true })
  root = await mkdtemp(join(cache, 'sandbox-writes-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('concurrent versioned writes', () => {
  it.each(['one instance', 'separate module copies'] as const)('accepts only one writer with %s', async (mode) => {
    const project = join(root, 'project')
    const alias = join(root, 'alias')
    await mkdir(project)
    await symlink(project, alias)
    await writeFile(join(project, 'app.ts'), 'original')
    const fs = new MobileProjectFileSystem([project])
    const initial = await fs.readText('app.ts')
    // Mobile host and Agent bundles each contain their own copy of this module.
    vi.resetModules()
    const { MobileProjectFileSystem: OtherFileSystem } = await import('../src/sandbox.js')
    expect(OtherFileSystem).not.toBe(MobileProjectFileSystem)
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => {
      const writer = mode === 'one instance' ? fs : index % 2
        ? new MobileProjectFileSystem([project])
        : new OtherFileSystem([alias])
      const path = index % 2 ? './app.ts' : join(alias, 'app.ts')
      return writer.writeText(path, `writer-${index}`, initial.version)
    }))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected').map(result => result.reason.code)).toEqual(Array(7).fill('CONFLICT'))
    const winner = results.findIndex(result => result.status === 'fulfilled')
    const current = await fs.readText('app.ts')
    expect(current.content).toBe(`writer-${winner}`)
    // Conflicts must release the queue so a subsequent valid edit still succeeds.
    await fs.writeText('app.ts', 'next edit', current.version)
    expect((await fs.readText('app.ts')).content).toBe('next edit')
  })
})

describe('literal file edits', () => {
  it('edits a unique fragment, preserves CRLF and permissions, and returns a version for the next edit', async () => {
    const path = join(root, 'app.ts')
    await writeFile(path, 'const value = 1\r\nconsole.log(value)\r\n')
    await chmod(path, 0o750)
    const fs = new MobileProjectFileSystem([root])
    const original = await fs.readText('app.ts')

    const first = await fs.editText('app.ts', 'value = 1\nconsole', 'value = 2\nconsole', original.version)
    expect(first.replacements).toBe(1)
    expect(first.version).not.toBe(original.version)
    expect(await readFile(path, 'utf8')).toBe('const value = 2\r\nconsole.log(value)\r\n')
    expect((await stat(path)).mode & 0o777).toBe(0o750)

    const second = await fs.editText('app.ts', 'console.log(value)\n', '', first.version)
    expect(second.replacements).toBe(1)
    expect(await readFile(path, 'utf8')).toBe('const value = 2\r\n')
  })

  it('rejects missing and ambiguous fragments without changing the file, then replaces all non-overlapping matches', async () => {
    const path = join(root, 'repeat.txt')
    await writeFile(path, 'one one one')
    const fs = new MobileProjectFileSystem([root])
    const { version } = await fs.readText('repeat.txt')

    await expect(fs.editText('repeat.txt', 'missing', 'new', version)).rejects.toMatchObject({ code: 'FS_EDIT_NOT_FOUND' })
    await expect(fs.editText('repeat.txt', 'one', 'two', version)).rejects.toMatchObject({ code: 'FS_AMBIGUOUS_EDIT' })
    expect(await readFile(path, 'utf8')).toBe('one one one')
    const edited = await fs.editText('repeat.txt', 'one', 'two', version, true)
    expect(edited.replacements).toBe(3)
    expect(await readFile(path, 'utf8')).toBe('two two two')
    await expect(fs.editText('repeat.txt', '', 'new', edited.version)).rejects.toThrow(/oldString/)
    await expect(fs.editText('repeat.txt', 'two', 'two', edited.version)).rejects.toThrow(/differ/)
  })

  it('rejects stale versions, invalid UTF-8, binary content, escaping paths, and symlink targets', async () => {
    const fs = new MobileProjectFileSystem([root])
    await writeFile(join(root, 'app.ts'), 'initial')
    const initial = await fs.readText('app.ts')
    await fs.writeText('app.ts', 'changed', initial.version)
    await expect(fs.editText('app.ts', 'changed', 'edited', initial.version)).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(join(root, 'app.ts'), 'utf8')).toBe('changed')

    const invalid = await fs.writeBinary('invalid.txt', Buffer.from([0xff, 0xfe]))
    await expect(fs.editText('invalid.txt', 'x', 'y', invalid.version)).rejects.toThrow()
    const binary = await fs.writeBinary('binary.txt', Buffer.from([0x61, 0x00, 0x62]))
    await expect(fs.editText('binary.txt', 'a', 'c', binary.version)).rejects.toThrow(/binary/)
    expect(await readFile(join(root, 'invalid.txt'))).toEqual(Buffer.from([0xff, 0xfe]))
    expect(await readFile(join(root, 'binary.txt'))).toEqual(Buffer.from([0x61, 0x00, 0x62]))

    await symlink(join(root, 'app.ts'), join(root, 'link.ts'))
    await expect(fs.editText('link.ts', 'changed', 'edited', (await fs.readText('link.ts')).version)).rejects.toMatchObject({ code: 'SYMLINK' })
    await expect(fs.editText('../outside.ts', 'x', 'y', initial.version)).rejects.toBeInstanceOf(SandboxViolation)
    expect(await readFile(join(root, 'app.ts'), 'utf8')).toBe('changed')
  })

  it('serializes edits with concurrent full-file writes across module copies', async () => {
    await writeFile(join(root, 'race.txt'), 'original')
    const fs = new MobileProjectFileSystem([root])
    const { version } = await fs.readText('race.txt')
    vi.resetModules()
    const { MobileProjectFileSystem: OtherFileSystem } = await import('../src/sandbox.js')
    const other = new OtherFileSystem([root])
    const results = await Promise.allSettled([
      fs.editText('race.txt', 'original', 'edited', version),
      other.writeText('race.txt', 'written', version),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected').map(result => result.reason.code)).toEqual(['CONFLICT'])
    expect((await fs.readText('race.txt')).content).toMatch(/^(edited|written)$/)
  })
})
