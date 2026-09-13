import { createContext, useContext } from 'react'
import type { ProjectFile, StudioProject, ProjectLoadStatus } from './project-data'

export interface ProjectStore {
  loadFile(projectId: string, path: string): Promise<ProjectFile>
  refreshFiles(projectId: string): Promise<void>
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
  touchRecentFile(projectId: string, path: string): void
}

export const ProjectContext = createContext<ProjectStore | null>(null)

export function useProjects(): ProjectStore {
  const value = useContext(ProjectContext)
  if (!value) throw new Error('useProjects must be used inside ProjectProvider')
  return value
}
