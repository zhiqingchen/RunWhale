import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MobileTaskRunner } from '../src/task-runner.js'

describe('mobile task runner', () => {
  it('transpiles a TypeScript module graph inside the bounded worker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-typescript-task-'))
    await mkdir(join(root, 'scripts'))
    await writeFile(join(root, 'scripts/helper.ts'), 'export const answer: number = 42\n')
    await writeFile(join(root, 'scripts/check.ts'), "import { answer } from './helper.ts'\nconsole.log({ answer })\n")
    const runner = new MobileTaskRunner(new URL('../src/task-worker.ts', import.meta.url))
    const result = await runner.run({ root, entry: 'scripts/check.ts' })
    expect(result).toMatchObject({ exitCode: 0 })
    expect(result.output).toContain('answer: 42')
  })

  it('contains worker memory exhaustion and remains usable afterwards', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-memory-task-'))
    await mkdir(join(root, 'scripts'))
    await writeFile(join(root, 'scripts/exhaust.ts'), 'const values: unknown[] = []; while (true) values.push(new Array(1_000_000).fill(Math.random()))\n')
    await writeFile(join(root, 'scripts/recover.ts'), 'console.log("worker-recovered")\n')
    const runner = new MobileTaskRunner(new URL('../src/task-worker.ts', import.meta.url))
    const exhausted = await runner.run({ root, entry: 'scripts/exhaust.ts', timeoutMs: 15_000 })
    expect(exhausted.exitCode).not.toBe(0)
    expect(exhausted.error).toBeTruthy()
    const recovered = await runner.run({ root, entry: 'scripts/recover.ts' })
    expect(recovered).toMatchObject({ exitCode: 0 })
    expect(recovered.output).toContain('worker-recovered')
  }, 30_000)

  it('reports project-scoped running work until cancellation settles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-running-task-'))
    await writeFile(join(root, 'hold.ts'), 'setInterval(() => undefined, 1_000)\n')
    const runner = new MobileTaskRunner(new URL('../src/task-worker.ts', import.meta.url))
    const task = await runner.start({ root, entry: 'hold.ts' })

    expect(runner.hasRunningTaskForRoot(root)).toBe(true)
    expect(runner.hasRunningTaskForRoot(join(root, 'sibling'))).toBe(false)
    await expect(runner.cancel(task.id)).resolves.toBe(true)
    await expect(task.result).resolves.toMatchObject({ exitCode: 130 })
    expect(runner.hasRunningTaskForRoot(root)).toBe(false)
  })
})
