import type { MobileImageMediaType } from '@runwhale/mobile-protocol'

export const AGENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024

export interface AgentImageDraft {
  sourcePath: string
  name: string
  mediaType: MobileImageMediaType
  size?: number
}

export interface AgentImagePickerAsset {
  uri: string
  name?: string | null
  fileName?: string | null
  mimeType?: string
  size?: number
  fileSize?: number
}

export type AgentImageValidationError = 'unsupported' | 'too-large' | 'cache-unavailable'

export type AgentImageValidationResult =
  | { ok: true; draft: AgentImageDraft }
  | { ok: false; error: AgentImageValidationError }

export function validateAgentImageAsset(asset: AgentImagePickerAsset): AgentImageValidationResult {
  const sourcePath = localFilePath(asset.uri)
  if (!sourcePath) return { ok: false, error: 'cache-unavailable' }
  const sourceName = asset.name ?? asset.fileName ?? fileNameFromPath(sourcePath)
  const mediaType = imageMediaType(asset.mimeType, sourceName)
  if (!mediaType) return { ok: false, error: 'unsupported' }
  const size = asset.size ?? asset.fileSize
  if ((size ?? 1) > AGENT_IMAGE_MAX_BYTES) return { ok: false, error: 'too-large' }
  return {
    ok: true,
    draft: {
      sourcePath,
      name: sourceName || `image.${imageExtension(mediaType)}`,
      mediaType,
      ...(size === undefined ? {} : { size }),
    },
  }
}

function fileNameFromPath(path: string): string {
  return path.split('/').pop() ?? ''
}

function imageExtension(mediaType: MobileImageMediaType): string {
  if (mediaType === 'image/jpeg') return 'jpg'
  return mediaType.slice('image/'.length)
}

export function localImageUri(path: string): string {
  return `file://${path.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`
}

export function storedAgentImageUri(runtimeRoot: string, attachmentId: string): string | undefined {
  if (!runtimeRoot || !/^sha256-[a-f0-9]{64}$/.test(attachmentId)) return undefined
  return localImageUri(`${runtimeRoot.replace(/\/+$/, '')}/.runwhale/attachments/${attachmentId}.bin`)
}

function imageMediaType(mimeType: string | undefined, name: string): MobileImageMediaType | undefined {
  if (mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp' || mimeType === 'image/gif') return mimeType
  const extension = name.split('.').pop()?.toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'gif') return 'image/gif'
  return undefined
}

function localFilePath(uri: string): string | undefined {
  if (!uri.startsWith('file://')) return undefined
  try {
    return decodeURIComponent(uri.slice('file://'.length))
  } catch {
    return undefined
  }
}
