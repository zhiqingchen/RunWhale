import { NATIVE_PREVIEW_TEMPLATE_DEPENDENCIES } from '@runwhale/mobile-protocol'
import { readTextProjectFiles } from '../utils/project-text-files'

export interface ProjectFile {
  path: string
  content: string
}

export interface StudioProject {
  id: string
  name: string
  description: string
  updatedAt: number
  template?: ProjectTemplate
  source?: GitHubProjectSource
  recentFiles?: string[]
  /** Loaded contents only on native; the complete snapshot on web. */
  files: ProjectFile[]
  filePaths?: string[]
}

export type ProjectTemplate = 'web' | 'expo'

export interface GitHubProjectSource {
  type: 'github'
  owner: string
  repo: string
  commit: string
}

export type ProjectLoadStatus = 'loading' | 'failed' | 'ready'

const LEGACY_STORAGE_KEY = 'runwhale.projects.v1'
const STORAGE_MANIFEST_KEY = 'runwhale.projects.v2'
const STORAGE_CHUNK_PREFIX = 'runwhale.projects.v2:chunk:'
const LEGACY_RUNTIME_RECOVERY_MARKER = '{"version":2,"recovery":"runtime"}'
const RUNTIME_RECOVERY_REQUIRED_MESSAGE = 'Saved project data requires runtime recovery.'
export const PROJECT_STORAGE_CHUNK_LENGTH = 128 * 1_024

function isStoredProject(project: unknown): project is StudioProject & { lastTask?: unknown } {
  if (!project || typeof project !== 'object') return false
  const candidate = project as Record<string, unknown>
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.description === 'string'
    && typeof candidate.updatedAt === 'number'
    && Number.isFinite(candidate.updatedAt)
    && (candidate.template === undefined || candidate.template === 'web' || candidate.template === 'expo')
    && (candidate.source === undefined || isStoredGitHubProjectSource(candidate.source))
    && Array.isArray(candidate.files)
    && candidate.files.every((file) => {
      if (!file || typeof file !== 'object') return false
      const candidateFile = file as Record<string, unknown>
      return typeof candidateFile.path === 'string' && typeof candidateFile.content === 'string'
    })
    && (candidate.recentFiles === undefined || (Array.isArray(candidate.recentFiles) && candidate.recentFiles.every((path) => typeof path === 'string')))
}

function isStoredGitHubProjectSource(source: unknown): source is GitHubProjectSource {
  if (!source || typeof source !== 'object') return false
  const candidate = source as Record<string, unknown>
  return candidate.type === 'github'
    && typeof candidate.owner === 'string'
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(candidate.owner)
    && typeof candidate.repo === 'string'
    && /^[A-Za-z0-9._-]{1,100}$/.test(candidate.repo)
    && candidate.repo !== '.'
    && candidate.repo !== '..'
    && typeof candidate.commit === 'string'
    && /^[0-9a-f]{40}$/.test(candidate.commit)
}

export function isGitHubImportedProject(project: Pick<StudioProject, 'description' | 'source'>): boolean {
  return project.source?.type === 'github' || project.description.startsWith('GitHub · ')
}

export function isRepositoryImportedProject(project: Pick<StudioProject, 'description' | 'source'>): boolean {
  return isGitHubImportedProject(project) || project.description.startsWith('Git · ')
}

export function runtimeProjectFileContent(
  project: Pick<StudioProject, 'description' | 'name' | 'source'>,
  runtimeProjectId: string,
  file: ProjectFile,
): string {
  if (file.path !== 'runwhale.json' || isRepositoryImportedProject(project)) return file.content
  const manifest = JSON.parse(file.content) as Record<string, unknown>
  manifest.id = runtimeProjectId
  manifest.name = project.name
  return `${JSON.stringify(manifest, null, 2)}\n`
}

export function deserializeProjects(value: string | null): StudioProject[] {
  if (!value) return []
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || !parsed.every(isStoredProject)) throw new Error('Saved project data is invalid.')
  return parsed
    .filter((project) => project.id !== 'vibe-game')
    .map((project) => {
      const { lastTask: _legacyTaskPresentation, ...current } = project
      return current
    })
}

export function createProjectLoader(read: () => Promise<string | null>): () => Promise<StudioProject[]> {
  let inFlight: Promise<StudioProject[]> | undefined
  return () => {
    if (inFlight) return inFlight
    const request = read().then(deserializeProjects)
    inFlight = request
    const clear = () => { if (inFlight === request) inFlight = undefined }
    void request.then(clear, clear)
    return request
  }
}

export interface ProjectSnapshotStorage {
  getItem(key: string): Promise<string | null>
  multiGet(keys: string[]): Promise<readonly [string, string | null][]>
  multiSet(entries: [string, string][]): Promise<void>
  multiRemove(keys: string[]): Promise<void>
  removeItem(key: string): Promise<void>
}

interface ProjectStorageManifest {
  version: 2
  chunks: number
}

export function createChunkedProjectSnapshotStorage(storage: ProjectSnapshotStorage): { read(): Promise<string | null>; write(value: string): Promise<void>; prepareLegacyRecovery(): Promise<void> } {
  return {
    async read() {
      const storedManifest = await storage.getItem(STORAGE_MANIFEST_KEY)
      if (storedManifest === null) {
        const legacy = await storage.getItem(LEGACY_STORAGE_KEY)
        if (legacy === LEGACY_RUNTIME_RECOVERY_MARKER) throw new Error(RUNTIME_RECOVERY_REQUIRED_MESSAGE)
        return legacy
      }
      const manifest = parseProjectStorageManifest(storedManifest)
      const keys = Array.from({ length: manifest.chunks }, (_, index) => projectStorageChunkKey(index))
      const storedChunks = new Map(await storage.multiGet(keys))
      return keys.map((key) => {
        const chunk = storedChunks.get(key)
        if (chunk === undefined || chunk === null) throw new Error('Saved project data is incomplete.')
        return chunk
      }).join('')
    },
    async write(value) {
      const previousChunkCount = await previousProjectChunkCount(storage)
      const chunks = splitProjectSnapshot(value)
      const manifest: ProjectStorageManifest = { version: 2, chunks: chunks.length }
      await storage.multiSet([
        ...chunks.map((chunk, index): [string, string] => [projectStorageChunkKey(index), chunk]),
        [STORAGE_MANIFEST_KEY, JSON.stringify(manifest)],
      ])
      await storage.removeItem(LEGACY_STORAGE_KEY).catch(() => undefined)
      if (previousChunkCount > chunks.length) {
        const staleKeys = Array.from({ length: previousChunkCount - chunks.length }, (_, index) => projectStorageChunkKey(chunks.length + index))
        await storage.multiRemove(staleKeys).catch(() => undefined)
      }
    },
    prepareLegacyRecovery() {
      return storage.multiSet([[LEGACY_STORAGE_KEY, LEGACY_RUNTIME_RECOVERY_MARKER]])
    },
  }
}

function isProjectStorageRuntimeRecoveryRequired(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message === RUNTIME_RECOVERY_REQUIRED_MESSAGE || /row too big to fit into cursorwindow/i.test(message)
}

export async function loadProjectsWithRuntimeRecovery(
  load: () => Promise<StudioProject[]>,
  recover?: () => Promise<StudioProject[]>,
): Promise<StudioProject[]> {
  try {
    return await load()
  } catch (cause) {
    if (!recover || !isProjectStorageRuntimeRecoveryRequired(cause)) throw cause
    return recover()
  }
}

export interface RuntimeProjectRecoverySource {
  listProjects(): Promise<Array<{ id: string; name: string; updatedAt: number }>>
  listFiles(projectId: string): Promise<readonly string[]>
  readFile(projectId: string, path: string): Promise<{ content: string }>
}

export async function recoverProjectsFromRuntime(source: RuntimeProjectRecoverySource): Promise<StudioProject[]> {
  const summaries = await source.listProjects()
  return Promise.all(summaries.map(async (summary) => {
    const paths = await source.listFiles(summary.id)
    const files = await readTextProjectFiles(paths, (path) => source.readFile(summary.id, path))
    const template = inferProjectTemplate(files)
    return {
      id: summary.id,
      name: summary.name,
      description: '',
      updatedAt: summary.updatedAt,
      ...(template ? { template } : {}),
      files,
    }
  }))
}

function splitProjectSnapshot(value: string): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < value.length) {
    let end = Math.min(start + PROJECT_STORAGE_CHUNK_LENGTH, value.length)
    if (end < value.length && isHighSurrogate(value.charCodeAt(end - 1)) && isLowSurrogate(value.charCodeAt(end))) end -= 1
    chunks.push(value.slice(start, end))
    start = end
  }
  return chunks.length > 0 ? chunks : ['']
}

function isHighSurrogate(value: number): boolean { return value >= 0xD800 && value <= 0xDBFF }
function isLowSurrogate(value: number): boolean { return value >= 0xDC00 && value <= 0xDFFF }
function projectStorageChunkKey(index: number): string { return `${STORAGE_CHUNK_PREFIX}${index}` }

function parseProjectStorageManifest(value: string): ProjectStorageManifest {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error('Saved project data is invalid.') }
  if (!parsed || typeof parsed !== 'object') throw new Error('Saved project data is invalid.')
  const manifest = parsed as Record<string, unknown>
  if (manifest.version !== 2 || !Number.isSafeInteger(manifest.chunks) || Number(manifest.chunks) < 1) throw new Error('Saved project data is invalid.')
  return { version: 2, chunks: Number(manifest.chunks) }
}

async function previousProjectChunkCount(storage: ProjectSnapshotStorage): Promise<number> {
  const value = await storage.getItem(STORAGE_MANIFEST_KEY)
  if (value === null) return 0
  try { return parseProjectStorageManifest(value).chunks } catch { return 0 }
}

function inferProjectTemplate(files: readonly ProjectFile[]): ProjectTemplate | undefined {
  const manifest = files.find((file) => file.path === 'runwhale.json')
  if (!manifest) return undefined
  try {
    const parsed = JSON.parse(manifest.content) as { preview?: { target?: unknown } }
    if (parsed.preview?.target === 'web') return 'web'
    if (parsed.preview?.target === 'native') return 'expo'
  } catch { /* damaged manifests remain recoverable */ }
  return undefined
}

function createOrderedSerializedProjectWriter(write: (value: string) => Promise<void>): (value: string) => Promise<void> {
  let tail = Promise.resolve()
  return (value) => {
    const request = tail.then(() => write(value))
    tail = request.catch(() => undefined)
    return request
  }
}

export interface ProjectPersistenceFailure {
  revision: number
  message: string
}

export function createProjectPersistenceCoordinator(
  write: (value: string) => Promise<void>,
  onFailureChange: (failure?: ProjectPersistenceFailure) => void,
): { persist(projects: readonly StudioProject[]): Promise<void>; retryLatest(): Promise<void> } {
  const persistOrdered = createOrderedSerializedProjectWriter(write)
  let latestRevision = 0
  let latestSnapshot: string | undefined

  const enqueue = (snapshot: string) => {
    const revision = ++latestRevision
    const request = persistOrdered(snapshot)
    return request.then(
      () => {
        if (revision === latestRevision) onFailureChange(undefined)
      },
      (cause: unknown) => {
        if (revision === latestRevision) {
          onFailureChange({ revision, message: cause instanceof Error ? cause.message : String(cause) })
        }
        throw cause
      },
    )
  }

  return {
    persist(projects) {
      latestSnapshot = JSON.stringify(projects)
      return enqueue(latestSnapshot)
    },
    retryLatest() {
      return latestSnapshot === undefined ? Promise.resolve() : enqueue(latestSnapshot)
    },
  }
}

export function projectTemplateFiles(id: string, name: string, template: ProjectTemplate): ProjectFile[] {
  const shared = [
    { path: '.gitignore', content: '.runwhale/sessions/\n.runwhale/cache/\n.runwhale/package-staging/\n.runwhale/git-audit.jsonl\nnode_modules/\n.expo/\ndist/\n' },
  ]
  if (template === 'web') return [
    ...shared,
    { path: 'runwhale.json', content: manifestContent(id, name, 'web') },
    { path: 'package.json', content: `${JSON.stringify({ name: id, private: true, version: '1.0.0', scripts: { start: 'vite', build: 'vite build' }, dependencies: { react: '19.2.3', 'react-dom': '19.2.3' }, devDependencies: { vite: '8.2.2' } }, null, 2)}\n` },
    { path: 'index.html', content: WEB_TEMPLATE_HTML },
    { path: 'src/main.tsx', content: WEB_TEMPLATE_ENTRY },
    { path: 'README.md', content: projectReadme(name) },
  ]
  return [
    ...shared,
    { path: 'runwhale.json', content: manifestContent(id, name, 'expo') },
    { path: 'package.json', content: `${JSON.stringify({ name: id, private: true, version: '1.0.0', main: 'index.tsx', scripts: { start: 'expo start', android: 'expo start --android', ios: 'expo start --ios' }, dependencies: NATIVE_PREVIEW_TEMPLATE_DEPENDENCIES }, null, 2)}\n` },
    { path: 'app.json', content: `${JSON.stringify({ expo: { name, slug: id, platforms: ['ios', 'android'], plugins: [['expo-sensors', { motionPermission: 'Allow this RunWhale preview to use motion sensors.' }]], android: { blockedPermissions: ['android.permission.ACTIVITY_RECOGNITION'] } } }, null, 2)}\n` },
    { path: 'index.tsx', content: EXPO_TEMPLATE_ENTRY },
    { path: 'README.md', content: projectReadme(name) },
  ]
}

export function createProjectDraft(name: string, template: ProjectTemplate, id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`): StudioProject {
  return {
    id,
    name,
    description: '',
    updatedAt: Date.now(),
    template,
    files: projectTemplateFiles(id, name, template),
  }
}

export function removeProjectFromList(projects: readonly StudioProject[], projectId: string): StudioProject[] {
  return projects.filter((project) => project.id !== projectId)
}

export function renameProjectManifest(files: readonly ProjectFile[], projectId: string, name: string): ProjectFile[] {
  return files.map((file) => {
    if (file.path !== 'runwhale.json') return file
    try {
      const manifest = JSON.parse(file.content) as Record<string, unknown>
      manifest.id = projectId
      manifest.name = name
      return { ...file, content: `${JSON.stringify(manifest, null, 2)}\n` }
    } catch {
      return file
    }
  })
}

function manifestContent(id: string, name: string, template: ProjectTemplate): string {
  const preview = template === 'web'
    ? { runtimeAbi: {}, entry: { web: 'src/main.tsx' }, preview: { target: 'web' } }
    : {
        runtimeAbi: { android: 'runwhale-expo57-android-v1', ios: 'runwhale-expo57-ios-v1' },
        entry: { android: 'index.tsx', ios: 'index.tsx' },
        preview: { target: 'native' },
      }
  return `${JSON.stringify({ schemaVersion: 1, id, name, ...preview, capabilities: [], tasks: {}, source: { kind: 'local' } }, null, 2)}\n`
}

function projectReadme(name: string): string {
  return `# ${name}\n\n\`\`\`sh\nnpm install\nnpm start\n\`\`\`\n`
}

const WEB_TEMPLATE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>RunWhale Web</title>
  </head>
  <body style="margin: 0">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`

const WEB_TEMPLATE_ENTRY = `import React from 'react'
import { createRoot } from 'react-dom/client'

function App() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#07182a', color: '#f7fbff', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ color: '#ffffff', fontSize: 42 }}>Hello RunWhale</h1>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
`

const EXPO_TEMPLATE_ENTRY = `import React from 'react'
import { AppRegistry, StyleSheet, Text, View } from 'react-native'

function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Hello RunWhale</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#ffffff', fontSize: 32, fontWeight: '700' },
})

AppRegistry.registerComponent('main', () => App)
`

export function projectFilePaths(project: StudioProject): string[] { return project.filePaths ?? project.files.map((file) => file.path) }
