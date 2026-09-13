import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { zipSync } from 'fflate'
import { afterEach, expect, it, vi } from 'vitest'
import { SOURCE_ARCHIVE_LIMITS } from '@runwhale/mobile-protocol'
import { decodeSource, encodeSource, SourceArchives } from '../src/source-archive.js'
import { RunWhaleRuntimeHost } from '../src/runtime-host.js'

const roots: string[] = []
const attribution = { creator: 'Example Creator', license: 'MIT', projectUrl: 'https://runwhale.dev/explore/example' }
const metadata = Buffer.from(JSON.stringify({ format: 'runwhale-source-v1', attribution }))
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const archive = (files: Record<string, Uint8Array> = {}) => Buffer.from(zipSync({ 'RUNWHALE-SOURCE.json': metadata, 'index.ts': Buffer.from('export const value = 1'), ...files }))
const temporaryRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), 'runwhale-source-'))
  roots.push(root)
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

it('exports editable files, assets, attribution and licenses without credentials, runtime data, dependencies or builds', async () => {
  const root = await temporaryRoot()
  const paths = ['index.tsx', 'assets/icon.png', 'LICENSE', '.env', '.env.production', '.npmrc', '.git/config', '.runwhale/sessions/private.json', 'node_modules/lib/index.js', 'dist/app.js', 'nested/node_modules/lib/index.js']
  for (const path of paths) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), path)
  }
  const exported = decodeSource(await encodeSource(root, attribution))
  expect([...exported.files.keys()].sort()).toEqual(['LICENSE', 'RUNWHALE-SOURCE.json', 'assets/icon.png', 'index.tsx'])
  expect(exported.metadata.attribution).toEqual(attribution)
  expect(exported.files.get('LICENSE')?.toString()).toBe('LICENSE')
  await writeFile(join(root, 'config.ts'), `const token = '${'sk-' + 'a'.repeat(30)}'`)
  await expect(encodeSource(root, attribution)).rejects.toThrow('possible credentials')
  await rm(join(root, 'config.ts'))
  await symlink(join(root, 'LICENSE'), join(root, 'linked-license'))
  await expect(encodeSource(root, attribution)).rejects.toThrow('links')
})

it('rejects traversal, duplicate/case-colliding paths, file-directory conflicts and ZIP symlinks', () => {
  for (const path of ['../escape.ts', '/absolute.ts', 'nested\\escape.ts', 'C:/escape.ts', '.git/config', '.runwhale/sessions/private.json']) {
    expect(() => decodeSource(archive({ [path]: Buffer.from('bad') }))).toThrow()
  }
  expect(() => decodeSource(archive({ 'INDEX.ts': Buffer.from('duplicate') }))).toThrow('duplicate')
  expect(() => decodeSource(archive({ 'assets': Buffer.from('file'), 'assets/icon.png': Buffer.from('image') }))).toThrow('conflicts')
  const linked = archive({ 'linked.ts': Buffer.from('../outside') })
  let offset = linked.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  while (linked.subarray(offset + 46, offset + 46 + linked.readUInt16LE(offset + 28)).toString() !== 'linked.ts') {
    offset += 46 + linked.readUInt16LE(offset + 28) + linked.readUInt16LE(offset + 30) + linked.readUInt16LE(offset + 32)
  }
  linked.writeUInt32LE((0xa1ff << 16) >>> 0, offset + 38)
  expect(() => decodeSource(linked)).toThrow('Unsupported')
})

it('bounds declared and real decompression size and checks archive and file integrity', async () => {
  const bomb = archive({ 'large.txt': Buffer.alloc(2 * 1024 * 1024, 65) })
  let central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  while (bomb.subarray(central + 46, central + 46 + bomb.readUInt16LE(central + 28)).toString() !== 'large.txt') {
    central += 46 + bomb.readUInt16LE(central + 28) + bomb.readUInt16LE(central + 30) + bomb.readUInt16LE(central + 32)
  }
  const local = bomb.readUInt32LE(central + 42)
  bomb.writeUInt32LE(1, central + 24)
  bomb.writeUInt32LE(1, local + 22)
  expect(() => decodeSource(bomb)).toThrow()
  bomb.writeUInt32LE(SOURCE_ARCHIVE_LIMITS.fileBytes + 1, central + 24)
  expect(() => decodeSource(bomb)).toThrow('oversized')
  const corrupted = archive()
  const first = corrupted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  corrupted.writeUInt32LE(0, first + 16)
  corrupted.writeUInt32LE(0, corrupted.readUInt32LE(first + 42) + 14)
  expect(() => decodeSource(corrupted)).toThrow('integrity')
  const root = await temporaryRoot()
  await mkdir(join(root, 'projects'))
  const transfers = new SourceArchives(join(root, 'projects'), join(root, 'staging'))
  const data = archive()
  const transfer = transfers.begin({ name: 'Imported', bytes: data.length, sha256: '0'.repeat(64) })
  transfers.chunk(transfer.id, 0, data.toString('base64'))
  await expect(transfers.commit(transfer.id)).rejects.toThrow('integrity')
  expect(await readdir(join(root, 'projects'))).toEqual([])
})

it('imports source via chunked host RPC into distinct Workspace projects without executing scripts or preparing packages', async () => {
  const root = await temporaryRoot()
  const prepareModuleStore = vi.fn(async () => {})
  const prepareNpm = vi.fn(async () => {})
  const agent = { run: vi.fn(async () => ({ text: '' })) }
  const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent, prepareModuleStore, prepareNpm })
  try {
    const info = await host.start()
    const rpc = async (method: string, params: unknown) => {
      const response = await fetch(`${info.origin}/rpc`, {
        method: 'POST',
        headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }),
      })
      const body = await response.json() as { ok: boolean; result: any; error: unknown }
      expect(body.ok, JSON.stringify(body.error)).toBe(true)
      return body.result
    }
    const original = await rpc('project.create', { name: 'Original', id: 'original' })
    const image = randomBytes(110_000)
    await mkdir(join(root, 'projects', original.id, 'assets'))
    await writeFile(join(root, 'projects', original.id, 'assets', 'image.png'), image)
    await rpc('project.write', { projectId: original.id, path: 'package.json', content: JSON.stringify({ scripts: { postinstall: 'touch SHOULD-NOT-EXECUTE' } }) })
    const exported = await rpc('source.export', { projectId: original.id, attribution })
    const chunks: Buffer[] = []
    for (let offset = 0; offset < exported.bytes;) {
      const { chunk } = await rpc('source.read', { id: exported.id, offset })
      const bytes = Buffer.from(chunk, 'base64')
      chunks.push(bytes)
      offset += bytes.length
    }
    const data = Buffer.concat(chunks)
    expect(sha256(data)).toBe(exported.sha256)
    await rpc('source.discard', { id: exported.id })
    const importedIds: string[] = []
    for (let i = 0; i < 2; i++) {
      const transfer = await rpc('source.import.begin', { name: 'Source Copy', bytes: data.length, sha256: exported.sha256 })
      for (let offset = 0; offset < data.length; offset += SOURCE_ARCHIVE_LIMITS.chunkBytes) {
        await rpc('source.import.chunk', { id: transfer.id, offset, chunk: data.subarray(offset, offset + SOURCE_ARCHIVE_LIMITS.chunkBytes).toString('base64') })
      }
      const project = await rpc('source.import.commit', { id: transfer.id })
      importedIds.push(project.id)
      const projectRoot = join(root, 'projects', project.id)
      expect(JSON.parse(await readFile(join(projectRoot, 'RUNWHALE-SOURCE.json'), 'utf8')).attribution).toEqual(attribution)
      expect(await readFile(join(projectRoot, 'assets', 'image.png'))).toEqual(image)
      expect(JSON.parse(await readFile(join(projectRoot, 'runwhale.json'), 'utf8'))).toMatchObject({ id: project.id, name: 'Source Copy', source: { kind: 'import' } })
      expect(await readdir(projectRoot)).not.toContain('SHOULD-NOT-EXECUTE')
    }
    expect(new Set(importedIds).size).toBe(2)
    expect((await rpc('project.list', {})).length).toBe(3)
    expect(await readdir(join(root, 'source-staging'))).toEqual([])
    expect(prepareModuleStore).not.toHaveBeenCalled()
    expect(prepareNpm).not.toHaveBeenCalled()
    expect(agent.run).not.toHaveBeenCalled()
  } finally { await host.stop() }
}, 30_000)
