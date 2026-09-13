import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { zipSync } from 'fflate'
import {
  SOURCE_ARCHIVE_LIMITS as LIMITS,
  validatedProjectName,
  type ProjectSummary,
  type ReleaseTransfer,
  type SourceArchiveMetadata,
  type SourceAttribution,
  type SourceImportInput,
} from '@runwhale/mobile-protocol'
import { MobileGitRepository } from '@runwhale/mobile-runtime/git'
import { emptyProjectManifest } from './project-manifest.js'

const METADATA = 'RUNWHALE-SOURCE.json'
const EXCLUDED = new Set(['.git', '.runwhale', 'node_modules', '.cache', '.expo', '.next', '.turbo', '.gradle', '.ssh', '.aws', '.npm', 'dist', 'build', 'coverage', 'pods', 'deriveddata', '__macosx'])
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function excluded(path: string): boolean {
  return path.split('/').some((segment) => EXCLUDED.has(segment.toLowerCase())
    || /^\.env(?:\.|$)/i.test(segment)
    || /^(?:\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.ds_store|id_rsa|id_dsa|id_ecdsa|id_ed25519|credentials(?:\.json)?|service-account(?:\.json)?)$/i.test(segment)
    || /\.(?:pem|key|jks|keystore|p12|pfx|ipa|apk|aab|map|log|zip|tar|tgz|gz|7z|rar)$/i.test(segment))
}

function safePath(path: string): string {
  if (!path || path.length > 1_024 || /[\\:\x00-\x1f\x7f]/.test(path)
    || path.split('/').length > 40
    || path.split('/').some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part))) {
    throw new Error('Source archive contains an unsafe path')
  }
  return path
}

function validateContent(bytes: Buffer): void {
  // Check every included file, including text embedded in binary assets. Never include
  // matching values in errors or diagnostic events.
  const text = bytes.toString('utf8')
  if (/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(text)
    || /(?:sk-[A-Za-z0-9_-]{20,}|gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._~+/-]{16,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[0-9A-Za-z-]{20,}|glpat-[0-9A-Za-z_-]{20,}|npm_[A-Za-z0-9]{20,})/.test(text)
    || /(?:api[-_]?key|access[-_]?token|auth(?:orization)?|password|secret)["']?\s*[:=]\s*["']?[0-9A-Za-z/+_.=-]{20,}/i.test(text)
    || /https?:\/\/[^\s/@]+:[^\s/@]+@/i.test(text)) {
    throw new Error('Source contains possible credentials. Remove them before sharing or importing.')
  }
}

function attribution(input: SourceAttribution): SourceAttribution {
  if (!input || typeof input.creator !== 'string' || !input.creator.trim() || input.creator.length > 200
    || typeof input.license !== 'string' || !input.license.trim() || input.license.length > 16_000
    || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.creator + input.license)) {
    throw new Error('Source creator and license are required')
  }
  if (input.projectUrl !== undefined) {
    if (typeof input.projectUrl !== 'string' || input.projectUrl.length > 2_048) throw new Error('Invalid source project URL')
    const url = new URL(input.projectUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid source project URL')
  }
  const result = { creator: input.creator.trim(), license: input.license.trim(), ...(input.projectUrl ? { projectUrl: input.projectUrl } : {}) }
  validateContent(Buffer.from(JSON.stringify(result)))
  return result
}

export async function encodeSource(root: string, input: SourceAttribution, signal?: AbortSignal): Promise<Buffer> {
  const metadata: SourceArchiveMetadata = { format: 'runwhale-source-v1', attribution: attribution(input) }
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>
  files[METADATA] = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`)
  let bytes = files[METADATA]!.length
  let entries = 1
  const paths = new Set([METADATA.toLowerCase()])
  const projectRoot = await realpath(root)
  const visit = async (directory: string, parent = ''): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      signal?.throwIfAborted()
      const path = parent ? `${parent}/${entry.name}` : entry.name
      if (excluded(path) || path === METADATA) continue
      safePath(path)
      if (++entries > LIMITS.entries) throw new Error('Source exceeds the 10,000 entry limit')
      const key = path.normalize('NFC').toLowerCase()
      if (paths.has(key)) throw new Error('Source contains duplicate file paths')
      paths.add(key)
      const absolute = join(directory, entry.name)
      const info = await lstat(absolute)
      if (info.isSymbolicLink() || (!info.isDirectory() && (!info.isFile() || info.nlink > 1))) throw new Error('Source links and special files are unsupported')
      const resolved = await realpath(absolute)
      if (relative(projectRoot, resolved).split(sep).some((part) => part === '..')) throw new Error('Source path escapes the project')
      if (info.isDirectory()) { await visit(resolved, path); continue }
      const file = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const current = await file.stat()
        if (!current.isFile() || current.nlink > 1 || current.size > LIMITS.fileBytes) throw new Error('Source file exceeds the 16 MiB limit or is not a regular file')
        bytes += current.size
        if (bytes > LIMITS.expandedBytes) throw new Error('Source exceeds the 64 MiB expanded limit')
        const data = Buffer.alloc(current.size)
        let offset = 0
        while (offset < data.length) {
          const read = await file.read(data, offset, data.length - offset, offset)
          if (!read.bytesRead) throw new Error('Source changed during export. Try again.')
          offset += read.bytesRead
        }
        const after = await file.stat()
        if (after.size !== current.size || after.mtimeMs !== current.mtimeMs) throw new Error('Source changed during export. Try again.')
        validateContent(data)
        files[path] = data
      } finally { await file.close() }
    }
  }
  await visit(projectRoot)
  signal?.throwIfAborted()
  const data = Buffer.from(zipSync(files, { level: 6 }))
  if (data.length > LIMITS.archiveBytes) throw new Error('Source archive exceeds 32 MiB')
  return data
}

type ZipEntry = { path: string; offset: number; compressed: number; size: number; crc: number; method: number; directory: boolean }

// Validate all central/local headers before allocating decompressed file buffers.
// Bounded inflate also rejects streams whose real size exceeds their ZIP headers.
function zipEntries(data: Buffer): ZipEntry[] {
  if (data.length < 22 || data.length > LIMITS.archiveBytes) throw new Error('Invalid source archive size')
  let end = data.length - 22
  while (end >= Math.max(0, data.length - 65_557) && data.readUInt32LE(end) !== 0x06054b50) end--
  if (end < 0 || data.readUInt32LE(end) !== 0x06054b50 || end + 22 + data.readUInt16LE(end + 20) !== data.length
    || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6)) throw new Error('Invalid source ZIP directory')
  const count = data.readUInt16LE(end + 10)
  const length = data.readUInt32LE(end + 12)
  const start = data.readUInt32LE(end + 16)
  if (!count || count > LIMITS.entries || count !== data.readUInt16LE(end + 8) || start + length !== end) throw new Error('Invalid source ZIP limits')
  const entries: ZipEntry[] = []
  const names = new Map<string, boolean>()
  const ranges: Array<[number, number]> = []
  let expanded = 0
  let cursor = start
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid source ZIP entry')
    const flags = data.readUInt16LE(cursor + 8)
    const method = data.readUInt16LE(cursor + 10)
    const crc = data.readUInt32LE(cursor + 16)
    const compressed = data.readUInt32LE(cursor + 20)
    const size = data.readUInt32LE(cursor + 24)
    const nameLength = data.readUInt16LE(cursor + 28)
    const extraLength = data.readUInt16LE(cursor + 30)
    const commentLength = data.readUInt16LE(cursor + 32)
    const mode = (data.readUInt32LE(cursor + 38) >>> 16) & 0xf000
    const local = data.readUInt32LE(cursor + 42)
    const next = cursor + 46 + nameLength + extraLength + commentLength
    if (next > end || flags & ~0x080e || (method !== 0 && method !== 8)
      || (mode !== 0 && mode !== 0x8000 && mode !== 0x4000) || data.readUInt16LE(cursor + 34)
      || size > LIMITS.fileBytes || compressed > LIMITS.archiveBytes) throw new Error('Unsupported or oversized source ZIP entry')
    const rawName = data.subarray(cursor + 46, cursor + 46 + nameLength)
    const name = decoder.decode(rawName)
    const directory = name.endsWith('/')
    const path = safePath(directory ? name.slice(0, -1) : name)
    if (excluded(path) || (mode === 0x4000 && !directory) || (directory && size !== 0)) throw new Error('Source archive contains excluded files')
    const key = path.normalize('NFC').toLowerCase()
    if (names.has(key)) throw new Error('Source archive contains duplicate file paths')
    names.set(key, directory)
    expanded += size
    if (expanded > LIMITS.expandedBytes) throw new Error('Source exceeds the 64 MiB expanded limit')
    if (local + 30 > start || data.readUInt32LE(local) !== 0x04034b50
      || data.readUInt16LE(local + 6) !== flags || data.readUInt16LE(local + 8) !== method
      || data.readUInt16LE(local + 26) !== nameLength) throw new Error('Invalid source ZIP local header')
    const offset = local + 30 + nameLength + data.readUInt16LE(local + 28)
    if (offset + compressed > start || !data.subarray(local + 30, local + 30 + nameLength).equals(rawName)
      || (!(flags & 8) && (data.readUInt32LE(local + 14) !== crc || data.readUInt32LE(local + 18) !== compressed || data.readUInt32LE(local + 22) !== size))) {
      throw new Error('Source ZIP headers disagree')
    }
    ranges.push([local, offset + compressed])
    entries.push({ path, offset, compressed, size, crc, method, directory })
    cursor = next
  }
  if (cursor !== end) throw new Error('Invalid source ZIP directory length')
  ranges.sort((a, b) => a[0] - b[0])
  for (let i = 1; i < ranges.length; i++) if (ranges[i]![0] < ranges[i - 1]![1]) throw new Error('Source ZIP entries overlap')
  for (const key of names.keys()) {
    const parts = key.split('/')
    for (let i = 1; i < parts.length; i++) if (names.get(parts.slice(0, i).join('/')) === false) throw new Error('Source ZIP file conflicts with a directory')
  }
  return entries
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  return value
})

function crc32(bytes: Buffer): number {
  let value = 0xffffffff
  for (const byte of bytes) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 0xff]!
  return (value ^ 0xffffffff) >>> 0
}

export function decodeSource(data: Buffer): { files: Map<string, Buffer>; metadata: SourceArchiveMetadata } {
  const entries = zipEntries(data)
  const files = new Map<string, Buffer>()
  for (const entry of entries) {
    if (entry.directory) continue
    const compressed = data.subarray(entry.offset, entry.offset + entry.compressed)
    const bytes = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size) })
    if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) throw new Error('Source file integrity check failed')
    validateContent(bytes)
    files.set(entry.path, bytes)
  }
  const raw = files.get(METADATA)
  if (!raw || raw.length > 64 * 1024) throw new Error('Source attribution and license are missing')
  const parsed = JSON.parse(raw.toString('utf8')) as SourceArchiveMetadata
  if (parsed.format !== 'runwhale-source-v1') throw new Error('Unsupported source archive format')
  const metadata: SourceArchiveMetadata = { format: 'runwhale-source-v1', attribution: attribution(parsed.attribution) }
  return { files, metadata }
}

type Transfer = { data: Buffer; offset: number; touched: number; input?: SourceImportInput }

export class SourceArchives {
  private transfers = new Map<string, Transfer>()
  private pending = 0
  constructor(private readonly projectsRoot: string, private readonly stagingRoot: string) {}

  private capacity(): void {
    for (const [id, transfer] of this.transfers) if (Date.now() - transfer.touched > 10 * 60_000) this.transfers.delete(id)
    if (this.transfers.size + this.pending >= 2) throw new Error('Finish the current source transfer first')
  }

  async export(root: string, input: SourceAttribution, signal?: AbortSignal): Promise<ReleaseTransfer> {
    this.capacity()
    this.pending++
    try {
      const data = await encodeSource(root, input, signal)
      const id = randomUUID()
      this.transfers.set(id, { data, offset: data.length, touched: Date.now() })
      return { id, bytes: data.length, sha256: hash(data) }
    } finally { this.pending-- }
  }

  read(id: string, offset: number) {
    const transfer = this.transfers.get(id)
    if (!transfer || transfer.input || !Number.isSafeInteger(offset) || offset < 0 || offset > transfer.data.length) throw new Error('Invalid source transfer')
    transfer.touched = Date.now()
    return { chunk: transfer.data.subarray(offset, offset + LIMITS.chunkBytes).toString('base64'), done: offset + LIMITS.chunkBytes >= transfer.data.length }
  }

  begin(input: SourceImportInput) {
    if (typeof input.name !== 'string' || !Number.isSafeInteger(input.bytes) || input.bytes < 1 || input.bytes > LIMITS.archiveBytes
      || typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error('Invalid source import')
    const name = validatedProjectName(input.name)
    this.capacity()
    const id = randomUUID()
    this.transfers.set(id, { data: Buffer.alloc(input.bytes), offset: 0, touched: Date.now(), input: { ...input, name } })
    return { id }
  }

  chunk(id: string, offset: number, chunk: string) {
    const transfer = this.transfers.get(id)
    if (!transfer?.input || offset !== transfer.offset || typeof chunk !== 'string' || chunk.length > 64_000
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(chunk)) throw new Error('Invalid source transfer chunk')
    const bytes = Buffer.from(chunk, 'base64')
    if (!bytes.length || offset + bytes.length > transfer.data.length) throw new Error('Invalid source transfer size')
    bytes.copy(transfer.data, offset)
    transfer.offset += bytes.length
    transfer.touched = Date.now()
    return { offset: transfer.offset }
  }

  discard(id: string) { this.transfers.delete(id); return { discarded: true as const } }

  async commit(transferId: string, signal?: AbortSignal): Promise<ProjectSummary> {
    const transfer = this.transfers.get(transferId)
    if (!transfer?.input || transfer.offset !== transfer.data.length) throw new Error('Source download is incomplete')
    // Consume before the first await so concurrent commits cannot duplicate an import.
    this.discard(transferId)
    if (hash(transfer.data) !== transfer.input.sha256) throw new Error('Source download integrity check failed')
    const { files } = decodeSource(transfer.data)
    const id = `source-${randomUUID()}`
    const name = transfer.input.name
    const staging = join(this.stagingRoot, id)
    this.pending++
    try {
      await mkdir(this.stagingRoot, { recursive: true })
      await mkdir(staging)
      for (const [path, bytes] of files) {
        signal?.throwIfAborted()
        await mkdir(dirname(join(staging, path)), { recursive: true })
        await writeFile(join(staging, path), bytes, { flag: 'wx', mode: 0o600 })
      }
      const original = files.get('runwhale.json')
      const manifest: Record<string, unknown> = original ? JSON.parse(original.toString('utf8')) as Record<string, unknown> : emptyProjectManifest(id, name)
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid source project manifest')
      manifest.id = id
      manifest.name = name
      manifest.source = { kind: 'import', archive: METADATA, importedAt: Date.now() }
      await writeFile(join(staging, 'runwhale.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
      await new MobileGitRepository(staging).ensureInitialized()
      signal?.throwIfAborted()
      await rename(staging, join(this.projectsRoot, id))
      return { id, name, updatedAt: Date.now() }
    } finally {
      this.pending--
      await rm(staging, { recursive: true, force: true })
    }
  }
}
