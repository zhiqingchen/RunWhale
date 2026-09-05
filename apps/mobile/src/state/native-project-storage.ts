import { PROJECT_STORAGE_CHUNK_LENGTH, type ProjectSnapshotStorage } from './project-data'

const KEY = 'runwhale.projects.v3'

/** Publish a new chunk generation only after every chunk has been durably read back. */
export function nativeProjectStorage(storage: ProjectSnapshotStorage) {
  return {
    async read(): Promise<string | null> {
      const raw = await storage.getItem(KEY)
      if (raw === null) return null
      const keys: unknown = JSON.parse(raw)
      if (!Array.isArray(keys) || !keys.length || !keys.every((key) => typeof key === 'string' && key.startsWith(`${KEY}:`))) throw new Error('Saved project manifest is invalid.')
      const chunks = new Map(await storage.multiGet(keys))
      return keys.map((key) => {
        const chunk = chunks.get(key)
        if (typeof chunk !== 'string') throw new Error('Saved project drafts are incomplete.')
        return chunk
      }).join('')
    },
    async write(value: string): Promise<void> {
      const previous = await storage.getItem(KEY)
      const generation = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
      const entries: [string, string][] = []
      for (let offset = 0; offset < value.length;) {
        let end = Math.min(offset + PROJECT_STORAGE_CHUNK_LENGTH, value.length)
        if (end < value.length && /[\uD800-\uDBFF]/u.test(value[end - 1]!)) end--
        entries.push([`${KEY}:${generation}:${entries.length}`, value.slice(offset, end)])
        offset = end
      }
      await storage.multiSet(entries)
      const verified = new Map(await storage.multiGet(entries.map(([key]) => key)))
      if (entries.some(([key, chunk]) => verified.get(key) !== chunk)) throw new Error('Project drafts could not be verified.')
      const manifest = JSON.stringify(entries.map(([key]) => key))
      await storage.multiSet([[KEY, manifest]])
      if (await storage.getItem(KEY) !== manifest) throw new Error('Project metadata could not be verified.')
      if (previous) await storage.multiRemove(JSON.parse(previous) as string[]).catch(() => undefined)
    },
  }
}
