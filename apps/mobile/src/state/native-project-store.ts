import { validatedProjectName, type ProjectImage } from '@runwhale/mobile-protocol'
import { deserializeProjects, validateStoredProjects, type ProjectFile, type StudioProject } from './project-data'

export type ProjectMetadata = Omit<StudioProject, 'files' | 'filePaths' | 'icon'>
interface SavedProjects {
  version: 3
  phase: 'migrating' | 'ready'
  restoring: string[]
  restoreVersions?: Record<string, Record<string, string>>
  projects: ProjectMetadata[]
}
export interface NativeProjectFiles {
  readProjectIcon?(projectId: string): Promise<{ icon?: ProjectImage }>
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
const metadata = ({ files: _files, filePaths: _paths, icon: _icon, ...project }: StudioProject): ProjectMetadata => project

/** Runtime files are authoritative. Studio only persists project metadata. */
export class NativeProjectStore {
  projects: StudioProject[] = []
  persistenceError: string | undefined
  private saved: SavedProjects = { version: 3, phase: 'migrating', restoring: [], projects: [] }
  private readonly contents = new Map<string, { content: string; version: string }>()
  private readonly reads = new Map<string, Promise<ProjectFile>>()
  private readonly epochs = new Map<string, number>()
  private loaded = false
  private loading: Promise<void> | undefined
  private persistence = Promise.resolve()

  constructor(private readonly storage: Storage, private readonly runtime: NativeProjectFiles, private readonly changed: () => void = () => {}) {}

  private publish(): void {
    this.projects = this.projects.map((project) => ({ ...project, files: (project.filePaths ?? []).flatMap((path) => {
      const cached = this.contents.get(keyOf(project.id, path))
      return cached ? [{ path, content: cached.content }] : []
    }) }))
    this.changed()
  }

  private persist(): Promise<void> {
    this.saved = { ...this.saved, projects: this.projects.map(metadata) }
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
        || !Array.isArray(saved.projects)) throw new Error('Saved project metadata is invalid.')
      validateStoredProjects(saved.projects.map((project) => ({ ...project, files: [] })))
      const { version, phase, restoring, restoreVersions, projects } = saved
      this.saved = { version, phase, restoring, restoreVersions, projects }
    }
    this.projects = this.saved.projects.map((project) => ({ ...project, files: [], filePaths: [] }))
    if (this.saved.phase === 'migrating') await this.migrate(readLegacy)
    await this.refreshProjects()
    this.loaded = true
    this.publish()
  }

  private async refreshProjects(): Promise<void> {
    const summaries = await this.runtime.listProjects()
    const existing = new Set(summaries.map((project) => project.id))
    // A deleted runtime folder must not survive as a stale Studio shortcut.
    this.projects = this.projects.filter((project) => existing.has(project.id))
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
    for (const path of this.projects.find((project) => project.id === projectId)?.filePaths ?? []) this.contents.delete(keyOf(projectId, path))
    this.epochs.set(projectId, (this.epochs.get(projectId) ?? 0) + 1)
    this.projects = this.projects.filter((project) => project.id !== projectId)
    await this.persist()
    this.publish()
  }

  touch(projectId: string, path: string): void {
    this.projects = this.projects.map((project) => project.id === projectId ? { ...project, recentFiles: [path, ...(project.recentFiles ?? []).filter((item) => item !== path)].slice(0, 5) } : project)
    this.publish()
    void this.persist().catch(() => undefined)
  }

  private updateManifestName(projectId: string, content: string): boolean {
    let name: string
    try {
      const manifest = JSON.parse(content) as { name?: unknown } | null
      if (typeof manifest?.name !== 'string') return false
      name = validatedProjectName(manifest.name)
    } catch { return false } // Keep the last title while the manifest is incomplete or invalid.
    const project = this.projects.find((item) => item.id === projectId)
    if (!project || project.name === name) return false
    this.projects = this.projects.map((item) => item.id === projectId ? { ...item, name } : item)
    return true
  }

  async refresh(projectId: string, path?: string): Promise<void> {
    const epoch = (this.epochs.get(projectId) ?? 0) + 1
    this.epochs.set(projectId, epoch)
    const project = this.projects.find((item) => item.id === projectId)
    if (!project) return
    for (const file of project.filePaths ?? []) if (!path || path === file) this.contents.delete(keyOf(projectId, file))
    this.publish()
    const [paths, appearance] = await Promise.all([this.runtime.listFiles(projectId), this.runtime.readProjectIcon?.(projectId)])
    if (this.epochs.get(projectId) !== epoch) return
    const manifest = (!path || path === 'runwhale.json') && paths.includes('runwhale.json')
      ? await this.runtime.readFile(projectId, 'runwhale.json') : undefined
    if (this.epochs.get(projectId) !== epoch) return
    const renamed = manifest ? this.updateManifestName(projectId, manifest.content) : false
    this.projects = this.projects.map((item) => item.id === projectId ? { ...item, icon: appearance?.icon, filePaths: [...paths].sort() } : item)
    this.publish()
    if (renamed) await this.persist()
  }

  async loadFile(projectId: string, path: string): Promise<ProjectFile> {
    const key = keyOf(projectId, path)
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

  async retry(): Promise<void> {
    await this.persist()
  }
}
