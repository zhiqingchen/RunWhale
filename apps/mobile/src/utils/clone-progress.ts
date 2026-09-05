import type { HostEvent, ProjectClonePhase, ProjectCloneProgress } from '@runwhale/mobile-protocol'

const clonePhases = new Set<ProjectClonePhase>(['preparing', 'receiving', 'resolving', 'checkout', 'validating'])

export type CloneProgressMessageKey =
  | 'clonePreparingRepository'
  | 'cloneReceivingObjects'
  | 'cloneResolvingDeltas'
  | 'cloneWritingFiles'
  | 'cloneValidatingProject'

export function projectCloneProgressFromEvent(event: HostEvent): ProjectCloneProgress | undefined {
  if (event.name !== 'project.clone-progress' || typeof event.data !== 'object' || event.data === null || Array.isArray(event.data)) return undefined
  const data = event.data as Partial<ProjectCloneProgress>
  if (typeof data.requestId !== 'string' || data.requestId.length === 0) return undefined
  if (typeof data.phase !== 'string' || !clonePhases.has(data.phase as ProjectClonePhase)) return undefined
  if (typeof data.loaded !== 'number' || !Number.isFinite(data.loaded) || data.loaded < 0) return undefined
  if (data.total !== undefined && (typeof data.total !== 'number' || !Number.isFinite(data.total) || data.total < 0)) return undefined
  return {
    requestId: data.requestId,
    phase: data.phase as ProjectClonePhase,
    loaded: data.loaded,
    ...(data.total === undefined ? {} : { total: data.total }),
  }
}

export function cloneProgressPercent(progress: ProjectCloneProgress): number | undefined {
  if (progress.total === undefined || progress.total <= 0) return undefined
  return Math.max(0, Math.min(100, Math.round(progress.loaded / progress.total * 100)))
}

export function cloneProgressMessageKey(phase: ProjectClonePhase): CloneProgressMessageKey {
  if (phase === 'receiving') return 'cloneReceivingObjects'
  if (phase === 'resolving') return 'cloneResolvingDeltas'
  if (phase === 'checkout') return 'cloneWritingFiles'
  if (phase === 'validating') return 'cloneValidatingProject'
  return 'clonePreparingRepository'
}
