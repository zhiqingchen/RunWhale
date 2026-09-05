import { Platform } from 'react-native'

export type SessionLogAction = 'download' | 'share'

/** Export once, then hand the ZIP to the chosen native destination. */
export async function exportSessionLog(prepare: () => Promise<{ path: string }>, dialogTitle: string, action: SessionLogAction = 'download'): Promise<'saved' | undefined> {
  const { File, Directory, Paths } = await import('expo-file-system')
  const Sharing = action === 'share' ? await import('expo-sharing') : undefined
  if (Sharing && !await Sharing.isAvailableAsync()) throw new Error('Session log sharing is unavailable')
  const { path } = await prepare()
  const file = new File(path.startsWith('file://') ? path : `file://${path}`)
  const temporaryDirectory = file.parentDirectory
  try {
    if (Sharing) {
      if (Platform.OS === 'android') {
        // Android can dismiss its chooser before the recipient reads the file.
        // Retain that copy in OS-managed cache; prune old shares on the next use.
        const cache = new Directory(Paths.cache, 'session-log-shares')
        cache.create({ idempotent: true })
        for (const entry of cache.list()) {
          const createdAt = Number(entry.name.split('-')[0])
          if (Number.isFinite(createdAt) && createdAt < Date.now() - 24 * 60 * 60_000) entry.delete()
        }
        const sharedDirectory = new Directory(cache, `${Date.now()}-${temporaryDirectory.name}`)
        sharedDirectory.create()
        await file.move(sharedDirectory)
      }
      await Sharing.shareAsync(file.uri, { mimeType: 'application/zip', UTI: 'public.zip-archive', dialogTitle })
    } else {
      let destination: InstanceType<typeof Directory>
      try { destination = await Directory.pickDirectoryAsync() } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && (error.code === 'ERR_PICKER_CANCELLED' || error.code === 'ERR_FILE_PICKING_CANCELLED')) return
        throw error
      }
      const names = new Set(destination.list().map(entry => entry.name))
      const originalName = file.name
      let name = originalName
      for (let suffix = 1; names.has(name); suffix++) name = originalName.replace(/\.zip$/, ` (${suffix}).zip`)
      if (name !== originalName) file.rename(name)
      // Copy to the SAF directory: overwriting a pre-created document deletes
      // its URI before Expo opens the output stream on Android.
      try { await file.copy(destination) } catch (error) {
        const partial = destination.list().find(entry => entry.name === name)
        if (partial instanceof File) partial.delete()
        throw error
      }
      return 'saved'
    }
  } finally {
    temporaryDirectory.delete()
  }
}
