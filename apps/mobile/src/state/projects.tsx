import AsyncStorage from '@react-native-async-storage/async-storage'
import { type PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { createChunkedProjectSnapshotStorage, createProjectLoader, createProjectPersistenceCoordinator, removeProjectFromList, renameProjectManifest, type ProjectFile, type StudioProject, type ProjectLoadStatus } from './project-data'
import { ProjectContext, type ProjectStore } from './project-context'
import { NativeProjectProvider, type NativeProjectProviderProps } from './projects-native'
export * from './project-data'
export { useProjects } from './project-context'

export function ProjectProvider(props: PropsWithChildren<NativeProjectProviderProps>) {
  return Platform.OS === 'web' ? <LocalProjectProvider {...props} /> : <NativeProjectProvider {...props} />
}

export function LocalProjectProvider({ children }: PropsWithChildren) {
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
  const retryLoad = useCallback(async () => {
    setLoadStatus('loading')
    setLoadError(undefined)
    try {
      const storedProjects = await loadProjects()
      projectsRef.current = storedProjects
      setProjects(storedProjects)
      setLoadStatus('ready')
      void persistence.persist(storedProjects).catch(() => undefined)
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause))
      setLoadStatus('failed')
    }
  }, [loadProjects, persistence])

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

  const touchRecentFile = useCallback((projectId: string, path: string) => {
    updateAndPersistProjects((current) => current.map((project) => project.id === projectId
      ? { ...project, recentFiles: [path, ...(project.recentFiles ?? []).filter((item) => item !== path)].slice(0, 5) }
      : project))
  }, [updateAndPersistProjects])

  const value = useMemo<ProjectStore>(() => ({
    loadFile: async (projectId, path) => {
      const file = projectsRef.current.find((project) => project.id === projectId)?.files.find((file) => file.path === path)
      if (!file) throw new Error('File is no longer available')
      return file
    },
    refreshFiles: async () => {},
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
    touchRecentFile,
  }), [addProject, loadError, loadStatus, persistence.retryLatest, persistenceError, projects, removeProject, renameProject, retryLoad, touchRecentFile])

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}
