import React from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLanguageStore } from '../src/language-store.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const environment = () => ({ url: 'http://127.0.0.1:1234/app.bundle?token=preview-test', locale: 'en' })
const response = (language, revision) => ({ ok: true, json: async () => ({ language, revision }) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules() })

describe('language hook', () => {
  it('reads cached native previews through the read-only settings bridge and unsubscribes', () => {
    let language = 'fr'
    let changed
    const remove = vi.fn()
    const request = vi.fn()
    const store = createLanguageStore(() => ({
      url: undefined, locale: 'en', readLanguage: () => language,
      subscribeLanguage: listener => { changed = listener; return remove },
    }), request)
    const listener = vi.fn()
    const stop = store.subscribe(listener)
    const stopOther = store.subscribe(() => {})
    expect(store.getSnapshot()).toEqual({ language: 'fr', loading: false, error: undefined })
    language = 'ja'; changed()
    expect(store.getSnapshot().language).toBe('ja')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(request).not.toHaveBeenCalled()
    stop(); expect(remove).not.toHaveBeenCalled()
    stopOther(); expect(remove).toHaveBeenCalledTimes(1)
    language = 'es'; changed()
    expect(store.getSnapshot().language).toBe('ja')
  })
  it('waits for native language initialization without selecting a different preference', () => {
    let language = null
    let changed
    const store = createLanguageStore(() => ({
      url: undefined, locale: 'en', readLanguage: () => language,
      subscribeLanguage: listener => { changed = listener; return () => {} },
    }))
    const stop = store.subscribe(() => {})
    expect(store.getSnapshot()).toMatchObject({language: undefined, error: expect.any(Error)})
    language = 'zh-CN'; changed()
    expect(store.getSnapshot()).toEqual({language: 'zh-CN', loading: false, error: undefined})
    stop()
  })
  it('keeps older RunWhale clients usable and reports the missing capability', async () => {
    const store = createLanguageStore(() => ({ ...environment(), locale: 'ja-JP' }), vi.fn().mockResolvedValue({ status: 404 }))
    const unsubscribe = store.subscribe(() => {})
    await Promise.resolve()
    expect(store.getSnapshot()).toMatchObject({ language: 'ja', loading: false, error: expect.any(Error) })
    unsubscribe()
  })
  it('shares the connection, rerenders consumers, and aborts on final unmount', async () => {
    vi.stubGlobal('location', { href: environment().url })
    const calls = []
    vi.stubGlobal('fetch', vi.fn((url, options) => new Promise(resolve => calls.push({ url, options, resolve }))))
    const { useLanguage } = await import('../src/index.js')
    function Label() { const state = useLanguage(); return React.createElement('span', null, state.loading ? 'loading' : state.language) }
    let root
    await act(async () => { root = create(React.createElement(React.Fragment, null, React.createElement(Label), React.createElement(Label))) })
    expect(calls).toHaveLength(1)
    await act(async () => { calls[0].resolve(response('fr', 1)) })
    expect(root.toJSON().map(node => node.children[0])).toEqual(['fr', 'fr'])
    expect(new URL(calls[1].url).searchParams.get('after')).toBe('1')
    await act(async () => { calls[1].resolve(response('ja', 2)) })
    expect(root.toJSON().map(node => node.children[0])).toEqual(['ja', 'ja'])
    await act(async () => { root.unmount() })
    expect(calls[2].options.signal.aborted).toBe(true)
  })

  it('retains the last preference during a disconnect and recovers', async () => {
    vi.useFakeTimers()
    let resolveNext
    const request = vi.fn().mockResolvedValueOnce(response('es', 1)).mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response('zh-CN', 2)).mockImplementation(() => new Promise(resolve => { resolveNext = resolve }))
    const store = createLanguageStore(environment, request)
    const unsubscribe = store.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot()).toMatchObject({ language: 'es', loading: false, error: expect.any(Error) })
    await vi.advanceTimersByTimeAsync(500)
    expect(store.getSnapshot()).toEqual({ language: 'zh-CN', loading: false, error: undefined })
    unsubscribe()
    resolveNext(response('en', 3))
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot().language).toBe('zh-CN')
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([['fr-CA', 'fr'], ['es-MX', 'es'], ['ja-JP', 'ja'], ['zh-TW', 'zh-CN'], ['de-DE', 'en']])('uses the system locale %s outside RunWhale', (locale, language) => {
    const request = vi.fn()
    const store = createLanguageStore(() => ({ url: undefined, locale }), request)
    const unsubscribe = store.subscribe(() => {})
    expect(store.getSnapshot()).toEqual({ language, loading: false, error: undefined })
    expect(request).not.toHaveBeenCalled()
    unsubscribe()
  })
})
