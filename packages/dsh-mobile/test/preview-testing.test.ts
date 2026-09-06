import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createMobileHarness } from '../src/index.js'
import type { PreviewTestCommand, PreviewTestObservation } from '@runwhale/mobile-protocol'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

describe('Agent Preview testing tools', () => {
  it('renders screenshot attachments as image blocks and blocks actions in read-only sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-preview-tools-'))
    // SOF metadata fixture: attachment validation records JPEG dimensions.
    const jpeg = Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 217])
    const testPreview = vi.fn(async (_root: string, command: PreviewTestCommand): Promise<PreviewTestObservation> => ({
      projectId: 'test-project', revision: 3, platform: 'ios', timestamp: 1,
      ...(command.kind === 'close' ? { closed: true } : { image: { mediaType: 'image/jpeg', base64: jpeg.toString('base64'), width: 1, height: 1 } }),
    }))
    const harness = await createMobileHarness({
      mode: 'deterministic', secrets: { async get() { return undefined }, async set() {}, async delete() {} },
      attachmentRoot: join(root, 'attachments'), workspaceServices: { permissionModeFor: () => 'read-only', testPreview },
    })
    cleanups.push(async () => { await harness.dispose(); await rm(root, { recursive: true, force: true }) })
    await harness.run({ sessionId: 'preview-test', prompt: 'Inspect', projectRoot: root })
    const agent = harness.context.agents.get(SessionId('preview-test'))!
    const invoke = (name: string, args: Record<string, string> = {}) => harness.context.tools.execute({ agent, signal: new AbortController().signal, callId: ToolCallId(name), name, arguments: args })
    const image = await invoke('preview_screenshot')
    expect(JSON.stringify(image)).toContain('"type":"image"')
    expect(JSON.stringify(image)).toContain('sha256-')
    expect(JSON.stringify(image)).not.toContain(jpeg.toString('base64'))
    expect(JSON.stringify(await invoke('preview_close'))).toContain('"closed":true')
    const action = await invoke('preview_action', { snapshotId: 'test-snapshot', nodeId: 'n1', action: 'press' })
    expect(JSON.stringify(action)).toContain('read-only')
    expect(testPreview).toHaveBeenCalledTimes(2)
  })
})
