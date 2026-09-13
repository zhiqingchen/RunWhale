import { describe, expect, it, vi } from 'vitest'
import { NativeProjectStore, type NativeProjectFiles } from '../src/state/native-project-store'
import { nativeProjectStorage } from '../src/state/native-project-storage'
import { type StudioProject, type ProjectSnapshotStorage } from '../src/state/project-data'

const project = (id = 'project-1', files = [{ path: 'index.ts', content: 'legacy' }]): StudioProject => ({ id, name: id, description: '', updatedAt: 1, files })
function fixture(initial: Record<string, Record<string, string>> = { 'project-1': { 'index.ts': 'runtime' } }) {
  let saved: string | null = null
  const files = new Map(Object.entries(initial).map(([id, entries]) => [id, new Map(Object.entries(entries))]))
  const storage = { read: vi.fn(async () => saved), write: vi.fn(async (value: string) => { saved = value }) }
  const runtime: NativeProjectFiles = {
    listProjects: vi.fn(async () => [...files.keys()].map((id) => ({ id, name: id, updatedAt: 1 }))),
    createProject: vi.fn(async (id) => { if (files.has(id)) throw new Error('already exists'); files.set(id, new Map()) }),
    listFiles: vi.fn(async (id) => [...files.get(id)!.keys()]),
    readFile: vi.fn(async (id, path) => {
      const content = files.get(id)!.get(path)
      if (content === undefined) throw new Error('not found')
      return { content, version: content }
    }),
    writeFile: vi.fn(async (id, path, content, version) => {
      if (version !== undefined && files.get(id)!.get(path) !== version) throw Object.assign(new Error('file changed'), { code: 'CONFLICT' })
      files.get(id)!.set(path, content)
      return { version: content }
    }),
  }
  return { storage, runtime, files, store: new NativeProjectStore(storage, runtime), saved: () => JSON.parse(saved!) as { projects: unknown[]; drafts?: unknown[] } }
}

describe('native project ownership', () => {
  it('synchronizes agent manifest renames on file and terminal refreshes and repairs stale titles on restart', async () => {
    const f = fixture({ 'project-1': { 'runwhale.json': JSON.stringify({ name: 'Original' }) } })
    await f.store.load(async () => null)
    expect(f.store.projects[0]?.name).toBe('Original')
    f.files.get('project-1')!.set('runwhale.json', JSON.stringify({ name: 'Star Pop' }))
    await f.store.refresh('project-1', 'runwhale.json')
    expect(f.store.projects[0]?.name).toBe('Star Pop')
    expect(f.saved().projects).toEqual([expect.objectContaining({ name: 'Star Pop' })])
    f.files.get('project-1')!.set('runwhale.json', JSON.stringify({ name: 'Final name' }))
    await f.store.refresh('project-1')
    expect(f.store.projects[0]?.name).toBe('Final name')
    await f.store.rename('project-1', 'Stale cached title')
    const restarted = new NativeProjectStore(f.storage, f.runtime)
    await restarted.load(async () => null)
    expect(restarted.projects[0]?.name).toBe('Final name')
  })

  it('keeps the last valid manifest title when the runtime file becomes invalid', async () => {
    const f = fixture({ 'project-1': { 'runwhale.json': JSON.stringify({ name: 'Original' }) } })
    await f.store.load(async () => null)
    for (const content of ['{', 'null', '{}', '{"name":42}', '{"name":" "}']) {
      f.files.get('project-1')!.set('runwhale.json', content)
      await f.store.refresh('project-1', 'runwhale.json')
      expect(f.store.projects[0]?.name).toBe('Original')
    }
  })

  it('refreshes workspace icon versions without persisting container image URLs', async () => {
    const f = fixture()
    const icon = { path: 'assets/icon.png', uri: 'file:///container/assets/icon.png', version: 'first' }
    f.runtime.readProjectIcon = vi.fn(async () => ({ icon: { ...icon } }))
    await f.store.load(async () => null)
    expect(f.store.projects[0]?.icon).toEqual(icon)
    expect(JSON.stringify(f.saved())).not.toContain('file:///container')
    icon.version = 'second'
    await f.store.refresh('project-1', 'assets/icon.png')
    expect(f.store.projects[0]?.icon?.version).toBe('second')
    f.runtime.readProjectIcon = async () => ({})
    await f.store.refresh('project-1')
    expect(f.store.projects[0]?.icon).toBeUndefined()
  })

  it('drops stale shortcuts after restart and reload while retaining existing metadata and discovering runtime projects', async () => {
    const f = fixture({ 'project-1': { 'index.ts': 'runtime' }, 'removed': {} })
    await f.store.load(async () => null)
    await f.store.rename('project-1', 'My project')
    f.files.delete('removed')
    f.files.set('new-project', new Map([['new.ts', 'new']]))
    vi.mocked(f.runtime.listFiles).mockClear()
    const restarted = new NativeProjectStore(f.storage, f.runtime)
    await restarted.load(async () => { throw new Error('legacy must not be restored again') })
    expect(restarted.projects.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'project-1', name: 'My project' }, { id: 'new-project', name: 'new-project' },
    ])
    expect(f.runtime.listFiles).not.toHaveBeenCalledWith('removed')
    expect(f.saved().projects).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'removed' })]))
    f.files.clear()
    await restarted.load(async () => null)
    expect(restarted.projects).toEqual([])
    expect(f.saved().projects).toEqual([])
    expect(f.runtime.createProject).not.toHaveBeenCalled()
  })

  it('does not treat runtime failure as an empty project list', async () => {
    const f = fixture()
    await f.store.load(async () => null)
    const before = f.saved()
    vi.mocked(f.runtime.listProjects).mockRejectedValueOnce(new Error('runtime unavailable'))
    await expect(f.store.load(async () => null)).rejects.toThrow('runtime unavailable')
    expect(f.saved()).toEqual(before)
  })

  it('keeps runtime contents active when a legacy snapshot differs', async () => {
    const f = fixture()
    const legacy = JSON.stringify([project('project-1', [{ path: 'index.ts', content: 'legacy' }, { path: 'local.ts', content: 'local only' }])])
    await f.store.load(async () => legacy)
    expect(f.files.get('project-1')?.get('index.ts')).toBe('runtime')
    expect(f.files.get('project-1')?.has('local.ts')).toBe(false)
    expect(f.saved().projects).toEqual([{ id: 'project-1', name: 'project-1', description: '', updatedAt: 1 }])
    await expect(f.store.loadFile('project-1', 'index.ts')).resolves.toEqual({ path: 'index.ts', content: 'runtime' })
  })

  it('restarts an interrupted local-only restoration without duplicating or overwriting runtime work', async () => {
    const f = fixture({})
    const legacy = JSON.stringify([project('legacy-only', [{ path: 'first.ts', content: 'first' }, { path: 'last.ts', content: 'last' }])])
    const write = f.runtime.writeFile
    f.runtime.writeFile = vi.fn(async (...args: Parameters<NativeProjectFiles['writeFile']>) => { if (args[1] === 'last.ts') throw new Error('interrupted'); return write(...args) })
    await expect(f.store.load(async () => legacy)).rejects.toThrow('interrupted')
    f.files.get('legacy-only')!.set('first.ts', 'runtime edit')
    f.runtime.writeFile = write
    const restarted = new NativeProjectStore(f.storage, f.runtime)
    await restarted.load(async () => legacy)
    expect(f.runtime.createProject).toHaveBeenCalledTimes(1)
    expect(f.files.get('legacy-only')?.get('last.ts')).toBe('last')
    expect(f.files.get('legacy-only')?.get('first.ts')).toBe('runtime edit')
  })

  it('replaces only the scaffold created while restoring a legacy-only project', async () => {
    const f = fixture({})
    f.runtime.createProject = async (id) => { f.files.set(id, new Map([['index.ts', 'generated scaffold']])) }
    await f.store.load(async () => JSON.stringify([project('legacy-only')]))
    expect(f.files.get('legacy-only')?.get('index.ts')).toBe('legacy')
    expect(f.runtime.writeFile).toHaveBeenCalledWith('legacy-only', 'index.ts', 'legacy', 'generated scaffold')
  })

  it('loads file contents only when opened, invalidates them after changes, and never persists clean contents', async () => {
    const f = fixture()
    await f.store.load(async () => null)
    expect(f.runtime.readFile).not.toHaveBeenCalled()
    expect(f.store.projects[0]?.filePaths).toEqual(['index.ts'])
    expect(f.store.projects[0]?.files).toEqual([])
    await f.store.loadFile('project-1', 'index.ts')
    await f.store.loadFile('project-1', 'index.ts')
    expect(f.runtime.readFile).toHaveBeenCalledTimes(1)
    f.files.get('project-1')!.set('index.ts', 'agent edit')
    await f.store.refresh('project-1')
    expect((await f.store.loadFile('project-1', 'index.ts')).content).toBe('agent edit')
    expect(JSON.stringify(f.saved())).not.toContain('agent edit')
  })

  it('ignores saved Studio drafts and shows the runtime file after upgrading', async () => {
    const f = fixture()
    await f.storage.write(JSON.stringify({
      version: 3, phase: 'ready', restoring: [], projects: [{ id: 'project-1', name: 'project-1', description: '', updatedAt: 1 }],
      drafts: [{ projectId: 'project-1', path: 'index.ts', content: 'old Studio draft', baseVersion: 'runtime', status: 'pending' }],
    }))
    await f.store.load(async () => null)
    expect(await f.store.loadFile('project-1', 'index.ts')).toEqual({ path: 'index.ts', content: 'runtime' })
    expect(f.runtime.writeFile).not.toHaveBeenCalled()
    expect(f.saved().drafts).toBeUndefined()
  })
})

describe('native metadata storage publication', () => {
  it('retains the previous verified generation if publishing a new snapshot is interrupted', async () => {
    const values = new Map<string, string>()
    const storage: ProjectSnapshotStorage = {
      getItem: async (key) => values.get(key) ?? null,
      multiGet: async (keys) => keys.map((key) => [key, values.get(key) ?? null]),
      multiSet: vi.fn(async (entries) => { for (const [key, value] of entries) values.set(key, value) }),
      multiRemove: async (keys) => { for (const key of keys) values.delete(key) },
      removeItem: async (key) => { values.delete(key) },
    }
    const snapshots = nativeProjectStorage(storage)
    await snapshots.write('previous')
    const original = storage.multiSet
    storage.multiSet = async (entries) => { if (entries.some(([key]) => key === 'runwhale.projects.v3')) throw new Error('interrupted'); await original(entries) }
    await expect(snapshots.write('new metadata'.repeat(50_000))).rejects.toThrow('interrupted')
    expect(await snapshots.read()).toBe('previous')
    storage.multiSet = original
    await snapshots.write('recovered')
    expect(await snapshots.read()).toBe('recovered')
  })
})
