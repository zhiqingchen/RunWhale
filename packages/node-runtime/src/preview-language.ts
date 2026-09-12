import type { ServerResponse } from 'node:http'
import { isAppLanguage, type AppLanguage } from '@runwhale/mobile-protocol'

/** Only the Studio RPC writes this snapshot; Preview has a read-only endpoint. */
export class PreviewLanguage {
  private language: AppLanguage | undefined
  private revision = 0
  private readonly pending = new Set<() => void>()

  set(value: unknown): void {
    if (!isAppLanguage(value)) throw new Error('Unsupported RunWhale language')
    if (value === this.language) return
    this.language = value
    this.revision += 1
    this.pending.forEach(finish => finish())
  }

  read(after: string | null, response: ServerResponse): void {
    response.setHeader('cache-control', 'no-store')
    if (!this.language) {
      response.writeHead(503).end('RunWhale language is not ready')
      return
    }
    let timeout: NodeJS.Timeout | undefined
    const cleanup = () => {
      clearTimeout(timeout)
      this.pending.delete(finish)
      response.off('close', cleanup)
    }
    const finish = () => {
      cleanup()
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ language: this.language, revision: this.revision }))
    }
    if (after !== String(this.revision)) return finish()
    this.pending.add(finish)
    timeout = setTimeout(finish, 25_000)
    response.once('close', cleanup)
  }
}
