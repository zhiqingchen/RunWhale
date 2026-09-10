import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileTaskRunner, type TaskRunRequest } from '../src/task-runner.js'

let root: string
let runner: MobileTaskRunner
const workers: Worker[] = []

beforeEach(async () => {
  const cache = resolve(import.meta.dirname, '../../../.cache')
  await mkdir(cache, { recursive: true })
  root = await mkdtemp(join(cache, 'task-runner-'))
  runner = new MobileTaskRunner(new URL('../src/task-worker.ts', import.meta.url))
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(workers.splice(0).map(worker => worker.terminate()))
  await rm(root, { recursive: true, force: true })
})

async function start(entry: string, options: Partial<TaskRunRequest> = {}) {
  const task = await runner.start({ root, entry, ...options })
  // Observe the real Worker exit, including when a regression releases its record early.
  const active = (runner as unknown as { workers: Map<string, { worker: Worker }> }).workers.get(task.id)!
  workers.push(active.worker)
  return { ...task, worker: active.worker }
}

describe('mobile task runner', () => {
  it('transpiles a TypeScript module graph inside the bounded worker', async () => {
    await mkdir(join(root, 'scripts'))
    await writeFile(join(root, 'scripts/helper.ts'), 'export const answer: number = 42\n')
    await writeFile(join(root, 'scripts/check.ts'), "import { answer } from './helper.ts'\nconsole.log({ answer })\n")
    const result = await (await start('scripts/check.ts')).result
    expect(result).toMatchObject({ exitCode: 0 })
    expect(result.output).toContain('answer: 42')
  })

  it('contains worker memory exhaustion and remains usable afterwards', async () => {
    await mkdir(join(root, 'scripts'))
    await writeFile(join(root, 'scripts/exhaust.ts'), 'const values: unknown[] = []; while (true) values.push(new Array(1_000_000).fill(Math.random()))\n')
    await writeFile(join(root, 'scripts/recover.ts'), 'console.log("worker-recovered")\n')
    const exhausted = await (await start('scripts/exhaust.ts', { timeoutMs: 15_000 })).result
    expect(exhausted.exitCode).not.toBe(0)
    expect(exhausted.error).toBeTruthy()
    const recovered = await (await start('scripts/recover.ts')).result
    expect(recovered).toMatchObject({ exitCode: 0 })
    expect(recovered.output).toContain('worker-recovered')
  }, 30_000)

  it('reports project-scoped running work until cancellation settles', async () => {
    await writeFile(join(root, 'hold.ts'), 'setInterval(() => undefined, 1_000)\n')
    const task = await start('hold.ts')

    expect(runner.hasRunningTaskForRoot(root)).toBe(true)
    expect(runner.hasRunningTaskForRoot(join(root, 'sibling'))).toBe(false)
    await expect(runner.cancel(task.id)).resolves.toBe(true)
    await expect(task.result).resolves.toMatchObject({ exitCode: 130 })
    expect(runner.hasRunningTaskForRoot(root)).toBe(false)
  })

  it('waits for delayed writes and output before completing', async () => {
    await writeFile(join(root, 'late.ts'), `
      import { writeFile } from 'node:fs/promises'
      setTimeout(async () => {
        await writeFile(new URL('./late.txt', import.meta.url), 'finished')
        console.log('late output')
      }, 100)
    `)
    const task = await start('late.ts')
    const result = await task.result
    expect(task.worker.threadId).toBe(-1)
    expect(result).toMatchObject({ exitCode: 0, output: 'late output\n' })
    expect(await readFile(join(root, 'late.txt'), 'utf8')).toBe('finished')
    expect(runner.hasRunningTaskForRoot(root)).toBe(false)
  })

  it('keeps cancellation available after module evaluation', async () => {
    await writeFile(join(root, 'late.ts'), `
      import { writeFileSync } from 'node:fs'
      setTimeout(() => console.log('ready'), 25)
      setTimeout(() => writeFileSync(new URL('./late.txt', import.meta.url), 'too late'), 1500)
    `)
    const ready = once(runner, 'output')
    const task = await start('late.ts')
    await ready
    expect(runner.hasRunningTaskForRoot(root)).toBe(true)
    expect(await runner.cancel(task.id)).toBe(true)
    expect(await task.result).toMatchObject({ exitCode: 130, error: 'task cancelled' })
    expect(task.worker.threadId).toBe(-1)
    await expect(readFile(join(root, 'late.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['timeout', 'output limit'] as const)('holds project ownership until %s termination exits', async (reason) => {
    await writeFile(join(root, 'late.ts'), `
      import { writeFileSync } from 'node:fs'
      setTimeout(() => console.log('ready'), 25)
      setTimeout(() => writeFileSync(new URL('./late.txt', import.meta.url), 'too late'), 3000)
    `)
    let markTerminating!: () => void
    let release!: () => void
    const terminating = new Promise<void>(resolve => { markTerminating = resolve })
    const released = new Promise<void>(resolve => { release = resolve })
    const terminate = Worker.prototype.terminate
    vi.spyOn(Worker.prototype, 'terminate').mockImplementation(function (this: Worker) {
      markTerminating()
      return released.then(() => terminate.call(this))
    })
    const states: string[] = []
    runner.on('state', (_, state) => states.push(state))
    // Control the runner deadline independently of real Worker startup and output.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const ready = reason === 'timeout' ? once(runner, 'output') : undefined
    const task = await start('late.ts', { timeoutMs: 1000, maxOutputBytes: reason === 'output limit' ? 1 : 1024 })
    let settled = false
    void task.result.then(() => { settled = true })
    try {
      if (ready) {
        await ready
        await vi.advanceTimersByTimeAsync(1000)
      }
      await Promise.race([terminating, task.result.then(() => { throw new Error('task settled before termination') })])
      expect(settled).toBe(false)
      expect(runner.hasRunningTaskForRoot(root)).toBe(true)
      const cancellation = runner.cancel(task.id)
      release()
      expect(await cancellation).toBe(true)
      expect(await task.result).toMatchObject({
        exitCode: reason === 'timeout' ? 124 : 1,
        error: reason === 'timeout' ? 'task timed out after 1000ms' : 'task output exceeded 1 bytes',
      })
      expect(task.worker.threadId).toBe(-1)
      expect(runner.hasRunningTaskForRoot(root)).toBe(false)
      expect(states).toEqual(['running', 'failed'])
      await expect(readFile(join(root, 'late.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      release()
      await terminate.call(task.worker)
    }
  })

  it.each([
    'throw new Error("task failure")',
    'throw "Error: task failure"',
    'setTimeout(() => { throw new Error("task failure") }, 25)',
  ])('preserves Worker failures: %s', async (source) => {
    await writeFile(join(root, 'fail.ts'), source)
    const task = await start('fail.ts')
    expect(await task.result).toMatchObject({ exitCode: 1, error: 'Error: task failure' })
    expect(task.worker.threadId).toBe(-1)
  })

  it('uses the actual Worker exit code', async () => {
    await writeFile(join(root, 'exit.ts'), 'process.exitCode = 7')
    const task = await start('exit.ts')
    expect(await task.result).toMatchObject({ exitCode: 7 })
    expect(task.worker.threadId).toBe(-1)
  })
})
