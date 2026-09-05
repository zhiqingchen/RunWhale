import { deserializeProjects, type ProjectFile, type StudioProject } from './project-data'

export type ProjectMetadata = Omit<StudioProject, 'files' | 'filePaths'>
export interface EditorDraft {
  projectId: string
  path: string
  content: string
  baseVersion?: string
  status: 'pending' | 'recovered' | 'failed' | 'conflict'
  error?: string
}
interface SavedProjects {
  version: 3
  phase: 'migrating' | 'ready'
  restoring: string[]
  restoreVersions?: Record<string, Record<string, string>>
  projects: ProjectMetadata[]
  drafts: EditorDraft[]
}
export interface NativeProjectFiles {
  listProjects(): Promise<Array<{ id: string; name: string; updatedAt: number }>>
  createProject(id: string, name: string): Promise<unknown>
  listFiles(projectId: string): Promise<readonly string[]>
  readFile(projectId: string, path: string): Promise<{ content: string; version: string }>
  writeFile(projectId: string, path: string, content: string, expectedVersion?: string): Promise<{ version: string }>
}
interface Storage {
  read(): Promise<string | null>
  write(value: string): Promise<void>
}
const keyOf = (projectId: string, path: string) => JSON.stringify([projectId, path])
const messageOf = (cause: unknown) => cause instanceof Error ? cause.message : String(cause)
const metadata = ({ files: _files, filePaths: _paths, ...project }: StudioProject): ProjectMetadata => project

/** Runtime files are authoritative. Only metadata and unresolved edits survive a Studio restart. */
export class NativeProjectStore {
  projects: StudioProject[] = []
  drafts: EditorDraft[] = []
  persistenceError: string | undefined
  private saved: SavedProjects = { version: 3, phase: 'migrating', restoring: [], projects: [], drafts: [] }
  private readonly contents = new Map<string, { content: string; version: string }>()
  private readonly reads = new Map<string, Promise<ProjectFile>>()
  private readonly epochs = new Map<string, number>()
  private loaded = false
  private loading: Promise<void> | undefined
  private persistence = Promise.resolve()
  private writes = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly storage: Storage, private readonly runtime: NativeProjectFiles, private readonly changed: () => void = () => {}) {}

  private publish(): void {
    this.projects = this.projects.map((project) => ({ ...project, files: (project.filePaths ?? []).flatMap((path) => {
      const draft = this.drafts.find((item) => item.projectId === project.id && item.path === path)
      const cached = this.contents.get(keyOf(project.id, path))
      return draft || cached ? [{ path, content: draft?.content ?? cached!.content }] : []
    }) }))
    this.changed()
  }

  private persist(): Promise<void> {
    this.saved = { ...this.saved, projects: this.projects.map(metadata), drafts: this.drafts }
    const snapshot = JSON.stringify(this.saved)
    const operation = this.persistence.catch(() => undefined).then(() => this.storage.write(snapshot))
    this.persistence = operation
    void operation.then(() => {
      if (this.persistence === operation) { this.persistenceError = undefined; this.changed() }
    }, (error: unknown) => {
      if (this.persistence === operation) { this.persistenceError = messageOf(error); this.changed() }
    })
    return operation
  }

  load(readLegacy: () => Promise<string | null>): Promise<void> {
    if (this.loading) return this.loading
    const loading = this.loadSaved(readLegacy).finally(() => { if (this.loading === loading) this.loading = undefined })
    this.loading = loading
    return loading
  }

  private async loadSaved(readLegacy: () => Promise<string | null>): Promise<void> {
    if (this.loaded) {
      await this.refreshProjects()
      return
    }
    const raw = await this.storage.read()
    if (raw) {
      const saved = JSON.parse(raw) as SavedProjects
      if (saved.version !== 3 || !['ready', 'migrating'].includes(saved.phase) || !Array.isArray(saved.restoring)
        || !Array.isArray(saved.projects) || !Array.isArray(saved.drafts)
        || !saved.drafts.every((draft) => typeof draft.projectId === 'string' && typeof draft.path === 'string' && typeof draft.content === 'string'
          && ['pending', 'recovered', 'failed', 'conflict'].includes(draft.status))) throw new Error('Saved project metadata or drafts are invalid.')
      deserializeProjects(JSON.stringify(saved.projects.map((project) => ({ ...project, files: [] }))))
      this.saved = saved
    }
    this.projects = this.saved.projects.map((project) => ({ ...project, files: [], filePaths: [] }))
    this.drafts = this.saved.drafts
    if (this.saved.phase === 'migrating') await this.migrate(readLegacy)
    await this.refreshProjects()
    this.loaded = true
    this.publish()
    void this.flushPending().catch(() => undefined)
  }

  private async refreshProjects(): Promise<void> {
    const summaries = await this.runtime.listProjects()
    const existing = new Set(summaries.map((project) => project.id))
    const draftProjects = new Set(this.drafts.map((draft) => draft.projectId))
    // A deleted runtime folder must not survive as a stale Studio shortcut.
    // Retain entries with unresolved edits so recovery data is not discarded.
    this.projects = this.projects.filter((project) => existing.has(project.id) || draftProjects.has(project.id))
    for (const summary of summaries) {
      if (!this.projects.some((project) => project.id === summary.id)) this.projects.push({ ...summary, description: '', files: [], filePaths: [] })
    }
    await this.persist()
    for (const project of this.projects) await this.refresh(project.id)
    this.publish()
  }

  private async migrate(readLegacy: () => Promise<string | null>): Promise<void> {
    // Legacy storage is retained, including after successful migration. No partially
    // written native metadata is accepted as proof that recovery is complete.
    let legacy: StudioProject[]
    try { legacy = deserializeProjects(await readLegacy()) } catch (error) {
      // The old Android oversized-row marker has no readable Studio snapshot.
      if (!/runtime recovery|row too big to fit into cursorwindow/i.test(messageOf(error))) throw error
      legacy = []
    }
    const summaries = await this.runtime.listProjects()
    const existing = new Set(summaries.map((project) => project.id))
    for (const project of legacy) {
      if (!this.projects.some((item) => item.id === project.id)) this.projects.push({ ...metadata(project), files: [], filePaths: [] })
      if (!existing.has(project.id) && !this.saved.restoring.includes(project.id)) this.saved.restoring.push(project.id)
    }
    // Journal restoration ownership before creating any runtime project.
    await this.persist()
    for (const project of legacy) {
      if (!existing.has(project.id)) {
        await this.runtime.createProject(project.id, project.name)
        existing.add(project.id)
        // project.create supplies a scaffold. Only this migration's unchanged
        // scaffold may be replaced automatically with the legacy-only project.
        const versions: Record<string, string> = {}
        for (const path of await this.runtime.listFiles(project.id)) versions[path] = (await this.runtime.readFile(project.id, path)).version
        this.saved.restoreVersions = { ...this.saved.restoreVersions, [project.id]: versions }
        await this.persist()
      }
      const paths = new Set(await this.runtime.listFiles(project.id))
      for (const file of project.files) {
        if (!paths.has(file.path) && this.saved.restoring.includes(project.id)) {
          await this.runtime.writeFile(project.id, file.path, file.content)
          paths.add(file.path)
        } else {
          const active = paths.has(file.path) ? await this.runtime.readFile(project.id, file.path) : undefined
          if (active && active.content !== file.content && this.saved.restoreVersions?.[project.id]?.[file.path] === active.version) {
            await this.runtime.writeFile(project.id, file.path, file.content, active.version)
            continue
          }
          if (active?.content !== file.content && !this.drafts.some((draft) => draft.projectId === project.id && draft.path === file.path)) {
            this.drafts.push({ projectId: project.id, ...file, ...(active ? { baseVersion: active.version } : {}), status: 'recovered' })
          }
        }
      }
    }
    this.saved.phase = 'ready'
    this.saved.restoring = []
    delete this.saved.restoreVersions
    await this.persist()
  }

  async add(project: StudioProject): Promise<void> {
    this.projects = [{ ...metadata(project), files: [], filePaths: [] }, ...this.projects.filter((item) => item.id !== project.id)]
    await this.persist()
    await this.refresh(project.id)
  }

  async rename(projectId: string, name: string): Promise<void> {
    this.projects = this.projects.map((project) => project.id === projectId ? { ...project, name, updatedAt: Date.now() } : project)
    await this.persist()
    this.publish()
  }

  async remove(projectId: string): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    await this.writes
    for (const path of this.projects.find((project) => project.id === projectId)?.filePaths ?? []) this.contents.delete(keyOf(projectId, path))
    this.epochs.set(projectId, (this.epochs.get(projectId) ?? 0) + 1)
    this.projects = this.projects.filter((project) => project.id !== projectId)
    this.drafts = this.drafts.filter((draft) => draft.projectId !== projectId)
    await this.persist()
    this.publish()
  }

  touch(projectId: string, path: string): void {
    this.projects = this.projects.map((project) => project.id === projectId ? { ...project, recentFiles: [path, ...(project.recentFiles ?? []).filter((item) => item !== path)].slice(0, 5) } : project)
    this.publish()
    void this.persist().catch(() => undefined)
  }

  async refresh(projectId: string, path?: string): Promise<void> {
    const epoch = (this.epochs.get(projectId) ?? 0) + 1
    this.epochs.set(projectId, epoch)
    const project = this.projects.find((item) => item.id === projectId)
    if (!project) return
    for (const file of project.filePaths ?? []) if (!path || path === file) this.contents.delete(keyOf(projectId, file))
    this.publish()
    const paths = await this.runtime.listFiles(projectId)
    if (this.epochs.get(projectId) !== epoch) return
    const pending = this.drafts.filter((draft) => draft.projectId === projectId).map((draft) => draft.path)
    this.projects = this.projects.map((item) => item.id === projectId ? { ...item, filePaths: [...new Set([...paths, ...pending])].sort() } : item)
    this.publish()
  }

  async loadFile(projectId: string, path: string): Promise<ProjectFile> {
    const key = keyOf(projectId, path)
    const draft = this.drafts.find((item) => item.projectId === projectId && item.path === path)
    if (draft) return { path, content: draft.content }
    const cached = this.contents.get(key)
    if (cached) return { path, content: cached.content }
    const reading = this.reads.get(key)
    if (reading) return reading
    const epoch = this.epochs.get(projectId)
    const request = this.runtime.readFile(projectId, path).then(async (file) => {
      if (this.epochs.get(projectId) !== epoch) {
        this.reads.delete(key)
        return this.loadFile(projectId, path)
      }
      this.contents.set(key, file)
      this.publish()
      return { path, content: file.content }
    }).finally(() => { if (this.reads.get(key) === request) this.reads.delete(key) })
    this.reads.set(key, request)
    return request
  }

  edit(projectId: string, path: string, content: string): void {
    const previous = this.drafts.find((draft) => draft.projectId === projectId && draft.path === path)
    const cached = this.contents.get(keyOf(projectId, path))
    if (!previous && !cached) throw new Error('Open the file before editing it.')
    this.projects = this.projects.map((project) => project.id === projectId ? { ...project, updatedAt: Date.now() } : project)
    const draft: EditorDraft = { projectId, path, content, baseVersion: previous?.baseVersion ?? cached?.version, status: previous?.status === 'recovered' || previous?.status === 'conflict' ? previous.status : 'pending' }
    this.drafts = [...this.drafts.filter((item) => item !== previous), draft]
    this.publish()
    // Persist the draft immediately; only runtime writes are debounced.
    void this.persist().catch(() => undefined)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flushPending().catch(() => undefined)
    }, 300)
  }

  private async save(draft: EditorDraft): Promise<void> {
    try {
      const result = await this.runtime.writeFile(draft.projectId, draft.path, draft.content, draft.baseVersion)
      this.contents.set(keyOf(draft.projectId, draft.path), { content: draft.content, version: result.version })
      this.drafts = this.drafts.flatMap((current) => {
        if (current.projectId !== draft.projectId || current.path !== draft.path) return [current]
        return current === draft ? [] : [{ ...current, baseVersion: result.version }]
      })
      await this.persist()
    } catch (error) {
      // A failed metadata checkpoint must retain a recoverable copy too.
      const status = (error as { code?: string }).code === 'CONFLICT' ? 'conflict' : 'failed'
      const current = this.drafts.find((item) => item.projectId === draft.projectId && item.path === draft.path) ?? draft
      this.drafts = [...this.drafts.filter((item) => item.projectId !== draft.projectId || item.path !== draft.path), { ...current, status, error: messageOf(error) }]
      await this.persist().catch(() => undefined)
      throw error
    } finally { this.publish() }
  }

  private flushPending(projectId?: string): Promise<void> {
    const operation = this.writes.catch(() => undefined).then(async () => {
      await this.persistence
      for (;;) {
        const draft = this.drafts.find((item) => (!projectId || item.projectId === projectId) && item.status === 'pending')
        if (!draft) break
        await this.save(draft)
      }
    })
    this.writes = operation.catch(() => undefined)
    return operation
  }

  async flush(projectId: string): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    await this.flushPending(projectId)
    const unresolved = this.drafts.find((draft) => draft.projectId === projectId)
    if (unresolved) throw new Error(`Resolve the saved draft for ${unresolved.path} in Files before continuing. ${unresolved.error ?? ''}`.trim())
  }

  async apply(projectId: string, path: string): Promise<void> {
    await this.writes
    const draft = this.drafts.find((item) => item.projectId === projectId && item.path === path)
    if (!draft) return
    const paths = await this.runtime.listFiles(projectId)
    const active = paths.includes(path) ? await this.runtime.readFile(projectId, path) : undefined
    const next: EditorDraft = { ...draft, baseVersion: active?.version, status: 'pending' }
    this.drafts = this.drafts.map((item) => item === draft ? next : item)
    await this.persist()
    await this.flushPending(projectId)
  }

  async discard(projectId: string, path: string): Promise<void> {
    await this.writes
    const previous = this.drafts
    this.drafts = this.drafts.filter((draft) => draft.projectId !== projectId || draft.path !== path)
    try { await this.persist() } catch (error) { this.drafts = previous; throw error }
    await this.refresh(projectId, path)
  }

  async retry(): Promise<void> {
    await this.persist()
    this.drafts = this.drafts.map((draft) => draft.status === 'failed' ? { ...draft, status: 'pending', error: undefined } : draft)
    await this.persist()
    await this.flushPending()
  }
}
