import { describe, expect, it } from 'vitest'
import {
  initialPreviewLifecycleState,
  previewLifecycleReducer,
  selectedActivePreview,
  webPreviewPageUrl,
} from '../src/utils/preview-lifecycle'
import {
  clampWebPreviewControlPosition,
  webPreviewControlInitialPosition,
  webPreviewOverlayControlContract,
  webPreviewOverlayPresentation,
} from '../src/utils/web-preview-overlay'

const bundleUrl = 'http://127.0.0.1:31337/index.bundle?platform=web&dev=true&token=private-token'

describe('Preview lifecycle', () => {
  it('closes without discarding the bundle and treats cancelled startup as an idle state', () => {
    let state = previewLifecycleReducer(initialPreviewLifecycleState(), { type: 'bundle-ready', target: 'web', bundleUrl })
    state = previewLifecycleReducer(state, { type: 'launch-cancelled' })
    expect(state.operation).toBeUndefined()
    expect(state.error).toBeUndefined()
    state = previewLifecycleReducer(state, { type: 'content-opened', bundleUrl })
    state = previewLifecycleReducer(state, { type: 'preview-closed' })
    expect(state.webVisible).toBe(false)
    expect(state.active).toMatchObject({ bundleUrl, opened: true })
  })
  it('tracks cache lookup as an open operation rather than an explicit rebuild', () => {
    const state = previewLifecycleReducer(initialPreviewLifecycleState(), { type: 'open-requested' })

    expect(state.operation).toBe('open')
    expect(state.webVisible).toBe(false)
  })

  it('keeps a 48-point Web Preview close control with visible press feedback', () => {
    expect(webPreviewOverlayControlContract.closeSize).toBe(48)
    expect(webPreviewOverlayControlContract.feedbackVariant).toBe('scale-highlight')
  })

  it('starts the Web Preview close control at the safe top-right and clamps dragging to every edge', () => {
    const viewport = { width: 390, height: 844 }
    const insets = { top: 47, right: 0, bottom: 34, left: 0 }

    expect(webPreviewControlInitialPosition(viewport, insets)).toEqual({ x: 334, y: 55 })
    expect(clampWebPreviewControlPosition({ x: -100, y: -100 }, viewport, insets)).toEqual({ x: 8, y: 55 })
    expect(clampWebPreviewControlPosition({ x: 1_000, y: 1_000 }, viewport, insets)).toEqual({ x: 334, y: 754 })
  })

  it('keeps one mounted Web Preview instance inert while minimized and reuses it when reopened', () => {
    let state = initialPreviewLifecycleState()
    state = previewLifecycleReducer(state, { type: 'run-started' })
    state = previewLifecycleReducer(state, {
      type: 'bundle-ready',
      target: 'web',
      bundleUrl,
      pageUrl: webPreviewPageUrl(bundleUrl),
    })
    state = previewLifecycleReducer(state, { type: 'content-opened', bundleUrl })
    state = previewLifecycleReducer(state, { type: 'minimize-web' })

    const activeKeyBeforeReopen = state.active?.bundleUrl
    expect(webPreviewOverlayPresentation(Boolean(state.active?.pageUrl), state.webVisible)).toEqual({
      mounted: true,
      visible: false,
      pointerEvents: 'none',
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    })

    state = previewLifecycleReducer(state, { type: 'open-started', bundleUrl })

    expect(state.webVisible).toBe(true)
    expect(state.active?.bundleUrl).toBe(activeKeyBeforeReopen)
    expect(webPreviewOverlayPresentation(Boolean(state.active?.pageUrl), state.webVisible)).toEqual({
      mounted: true,
      visible: true,
      pointerEvents: 'auto',
      accessibilityElementsHidden: false,
      importantForAccessibility: 'auto',
    })
  })

  it('preserves the active Preview through repeated reopen cycles and replaces it only after an explicit run', () => {
    const nextBundleUrl = bundleUrl.replace('private-token', 'next-private-token')
    let state = previewLifecycleReducer(initialPreviewLifecycleState(), {
      type: 'bundle-ready',
      target: 'web',
      bundleUrl,
      pageUrl: webPreviewPageUrl(bundleUrl),
    })
    state = previewLifecycleReducer(state, { type: 'content-opened', bundleUrl })

    for (let cycle = 0; cycle < 3; cycle += 1) {
      state = previewLifecycleReducer(state, { type: 'minimize-web' })
      state = previewLifecycleReducer(state, { type: 'open-started', bundleUrl })
      state = previewLifecycleReducer(state, { type: 'content-opened', bundleUrl })
      expect(state.active?.bundleUrl).toBe(bundleUrl)
      expect(state.active?.opened).toBe(true)
    }

    state = previewLifecycleReducer(state, { type: 'run-started' })
    expect(state.active?.bundleUrl).toBe(bundleUrl)
    expect(state.webVisible).toBe(false)
    state = previewLifecycleReducer(state, {
      type: 'bundle-ready',
      target: 'web',
      bundleUrl: nextBundleUrl,
      pageUrl: webPreviewPageUrl(nextBundleUrl),
    })
    expect(state.active?.bundleUrl).toBe(nextBundleUrl)
    expect(state.active?.pageUrl).toBe(webPreviewPageUrl(nextBundleUrl))
  })

  it('keeps the old WebView mounted but ignores its lifecycle events while rebuilding', () => {
    let state = previewLifecycleReducer(initialPreviewLifecycleState(), {
      type: 'bundle-ready',
      target: 'web',
      bundleUrl,
      pageUrl: webPreviewPageUrl(bundleUrl),
    })
    state = previewLifecycleReducer(state, { type: 'content-opened', bundleUrl })

    state = previewLifecycleReducer(state, { type: 'run-started' })

    expect(state.webVisible).toBe(false)
    expect(state.operation).toBe('run')
    expect(webPreviewOverlayPresentation(Boolean(state.active?.pageUrl), state.webVisible).mounted).toBe(true)

    const rebuilding = state
    state = previewLifecycleReducer(state, { type: 'content-opened', bundleUrl })
    state = previewLifecycleReducer(state, { type: 'content-failed', bundleUrl, message: 'Old Preview disconnected' })
    expect(state).toBe(rebuilding)
  })

  it('does not report Native Preview as opened before first content succeeds', () => {
    let state = initialPreviewLifecycleState('native')
    state = previewLifecycleReducer(state, { type: 'run-started' })
    state = previewLifecycleReducer(state, { type: 'bundle-ready', target: 'native', bundleUrl })

    expect(selectedActivePreview(state)?.opened).toBe(false)

    state = previewLifecycleReducer(state, { type: 'content-failed', bundleUrl, message: 'First content timed out' })
    expect(selectedActivePreview(state)?.opened).toBe(false)
    expect(state.error).toBe('First content timed out')

    state = previewLifecycleReducer(state, { type: 'open-started', bundleUrl })
    state = previewLifecycleReducer(state, { type: 'content-opened', bundleUrl })
    expect(selectedActivePreview(state)?.opened).toBe(true)
  })

  it('turns a post-ready Native Preview failure into a recoverable error state', () => {
    let state = previewLifecycleReducer(initialPreviewLifecycleState('native'), {
      type: 'bundle-ready',
      target: 'native',
      bundleUrl,
    })
    state = previewLifecycleReducer(state, { type: 'content-opened', bundleUrl })
    expect(selectedActivePreview(state)?.opened).toBe(true)

    state = previewLifecycleReducer(state, {
      type: 'content-failed',
      bundleUrl,
      message: 'Native Preview encountered a fatal JavaScript error',
    })

    expect(selectedActivePreview(state)?.opened).toBe(false)
    expect(state.error).toBe('Native Preview encountered a fatal JavaScript error')
    expect(state.operation).toBeUndefined()

    const failed = state
    state = previewLifecycleReducer(state, { type: 'content-opened', bundleUrl })
    expect(state).toBe(failed)
  })

  it('deduplicates a visible failure and dismisses it without discarding the active Preview', () => {
    let state = previewLifecycleReducer(initialPreviewLifecycleState('native'), {
      type: 'bundle-ready',
      target: 'native',
      bundleUrl,
    })
    state = previewLifecycleReducer(state, { type: 'content-failed', bundleUrl, message: 'First content timed out' })
    const failed = state

    state = previewLifecycleReducer(state, { type: 'content-failed', bundleUrl, message: 'First content timed out' })
    expect(state).toBe(failed)

    state = previewLifecycleReducer(state, { type: 'dismiss-error' })
    expect(state.error).toBeUndefined()
    expect(state.active).toEqual(failed.active)

    state = previewLifecycleReducer(state, { type: 'content-failed', bundleUrl, message: 'First content timed out' })
    expect(state.error).toBe('First content timed out')

    const activeBeforeRetry = state.active
    state = previewLifecycleReducer(state, { type: 'run-started' })
    expect(state.error).toBeUndefined()
    expect(state.operation).toBe('run')
    expect(state.active).toBe(activeBeforeRetry)
  })

  it('clears the active URL only when Preview is stopped', () => {
    let state = previewLifecycleReducer(initialPreviewLifecycleState(), {
      type: 'bundle-ready',
      target: 'web',
      bundleUrl,
      pageUrl: webPreviewPageUrl(bundleUrl),
    })
    state = previewLifecycleReducer(state, { type: 'minimize-web' })
    expect(state.active?.bundleUrl).toBe(bundleUrl)

    state = previewLifecycleReducer(state, { type: 'stop-started' })
    state = previewLifecycleReducer(state, { type: 'stopped' })
    expect(state.active).toBeUndefined()
  })

  it('keeps the token when deriving the private Web page URL', () => {
    const page = new URL(webPreviewPageUrl(bundleUrl))
    expect(page.pathname).toBe('/')
    expect(page.searchParams.get('platform')).toBeNull()
    expect(page.searchParams.get('token')).toBe('private-token')
    expect(page.searchParams.get('dev')).toBe('true')
  })

  it('rejects unprotected or non-local Web URLs', () => {
    expect(() => webPreviewPageUrl('http://127.0.0.1:31337/index.bundle?platform=web')).toThrow('token-protected localhost')
    expect(() => webPreviewPageUrl('https://example.com/index.bundle?token=private-token')).toThrow('token-protected localhost')
  })
})
