import AsyncStorage from '@react-native-async-storage/async-storage'
import { type PropsWithChildren, useEffect, useMemo, useState } from 'react'
import type { HostEvent } from '@runwhale/mobile-protocol'
import { createChunkedProjectSnapshotStorage, type ProjectLoadStatus } from './project-data'
import { ProjectContext, type ProjectStore } from './project-context'
import { NativeProjectStore, type NativeProjectFiles } from './native-project-store'
import { nativeProjectStorage } from './native-project-storage'

export interface NativeProjectProviderProps {
  nativeFiles?: NativeProjectFiles
  runtimeReady?: boolean
  events?: readonly HostEvent[]
}

export function NativeProjectProvider({ children, nativeFiles, runtimeReady, events = [] }: PropsWithChildren<NativeProjectProviderProps>) {
  const [, render] = useState(0)
  const [loadStatus, setLoadStatus] = useState<ProjectLoadStatus>('loading')
  const [loadError, setLoadError] = useState<string>()
  const store = useMemo(() => nativeFiles ? new NativeProjectStore(nativeProjectStorage(AsyncStorage), nativeFiles, () => render((revision) => revision + 1)) : undefined, [nativeFiles])
  const actions = useMemo(() => {
    const requireStore = () => {
      if (!store) throw new Error('Embedded runtime project storage is unavailable.')
      return store
    }
    return {
      async retryLoad() {
        if (!runtimeReady) return
        setLoadStatus((current) => current === 'ready' ? current : 'loading')
        setLoadError(undefined)
        try {
          await requireStore().load(createChunkedProjectSnapshotStorage(AsyncStorage).read)
          setLoadStatus('ready')
        } catch (cause) {
          setLoadError(cause instanceof Error ? cause.message : String(cause))
          setLoadStatus((current) => current === 'ready' ? current : 'failed')
        }
      },
      retryPersistence: () => requireStore().retry(),
      addProject: (project) => requireStore().add(project),
      renameProject: (projectId, name) => requireStore().rename(projectId, name),
      removeProject: (projectId) => requireStore().remove(projectId),
      touchRecentFile: (projectId, path) => requireStore().touch(projectId, path),
      loadFile: (projectId, path) => requireStore().loadFile(projectId, path),
      refreshFiles: (projectId) => requireStore().refresh(projectId),
    } satisfies Omit<ProjectStore, 'ready' | 'loadStatus' | 'loadError' | 'persistenceError' | 'projects'>
  }, [runtimeReady, store])
  useEffect(() => { void actions.retryLoad() }, [actions.retryLoad])

  const [observed, setObserved] = useState(0)
  useEffect(() => {
    if (!store || loadStatus !== 'ready') return
    const changed = new Map<string, string | undefined>()
    let latest = observed
    for (const event of events) {
      if (event.sequence <= observed) continue
      latest = Math.max(latest, event.sequence)
      const data = event.data as { projectId?: string; path?: string; state?: string }
      if (data && data.projectId && (event.name === 'project.changed' || (event.name === 'agent.state' && ['completed', 'failed', 'aborted'].includes(data.state ?? '')))) {
        // Multiple mutations in one batch invalidate the entire in-memory view.
        changed.set(data.projectId, changed.has(data.projectId) ? undefined : data.path)
      }
    }
    if (latest !== observed) setObserved(latest)
    for (const [id, path] of changed) void store.refresh(id, path).catch((error: unknown) => setLoadError(String(error)))
  }, [events, loadStatus, observed, store])

  return <ProjectContext.Provider value={{ ...actions, ready: loadStatus === 'ready', loadStatus, loadError, persistenceError: store?.persistenceError, projects: store?.projects ?? [] }}>{children}</ProjectContext.Provider>
}
