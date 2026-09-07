import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supportsModelWebSearch } from '@runwhale/mobile-protocol'
import { mobileWebSearchProvider } from '../src/web-search-mobile.js'
import { createMobileHarness } from '../src/profile.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup() })
const citation = { type: 'url_citation', url: 'https://example.com/news', title: 'News', start_index: 6, end_index: 9 }
function response() {
  return { status: 'completed', output: [
    { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ type: 'url', url: 'https://example.com/news' }] } },
    { type: 'message', content: [{ type: 'output_text', text: 'Found [1]', annotations: [citation] }] },
  ] }
}
function deepseekResponse() {
  return { content: [{ type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: citation.url, title: 'News', page_age: '2026-09-07' }] }, { type: 'text', text: 'Summary', citations: [{ url: citation.url, cited_text: 'Verified excerpt' }] }] }
}
function provider(kind: 'openai' | 'deepseek' = 'openai', baseURL?: string) {
  return mobileWebSearchProvider({ provider: kind, model: kind === 'openai' ? 'gpt-5.6-sol' : 'deepseek-v4-flash', baseURL, resolveApiKey: async () => 'fixture-secret' })
}

describe('mobile web search', () => {
  it.each(['openai', 'deepseek'] as const)('uses the %s native API and returns real citation metadata', async (kind) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(kind === 'openai' ? response() : deepseekResponse())))
    const result = await provider(kind).search({ query: 'Latest news' })
    expect(result.sources[0]).toMatchObject({ url: citation.url, title: 'News' })
    if (kind === 'openai') expect(result.content).toBe('Found [News](<https://example.com/news>)')
    else { expect(result.content).toBeUndefined(); expect(result.sources[0]).toMatchObject({ snippet: 'Verified excerpt', publishedAt: '2026-09-07' }) }
    const [url, options] = fetch.mock.calls[0]!
    expect(String(url)).toBe(kind === 'openai' ? 'https://api.openai.com/v1/responses' : 'https://api.deepseek.com/anthropic/v1/messages')
    const body = JSON.parse(options!.body as string)
    if (kind === 'openai') expect(body).toMatchObject({ tools: [{ type: 'web_search' }], tool_choice: 'required', reasoning: { effort: 'low' } })
    else expect(body.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }])
    expect(body.model).toBe(kind === 'openai' ? 'gpt-5.6-sol' : 'deepseek-v4-flash')
    expect(new Headers(options!.headers).get('authorization')).toBe('Bearer fixture-secret')
    if (kind === 'openai') expect(body.include).toEqual(['web_search_call.action.sources'])
    else { expect(body).not.toHaveProperty('include'); expect(body).not.toHaveProperty('store') }
  })

  it('preserves custom endpoint prefixes and rejects credential-bearing endpoints before dispatch', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(response())))
    await provider('openai', 'https://gateway.invalid/deepseek/v1/').search({ query: 'News' })
    expect(String(fetch.mock.calls[0]![0])).toBe('https://gateway.invalid/deepseek/v1/responses')
    await expect(provider('openai', 'https://private-value@gateway.invalid').search({ query: 'News' })).rejects.toThrow('Invalid configured')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not treat model-only replies, incomplete searches or unsourced prose as search success', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...response(), output: response().output.slice(1) })))
    await expect(provider().search({ query: 'News' })).rejects.toMatchObject({ code: 'WEB_SEARCH_NOT_EXECUTED' })
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...response(), status: 'incomplete' })))
    await expect(provider().search({ query: 'News' })).rejects.toMatchObject({ code: 'WEB_SEARCH_NOT_EXECUTED' })
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'completed', output: [{ type: 'web_search_call', status: 'completed' }] })))
    await expect(provider().search({ query: 'News' })).rejects.toMatchObject({ code: 'WEB_SEARCH_NO_SOURCES' })
  })

  it('drops unsafe URLs and keeps citations even when the provider omits source lists', async () => {
    const result = response()
    result.output = result.output.slice(1)
    result.output.unshift({ type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [] } })
    result.output[1]!.content![0]!.annotations.push({ ...citation, url: 'javascript:alert(1)' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(result)))
    expect((await provider('openai').search({ query: 'News' })).sources).toEqual([{ url: citation.url, title: 'News' }])
  })

  it.each(['openai', 'deepseek'] as const)('honors cancellation and sanitizes %s errors without retrying', async (kind) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { message: 'fixture-secret private diagnostics' } }), { status: 403 }))
    const error = await provider(kind).search({ query: 'News' }).catch((error: Error) => error)
    expect(String(error)).toContain('HTTP 403')
    expect(String(error)).not.toContain('fixture-secret')
    expect(fetch).toHaveBeenCalledTimes(1)
    const controller = new AbortController(); controller.abort()
    await expect(provider(kind).search({ query: 'News' }, controller.signal)).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('registers the shared harness tool in read-only plan mode and resolves the native credential', async () => {
    const cache = resolve(import.meta.dirname, '../../../.cache')
    await mkdir(cache, { recursive: true })
    const root = await mkdtemp(join(cache, 'web-search-test-'))
    const get = vi.fn(async (key: string) => key === 'ref:DEEPSEEK_API_KEY' ? 'fixture-secret' : undefined)
    const harness = await createMobileHarness({ mode: 'deepseek', provider: 'deepseek', model: 'deepseek-v4-flash',
      modelProfile: { baseURL: 'https://gateway.invalid/v1', models: [{ id: 'deepseek-v4-flash' }] },
      secrets: { get, async set() {}, async delete() {} }, workspaceServices: { permissionModeFor: () => 'read-only' },
    })
    cleanups.push(async () => { await harness.dispose(); await rm(root, { force: true, recursive: true }) })
    await harness.loadSession({ sessionId: 'search-test', projectRoot: root })
    harness.setPlanMode('search-test', true)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(deepseekResponse())))
    const result = await harness.context.tools.execute({ agent: harness.context.agents.get(SessionId('search-test'))!, signal: new AbortController().signal,
      callId: ToolCallId('search-call'), name: 'web_search', arguments: { queries: ['News'] } })
    expect(result.isError).toBe(false)
    expect(result.meta).toMatchObject({ sources: [{ url: citation.url, title: 'News', snippet: 'Verified excerpt' }] })
    expect(JSON.stringify(result)).not.toContain('fixture-secret')
    expect(get).toHaveBeenCalledWith('ref:DEEPSEEK_API_KEY')
  })

  it.each(['openai', 'deepseek', 'anthropic', 'google'] as const)('removes the search tool when disabled for %s without changing image capability', async (kind) => {
    const model = { openai: 'gpt-5.6-sol', deepseek: 'deepseek-v4-flash', anthropic: 'claude-sonnet-4-6', google: 'gemini-3.5-flash' }[kind]
    const harness = await createMobileHarness({ mode: 'deepseek', provider: kind, model,
      modelProfile: { models: [{ id: model, webSearch: false, imageGeneration: true }] },
      secrets: { async get() { return undefined }, async set() {}, async delete() {} },
    })
    cleanups.push(() => harness.dispose())
    expect(harness.context.tools.get('web_search')).toBeUndefined()
    expect(Boolean(harness.context.tools.get('generate_image'))).toBe(kind === 'openai')
  })

  it('keeps provider capabilities independent and allows explicit custom model overrides', () => {
    expect(supportsModelWebSearch('deepseek', 'deepseek-v4-flash')).toBe(true)
    expect(supportsModelWebSearch('openai', 'gpt-5.6-sol')).toBe(true)
    expect(supportsModelWebSearch('openai', 'custom')).toBe(false)
    expect(supportsModelWebSearch('openai', 'custom', { models: [{ id: 'custom', webSearch: true }] })).toBe(true)
    expect(supportsModelWebSearch('deepseek', 'deepseek-v4-flash', { models: [{ id: 'deepseek-v4-flash', webSearch: false }] })).toBe(false)
    expect(supportsModelWebSearch('google', 'custom', { models: [{ id: 'custom', webSearch: true }] })).toBe(true)
    expect(supportsModelWebSearch('anthropic', 'claude-sonnet-4-6')).toBe(true)
    expect(supportsModelWebSearch('anthropic', 'claude-3-haiku-20240307')).toBe(false)
    expect(supportsModelWebSearch('google', 'gemini-3.5-flash')).toBe(true)
    expect(supportsModelWebSearch('google', 'gemini-2.0-flash-lite')).toBe(false)
    expect(supportsModelWebSearch('google', 'gemini-2.5-flash-native-audio-latest')).toBe(false)
  })
})
