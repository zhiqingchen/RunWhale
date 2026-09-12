const languages = ['en', 'zh-CN', 'es', 'fr', 'ja']

/** @param {unknown} value @returns {value is import('./index.js').Language} */
function isLanguage(value) { return typeof value === 'string' && languages.includes(value) }

/** @param {string} locale @returns {import('./index.js').Language} */
function systemLanguage(locale) {
  const base = locale.toLowerCase().split(/[-_]/)[0]
  return base === 'zh' ? 'zh-CN' : base === 'es' || base === 'fr' || base === 'ja' ? base : 'en'
}

/**
 * @param {() => {url: string | undefined, locale: string, readLanguage?: () => string | null, subscribeLanguage?: (listener: () => void) => () => void}} environment
 * @param {typeof fetch} request
 */
export function createLanguageStore(environment, request = globalThis.fetch) {
  /** @type {import('./index.js').LanguageState} */
  let state = { language: undefined, loading: true, error: undefined }
  /** @type {Set<() => void>} */
  const listeners = new Set()
  /** @type {AbortController | undefined} */
  let controller
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let retryTimer
  /** @param {import('./index.js').LanguageState} next */
  const publish = next => {
    if (state.language === next.language && state.loading === next.loading && state.error === next.error) return
    state = next
    listeners.forEach(listener => listener())
  }

  async function start() {
    const current = new AbortController()
    controller = current
    let failures = 0
    let revision = -1
    try {
      const { url, locale, readLanguage, subscribeLanguage } = environment()
      if (readLanguage && subscribeLanguage) {
        const refresh = () => {
          if (current.signal.aborted) return
          const language = readLanguage()
          if (!isLanguage(language)) {
            publish({ language: undefined, loading: false, error: new Error('RunWhale language is not ready.') })
            return
          }
          publish({ language, loading: false, error: undefined })
        }
        const unsubscribe = subscribeLanguage(refresh)
        current.signal.addEventListener('abort', unsubscribe, { once: true })
        refresh()
        return
      }
      const source = url ? new URL(url) : undefined
      if (!source?.searchParams.has('token')) {
        publish({ language: systemLanguage(locale), loading: false, error: undefined })
        return
      }
      if (source.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname)) {
        throw new Error('RunWhale language requires a local Preview connection.')
      }
      const endpoint = new URL('/__runwhale/sdk/v1/language', source)
      endpoint.searchParams.set('token', source.searchParams.get('token') ?? '')
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let requestTimeout
      const clearRequestTimeout = () => clearTimeout(requestTimeout)
      current.signal.addEventListener('abort', clearRequestTimeout, { once: true })
      while (!current.signal.aborted) {
        try {
          endpoint.searchParams.set('after', String(revision))
          requestTimeout = setTimeout(() => current.abort(), 35_000)
          let response
          try { response = await request(endpoint.href, { signal: current.signal }) }
          finally { clearRequestTimeout() }
          if (response.status === 404) {
            publish({ language: systemLanguage(locale), loading: false, error: new Error('Update RunWhale to follow its language setting. Using the system language.') })
            return
          }
          if (!response.ok) throw new Error(`RunWhale language is unavailable (${response.status}).`)
          const value = await response.json()
          if (!languages.includes(value.language) || !Number.isSafeInteger(value.revision) || value.revision < 0) {
            throw new Error('RunWhale returned an invalid language preference.')
          }
          if (current.signal.aborted) return
          revision = value.revision
          failures = 0
          publish({ language: value.language, loading: false, error: undefined })
        } catch {
          if (controller !== current || listeners.size === 0) return
          publish({ language: state.language, loading: false, error: new Error('Could not read RunWhale language. Reconnecting…') })
          // A timed-out request needs a fresh abort controller.
          if (current.signal.aborted) {
            retryTimer = setTimeout(() => { void start() }, 1000)
            return
          }
          await new Promise(resolve => { retryTimer = setTimeout(resolve, Math.min(5000, 500 * 2 ** Math.min(failures++, 4))) })
        }
      }
    } catch (error) {
      if (!current.signal.aborted) publish({ language: state.language, loading: false, error: error instanceof Error ? error : new Error('RunWhale language is unavailable.') })
    }
  }

  return {
    getSnapshot: () => state,
    /** @param {() => void} listener */
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) void start()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          controller?.abort()
          controller = undefined
          clearTimeout(retryTimer)
        }
      }
    },
  }
}
