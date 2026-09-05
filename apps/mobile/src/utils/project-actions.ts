export interface ProjectActionTarget {
  projectId: string
  name: string
}

export type ProjectActionState =
  | { phase: 'closed' }
  | { phase: 'confirm-delete'; target: ProjectActionTarget; status: 'idle' | 'deleting' | 'failed'; error?: string }

export type ProjectActionEvent =
  | { type: 'request-delete'; target: ProjectActionTarget }
  | { type: 'begin-delete' }
  | { type: 'delete-failed'; error: string }
  | { type: 'delete-succeeded' }
  | { type: 'dismiss' }

export const closedProjectActionState: ProjectActionState = { phase: 'closed' }

export function projectActionReducer(state: ProjectActionState, event: ProjectActionEvent): ProjectActionState {
  if (event.type === 'delete-failed' && state.phase === 'confirm-delete' && state.status === 'deleting') {
    return { ...state, status: 'failed', error: event.error }
  }
  if (event.type === 'delete-succeeded') return closedProjectActionState
  if (state.phase === 'confirm-delete' && state.status === 'deleting') return state
  if (event.type === 'dismiss') return closedProjectActionState
  if (event.type === 'request-delete') {
    return { phase: 'confirm-delete', target: event.target, status: 'idle' }
  }
  if (event.type === 'begin-delete' && state.phase === 'confirm-delete') {
    return { ...state, status: 'deleting', error: undefined }
  }
  return state
}

export async function performProjectDeletion({
  projectId,
  deleteRuntime,
  removeLocal,
  clearDrafts,
}: {
  projectId: string
  deleteRuntime(projectId: string): Promise<unknown>
  removeLocal(projectId: string): Promise<void>
  clearDrafts(projectId: string): Promise<void>
}): Promise<void> {
  await deleteRuntime(projectId)
  await removeLocal(projectId)
  await clearDrafts(projectId)
}

export function omitProjectRecordEntry<T>(
  values: Readonly<Record<string, T>>,
  projectId: string,
): Record<string, T> {
  if (values[projectId] === undefined) return values as Record<string, T>
  const next = { ...values }
  delete next[projectId]
  return next
}
