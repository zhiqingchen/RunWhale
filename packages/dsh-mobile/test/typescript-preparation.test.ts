import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createMobileHarness } from '../src/index.js'

describe('TypeScript tool preparation', () => {
  it.each(['typescript_diagnostics', 'typescript_program'])('prepares libraries before %s without opening Preview', async (name) => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-typescript-preparation-'))
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
      workspaceServices: { moduleStore, ensureModuleStore, permissionModeFor: () => 'danger-full-access' },
    })
    try {
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
      await harness.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
