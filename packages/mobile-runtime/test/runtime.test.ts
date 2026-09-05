import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DependencyRejected,
  MobileProjectFileSystem,
  SandboxViolation,
  assertRegistryDependency,
  findSecretLeaks,
  parseRunWhaleManifest,
  redactSecrets,
  resolveProjectPreviewPlatform,
  validatePackageArchive,
} from '../src/index.js'

describe('runwhale manifest', () => {
  it('validates the runtime ABI', () => {
    expect(parseRunWhaleManifest({
      schemaVersion: 1,
      id: 'test-project',
      name: 'Test Project',
      runtimeAbi: { android: 'runwhale-expo57-android-v1', ios: 'runwhale-expo57-ios-v1' },
      entry: { web: 'expo-router/entry', ios: 'expo-router/entry', android: 'expo-router/entry' },
      capabilities: [],
      tasks: {},
      source: { kind: 'local' },
    }).id).toBe('test-project')
  })

  it('derives a single Preview target and requires project selection when both are present', () => {
    const base = {
      schemaVersion: 1 as const,
      id: 'test-project',
      name: 'Test Project',
      runtimeAbi: {},
      capabilities: [],
      tasks: {},
      source: { kind: 'local' as const },
    }
    const web = parseRunWhaleManifest({ ...base, entry: { web: 'src/main.tsx' } })
    expect(resolveProjectPreviewPlatform(web, 'android')).toBe('web')

    const native = parseRunWhaleManifest({ ...base, entry: { ios: 'index.ts', android: 'index.ts' } })
    expect(resolveProjectPreviewPlatform(native, 'ios')).toBe('ios')

    const selected = parseRunWhaleManifest({
      ...base,
      entry: { web: 'src/main.tsx', ios: 'index.ts', android: 'index.ts' },
      preview: { target: 'native' },
    })
    expect(resolveProjectPreviewPlatform(selected, 'android')).toBe('android')

    const ambiguous = parseRunWhaleManifest({ ...base, entry: { web: 'src/main.tsx', android: 'index.ts' } })
    expect(() => resolveProjectPreviewPlatform(ambiguous, 'android')).toThrow(/set preview\.target/)
  })

  it('rejects a Preview selection without its required entry', () => {
    expect(() => parseRunWhaleManifest({
      schemaVersion: 1,
      id: 'test-project',
      name: 'Test Project',
      runtimeAbi: {},
      entry: { android: 'index.ts' },
      preview: { target: 'web' },
      capabilities: [],
      tasks: {},
      source: { kind: 'local' },
    })).toThrow(/Web Preview requires entry\.web/)
  })

})

describe('mobile filesystem', () => {
  it('supports guarded atomic writes and rejects escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-fs-'))
    await writeFile(join(root, 'app.ts'), 'one')
    const fs = new MobileProjectFileSystem([root])
    const first = await fs.readText('app.ts')
    const written = await fs.writeText('app.ts', 'two', first.version)
    await fs.writeText('components/game/Ship.tsx', 'export default null')
    expect((await fs.readText('app.ts')).content).toBe('two')
    await expect(fs.writeText('app.ts', 'three', first.version)).rejects.toBeInstanceOf(SandboxViolation)
    expect(written.version).not.toBe(first.version)
    expect((await fs.readText('components/game/Ship.tsx')).content).toContain('export default')
    await expect(fs.readText('../outside')).rejects.toBeInstanceOf(SandboxViolation)
  })

  it('does not write through a symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-link-'))
    const outside = await mkdtemp(join(tmpdir(), 'runwhale-outside-'))
    await writeFile(join(outside, 'secret'), 'secret')
    await symlink(join(outside, 'secret'), join(root, 'link'))
    const fs = new MobileProjectFileSystem([root])
    await expect(fs.writeText('link', 'changed')).rejects.toBeInstanceOf(SandboxViolation)
  })
})

describe('dependency policy', () => {
  it('rejects git dependencies and native archives', () => {
    expect(() => assertRegistryDependency('x', 'git+https://example.test/x')).toThrow(DependencyRejected)
    expect(() => assertRegistryDependency('x', 'owner/repository')).toThrow(DependencyRejected)
    expect(() => assertRegistryDependency('x', 'workspace:*')).toThrow(DependencyRejected)
    expect(() => validatePackageArchive({}, [
      { path: 'package/binding.gyp', size: 10, type: 'file' },
    ])).toThrow(/native/)
  })

  it('rejects escaping archive symlinks', () => {
    expect(() => validatePackageArchive({}, [
      { path: 'package/link', size: 0, type: 'symlink', linkTarget: '../../outside' },
    ])).toThrow(/symlink/)
  })
})

describe('secrets', () => {
  it('redacts nested credentials and finds leaks', () => {
    const secret = `sk-${'x'.repeat(24)}`
    expect(redactSecrets({ apiKey: secret, nested: `Bearer ${'y'.repeat(20)}` })).toEqual({
      apiKey: '[REDACTED]',
      nested: '[REDACTED]',
    })
    expect(findSecretLeaks(`value=${secret}`)).toEqual([secret])
  })
})
