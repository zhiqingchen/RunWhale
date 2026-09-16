import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const pending = new Map<string, Promise<string>>()

/** Local installation identity, excluded from Git and source exports. */
export function projectIdentity(root: string): Promise<string> {
  const key = resolve(root)
  const current = pending.get(key)
  if (current) return current
  const operation = readOrCreate(key).finally(() => pending.delete(key))
  pending.set(key, operation)
  return operation
}

async function readIdentity(file: string): Promise<string> {
  if (!(await lstat(file)).isFile()) throw new Error('Invalid project identity file')
  const id = (await readFile(file, 'utf8')).trim()
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) throw new Error('Invalid project identity')
  return id
}

async function readOrCreate(root: string): Promise<string> {
  const directory = join(root, '.runwhale')
  const file = join(directory, 'project-identity')
  await mkdir(directory, { recursive: true })
  if (!(await lstat(directory)).isDirectory()) throw new Error('Invalid project identity directory')
  try { return await readIdentity(file) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const temporary = join(directory, 'identity-' + randomUUID())
  try {
    await writeFile(temporary, randomUUID(), { flag: 'wx', mode: 0o600 })
    // The embedded host owns project writes. Coalesce its concurrent callers and
    // atomically install a complete UUID without Android-restricted hard links.
    await rename(temporary, file)
  } finally { await rm(temporary, { force: true }) }
  return readIdentity(file)
}
