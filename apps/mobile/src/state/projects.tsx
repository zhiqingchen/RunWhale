import AsyncStorage from '@react-native-async-storage/async-storage'
import { type PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { createChunkedProjectSnapshotStorage, createProjectLoader, createProjectPersistenceCoordinator, loadProjectsWithRuntimeRecovery, removeProjectFromList, renameProjectManifest, type ProjectFile, type StudioProject, type ProjectLoadStatus } from './project-data'
import { ProjectContext, type ProjectStore } from './project-context'
import { NativeProjectProvider, type NativeProjectProviderProps } from './projects-native'
export * from './project-data'
export { useProjects } from './project-context'

export function ProjectProvider(props: PropsWithChildren<NativeProjectProviderProps & { recoverProjects?: () => Promise<StudioProject[]> }>) {
  return Platform.OS === 'web' ? <LocalProjectProvider {...props} /> : <NativeProjectProvider {...props} />
}

export function LocalProjectProvider({ children, recoverProjects }: PropsWithChildren<{ recoverProjects?: () => Promise<StudioProject[]> }>) {
  const [projects, setProjects] = useState<StudioProject[]>([])
  const projectsRef = useRef<StudioProject[]>([])
  const [loadStatus, setLoadStatus] = useState<ProjectLoadStatus>('loading')
  const [loadError, setLoadError] = useState<string>()
  const [persistenceError, setPersistenceError] = useState<string>()
  const projectStorage = useMemo(() => createChunkedProjectSnapshotStorage({
    getItem: (key) => AsyncStorage.getItem(key),
    multiGet: (keys) => AsyncStorage.multiGet(keys),
    multiSet: (entries) => AsyncStorage.multiSet(entries),
    multiRemove: (keys) => AsyncStorage.multiRemove(keys),
    removeItem: (key) => AsyncStorage.removeItem(key),
  }), [])
  const loadProjects = useMemo(() => createProjectLoader(projectStorage.read), [projectStorage])
  const persistence = useMemo(() => createProjectPersistenceCoordinator(
    projectStorage.write,
    (failure) => setPersistenceError(failure?.message),
  ), [projectStorage])
  const recoverUnreadableProjects = useCallback(async () => {
    if (!recoverProjects) throw new Error('Embedded runtime project recovery is unavailable.')
    const recovered = await recoverProjects()
    // Replace the unreadable legacy row with a small durable recovery marker
    // before writing chunks. A process interruption will retry runtime recovery
    // instead of presenting an empty project list on the next launch.
    await projectStorage.prepareLegacyRecovery()
    return recovered
  }, [projectStorage, recoverProjects])
  const retryLoad = useCallback(async () => {
    setLoadStatus('loading')
    setLoadError(undefined)
    try {
      const storedProjects = await loadProjectsWithRuntimeRecovery(loadProjects, recoverProjects ? recoverUnreadableProjects : undefined)
      projectsRef.current = storedProjects
      setProjects(storedProjects)
      setLoadStatus('ready')
      void persistence.persist(storedProjects).catch(() => undefined)
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause))
      setLoadStatus('failed')
    }
  }, [loadProjects, persistence, recoverProjects, recoverUnreadableProjects])

  useEffect(() => {
    void retryLoad()
  }, [retryLoad])

  const setAndPersistProjects = useCallback((next: StudioProject[]) => {
    projectsRef.current = next
    setProjects(next)
    return persistence.persist(next)
  }, [persistence])

  const updateAndPersistProjects = useCallback((update: (current: StudioProject[]) => StudioProject[]) => {
    void setAndPersistProjects(update(projectsRef.current)).catch(() => undefined)
  }, [setAndPersistProjects])

  const addProject = useCallback(async (project: StudioProject) => {
    await setAndPersistProjects([project, ...projectsRef.current.filter((item) => item.id !== project.id)])
  }, [setAndPersistProjects])

  const renameProject = useCallback(async (projectId: string, name: string) => {
    if (!projectsRef.current.some((project) => project.id === projectId)) throw new Error('project is no longer available')
    const next = projectsRef.current.map((project) => project.id === projectId
      ? { ...project, name, updatedAt: Date.now(), files: renameProjectManifest(project.files, projectId, name) }
      : project)
    await setAndPersistProjects(next)
  }, [setAndPersistProjects])

  const removeProject = useCallback((projectId: string) => {
    return setAndPersistProjects(removeProjectFromList(projectsRef.current, projectId))
  }, [setAndPersistProjects])

  const updateFile = useCallback((projectId: string, path: string, content: string) => {
    updateAndPersistProjects((current) => current.map((project) => project.id === projectId
      ? { ...project, updatedAt: Date.now(), files: project.files.map((file) => file.path === path ? { ...file, content } : file) }
      : project))
  }, [updateAndPersistProjects])

  const replaceFiles = useCallback((projectId: string, files: ProjectFile[]) => {
    updateAndPersistProjects((current) => current.map((project) => project.id === projectId
      ? { ...project, updatedAt: Date.now(), files }
      : project))
  }, [updateAndPersistProjects])

  const touchRecentFile = useCallback((projectId: string, path: string) => {
    updateAndPersistProjects((current) => current.map((project) => project.id === projectId
      ? { ...project, recentFiles: [path, ...(project.recentFiles ?? []).filter((item) => item !== path)].slice(0, 5) }
      : project))
  }, [updateAndPersistProjects])

  const value = useMemo<ProjectStore>(() => ({
    drafts: [],
    loadFile: async (projectId, path) => {
      const file = projectsRef.current.find((project) => project.id === projectId)?.files.find((file) => file.path === path)
      if (!file) throw new Error('File is no longer available')
      return file
    },
    flushFiles: () => persistence.retryLatest(),
    refreshFiles: async () => {},
    applyDraft: async () => {},
    discardDraft: async () => {},
    ready: loadStatus === 'ready',
    loadStatus,
    loadError,
    persistenceError,
    projects,
    retryLoad,
    retryPersistence: persistence.retryLatest,
    addProject,
    renameProject,
    removeProject,
    updateFile,
    replaceFiles,
    touchRecentFile,
  }), [addProject, loadError, loadStatus, persistence.retryLatest, persistenceError, projects, removeProject, renameProject, replaceFiles, retryLoad, touchRecentFile, updateFile])

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}
