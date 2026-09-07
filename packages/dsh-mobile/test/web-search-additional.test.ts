import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { mobileWebSearchProvider, type GoogleSearchResult } from '../src/web-search-mobile.js'
import { createMobileHarness } from '../src/profile.js'

const models = { anthropic: 'claude-sonnet-4-6', google: 'gemini-3.5-flash' }
const html = '<div><a href="https://www.google.com/search?q=test">Google Search</a></div>'
const url = 'https://example.com/news'
const fixtures = {
  anthropic: { stop_reason: 'end_turn', content: [
    { type: 'server_tool_use', id: 'search-1', name: 'web_search', input: { query: 'news' } },
    { type: 'web_search_tool_result', tool_use_id: 'search-1', content: [{ type: 'web_search_result', url, title: 'News', encrypted_content: 'opaque', page_age: '2026-09-07' }] },
    { type: 'text', text: '新闻。', citations: [{ type: 'web_search_result_location', url, title: 'News', cited_text: '新闻。' }] },
  ] },
  google: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '新闻。' }] }, groundingMetadata: {
    webSearchQueries: ['news'], searchEntryPoint: { renderedContent: html },
    groundingChunks: [{ web: { uri: url, title: 'News' } }],
    groundingSupports: [{ segment: { startIndex: 0, endIndex: 9, text: '新闻。' }, groundingChunkIndices: [0] }],
  } }] },
}
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup() })
const provider = (kind: keyof typeof models, baseURL?: string, key: string | undefined = 'fixture-secret') => mobileWebSearchProvider({ provider: kind, model: models[kind], baseURL, resolveApiKey: async () => key })

it.each(['anthropic', 'google'] as const)('uses the %s protocol with current model and header credentials', async (kind) => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(fixtures[kind])))
  const result = await provider(kind).search({ query: 'News' }) as GoogleSearchResult
  expect(result.sources[0]).toMatchObject({ url, title: 'News', snippet: '新闻。' })
  expect(result.content).toContain(`新闻。 [News](<${url}>)`)
  const [endpoint, init] = fetch.mock.calls[0]!
  expect(String(endpoint)).toBe(kind === 'google' ? `https://generativelanguage.googleapis.com/v1beta/models/${models.google}:generateContent` : 'https://api.anthropic.com/v1/messages')
  expect(String(endpoint)).not.toContain('fixture-secret')
  expect(new Headers(init!.headers).get(kind === 'google' ? 'x-goog-api-key' : 'x-api-key')).toBe('fixture-secret')
  expect(init!.redirect).toBe('error')
  const body = JSON.parse(init!.body as string)
  if (kind === 'google') { expect(body.tools).toEqual([{ google_search: {} }]); expect(result.searchSuggestions).toBe(html) }
  else { expect(body.model).toBe(models.anthropic); expect(body.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }]); expect(new Headers(init!.headers).get('anthropic-version')).toBe('2023-06-01') }
})

it.each(['anthropic', 'google'] as const)('preserves %s gateway paths and sanitizes failures', async (kind) => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('fixture-secret diagnostics', { status: 403 }))
  const error = await provider(kind, 'https://gateway.invalid/prefix/v1/').search({ query: 'News' }).catch(String)
  expect(error).toContain('HTTP 403'); expect(error).not.toContain('fixture-secret')
  expect(String(fetch.mock.calls[0]![0])).toContain('https://gateway.invalid/prefix/v1/')
  const controller = new AbortController(); controller.abort()
  await expect(provider(kind).search({ query: 'News' }, controller.signal)).rejects.toThrow()
  await expect(mobileWebSearchProvider({ provider: kind, model: models[kind], resolveApiKey: async () => undefined }).search({ query: 'News' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('continues an Anthropic paused turn unchanged and rejects server tool errors', async () => {
  const paused = { stop_reason: 'pause_turn', content: fixtures.anthropic.content.slice(0, 2) }
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(paused))).mockResolvedValueOnce(new Response(JSON.stringify(fixtures.anthropic)))
  await provider('anthropic').search({ query: 'News' })
  expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string).messages[1]).toEqual({ role: 'assistant', content: paused.content })
  fetch.mockResolvedValue(new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'unavailable' } }] })))
  await expect(provider('anthropic').search({ query: 'News' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
})

it.each(['anthropic', 'google'] as const)('rejects %s model-only replies and incomplete results', async (kind) => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(kind === 'google' ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Unsourced' }] } }] } : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Unsourced' }] })))
  await expect(provider(kind).search({ query: 'News' })).rejects.toMatchObject({ code: 'WEB_SEARCH_NOT_EXECUTED' })
  const incomplete = structuredClone(fixtures[kind])
  if ('candidates' in incomplete) incomplete.candidates[0]!.finishReason = 'MAX_TOKENS'
  else incomplete.stop_reason = 'max_tokens'
  fetch.mockResolvedValue(new Response(JSON.stringify(incomplete)))
  await expect(provider(kind).search({ query: 'News' })).rejects.toMatchObject({ code: 'WEB_SEARCH_NOT_EXECUTED' })
})

it.each(['anthropic', 'google'] as const)('exposes %s search in read-only harness with durable citations', async (kind) => {
  const cache = resolve(import.meta.dirname, '../../../.cache'); await mkdir(cache, { recursive: true })
  const root = await mkdtemp(join(cache, 'additional-search-test-'))
  const get = vi.fn(async (key: string) => key === `ref:${kind.toUpperCase()}_API_KEY` ? 'fixture-secret' : undefined)
  const harness = await createMobileHarness({ mode: 'deepseek', provider: kind, model: models[kind], secrets: { get, async set() {}, async delete() {} }, workspaceServices: { permissionModeFor: () => 'read-only' } })
  cleanups.push(async () => { await harness.dispose(); await rm(root, { recursive: true, force: true }) })
  await harness.loadSession({ sessionId: 'search-test', projectRoot: root }); harness.setPlanMode('search-test', true)
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(fixtures[kind])))
  const result = await harness.context.tools.execute({ agent: harness.context.agents.get(SessionId('search-test'))!, signal: new AbortController().signal, callId: ToolCallId('search-call'), name: 'web_search', arguments: { queries: ['News'] } })
  expect(result.isError).toBe(false)
  expect(result.meta).toMatchObject({ sources: [{ url, title: 'News' }] })
  expect(get).toHaveBeenCalledWith(`ref:${kind.toUpperCase()}_API_KEY`)
  expect(JSON.stringify(result)).not.toContain('fixture-secret')
  if (kind === 'google') {
    expect(result.meta).toMatchObject({ googleSearchSuggestions: html })
    expect(JSON.stringify(result.content)).not.toContain(html)
  }
})
