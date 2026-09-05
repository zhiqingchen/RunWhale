import { describe, expect, it, vi } from 'vitest'
import { createChunkedProjectSnapshotStorage, createProjectDraft, createProjectLoader, createProjectPersistenceCoordinator, deserializeProjects, isGitHubImportedProject, loadProjectsWithRuntimeRecovery, PROJECT_STORAGE_CHUNK_LENGTH, recoverProjectsFromRuntime, removeProjectFromList, runtimeProjectFileContent, type ProjectPersistenceFailure, type ProjectSnapshotStorage } from '../src/state/project-data'

describe('project persistence', () => {
  it('stores large snapshots in bounded rows without splitting surrogate pairs', async () => {
    const { storage, values } = memoryProjectStorage()
    const snapshots = createChunkedProjectSnapshotStorage(storage)
    const snapshot = `${'x'.repeat(PROJECT_STORAGE_CHUNK_LENGTH - 1)}😀${'y'.repeat(PROJECT_STORAGE_CHUNK_LENGTH)}`

    await snapshots.write(snapshot)

    const chunks = [...values.entries()].filter(([key]) => key.startsWith('runwhale.projects.v2:chunk:'))
    expect(chunks).toHaveLength(3)
    expect(chunks.every(([, chunk]) => chunk.length <= PROJECT_STORAGE_CHUNK_LENGTH)).toBe(true)
    expect(await snapshots.read()).toBe(snapshot)
  })

  it('migrates a readable legacy snapshot after the chunked write commits', async () => {
    const { storage, values } = memoryProjectStorage()
    const snapshots = createChunkedProjectSnapshotStorage(storage)
    const legacy = JSON.stringify([createProjectDraft('Legacy', 'web', 'legacy')])
    values.set('runwhale.projects.v1', legacy)

    await expect(snapshots.read()).resolves.toBe(legacy)
    await snapshots.write(legacy)

    expect(values.has('runwhale.projects.v1')).toBe(false)
    await expect(snapshots.read()).resolves.toBe(legacy)
  })

  it('recovers only CursorWindow overflow failures from the embedded runtime', async () => {
    const recovered = [createProjectDraft('Recovered', 'web', 'recovered')]
    const recover = vi.fn(async () => recovered)

    await expect(loadProjectsWithRuntimeRecovery(
      async () => { throw new Error('Row too big to fit into CursorWindow requiredPos=0, totalRows=1') },
      recover,
    )).resolves.toBe(recovered)
    await expect(loadProjectsWithRuntimeRecovery(
      async () => { throw new Error('storage unavailable') },
      recover,
    )).rejects.toThrow('storage unavailable')
    expect(recover).toHaveBeenCalledTimes(1)
  })

  it('marks an unreadable legacy row for crash-safe recovery before committing chunks', async () => {
    const { storage, values } = memoryProjectStorage()
    const snapshots = createChunkedProjectSnapshotStorage(storage)
    values.set('runwhale.projects.v1', 'unreadable oversized data')

    await snapshots.prepareLegacyRecovery()
    await expect(snapshots.read()).rejects.toThrow('requires runtime recovery')
    await snapshots.write(JSON.stringify([createProjectDraft('Recovered', 'web', 'recovered')]))

    expect(values.has('runwhale.projects.v1')).toBe(false)
    await expect(snapshots.read()).resolves.toContain('Recovered')
  })

  it('rebuilds unreadable project metadata and text files from runtime storage', async () => {
    const projects = await recoverProjectsFromRuntime({
      listProjects: async () => [{ id: 'native-project', name: 'Native project', updatedAt: 42 }],
      listFiles: async () => ['runwhale.json', 'index.tsx', 'image.png'],
      readFile: async (_projectId, path) => {
        if (path === 'image.png') throw new Error('binary files cannot be read as text')
        return { content: path === 'runwhale.json' ? JSON.stringify({ preview: { target: 'native' } }) : 'export default null\n' }
      },
    })

    expect(projects).toEqual([{
      id: 'native-project',
      name: 'Native project',
      description: '',
      updatedAt: 42,
      template: 'expo',
      files: [
        { path: 'runwhale.json', content: JSON.stringify({ preview: { target: 'native' } }) },
        { path: 'index.tsx', content: 'export default null\n' },
      ],
    }])
  })

  it('keeps an initial read failure distinct from a ready empty project list', async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(JSON.stringify([createProjectDraft('Recovered', 'web', 'recovered')]))
    const load = createProjectLoader(read)

    await expect(load()).rejects.toThrow('storage unavailable')
    await expect(load()).resolves.toEqual([expect.objectContaining({ id: 'recovered', name: 'Recovered' })])
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('synchronously shares one load and unlocks retry after invalid JSON', async () => {
    let resolveRead!: (value: string | null) => void
    const read = vi.fn(() => new Promise<string | null>((resolve) => { resolveRead = resolve }))
    const load = createProjectLoader(read)
    const first = load()

    expect(load()).toBe(first)
    expect(read).toHaveBeenCalledTimes(1)
    resolveRead('{invalid')
    await expect(first).rejects.toThrow()

    read.mockResolvedValueOnce(null)
    await expect(load()).resolves.toEqual([])
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('rejects non-list storage without normalizing it to an empty list', () => {
    expect(() => deserializeProjects(JSON.stringify({ projects: [] }))).toThrow('Saved project data is invalid.')
  })

  it('rejects incomplete or malformed project shapes before Workspace renders them', () => {
    const valid = createProjectDraft('Valid', 'web', 'valid')
    const malformed = [
      { id: 'x' },
      { ...valid, name: 7 },
      { ...valid, template: 'app' },
      { ...valid, files: [{ path: 'index.tsx', content: 7 }] },
      { ...valid, recentFiles: ['index.tsx', 7] },
    ]
    for (const project of malformed) {
      expect(() => deserializeProjects(JSON.stringify([project]))).toThrow('Saved project data is invalid.')
    }
    expect(() => deserializeProjects('[{"id":"x","name":"X","description":"","updatedAt":1e400,"files":[]}]')).toThrow('Saved project data is invalid.')
  })

  it('preserves legacy cleanup after validating stored projects', () => {
    const current = { ...createProjectDraft('Current', 'web', 'current'), lastTask: { title: 'legacy' } }
    const removed = createProjectDraft('Removed', 'web', 'vibe-game')
    const projects = deserializeProjects(JSON.stringify([current, removed]))

    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({ id: 'current', name: 'Current' })
    expect(projects[0]).not.toHaveProperty('lastTask')
  })

  it('persists template provenance while accepting projects created before it existed', () => {
    const current = createProjectDraft('Expo Project', 'expo', 'expo-project')
    const legacy = { ...createProjectDraft('Legacy', 'web', 'legacy'), template: undefined }

    expect(deserializeProjects(JSON.stringify([current, legacy]))).toEqual([
      expect.objectContaining({ id: 'expo-project', template: 'expo' }),
      expect.objectContaining({ id: 'legacy' }),
    ])
    expect(deserializeProjects(JSON.stringify([legacy]))[0]).not.toHaveProperty('template')
  })

  it('persists GitHub import provenance and recognizes legacy imported projects', () => {
    const source = { type: 'github' as const, owner: 'runwhale', repo: 'demo', commit: 'a'.repeat(40) }
    const imported = { ...createProjectDraft('Imported', 'expo', 'imported'), source }
    const [stored] = deserializeProjects(JSON.stringify([imported]))

    expect(stored?.source).toEqual(source)
    expect(isGitHubImportedProject(stored!)).toBe(true)
    expect(isGitHubImportedProject({ description: 'GitHub · runwhale/demo@aaaaaaa' })).toBe(true)
    expect(() => deserializeProjects(JSON.stringify([{ ...imported, source: { ...source, commit: 'short' } }]))).toThrow('Saved project data is invalid.')
  })

  it('keeps imported repository manifests byte-for-byte when preparing runtime files', () => {
    const manifest = '{"schemaVersion":1,"id":"upstream","name":"Upstream"}\n'
    const source = { type: 'github' as const, owner: 'runwhale', repo: 'demo', commit: 'a'.repeat(40) }
    const github = { name: 'Imported copy', description: '', source }
    const genericGit = { name: 'Imported copy', description: 'Git · https://example.com/demo.git' }

    expect(runtimeProjectFileContent(github, 'demo-2', { path: 'runwhale.json', content: manifest })).toBe(manifest)
    expect(runtimeProjectFileContent(genericGit, 'demo-2', { path: 'runwhale.json', content: manifest })).toBe(manifest)
    expect(runtimeProjectFileContent(github, 'demo-2', { path: 'README.md', content: '# Demo\n' })).toBe('# Demo\n')
  })

  it('still aligns locally created project manifests with runtime metadata', () => {
    const content = runtimeProjectFileContent(
      { name: 'Renamed locally', description: '' },
      'local-copy',
      { path: 'runwhale.json', content: '{"schemaVersion":1,"id":"old","name":"Old"}\n' },
    )

    expect(JSON.parse(content)).toMatchObject({ id: 'local-copy', name: 'Renamed locally' })
  })

  it('removes only the target project and remains idempotent', () => {
    const first = createProjectDraft('First', 'web', 'first')
    const target = createProjectDraft('Target', 'expo', 'target')
    const last = createProjectDraft('Last', 'web', 'last')
    const initial = [first, target, last]

    const removed = removeProjectFromList(initial, 'target')
    expect(removed).toEqual([first, last])
    expect(initial).toEqual([first, target, last])
    expect(removeProjectFromList(removed, 'target')).toEqual([first, last])
  })

  it('reports a rejected latest write', async () => {
    const changes: Array<ProjectPersistenceFailure | undefined> = []
    const persistence = createProjectPersistenceCoordinator(
      async () => { throw new Error('device storage unavailable') },
      (failure) => changes.push(failure),
    )

    await expect(persistence.persist([createProjectDraft('Latest', 'web', 'latest')])).rejects.toThrow('device storage unavailable')
    expect(changes).toEqual([{ revision: 1, message: 'device storage unavailable' }])
  })

  it('continues with a later queued write without publishing a stale failure', async () => {
    const changes: Array<ProjectPersistenceFailure | undefined> = []
    const write = vi.fn()
      .mockRejectedValueOnce(new Error('older write failed'))
      .mockResolvedValueOnce(undefined)
    const persistence = createProjectPersistenceCoordinator(write, (failure) => changes.push(failure))

    const older = persistence.persist([createProjectDraft('Older', 'web', 'older')])
    const newer = persistence.persist([createProjectDraft('Newer', 'web', 'newer')])

    await expect(older).rejects.toThrow('older write failed')
    await expect(newer).resolves.toBeUndefined()
    expect(write).toHaveBeenCalledTimes(2)
    expect(changes).toEqual([undefined])
  })

  it('retries the latest snapshot and clears its failure only after a successful retry', async () => {
    const changes: Array<ProjectPersistenceFailure | undefined> = []
    let rejectRetry!: (cause: Error) => void
    const write = vi.fn()
      .mockRejectedValueOnce(new Error('older snapshot failed'))
      .mockRejectedValueOnce(new Error('latest snapshot failed'))
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectRetry = reject }))
      .mockResolvedValueOnce(undefined)
    const persistence = createProjectPersistenceCoordinator(write, (failure) => changes.push(failure))

    await expect(persistence.persist([createProjectDraft('Older', 'web', 'older')])).rejects.toThrow('older snapshot failed')
    await expect(persistence.persist([createProjectDraft('Latest', 'web', 'latest')])).rejects.toThrow('latest snapshot failed')
    expect(changes.at(-1)).toEqual({ revision: 2, message: 'latest snapshot failed' })

    const failedRetry = persistence.retryLatest()
    await Promise.resolve()
    expect(changes.at(-1)).toEqual({ revision: 2, message: 'latest snapshot failed' })
    rejectRetry(new Error('retry failed'))
    await expect(failedRetry).rejects.toThrow('retry failed')
    expect(changes.at(-1)).toEqual({ revision: 3, message: 'retry failed' })

    await expect(persistence.retryLatest()).resolves.toBeUndefined()
    expect(changes.at(-1)).toBeUndefined()
    expect(write).toHaveBeenCalledTimes(4)
    for (const call of write.mock.calls.slice(1)) {
      expect(JSON.parse(call[0] as string)).toEqual([expect.objectContaining({ id: 'latest', name: 'Latest' })])
    }
  })

  it('persists the same removed snapshot when an idempotent delete retries after failure', async () => {
    const snapshots: string[] = []
    const persistence = createProjectPersistenceCoordinator(
      vi.fn(async (snapshot: string) => {
        snapshots.push(snapshot)
        if (snapshots.length === 1) throw new Error('device storage unavailable')
      }),
      () => undefined,
    )
    let projects = [
      createProjectDraft('Keep', 'web', 'keep'),
      createProjectDraft('Delete', 'expo', 'delete'),
    ]
    const remove = async () => {
      projects = removeProjectFromList(projects, 'delete')
      await persistence.persist(projects)
    }

    await expect(remove()).rejects.toThrow('device storage unavailable')
    expect(projects.map((project) => project.id)).toEqual(['keep'])
    await expect(remove()).resolves.toBeUndefined()
    expect(snapshots.map((snapshot) => JSON.parse(snapshot))).toEqual([
      [expect.objectContaining({ id: 'keep' })],
      [expect.objectContaining({ id: 'keep' })],
    ])
  })
})

function memoryProjectStorage(): { storage: ProjectSnapshotStorage; values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    storage: {
      getItem: async (key) => values.get(key) ?? null,
      multiGet: async (keys) => keys.map((key) => [key, values.get(key) ?? null]),
      multiSet: async (entries) => { for (const [key, value] of entries) values.set(key, value) },
      multiRemove: async (keys) => { for (const key of keys) values.delete(key) },
      removeItem: async (key) => { values.delete(key) },
    },
  }
}
