import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { supportsModelImageGeneration } from '@runwhale/mobile-protocol'
import { createMobileHarness } from '../src/profile.js'
import { generateModelImage } from '../src/image-generation-mobile.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup() })

async function fixture(permissionMode: 'read-only' | 'review' | 'danger-full-access' = 'danger-full-access') {
  const cache = resolve(import.meta.dirname, '../../../.cache')
  await mkdir(cache, { recursive: true })
  const root = await mkdtemp(join(cache, 'image-generation-'))
  await writeFile(join(root, 'runwhale.json'), JSON.stringify({ schemaVersion: 1, id: 'image-test', name: 'Ocean', source: { kind: 'local' } }))
  const generateImage = vi.fn(async () => png)
  const harness = await createMobileHarness({
    mode: 'deterministic', attachmentRoot: join(root, '.attachments'),
    secrets: { async get() { return undefined }, async set() {}, async delete() {} },
    requestApproval: async () => 'rejected',
    workspaceServices: { generateImage, permissionModeFor: () => permissionMode },
  })
  cleanups.push(async () => { await harness.dispose(); await rm(root, { recursive: true, force: true }) })
  await harness.run({ sessionId: 'image-test', prompt: 'Create an ocean project', projectRoot: root })
  const agent = harness.context.agents.get(SessionId('image-test'))!
  const invoke = (args = {}, signal = new AbortController().signal) => harness.context.tools.execute({
    agent, signal, callId: ToolCallId('image-call'), name: 'generate_image',
    arguments: { prompt: 'Ocean waves, square icon', path: 'assets/project-icon.png', projectIcon: true, ...args },
  })
  return { root, harness, agent, invoke, generateImage }
}

describe('provider Images API generation', () => {
  it('registers the production bridge and resolves the existing native credential reference', async () => {
    const f = await fixture()
    const get = vi.fn(async (key: string) => key === 'ref:OPENAI_API_KEY' ? 'fixture-value' : undefined)
    const harness = await createMobileHarness({
      mode: 'deepseek', provider: 'openai', model: 'gpt-5.6-sol',
      modelProfile: { baseURL: 'https://provider.invalid/v1', models: [{ id: 'gpt-5.6-sol', imageGeneration: true }] },
      attachmentRoot: join(f.root, '.attachments'),
      secrets: { get, async set() {}, async delete() {} },
      workspaceServices: { permissionModeFor: () => 'danger-full-access' },
    })
    cleanups.unshift(async () => harness.dispose())
    await harness.loadSession({ sessionId: 'production-test', projectRoot: f.root })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: png.toString('base64') }],
    })))
    const result = await harness.context.tools.execute({
      agent: harness.context.agents.get(SessionId('production-test'))!, signal: new AbortController().signal,
      callId: ToolCallId('production-image'), name: 'generate_image', arguments: { prompt: 'Ocean icon', path: 'assets/icon.png' },
    })
    expect(JSON.stringify(result)).toContain('sha256-')
    expect(get).toHaveBeenCalledWith('ref:OPENAI_API_KEY')
    expect(await readFile(join(f.root, 'assets/icon.png'))).toEqual(png)
  })

  it('uses gpt-image-2 and the configured provider credentials with a small icon request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: png.toString('base64') }],
    })))
    const image = await generateModelImage({ baseURL: 'https://provider.invalid/v1/', apiKey: 'fixture-value' }, {
      prompt: 'An ocean icon', projectIcon: true, references: [], signal: new AbortController().signal,
    })
    expect(image).toEqual(png)
    const [url, options] = fetch.mock.calls[0]!
    expect(String(url)).toBe('https://provider.invalid/v1/images/generations')
    expect(JSON.parse(options!.body as string)).toMatchObject({
      model: 'gpt-image-2', prompt: 'An ocean icon', output_format: 'png', size: '816x816', quality: 'low', background: 'opaque',
    })
    expect(options!.headers).toMatchObject({ Authorization: 'Bearer fixture-value' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('accepts a bare provider origin and sends references to the Images edit endpoint', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] })))
    await generateModelImage({ baseURL: 'https://provider.invalid', apiKey: 'fixture-value' }, {
      prompt: 'Use this reference', projectIcon: false, size: '1024x768', references: [{ data: png, mediaType: 'image/png' }], signal: new AbortController().signal,
    })
    expect(String(fetch.mock.calls[0]![0])).toBe('https://provider.invalid/v1/images/edits')
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toMatchObject({ size: '1024x768', quality: 'medium', images: [{ image_url: `data:image/png;base64,${png.toString('base64')}` }] })
  })

  it('downloads gateway URL results without forwarding credentials', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: 'https://images.invalid/result.png' }] }))).mockResolvedValueOnce(new Response(png))
    expect(await generateModelImage({ apiKey: 'fixture-value' }, { prompt: 'Icon', projectIcon: true, references: [], signal: new AbortController().signal })).toEqual(png)
    expect(fetch.mock.calls[1]![1]).not.toHaveProperty('headers')
  })

  it('saves image bytes and the icon reference, returns a durable attachment, and preserves an existing icon', async () => {
    const f = await fixture()
    const result = await f.invoke()
    expect(await readFile(join(f.root, 'assets/project-icon.png'))).toEqual(png)
    expect(JSON.parse(await readFile(join(f.root, 'runwhale.json'), 'utf8'))).toMatchObject({ name: 'Ocean', icon: 'assets/project-icon.png' })
    expect(JSON.stringify(result)).toContain('sha256-')
    expect(JSON.stringify(result)).not.toContain(png.toString('base64'))
    expect(JSON.stringify(await f.invoke())).toContain('already has an icon')
    expect(f.generateImage).toHaveBeenCalledTimes(1)
  })

  it.each(['read-only', 'review'] as const)('does not make a billable call when %s blocks the write', async (mode) => {
    const f = await fixture(mode)
    await f.invoke()
    expect(f.generateImage).not.toHaveBeenCalled()
  })

  it('rejects plan mode, escaping paths and pre-existing files before generation', async () => {
    const f = await fixture()
    f.harness.setPlanMode('image-test', true)
    expect(JSON.stringify(await f.invoke())).toContain('plan mode')
    f.harness.setPlanMode('image-test', false)
    expect(JSON.stringify(await f.invoke({ path: '../escape.png' }))).toContain('relative workspace')
    await writeFile(join(f.root, 'existing.png'), png)
    expect(JSON.stringify(await f.invoke({ path: 'existing.png' }))).toContain('already exists')
    await symlink(resolve(f.root, '..'), join(f.root, 'outside'))
    await f.invoke({ path: 'outside/escape.png' })
    expect(f.generateImage).not.toHaveBeenCalled()
  })

  it('does not write a late result after cancellation', async () => {
    const f = await fixture()
    const controller = new AbortController()
    f.generateImage.mockImplementation(async () => { controller.abort(); return png })
    await f.invoke({}, controller.signal)
    await expect(readFile(join(f.root, 'assets/project-icon.png'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports unsupported APIs without exposing provider bodies or silently retrying', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('private provider diagnostics', { status: 400 }))
    await expect(generateModelImage({ apiKey: 'fixture-value' }, {
      prompt: 'An icon', projectIcon: false, references: [], signal: new AbortController().signal,
    })).rejects.toThrow('HTTP 400')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(supportsModelImageGeneration('openai', 'gpt-5.6')).toBe(true)
    expect(supportsModelImageGeneration('openai', 'gpt-5.6', { models: [{ id: 'gpt-5.6', imageGeneration: false }] })).toBe(false)
    expect(supportsModelImageGeneration('deepseek', 'deepseek-v4-flash')).toBe(false)
  })
})
