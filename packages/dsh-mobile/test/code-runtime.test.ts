import { Context } from '@deepseek-ai/cordis'
import type { CodeJsonValue } from '@deepseek-ai/dsh-code-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileCodeRuntime } from '../src/code-runtime-mobile.js'

let ctx: Context

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(MobileCodeRuntime, {
    computeMs: 250,
    maxWallMs: 1500,
    maxOutputBytes: 16 * 1024,
    maxOldGenerationSizeMb: 64,
  })
  vi.stubGlobal('WebAssembly', undefined)
})

afterEach(async () => {
  await ctx.fiber.dispose()
  vi.unstubAllGlobals()
})

describe('mobile code runtime without WebAssembly', () => {
  it('parses JavaScript async bodies without executing project code on the host', async () => {
    const key = '__runwhale_compile_probe__'
    const result = await ctx.codeRuntime.run({
      program: `globalThis.${key} = true; return await workspace.echo({ value: 42 })`,
      bindings: [{ global: 'workspace', functions: { echo: async (args) => args as CodeJsonValue } }],
    })
    expect(result).toEqual({ logs: [], value: { value: 42 } })
    expect(Object.hasOwn(globalThis, key)).toBe(false)
  })

  it('preserves TypeScript, top-level await and return, logs, and parallel bindings', async () => {
    const calls: number[] = []
    const result = await ctx.codeRuntime.run({
      program: `
        interface Value { n: number }
        const values: Value[] = await Promise.all([1, 2, 3].map(n => workspace.echo({ n })))
        console.log('done', values.length)
        return { values }
      `,
      bindings: [{ global: 'workspace', functions: {
        echo: async (args) => {
          const { n } = args as { n: number }
          calls.push(n)
          await new Promise(resolve => setTimeout(resolve, 10))
          return { n }
        },
      } }],
    })
    expect(result).toEqual({ logs: ['done 3'], value: { values: [{ n: 1 }, { n: 2 }, { n: 3 }] } })
    expect(calls).toEqual([1, 2, 3])
  })

  it.each([
    'return await workspace.echo<number>(42)',
    'return await workspace.echo < Array<number> > ([42])',
    'return [...new Map<string, number>([["score", 42]])]',
  ])('preserves generic expressions that resemble JavaScript comparisons: %s', async (program) => {
    const result = await ctx.codeRuntime.run({
      program,
      bindings: [{ global: 'workspace', functions: { echo: async (args) => args as CodeJsonValue } }],
    })
    expect(result.error).toBeUndefined()
    expect(result.value).toEqual(program.includes('Map') ? [['score', 42]] : program.includes('Array') ? [42] : 42)
  })

  it.each([
    'const value: = ;',
    'return 1; } console.log("outside"); export async function other() {',
    'throw new Error("program failed")',
  ])('reports invalid or throwing programs: %s', async (program) => {
    const result = await ctx.codeRuntime.run({ program, bindings: [] })
    expect(result.error).toMatchObject({ kind: 'exception', message: expect.any(String) })
    expect(result.value).toBeUndefined()
  })

  it('retains the Worker timeout and remains usable afterwards', async () => {
    const result = await ctx.codeRuntime.run({ program: 'while (true) {}', bindings: [] })
    expect(result.error).toMatchObject({ kind: 'timeout' })
    expect(await ctx.codeRuntime.run({ program: 'return 42', bindings: [] })).toEqual({ logs: [], value: 42 })
  })

  it('retains cancellation while a program is waiting', async () => {
    const controller = new AbortController()
    const result = await ctx.codeRuntime.run({
      program: 'await workspace.started({}); await new Promise(() => {})',
      signal: controller.signal,
      bindings: [{ global: 'workspace', functions: { started: async () => { controller.abort('cancelled'); return null } } }],
    })
    expect(result.error, JSON.stringify(result)).toMatchObject({ kind: 'abort' })
  })

  it('retains the output limit', async () => {
    const result = await ctx.codeRuntime.run({ program: 'console.log("x".repeat(32768))', bindings: [] })
    expect(result.error).toMatchObject({ kind: 'output-limit' })
  })
})
