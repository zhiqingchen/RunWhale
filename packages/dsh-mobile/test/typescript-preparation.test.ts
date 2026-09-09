import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createMobileHarness } from '../src/index.js'

describe('TypeScript tool preparation', () => {
  it.each(['typescript_diagnostics', 'typescript_program'])('prepares libraries before %s without WebAssembly or Preview', async (name) => {
    const cache = resolve(import.meta.dirname, '../../../.cache')
    await mkdir(cache, { recursive: true })
    const root = await mkdtemp(join(cache, 'typescript-preparation-'))
    const moduleStore = join(root, 'modules')
    const projectRoot = join(root, 'project')
    await mkdir(projectRoot)
    await writeFile(join(projectRoot, 'index.ts'), 'const score: string = 42; export { score }\n')
    const ensureModuleStore = vi.fn(async () => {
      await mkdir(join(moduleStore, 'typescript'), { recursive: true })
      await symlink(dirname(ts.getDefaultLibFilePath({})), join(moduleStore, 'typescript/lib'), 'dir')
    })
    const harness = await createMobileHarness({
      mode: 'deterministic',
      secrets: { async get() { return undefined }, async set() {}, async delete() {} },
      workspaceServices: { moduleStore, ensureModuleStore, typescriptWorkerUrl: new URL('../../mobile-runtime/src/task-worker.ts', import.meta.url), permissionModeFor: () => 'danger-full-access' },
    })
    try {
      vi.stubGlobal('WebAssembly', undefined)
      await harness.run({ sessionId: 'typescript-preparation', prompt: 'Inspect', projectRoot })
      expect(ensureModuleStore).not.toHaveBeenCalled()
      const agent = harness.context.agents.get(SessionId('typescript-preparation'))!
      const result = await harness.context.tools.execute({
        agent, signal: new AbortController().signal, callId: ToolCallId(name), name,
        arguments: name === 'typescript_diagnostics'
          ? { path: 'index.ts' }
          : { program: 'console.log(await workspace.typescriptDiagnostics({ path: "index.ts" }))' },
      })
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true)
      expect(JSON.stringify(result.content)).toContain('2322')
      expect(JSON.stringify(result.content)).not.toContain('shared standard library is missing')
      expect(ensureModuleStore).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
      await harness.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each(['typescript_diagnostics', 'typescript_program'])('checks multiple files through %s and rejects invalid batches', async (name) => {
    const cache = resolve(import.meta.dirname, '../../../.cache')
    await mkdir(cache, { recursive: true })
    const root = await mkdtemp(join(cache, 'typescript-batch-'))
    const paths = ['one.ts', 'two.ts']
    await Promise.all(paths.map((path) => writeFile(join(root, path), 'export const value: string = 42')))
    const harness = await createMobileHarness({
      mode: 'deterministic',
      secrets: { async get() { return undefined }, async set() {}, async delete() {} },
      workspaceServices: { typescriptWorkerUrl: new URL('../../mobile-runtime/src/task-worker.ts', import.meta.url), permissionModeFor: () => 'danger-full-access' },
    })
    try {
      await harness.run({ sessionId: 'typescript-batch', prompt: 'Inspect', projectRoot: root })
      const agent = harness.context.agents.get(SessionId('typescript-batch'))!
      const execute = (args: Record<string, unknown>) => harness.context.tools.execute({
        agent, signal: new AbortController().signal, callId: ToolCallId('batch'), name,
        arguments: name === 'typescript_diagnostics' ? args : { program: `return await workspace.typescriptDiagnostics(${JSON.stringify(args)})` },
      })
      const result = await execute({ paths })
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true)
      const output = JSON.stringify(result.content)
      expect(output).toContain('one.ts')
      expect(output).toContain('two.ts')
      expect(output.match(/2322/g)).toHaveLength(2)
      for (const args of [{}, { path: 'one.ts', paths }, { paths: [] }, { paths: ['one.ts', 'one.ts'] }, { paths: Array.from({ length: 9 }, (_, i) => `${i}.ts`) }]) {
        const rejected = await execute(args)
        // Nested programs report binding failures in their structured result.
        expect(JSON.stringify(rejected.content)).toMatch(/error|Error/)
      }
    } finally {
      await harness.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('stops pending diagnostics when a program returns without awaiting them', async () => {
    const cache = resolve(import.meta.dirname, '../../../.cache')
    await mkdir(cache, { recursive: true })
    const root = await mkdtemp(join(cache, 'typescript-program-lifecycle-'))
    await writeFile(join(root, 'one.ts'), 'export {}')
    const busyWorker = new URL(`data:text/javascript,${encodeURIComponent("import { writeFileSync } from 'node:fs'; import { join } from 'node:path'; import { workerData } from 'node:worker_threads'; writeFileSync(join(workerData.root, 'ready'), 'ready'); while (true) {}")}`)
    const harness = await createMobileHarness({
      mode: 'deterministic',
      secrets: { async get() { return undefined }, async set() {}, async delete() {} },
      workspaceServices: { typescriptWorkerUrl: busyWorker, permissionModeFor: () => 'danger-full-access' },
    })
    const controller = new AbortController()
    const stopped: Worker[] = []
    const terminate = Worker.prototype.terminate
    const spy = vi.spyOn(Worker.prototype, 'terminate').mockImplementation(function (this: Worker) {
      if (this.resourceLimits?.maxOldGenerationSizeMb === 256) stopped.push(this)
      return terminate.call(this)
    })
    try {
      await harness.run({ sessionId: 'typescript-program-lifecycle', prompt: 'Inspect', projectRoot: root })
      const result = await harness.context.tools.execute({
        agent: harness.context.agents.get(SessionId('typescript-program-lifecycle'))!,
        signal: controller.signal, callId: ToolCallId('early-return'), name: 'typescript_program',
        arguments: { program: `
          void workspace.typescriptDiagnostics({ path: 'one.ts' }).catch(() => undefined);
          for (let i = 0; i < 1000; i++) {
            try { return await workspace.readFile({ path: 'ready' }); } catch {}
          }
          throw new Error('diagnostics worker did not start');
        ` },
      })
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true)
      expect(stopped).toHaveLength(1)
      expect(stopped[0]!.threadId).toBe(-1)
    } finally {
      controller.abort()
      await harness.dispose()
      spy.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)
})
