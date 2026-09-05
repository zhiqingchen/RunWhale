import { unwatchFile, watchFile } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface TransportRecoveryRequest { id: string; revision: number }

// Native writes this mailbox atomically. Stat polling survives inode replacement
// and suspension without depending on a socket or a filesystem notification.
export function watchTransportRecovery(
  directory: string,
  recover: (request: TransportRecoveryRequest) => Promise<void>,
  onError: (error: unknown) => void,
): () => void {
  const filename = 'transport-recovery.json'
  const file = join(directory, filename)
  let stopped = false
  let pending: Promise<void> | undefined
  let dirty = false
  let lastId: string | undefined
  const check = () => {
    dirty = true
    if (pending || stopped) return
    pending = (async () => {
      while (dirty && !stopped) {
        dirty = false
        try {
          const request = JSON.parse(await readFile(file, 'utf8')) as TransportRecoveryRequest
          if (stopped || typeof request.id !== 'string' || !request.id || !Number.isSafeInteger(request.revision) || request.revision < 0 || request.id === lastId) continue
          lastId = request.id
          await recover(request)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') onError(error)
        }
      }
    })().finally(() => {
      pending = undefined
      if (dirty && !stopped) check()
    })
  }
  watchFile(file, { interval: 1_000 }, check)
  check()
  return () => { stopped = true; unwatchFile(file, check) }
}
