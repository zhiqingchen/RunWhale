import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMobileTypeScriptDiagnostics } from '../src/typescript-diagnostics.js'

const workerUrl = new URL('../src/task-worker.ts', import.meta.url)
let root: string

beforeEach(async () => {
  const cache = resolve(import.meta.dirname, '../../../.cache')
  await mkdir(cache, { recursive: true })
  root = await mkdtemp(join(cache, 'typescript-diagnostics-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

describe('mobile TypeScript diagnostics worker', () => {
  it('checks a batch while the host stays responsive, and sees dependency/config changes on the next check', async () => {
    const files = [
      { path: 'one.ts', content: "import { score } from './score'; export const result: string = score; const unused = 1" },
      { path: 'two.ts', content: 'export const wrong: number = "two"' },
    ]
    await writeFile(join(root, 'score.ts'), 'export const score = 42')
    let ticks = 0
    const heartbeat = setInterval(() => { ticks++ }, 10)
    try {
      const diagnostics = await runMobileTypeScriptDiagnostics({ root, files }, new AbortController().signal, workerUrl)
      expect(ticks).toBeGreaterThan(0)
      expect(diagnostics.map(({ path, code }) => ({ path, code }))).toEqual([
        { path: 'one.ts', code: 2322 }, { path: 'two.ts', code: 2322 },
      ])
      await writeFile(join(root, 'score.ts'), 'export const score = "fixed"')
      await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noUnusedLocals: true }, files: ['one.ts', 'two.ts'] }))
      const updated = await runMobileTypeScriptDiagnostics({ root, files }, new AbortController().signal, workerUrl)
      expect(updated.map(({ path, code }) => ({ path, code }))).toEqual([
        { path: 'one.ts', code: 6133 }, { path: 'two.ts', code: 2322 },
      ])
    } finally { clearInterval(heartbeat) }
  }, 15_000)

  it.each(['cancel', 'timeout'] as const)('terminates a CPU-bound worker before reporting %s, then permits another check', async (reason) => {
    const controller = new AbortController()
    const busyWorker = new URL('data:text/javascript,while(true){}')
    const terminate = Worker.prototype.terminate
    let stoppedWorker: Worker | undefined
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    let stopping!: () => void
    const startedStopping = new Promise<void>(resolve => { stopping = resolve })
    vi.spyOn(Worker.prototype, 'terminate').mockImplementation(function (this: Worker) {
      stoppedWorker = this
      stopping()
      return held.then(() => terminate.call(this))
    })
    const result = runMobileTypeScriptDiagnostics({ root, files: [] }, controller.signal, busyWorker, reason === 'timeout' ? 50 : 10_000)
    const outcome = result.catch((error: Error) => error)
    if (reason === 'cancel') controller.abort()
    let settled = false
    void outcome.then(() => { settled = true })
    try {
      await startedStopping
      expect(settled).toBe(false)
      release()
      expect((await outcome as Error).message).toContain(reason === 'timeout' ? 'timed out' : 'cancelled')
      expect(stoppedWorker?.threadId).toBe(-1)
      const recovered = await runMobileTypeScriptDiagnostics({ root, files: [{ path: 'ok.ts', content: 'export const ok = 1' }] }, new AbortController().signal, workerUrl)
      expect(recovered).toEqual([])
    } finally {
      release()
      if (stoppedWorker) await terminate.call(stoppedWorker)
    }
  }, 15_000)

  it('reports configuration failure as an error instead of a successful empty check', async () => {
    await writeFile(join(root, 'tsconfig.json'), '{')
    await expect(runMobileTypeScriptDiagnostics({ root, files: [{ path: 'ok.ts', content: 'export {}' }] }, new AbortController().signal, workerUrl)).rejects.toThrow('TypeScript configuration')
  })
})
