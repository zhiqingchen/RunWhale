const EXCLUDED_REFERENCE_SEGMENTS = new Set([
  '.runwhale',
  '.expo',
  '.git',
  '.next',
  '.nuxt',
  '.pnpm',
  '.turbo',
  '.yarn',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'web-build',
])

export type ProjectReferenceLoadState = 'loading' | 'failed' | 'ready'

export type ProjectReferenceLoadEvent = 'start' | 'fail' | 'succeed'

export function projectReferenceLoadReducer(_state: ProjectReferenceLoadState, event: ProjectReferenceLoadEvent): ProjectReferenceLoadState {
  if (event === 'start') return 'loading'
  if (event === 'fail') return 'failed'
  return 'ready'
}

export function isSafeProjectReferencePath(path: string): boolean {
  if (!path || path.includes('\0') || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false
  const segments = path.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return false
  return segments.every((segment) => !EXCLUDED_REFERENCE_SEGMENTS.has(segment.toLowerCase()))
}

export function filterProjectReferencePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.filter(isSafeProjectReferencePath))].sort((left, right) => left.localeCompare(right))
}

export function insertAgentReference(prompt: string, reference: string): string {
  const separator = prompt && !prompt.endsWith(' ') ? ' ' : ''
  return `${prompt}${separator}@${reference} `
}
