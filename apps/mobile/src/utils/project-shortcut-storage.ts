import AsyncStorage from '@react-native-async-storage/async-storage'
import { Image } from 'react-native'
import { isShortcutNameValid, projectLaunchUrl, type ProjectShortcutAppearance } from './project-shortcut'

function storageKey(projectId: string): string {
  projectLaunchUrl(projectId)
  return `runwhale.project-shortcut.v1:${projectId}`
}

export async function loadProjectShortcut(projectId: string): Promise<ProjectShortcutAppearance | undefined> {
  const source = await AsyncStorage.getItem(storageKey(projectId))
  if (!source) return undefined
  const saved: unknown = JSON.parse(source)
  if (!saved || typeof saved !== 'object' || !('name' in saved) || typeof saved.name !== 'string' || !isShortcutNameValid(saved.name)) throw new Error('Saved shortcut is invalid')
  const { File, Paths } = await import('expo-file-system')
  const icon = 'icon' in saved && typeof saved.icon === 'string' && /^[a-z0-9-]+\.png$/.test(saved.icon)
    ? new File(Paths.document, 'project-shortcuts', projectId, saved.icon)
    : undefined
  return { name: saved.name, ...(icon?.exists ? { iconUri: icon.uri } : {}) }
}

export async function prepareShortcutIcon(uri?: string): Promise<string> {
  const { Asset } = await import('expo-asset')
  const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator')
  const source = uri ?? (await Asset.fromModule(require('../../assets/images/runwhale-icon.png')).downloadAsync()).localUri
  if (!source) throw new Error('Shortcut image is unavailable')
  const { width, height } = await Image.getSize(source)
  const side = Math.min(width, height)
  const result = await manipulateAsync(source, [
    { crop: { originX: (width - side) / 2, originY: (height - side) / 2, width: side, height: side } },
    { resize: { width: 512, height: 512 } },
  ], { format: SaveFormat.PNG })
  return result.uri
}

export async function saveProjectShortcut(projectId: string, appearance: ProjectShortcutAppearance): Promise<ProjectShortcutAppearance & { iconUri: string }> {
  const key = storageKey(projectId)
  if (!isShortcutNameValid(appearance.name)) throw new Error('Shortcut name is invalid')
  const { Directory, File, Paths } = await import('expo-file-system')
  const directory = new Directory(Paths.document, 'project-shortcuts', projectId)
  directory.create({ intermediates: true, idempotent: true })
  const iconUri = await prepareShortcutIcon(appearance.iconUri)
  const file = new File(directory, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.png`)
  await new File(iconUri).copy(file)
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ name: appearance.name.trim(), icon: file.name }))
  } catch (cause) {
    file.delete()
    throw cause
  }
  // Metadata refers to the new image before old images are removed.
  for (const entry of directory.list()) {
    if (entry instanceof File && entry.name !== file.name) {
      try { entry.delete() } catch { /* A later save can prune an old image. */ }
    }
  }
  return { name: appearance.name.trim(), iconUri: file.uri }
}

export async function removeProjectShortcutAppearance(projectId: string): Promise<void> {
  const key = storageKey(projectId)
  const { Directory, Paths } = await import('expo-file-system')
  const directory = new Directory(Paths.document, 'project-shortcuts', projectId)
  if (directory.exists) directory.delete()
  await AsyncStorage.removeItem(key)
}
