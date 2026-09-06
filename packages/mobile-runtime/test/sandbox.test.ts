import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileProjectFileSystem } from '../src/sandbox.js'

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
