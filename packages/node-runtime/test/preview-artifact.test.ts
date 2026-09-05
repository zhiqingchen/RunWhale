import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MetroBundle } from '../src/metro-runtime.js'
import {
  previewArtifactPath,
  readPreviewArtifact,
  writePreviewArtifact,
  type PreviewArtifactKey,
} from '../src/preview-artifact.js'

const projects: string[] = []
afterEach(async () => { await Promise.all(projects.splice(0).map((project) => rm(project, { recursive: true, force: true }))) })

describe('Preview artifacts', () => {
  it('restores the exact successful bundle after project source changes', async () => {
    const project = await temporaryProject()
    const key: PreviewArtifactKey = { projectId: 'cached-project', platform: 'ios', runtimeAbi: 'ios-runtime-v1' }
    const bundle = previewBundle('ios', 'globalThis.message = "鲸鱼 🐋"\n')
    await writePreviewArtifact(project, key, bundle, 7)

    await writeFile(join(project, 'app.tsx'), 'throw new Error("new unbundled source")\n')
    const restored = await readPreviewArtifact(project, key)

    expect(restored).toMatchObject({ platform: 'ios', revision: 7, code: bundle.code, map: bundle.map, requestPath: bundle.requestPath })
    expect(Buffer.from(restored!.codeBytes)).toEqual(Buffer.from(bundle.code))
    expect(Buffer.from(restored!.mapBytes)).toEqual(Buffer.from(bundle.map))
  })

  it('keeps platform artifacts separate and rejects a different runtime ABI', async () => {
    const project = await temporaryProject()
    const iosKey: PreviewArtifactKey = { projectId: 'cached-project', platform: 'ios', runtimeAbi: 'runtime-v1' }
    const webKey: PreviewArtifactKey = { projectId: 'cached-project', platform: 'web', runtimeAbi: 'runtime-v1' }
    await writePreviewArtifact(project, iosKey, previewBundle('ios', 'globalThis.platform = "ios"\n'), 1)
    await writePreviewArtifact(project, webKey, previewBundle('web', 'globalThis.platform = "web"\n'), 2)

    await expect(readPreviewArtifact(project, iosKey)).resolves.toMatchObject({ code: expect.stringContaining('ios') })
    await expect(readPreviewArtifact(project, webKey)).resolves.toMatchObject({ code: expect.stringContaining('web') })
    await expect(readPreviewArtifact(project, { ...iosKey, runtimeAbi: 'runtime-v2' })).resolves.toBeUndefined()
  })

  it('treats corrupted or linked cache files as misses without replacing the last valid artifact', async () => {
    const project = await temporaryProject()
    const key: PreviewArtifactKey = { projectId: 'cached-project', platform: 'android', runtimeAbi: 'runtime-v1' }
    const original = previewBundle('android', 'globalThis.release = 1\n')
    await writePreviewArtifact(project, key, original, 1)

    await expect(writePreviewArtifact(project, key, { ...original, platform: 'ios' }, 2)).rejects.toThrow(/platform/)
    await expect(readPreviewArtifact(project, key)).resolves.toMatchObject({ code: original.code })

    const path = previewArtifactPath(project, 'android')
    await writeFile(path, '{"schemaVersion":1,"code":"truncated"}')
    await expect(readPreviewArtifact(project, key)).resolves.toBeUndefined()

    await rm(path)
    const outside = join(project, 'outside.json')
    await writeFile(outside, '{}')
    await symlink(outside, path)
    await expect(readPreviewArtifact(project, key)).resolves.toBeUndefined()
  })
})

async function temporaryProject(): Promise<string> {
  const project = await mkdtemp(join(tmpdir(), 'runwhale-preview-artifact-'))
  projects.push(project)
  return project
}

function previewBundle(platform: 'android' | 'ios' | 'web', code: string): MetroBundle {
  return {
    platform,
    code,
    map: JSON.stringify({ version: 3, sources: ['app.tsx'], mappings: 'AAAA' }),
    durationMs: 47,
    requestPath: `/.runwhale/metro-${platform}-entry.bundle`,
  }
}
