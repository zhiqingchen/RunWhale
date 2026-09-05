import { describe, expect, it } from 'vitest'
import { AGENT_IMAGE_MAX_BYTES, localImageUri, storedAgentImageUri, validateAgentImageAsset } from '../src/utils/agent-image'

describe('Agent image attachment validation', () => {
  it('accepts supported cached images using MIME type or a case-insensitive extension', () => {
    expect(validateAgentImageAsset({ uri: 'file:///cache/design%20review.png', name: 'design.png', mimeType: 'image/png', size: 42 })).toEqual({
      ok: true,
      draft: { sourcePath: '/cache/design review.png', name: 'design.png', mediaType: 'image/png', size: 42 },
    })
    expect(validateAgentImageAsset({ uri: 'file:///cache/photo', name: 'PHOTO.JPEG' })).toEqual({
      ok: true,
      draft: { sourcePath: '/cache/photo', name: 'PHOTO.JPEG', mediaType: 'image/jpeg' },
    })
    expect(validateAgentImageAsset({ uri: 'file:///cache/camera-capture', fileName: null, mimeType: 'image/jpeg', fileSize: 128 })).toEqual({
      ok: true,
      draft: { sourcePath: '/cache/camera-capture', name: 'camera-capture', mediaType: 'image/jpeg', size: 128 },
    })
  })

  it('rejects unsupported formats with a stable error code', () => {
    expect(validateAgentImageAsset({ uri: 'file:///cache/photo.heic', name: 'photo.heic', mimeType: 'image/heic' })).toEqual({ ok: false, error: 'unsupported' })
  })

  it('accepts the size limit and rejects an oversized image', () => {
    expect(validateAgentImageAsset({ uri: 'file:///cache/limit.gif', name: 'limit.gif', size: AGENT_IMAGE_MAX_BYTES }).ok).toBe(true)
    expect(validateAgentImageAsset({ uri: 'file:///cache/large.webp', name: 'large.webp', size: AGENT_IMAGE_MAX_BYTES + 1 })).toEqual({ ok: false, error: 'too-large' })
  })

  it('rejects images that are not represented by a valid local cache URI', () => {
    expect(validateAgentImageAsset({ uri: 'content://photo/1', name: 'photo.png' })).toEqual({ ok: false, error: 'cache-unavailable' })
    expect(validateAgentImageAsset({ uri: 'file:///cache/bad%ZZ.png', name: 'bad.png' })).toEqual({ ok: false, error: 'cache-unavailable' })
  })
})

describe('Agent image display paths', () => {
  it('encodes local file names for React Native image sources', () => {
    expect(localImageUri('/tmp/My image #1.png')).toBe('file:///tmp/My%20image%20%231.png')
  })

  it('maps only durable attachment identifiers into the runtime image store', () => {
    const id = `sha256-${'a'.repeat(64)}`
    expect(storedAgentImageUri('/runtime root/', id)).toBe(`file:///runtime%20root/.runwhale/attachments/${id}.bin`)
    expect(storedAgentImageUri('/runtime', '../../escape')).toBeUndefined()
  })
})
