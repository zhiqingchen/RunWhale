export const PROJECT_SHORTCUT_NAME_LIMIT = 40

export function isShortcutProjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,62}$/.test(value)
}

export function projectLaunchUrl(projectId: string): string {
  if (!isShortcutProjectId(projectId)) throw new Error('Invalid project identifier')
  return `runwhale://run/${projectId}`
}

export function projectIdFromLaunchUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    const id = url.pathname.slice(1)
    if (url.protocol === 'runwhale:' && url.hostname === 'run' && !url.username && !url.password && !url.port && isShortcutProjectId(id)) return id
  } catch { /* Other incoming links are handled by the router. */ }
  return undefined
}

export function isShortcutNameValid(value: string): boolean {
  const name = value.trim()
  return name.length > 0 && name.length <= PROJECT_SHORTCUT_NAME_LIMIT && !/[\u0000-\u001f\u007f]/.test(name)
}

export interface ProjectShortcutAppearance {
  name: string
  iconUri?: string
}
