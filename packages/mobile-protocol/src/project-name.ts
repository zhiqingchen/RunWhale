export const MAX_PROJECT_NAME_LENGTH = 80

export type ProjectNameValidationIssue = 'empty' | 'too-long' | 'invalid-character'

export function normalizeProjectName(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

export function projectNameValidationIssue(value: string): ProjectNameValidationIssue | undefined {
  const normalized = normalizeProjectName(value)
  if (!normalized) return 'empty'
  if ([...normalized].length > MAX_PROJECT_NAME_LENGTH) return 'too-long'
  if (/[\u0000-\u001F\u007F/\\]/u.test(normalized) || normalized === '.' || normalized === '..') return 'invalid-character'
  return undefined
}

export function validatedProjectName(value: string): string {
  const normalized = normalizeProjectName(value)
  const issue = projectNameValidationIssue(normalized)
  if (issue) throw new Error(`invalid project name: ${issue}`)
  return normalized
}
