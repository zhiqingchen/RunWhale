import { normalizeProjectName, projectNameValidationIssue, type ProjectNameValidationIssue } from '@runwhale/mobile-protocol'

export interface ProjectRenameTarget {
  projectId: string
  name: string
}

export type ProjectRenameState =
  | { phase: 'closed' }
  | { phase: 'editing'; target: ProjectRenameTarget; draft: string; error?: string }

export type ProjectRenameAction =
  | { type: 'open'; target: ProjectRenameTarget }
  | { type: 'change'; draft: string }
  | { type: 'fail'; error: string }
  | { type: 'dismiss' }

export const closedProjectRenameState: ProjectRenameState = { phase: 'closed' }

export function isProjectRenameDraftValid(draft: string): boolean {
  return projectNameValidationIssue(draft) === undefined
}

export function projectRenameSelection(draft: string): { start: number; end: number } {
  return { start: 0, end: draft.length }
}

export function projectRenameReducer(state: ProjectRenameState, action: ProjectRenameAction): ProjectRenameState {
  if (action.type === 'open') return { phase: 'editing', target: action.target, draft: action.target.name }
  if (action.type === 'dismiss') return closedProjectRenameState
  if (state.phase !== 'editing') return state
  if (action.type === 'change') return { ...state, draft: action.draft, error: undefined }
  return { ...state, error: action.error }
}

export class ProjectRenameValidationError extends Error {
  constructor(readonly issue: ProjectNameValidationIssue) {
    super(`invalid project name: ${issue}`)
  }
}

export async function persistProjectRename({
  projectId,
  draft,
  renameRuntime,
  persistLocal,
}: {
  projectId: string
  draft: string
  renameRuntime(input: { projectId: string; name: string }): Promise<{ name: string }>
  persistLocal(projectId: string, name: string): Promise<void>
}): Promise<string> {
  const issue = projectNameValidationIssue(draft)
  if (issue) throw new ProjectRenameValidationError(issue)
  const name = normalizeProjectName(draft)
  const renamed = await renameRuntime({ projectId, name })
  await persistLocal(projectId, renamed.name)
  return renamed.name
}
