import { afterEach, describe, expect, it, vi } from 'vitest'
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
  return { storage, runtime, files, store: new NativeProjectStore(storage, runtime), saved: () => JSON.parse(saved!) as { projects: unknown[]; drafts: unknown[] } }
}
afterEach(() => vi.useRealTimers())

describe('native project ownership', () => {
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

  it('does not discard missing-project drafts or treat runtime failure as an empty project list', async () => {
    const f = fixture()
    await f.store.load(async () => JSON.stringify([project()]))
    const before = f.saved()
    vi.mocked(f.runtime.listProjects).mockRejectedValueOnce(new Error('runtime unavailable'))
    await expect(f.store.load(async () => null)).rejects.toThrow('runtime unavailable')
    expect(f.saved()).toEqual(before)
    f.files.clear()
    f.runtime.listFiles = vi.fn(async () => { throw new Error('project folder missing') })
    const restarted = new NativeProjectStore(f.storage, f.runtime)
    await expect(restarted.load(async () => null)).rejects.toThrow('project folder missing')
    expect(f.saved()).toEqual(before)
    expect(restarted.drafts).toMatchObject([{ projectId: 'project-1', content: 'legacy', status: 'recovered' }])
  })

  it('keeps runtime contents active and recovers differing and missing legacy files outside projects', async () => {
    const f = fixture()
    const legacy = JSON.stringify([project('project-1', [{ path: 'index.ts', content: 'legacy' }, { path: 'local.ts', content: 'local only' }])])
    await f.store.load(async () => legacy)
    expect(f.files.get('project-1')?.get('index.ts')).toBe('runtime')
    expect(f.files.get('project-1')?.has('local.ts')).toBe(false)
    expect(f.store.drafts.map((draft) => [draft.path, draft.status])).toEqual([['index.ts', 'recovered'], ['local.ts', 'recovered']])
    expect(f.saved().projects).toEqual([{ id: 'project-1', name: 'project-1', description: '', updatedAt: 1 }])
    await expect(f.store.flush('project-1')).resolves.toBeUndefined()
    await f.store.apply('project-1', 'local.ts')
    expect(f.files.get('project-1')?.get('local.ts')).toBe('local only')
    await f.store.discard('project-1', 'index.ts')
    await expect(f.store.loadFile('project-1', 'index.ts')).resolves.toEqual({ path: 'index.ts', content: 'runtime' })
    await expect(f.store.flush('project-1')).resolves.toBeUndefined()
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
    expect(restarted.drafts).toMatchObject([{ path: 'first.ts', content: 'first', status: 'recovered' }])
  })

  it('replaces only the scaffold created while restoring a legacy-only project', async () => {
    const f = fixture({})
    f.runtime.createProject = async (id) => { f.files.set(id, new Map([['index.ts', 'generated scaffold']])) }
    await f.store.load(async () => JSON.stringify([project('legacy-only')]))
    expect(f.files.get('legacy-only')?.get('index.ts')).toBe('legacy')
    expect(f.runtime.writeFile).toHaveBeenCalledWith('legacy-only', 'index.ts', 'legacy', 'generated scaffold')
    expect(f.store.drafts).toEqual([])
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

  it('serializes a debounced edit and a newer edit during its write before Agent and Preview proceed', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.store.load(async () => null)
    await f.store.loadFile('project-1', 'index.ts')
    const write = f.runtime.writeFile
    let release!: () => void
    let started!: () => void
    const admitted = new Promise<void>((resolve) => { started = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    f.runtime.writeFile = vi.fn(async (...args: Parameters<NativeProjectFiles['writeFile']>) => { if (args[2] === 'first') { started(); await gate }; return write(...args) })
    f.store.edit('project-1', 'index.ts', 'first')
    await vi.advanceTimersByTimeAsync(299)
    expect(f.runtime.writeFile).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await admitted
    f.store.edit('project-1', 'index.ts', 'second')
    let agentStarted = false
    const agent = f.store.flush('project-1').then(() => { agentStarted = true; f.files.get('project-1')!.set('index.ts', 'agent output') })
    expect(agentStarted).toBe(false)
    release()
    await agent
    await f.store.refresh('project-1')
    await f.store.flush('project-1')
    expect((await f.store.loadFile('project-1', 'index.ts')).content).toBe('agent output')
    expect(vi.mocked(f.runtime.writeFile).mock.calls.map((call) => call.slice(2))).toEqual([['first', 'runtime'], ['second', 'first']])
    expect(f.store.drafts).toEqual([])
  })

  it('retains failed saves across restart without blocking runs using saved files', async () => {
    const f = fixture()
    await f.store.load(async () => null)
    await f.store.loadFile('project-1', 'index.ts')
    const write = f.runtime.writeFile
    f.runtime.writeFile = vi.fn(async () => { throw new Error('disk full') })
    f.store.edit('project-1', 'index.ts', 'unsaved')
    await expect(f.store.flush('project-1')).resolves.toBeUndefined()
    expect(f.files.get('project-1')?.get('index.ts')).toBe('runtime')
    const restarted = new NativeProjectStore(f.storage, f.runtime)
    await restarted.load(async () => { throw new Error('legacy must not be read after migration') })
    expect(restarted.drafts).toMatchObject([{ content: 'unsaved', status: 'failed' }])
    await expect(restarted.flush('project-1')).resolves.toBeUndefined()
    f.runtime.writeFile = write
    await restarted.retry()
    await restarted.flush('project-1')
    expect(f.files.get('project-1')?.get('index.ts')).toBe('unsaved')
  })

  it('keeps version conflicts as drafts until explicit apply or discard', async () => {
    const f = fixture()
    await f.store.load(async () => null)
    await f.store.loadFile('project-1', 'index.ts')
    f.store.edit('project-1', 'index.ts', 'studio edit')
    f.files.get('project-1')!.set('index.ts', 'external edit')
    await expect(f.store.flush('project-1')).resolves.toBeUndefined()
    expect(f.store.drafts[0]?.status).toBe('conflict')
    expect(f.files.get('project-1')?.get('index.ts')).toBe('external edit')
    await f.store.apply('project-1', 'index.ts')
    expect(f.files.get('project-1')?.get('index.ts')).toBe('studio edit')
    expect(f.store.drafts).toEqual([])
  })

  it('does not write runtime files if the durable draft checkpoint fails', async () => {
    const f = fixture()
    await f.store.load(async () => null)
    await f.store.loadFile('project-1', 'index.ts')
    f.storage.write.mockRejectedValue(new Error('storage unavailable'))
    f.store.edit('project-1', 'index.ts', 'keep me')
    await expect(f.store.flush('project-1')).resolves.toBeUndefined()
    expect(f.files.get('project-1')?.get('index.ts')).toBe('runtime')
    expect(f.runtime.writeFile).not.toHaveBeenCalled()
    expect(f.store.drafts[0]?.content).toBe('keep me')
  })
})

describe('native draft storage publication', () => {
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
    await expect(snapshots.write('new draft'.repeat(50_000))).rejects.toThrow('interrupted')
    expect(await snapshots.read()).toBe('previous')
    storage.multiSet = original
    await snapshots.write('recovered')
    expect(await snapshots.read()).toBe('recovered')
  })
})
