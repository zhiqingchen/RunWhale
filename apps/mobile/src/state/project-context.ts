import { createContext, useContext } from 'react'
import type { ProjectFile, StudioProject, ProjectLoadStatus } from './project-data'
import type { EditorDraft } from './native-project-store'

export interface ProjectStore {
  drafts: readonly EditorDraft[]
  loadFile(projectId: string, path: string): Promise<ProjectFile>
  flushFiles(projectId: string): Promise<void>
  refreshFiles(projectId: string): Promise<void>
  applyDraft(projectId: string, path: string): Promise<void>
  discardDraft(projectId: string, path: string): Promise<void>
  ready: boolean
  loadStatus: ProjectLoadStatus
  loadError?: string
  persistenceError?: string
  projects: StudioProject[]
  retryLoad(): Promise<void>
  retryPersistence(): Promise<void>
  addProject(project: StudioProject): Promise<void>
  renameProject(projectId: string, name: string): Promise<void>
  removeProject(projectId: string): Promise<void>
  updateFile(projectId: string, path: string, content: string): void
  replaceFiles(projectId: string, files: ProjectFile[]): void
  touchRecentFile(projectId: string, path: string): void
}

export const ProjectContext = createContext<ProjectStore | null>(null)

export function useProjects(): ProjectStore {
  const value = useContext(ProjectContext)
  if (!value) throw new Error('useProjects must be used inside ProjectProvider')
  return value
}
