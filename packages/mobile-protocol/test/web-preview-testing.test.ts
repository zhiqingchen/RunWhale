import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { webPreviewTestingScript } from '../src/web-preview-testing.js'

describe('Web Preview console capture', () => {
  it('preserves the console, bounds retention, and reports cursor gaps and uncaught failures', () => {
    const messages: Array<{ result: { logs: Array<{ message: string; level: string }>; nextSequence: number; gap: boolean } }> = []
    const listeners = new Map<string, (event: unknown) => void>()
    const original = vi.fn()
    const context: Record<string, any> = {
      console: { log: original, info: original, warn: original, error: original, debug: original },
      document: {}, MutationObserver: class { observe() {} takeRecords() { return [] } },
      addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback),
      ReactNativeWebView: { postMessage: (data: string) => messages.push(JSON.parse(data)) },
    }
    context.window = context
    runInNewContext(webPreviewTestingScript, context)
    runInNewContext(webPreviewTestingScript, context)
    for (let i = 0; i < 105; i++) context.console.log(`entry ${i}`)
    listeners.get('unhandledrejection')!({ reason: { stack: 'async failure' } })
    context.__runwhalePreviewTest('logs', { kind: 'logs', afterSequence: 0 })
    expect(original).toHaveBeenCalledTimes(105)
    expect(messages[0]!.result).toMatchObject({ nextSequence: 106, gap: true })
    expect(messages[0]!.result.logs).toHaveLength(100)
    expect(messages[0]!.result.logs.at(-1)).toEqual(expect.objectContaining({ level: 'error', message: 'async failure' }))
    context.__runwhalePreviewTest('next', { kind: 'logs', afterSequence: 106 })
    expect(messages[1]!.result.logs).toEqual([])
    context.console.error('x'.repeat(9000))
    context.__runwhalePreviewTest('bounded', { kind: 'logs', afterSequence: 106 })
    expect(messages[2]!.result.logs[0]!.message.length).toBeLessThanOrEqual(2048)
  })
})
