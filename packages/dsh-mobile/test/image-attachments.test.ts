import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMobileHarness, MobileImageAttachmentStore, type NativeSecretStore } from '../src/index.js'

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

class MemorySecrets implements NativeSecretStore {
  async get() { return undefined }
  async set() {}
  async delete() {}
}

describe('mobile image attachments', () => {
  it('stores content-addressed images and verifies durable reads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-images-'))
    const ctx = new Context()
    await ctx.plugin(MobileImageAttachmentStore, { root })
    const [ref] = await ctx.attachments.saveImages([{ data: PIXEL, mediaType: 'image/png', name: '../pixel.png' }])
    expect(ref).toMatchObject({ mediaType: 'image/png', width: 1, height: 1, bytes: PIXEL.byteLength, name: 'pixel.png' })
    expect((await ctx.attachments.readImage(ref!)).data).toEqual(PIXEL)
    expect(await ctx.attachments.readImageRequest(ref!, { maxBytes: 1024, maxPixels: 10 })).toMatchObject({ attachment: ref, width: 1, height: 1 })
    await expect(ctx.attachments.saveImage({ data: PIXEL, mediaType: 'image/jpeg' })).rejects.toMatchObject({ code: 'IMAGE_TYPE_MISMATCH' })
    await ctx.fiber.dispose()
  })

  it('logs image references before user text and reopens them after a restart', async () => {
    const attachmentRoot = await mkdtemp(join(tmpdir(), 'runwhale-image-session-'))
    const options = { mode: 'deterministic' as const, secrets: new MemorySecrets(), deterministicReply: 'I can see the image.', attachmentRoot }
    const first = await createMobileHarness(options)
    const initial = await first.run({ sessionId: 'image-session', prompt: 'Use this screenshot', seed: [], attachments: [{ data: PIXEL, mediaType: 'image/png', name: 'screen.png' }] })
    const user = initial.events.find((event) => event.type === 'user/message')
    const message = (user?.type === 'user/message' ? ('message' in user.data ? user.data.message : user.data) : undefined) as { content: Array<{ type: string; attachment?: ImageAttachmentRef }> } | undefined
    expect(message?.content.map((block) => block.type)).toEqual(['image', 'text'])
    const image = message?.content.find((block) => block.type === 'image')
    await first.dispose()

    const restarted = await createMobileHarness(options)
    expect(image?.type === 'image' && image.attachment ? (await restarted.context.attachments.readImage(image.attachment)).data : undefined).toEqual(PIXEL)
    const continued = await restarted.run({ sessionId: 'image-session', prompt: 'Continue', seed: JSON.parse(JSON.stringify(initial.events)) })
    expect(continued.events.filter((event) => event.type === 'turn/end')).toHaveLength(2)
    await restarted.dispose()
  })
})
