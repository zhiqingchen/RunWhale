import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { afterEach, expect, it } from 'vitest'
import type { AgentSessionRecord } from '@runwhale/mobile-protocol'
import { exportSessionLog } from '../src/session-log-export.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function root() { const value = await mkdtemp(join(tmpdir(), 'session-export-')); roots.push(value); return value }
async function* records(...values: AgentSessionRecord[]) { yield* values }
const session = (sessionId: string, events: unknown[] = []): AgentSessionRecord => ({ sessionId, projectId: 'project', title: 'Debug session', state: 'completed', updatedAt: 123, events })

it('exports complete JSONL, descendants, and deduplicated nested image attachments', async () => {
  const dir = await root()
  const image = Buffer.from('test image bytes')
  const id = `sha256-${createHash('sha256').update(image).digest('hex')}`
  await mkdir(join(dir, '.runwhale', 'attachments'), { recursive: true })
  await writeFile(join(dir, '.runwhale', 'attachments', `${id}.bin`), image)
  const events = [
    { type: 'request/header', seq: 1, data: { header: { system: 'Complete system prompt' } } },
    { type: 'assistant/chunk', seq: 2, data: { chunk: { type: 'reasoning-delta', text: '🐋'.repeat(40_000) } } },
    { type: 'tool/result', seq: 3, data: { message: { content: [{ type: 'tool-result', content: [{ type: 'image', attachment: { attachmentId: id, mediaType: 'image/png', bytes: image.length } }] }] } } },
    { type: 'turn/end', seq: 4, data: { reason: { kind: 'error', error: 'Diagnostic failure' } } },
  ]
  const parent = session('parent', events)
  const child = { ...session('child', events), parentSessionId: 'parent' }
  const exported = await exportSessionLog(dir, 'parent', records(parent, child), new AbortController().signal)
  const zip = unzipSync(await readFile(exported.path))
  expect(Object.keys(zip)).toEqual(['session.jsonl', 'subagents/child/session.jsonl', `media/${id}.png`])
  const lines = strFromU8(zip['session.jsonl']!).trimEnd().split('\n').map(line => JSON.parse(line))
  expect(lines[0]).toEqual({ type: 'session', ...parent, events: undefined })
  expect(lines.slice(1)).toEqual(events)
  expect(Buffer.from(zip[`media/${id}.png`]!)).toEqual(image)
  expect(strFromU8(zip['subagents/child/session.jsonl']!)).toContain('"parentSessionId":"parent"')
})

it('removes partial exports when attachments are missing or cancellation occurs', async () => {
  const dir = await root()
  const event = { type: 'image', attachment: { attachmentId: `sha256-${'a'.repeat(64)}`, mediaType: 'image/png', bytes: 1 } }
  await expect(exportSessionLog(dir, 'root', records(session('root', [event])), new AbortController().signal)).rejects.toThrow()
  const controller = new AbortController()
  controller.abort()
  await expect(exportSessionLog(dir, 'root', records(session('root')), controller.signal)).rejects.toThrow()
  expect(await readdir(join(dir, '.runwhale', 'exports'))).toEqual([])
})
