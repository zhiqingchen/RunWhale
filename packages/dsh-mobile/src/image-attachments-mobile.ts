import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AttachmentStore, { AttachmentError, AttachmentId, ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits, ImageAttachmentRef, ImageMediaType, ImageRequestPolicy, RequestImageAttachment, SaveImageAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'

export interface MobileImageAttachmentStoreConfig { root: string }

export class MobileImageAttachmentStore extends AttachmentStore {
  readonly root: string
  readonly imageLimits: ImageAttachmentLimits = Object.freeze({
    maxImageBytes: 5 * 1024 * 1024,
    maxImagesPerMessage: 4,
    maxMessageImageBytes: 12 * 1024 * 1024,
    maxImagePixels: 16_000_000,
    maxImageDimension: 8_192,
    mediaTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const),
  })

  constructor(ctx: Context, config: MobileImageAttachmentStoreConfig) {
    super(ctx)
    this.root = resolve(config.root)
  }

  async validateImage(input: SaveImageAttachment): Promise<void> { void inspectImage(input, this.imageLimits) }

  async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    const image = inspectImage(input, this.imageLimits)
    const digest = createHash('sha256').update(input.data).digest('hex')
    const attachmentId = AttachmentId(`sha256-${digest}`)
    const ref: ImageAttachmentRef = {
      attachmentId,
      mediaType: image.mediaType,
      bytes: input.data.byteLength,
      width: image.width,
      height: image.height,
      ...(input.name ? { name: input.name.replaceAll('\\', '/').split('/').pop()!.slice(0, 255) } : {}),
    }
    await mkdir(this.root, { recursive: true })
    await Promise.all([
      writeFile(join(this.root, `${attachmentId}.bin`), input.data, { mode: 0o600 }),
      writeFile(join(this.root, `${attachmentId}.json`), `${JSON.stringify(ref)}\n`, { mode: 0o600 }),
    ])
    return ref
  }

  async readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment> {
    signal?.throwIfAborted()
    let data: Buffer
    try { data = await readFile(join(this.root, `${safeAttachmentId(ref.attachmentId)}.bin`)) }
    catch (cause) { throw new AttachmentError('Mobile image attachment was not found.', 'ATTACHMENT_NOT_FOUND', { cause }) }
    signal?.throwIfAborted()
    const digest = `sha256-${createHash('sha256').update(data).digest('hex')}`
    if (digest !== ref.attachmentId || data.byteLength !== ref.bytes) throw new AttachmentError('Mobile image attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
    const inspected = inspectImage({ data, mediaType: ref.mediaType }, this.imageLimits)
    if (inspected.width !== ref.width || inspected.height !== ref.height) throw new AttachmentError('Mobile image dimensions do not match the durable reference.', 'ATTACHMENT_CORRUPT')
    return { ref, data }
  }

  override async readImageRequest(ref: ImageAttachmentRef, policy: ImageRequestPolicy, signal?: AbortSignal): Promise<RequestImageAttachment> {
    const stored = await this.readImage(ref, signal)
    if (stored.data.byteLength > policy.maxBytes || ref.width * ref.height > policy.maxPixels) {
      throw new AttachmentError('This image exceeds the selected model route limits; choose a smaller image.', 'ATTACHMENT_PROJECTION_UNSUPPORTED')
    }
    return {
      variantId: ImageVariantId(createHash('sha256').update(`${ref.attachmentId}:${policy.maxBytes}:${policy.maxPixels}`).digest('hex')),
      attachment: ref,
      data: stored.data,
      mediaType: ref.mediaType,
      bytes: stored.data.byteLength,
      width: ref.width,
      height: ref.height,
      depth: 'uchar',
      space: 'srgb',
      hasAlpha: ref.mediaType === 'image/png' || ref.mediaType === 'image/webp' || ref.mediaType === 'image/gif',
    }
  }
}

function inspectImage(input: SaveImageAttachment, limits: ImageAttachmentLimits): { mediaType: ImageMediaType; width: number; height: number } {
  const data = Buffer.from(input.data.buffer, input.data.byteOffset, input.data.byteLength)
  if (data.byteLength === 0) throw new AttachmentError('Image data is empty.', 'INVALID_IMAGE')
  if (data.byteLength > limits.maxImageBytes) throw new AttachmentError('Image exceeds the mobile attachment byte limit.', 'IMAGE_TOO_LARGE')
  const detected = detectImage(data)
  if (!detected) throw new AttachmentError('Image bytes are invalid or unsupported.', 'INVALID_IMAGE')
  if (detected.mediaType !== input.mediaType) throw new AttachmentError('Declared image type does not match its bytes.', 'IMAGE_TYPE_MISMATCH')
  if (detected.width > limits.maxImageDimension || detected.height > limits.maxImageDimension) throw new AttachmentError('Image dimensions exceed the mobile limit.', 'IMAGE_DIMENSION_TOO_LARGE')
  if (detected.width * detected.height > limits.maxImagePixels) throw new AttachmentError('Image contains too many pixels.', 'IMAGE_TOO_MANY_PIXELS')
  return detected
}

function detectImage(data: Buffer): { mediaType: ImageMediaType; width: number; height: number } | undefined {
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return dimensions('image/png', data.readUInt32BE(16), data.readUInt32BE(20))
  }
  if (data.length >= 10 && (data.subarray(0, 6).toString('ascii') === 'GIF87a' || data.subarray(0, 6).toString('ascii') === 'GIF89a')) {
    return dimensions('image/gif', data.readUInt16LE(6), data.readUInt16LE(8))
  }
  if (data.length >= 30 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    const kind = data.subarray(12, 16).toString('ascii')
    if (kind === 'VP8X') return dimensions('image/webp', readUInt24LE(data, 24) + 1, readUInt24LE(data, 27) + 1)
    if (kind === 'VP8 ' && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) return dimensions('image/webp', data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff)
    if (kind === 'VP8L' && data[20] === 0x2f) {
      const bits = data.readUInt32LE(21)
      return dimensions('image/webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
    }
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) { offset += 1; continue }
      const marker = data[offset + 1]!
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue }
      const size = data.readUInt16BE(offset + 2)
      if (size < 2 || offset + 2 + size > data.length) return undefined
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return dimensions('image/jpeg', data.readUInt16BE(offset + 7), data.readUInt16BE(offset + 5))
      }
      offset += 2 + size
    }
  }
  return undefined
}

function dimensions(mediaType: ImageMediaType, width: number, height: number) {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 ? { mediaType, width, height } : undefined
}
function readUInt24LE(data: Buffer, offset: number): number { return data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) }
function safeAttachmentId(value: unknown): string {
  const id = String(value)
  if (!/^sha256-[a-f0-9]{64}$/.test(id)) throw new AttachmentError('Invalid mobile attachment reference.', 'INVALID_ATTACHMENT_REF')
  return id
}
