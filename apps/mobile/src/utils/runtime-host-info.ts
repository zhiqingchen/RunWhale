export interface RuntimeHostInfo {
  port: number
  token: string
  origin: string
  websocketUrl: string
  nodeVersion: string
  npmVersion?: string
  recoveryId?: string
}

export function parseRuntimeHostInfo(value: string | null | undefined): RuntimeHostInfo | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as Partial<RuntimeHostInfo>
    if (!Number.isInteger(parsed.port) || (parsed.port ?? 0) < 1 || (parsed.port ?? 0) > 65_535) return undefined
    if (typeof parsed.token !== 'string' || typeof parsed.origin !== 'string' || typeof parsed.websocketUrl !== 'string') return undefined
    const origin = new URL(parsed.origin)
    const websocket = new URL(parsed.websocketUrl)
    if (origin.protocol !== 'http:' || websocket.protocol !== 'ws:' || origin.hostname !== '127.0.0.1' || websocket.hostname !== '127.0.0.1') return undefined
    const { npmVersion: publishedNpmVersion, ...host } = parsed
    const npmVersion = typeof publishedNpmVersion === 'string' && publishedNpmVersion ? publishedNpmVersion : undefined
    return { ...host, ...(npmVersion ? { npmVersion } : {}) } as RuntimeHostInfo
  } catch { return undefined }
}
