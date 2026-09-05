import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { MetroBundle, MetroPlatform } from './metro-runtime.js'

const PREVIEW_ARTIFACT_SCHEMA_VERSION = 2
const MAX_PREVIEW_BUNDLE_BYTES = 64 * 1024 * 1024
const MAX_PREVIEW_ARTIFACT_BYTES = 128 * 1024 * 1024

export interface PreviewArtifactKey {
  projectId: string
  platform: MetroPlatform
  runtimeAbi: string
}

export interface CachedPreviewBundle extends MetroBundle {
  revision: number
  builtAt: number
  codeBytes: Uint8Array
  mapBytes: Uint8Array
}

interface SerializedPreviewArtifact {
  schemaVersion: typeof PREVIEW_ARTIFACT_SCHEMA_VERSION
  projectId: string
  platform: MetroPlatform
  runtimeAbi: string
  revision: number
  builtAt: number
  durationMs: number
  requestPath: string
  code: string
  codeBytes: number
  codeSha256: string
  map: string
  mapBytes: number
  mapSha256: string
}

export async function writePreviewArtifact(
  projectRoot: string,
  key: PreviewArtifactKey,
  bundle: MetroBundle,
  revision: number,
): Promise<void> {
  assertPreviewArtifactKey(key)
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Preview artifact revision is invalid')
  if (bundle.platform !== key.platform) throw new Error('Preview artifact platform does not match its cache key')
  if (bundle.requestPath !== expectedRequestPath(key.platform)) throw new Error('Preview artifact has an unexpected bundle path')
  const code = bundle.codeBytes ? Buffer.from(bundle.codeBytes) : Buffer.from(bundle.code)
  const map = bundle.mapBytes ? Buffer.from(bundle.mapBytes) : Buffer.from(bundle.map)
  if (code.byteLength > MAX_PREVIEW_BUNDLE_BYTES || map.byteLength > MAX_PREVIEW_BUNDLE_BYTES) {
    throw new Error('Preview artifact exceeds the cache size limit')
  }
  const artifact: SerializedPreviewArtifact = {
    schemaVersion: PREVIEW_ARTIFACT_SCHEMA_VERSION,
    projectId: key.projectId,
    platform: key.platform,
    runtimeAbi: key.runtimeAbi,
    revision,
    builtAt: Date.now(),
    durationMs: bundle.durationMs,
    requestPath: bundle.requestPath,
    code: code.toString('utf8'),
    codeBytes: code.byteLength,
    codeSha256: sha256(code),
    map: map.toString('utf8'),
    mapBytes: map.byteLength,
    mapSha256: sha256(map),
  }
  const serialized = Buffer.from(`${JSON.stringify(artifact)}\n`)
  if (serialized.byteLength > MAX_PREVIEW_ARTIFACT_BYTES) throw new Error('Preview artifact exceeds the cache file size limit')

  const path = previewArtifactPath(projectRoot, key.platform)
  const directory = dirname(path)
  const temporary = resolve(directory, `.${key.platform}.${randomUUID()}.tmp`)
  await mkdir(directory, { recursive: true })
  try {
    await writeFile(temporary, serialized, { mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

export async function readPreviewArtifact(
  projectRoot: string,
  key: PreviewArtifactKey,
): Promise<CachedPreviewBundle | undefined> {
  try {
    assertPreviewArtifactKey(key)
    const path = previewArtifactPath(projectRoot, key.platform)
    const info = await lstat(path)
    if (!info.isFile() || info.size > MAX_PREVIEW_ARTIFACT_BYTES) return undefined
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!isSerializedPreviewArtifact(parsed, key)) return undefined
    const codeBytes = Buffer.from(parsed.code)
    const mapBytes = Buffer.from(parsed.map)
    if (
      codeBytes.byteLength !== parsed.codeBytes
      || mapBytes.byteLength !== parsed.mapBytes
      || codeBytes.byteLength > MAX_PREVIEW_BUNDLE_BYTES
      || mapBytes.byteLength > MAX_PREVIEW_BUNDLE_BYTES
      || sha256(codeBytes) !== parsed.codeSha256
      || sha256(mapBytes) !== parsed.mapSha256
    ) return undefined
    return {
      platform: parsed.platform,
      code: parsed.code,
      map: parsed.map,
      codeBytes,
      mapBytes,
      durationMs: parsed.durationMs,
      requestPath: parsed.requestPath,
      revision: parsed.revision,
      builtAt: parsed.builtAt,
    }
  } catch {
    // Missing, incompatible, or damaged cache entries are ordinary cache misses.
    return undefined
  }
}

export function previewArtifactPath(projectRoot: string, platform: MetroPlatform): string {
  if (!isMetroPlatform(platform)) throw new Error('invalid Preview artifact platform')
  return resolve(projectRoot, '.runwhale', 'cache', 'preview', `${platform}.json`)
}

function isSerializedPreviewArtifact(value: unknown, key: PreviewArtifactKey): value is SerializedPreviewArtifact {
  if (!isRecord(value)) return false
  return value.schemaVersion === PREVIEW_ARTIFACT_SCHEMA_VERSION
    && value.projectId === key.projectId
    && value.platform === key.platform
    && value.runtimeAbi === key.runtimeAbi
    && typeof value.revision === 'number'
    && Number.isSafeInteger(value.revision)
    && value.revision >= 1
    && value.requestPath === expectedRequestPath(key.platform)
    && isNonNegativeInteger(value.builtAt)
    && isNonNegativeInteger(value.durationMs)
    && typeof value.code === 'string'
    && isNonNegativeInteger(value.codeBytes)
    && isSha256(value.codeSha256)
    && typeof value.map === 'string'
    && isNonNegativeInteger(value.mapBytes)
    && isSha256(value.mapSha256)
}

function assertPreviewArtifactKey(key: PreviewArtifactKey): void {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(key.projectId)) throw new Error('invalid Preview artifact project id')
  if (!isMetroPlatform(key.platform)) throw new Error('invalid Preview artifact platform')
  if (typeof key.runtimeAbi !== 'string' || key.runtimeAbi.length === 0 || key.runtimeAbi.length > 256) throw new Error('invalid Preview artifact runtime ABI')
}

function expectedRequestPath(platform: MetroPlatform): string {
  return `/.runwhale/metro-${platform}-entry.bundle`
}

function isMetroPlatform(value: unknown): value is MetroPlatform {
  return value === 'android' || value === 'ios' || value === 'web'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
