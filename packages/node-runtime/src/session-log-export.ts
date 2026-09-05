import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Zip, ZipDeflate } from 'fflate'
import type { AgentSessionRecord } from '@runwhale/mobile-protocol'

const IMAGE_EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

/** Mirrors DSH's ZIP layout, retaining RunWhale's own persisted header metadata. */
export async function exportSessionLog(root: string, sessionId: string, records: AsyncIterable<AgentSessionRecord>, signal: AbortSignal): Promise<{ path: string }> {
  const exportsRoot = join(root, '.runwhale', 'exports')
  await mkdir(exportsRoot, { recursive: true, mode: 0o700 })
  const directory = await mkdtemp(join(exportsRoot, 'session-'))
  const path = join(directory, `dsh-session-${safeSegment(sessionId)}.zip`)
  try {
    const file = await open(path, 'wx', 0o600)
    const chunks: Uint8Array[] = []
    const zip = new Zip((error, data) => { if (error) throw error; chunks.push(data) })
    const drain = async () => {
      for (const chunk of chunks.splice(0)) { signal.throwIfAborted(); await file.writeFile(chunk) }
    }
    const push = async (entry: ZipDeflate, bytes: Uint8Array) => {
      for (let offset = 0; offset < bytes.length; offset += 65_536) {
        signal.throwIfAborted()
        entry.push(bytes.subarray(offset, offset + 65_536), false)
        await drain()
      }
    }
    const images = new Map<string, { mediaType: string; bytes: number }>()
    try {
      for await (const record of records) {
        signal.throwIfAborted()
        const entry = new ZipDeflate(record.sessionId === sessionId ? 'session.jsonl' : `subagents/${safeSegment(record.sessionId)}/session.jsonl`, { level: 6 })
        zip.add(entry)
        const { events, ...metadata } = record
        // Mobile persists records, not DSH SessionHeaders. Do not invent a DSH format version.
        await push(entry, Buffer.from(`${JSON.stringify({ type: 'session', ...metadata })}\n`))
        for (const event of events) {
          collectImages(event, images)
          await push(entry, Buffer.from(`${JSON.stringify(event)}\n`))
        }
        entry.push(new Uint8Array(), true)
        await drain()
      }
      for (const [id, ref] of images) {
        signal.throwIfAborted()
        const source = join(root, '.runwhale', 'attachments', `${id}.bin`)
        const info = await lstat(source)
        if (!info.isFile() || info.isSymbolicLink() || info.size !== ref.bytes || info.size > 5 * 1024 * 1024) throw new Error('Invalid session image attachment')
        const bytes = await readFile(source)
        if (`sha256-${createHash('sha256').update(bytes).digest('hex')}` !== id) throw new Error('Session image attachment failed integrity verification')
        const entry = new ZipDeflate(`media/${id}.${IMAGE_EXTENSIONS[ref.mediaType]}`, { level: 6 })
        zip.add(entry)
        await push(entry, bytes)
        entry.push(new Uint8Array(), true)
        await drain()
      }
      zip.end()
      await drain()
    } finally {
      zip.terminate()
      await file.close()
    }
    signal.throwIfAborted()
    return { path }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

function collectImages(value: unknown, images: Map<string, { mediaType: string; bytes: number }>): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) { for (const item of value) collectImages(item, images); return }
  const record = value as Record<string, unknown>
  if (record.type === 'image' && record.attachment && typeof record.attachment === 'object') {
    const ref = record.attachment as { attachmentId?: unknown; mediaType?: unknown; bytes?: unknown }
    if (typeof ref.attachmentId !== 'string' || !/^sha256-[a-f0-9]{64}$/.test(ref.attachmentId) || typeof ref.mediaType !== 'string' || !IMAGE_EXTENSIONS[ref.mediaType] || typeof ref.bytes !== 'number' || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1) throw new Error('Invalid session image attachment reference')
    images.set(ref.attachmentId, { mediaType: ref.mediaType, bytes: ref.bytes })
  }
  for (const item of Object.values(record)) collectImages(item, images)
}

function safeSegment(id: string): string { return id.replace(/[^A-Za-z0-9_-]/g, '_') }
