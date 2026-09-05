import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PROTOCOL_LIMITS, MOBILE_HOST_PROTOCOL_VERSION } from '@runwhale/mobile-protocol'
import { MobileHostServer } from '../src/host-server.js'

let host: MobileHostServer | undefined
afterEach(async () => {
  await host?.stop(); host = undefined
})

describe('MobileHostServer', () => {
  it('binds localhost, authenticates and dispatches typed RPC', async () => {
    host = new MobileHostServer({ 'project.list': async () => [{ id: 'p', name: 'P', updatedAt: 1 }] })
    const info = await host.start()
    expect(info.origin).toMatch(/^http:\/\/127\.0\.0\.1:/)
    expect((await fetch(`${info.origin}/health`)).status).toBe(401)
    const response = await fetch(`${info.origin}/rpc`, {
      method: 'POST', headers: { authorization: `Bearer ${info.token}` },
      body: JSON.stringify({ v: MOBILE_HOST_PROTOCOL_VERSION, type: 'request', id: '1', method: 'project.list', params: {} }),
    })
    expect(await response.json()).toMatchObject({ ok: true, result: [{ id: 'p' }] })
  })

  it('accepts bulk RPC requests above the event payload limit', async () => {
    let receivedBytes = 0
    host = new MobileHostServer({
      'project.write': async ({ content }) => {
        receivedBytes = Buffer.byteLength(content)
        return { version: 'large-write' }
      },
    })
    const info = await host.start()
    const content = 'x'.repeat(10 * 1024 * 1024)
    const body = JSON.stringify({
      v: MOBILE_HOST_PROTOCOL_VERSION,
      type: 'request',
      id: 'large-write',
      method: 'project.write',
      params: { projectId: 'p', path: '.yarn/releases/yarn.cjs', content },
    })
    expect(Buffer.byteLength(body)).toBeGreaterThan(DEFAULT_PROTOCOL_LIMITS.maxPayloadBytes)
    expect(Buffer.byteLength(body)).toBeLessThan(DEFAULT_PROTOCOL_LIMITS.maxRequestBytes)

    const response = await fetch(`${info.origin}/rpc`, {
      method: 'POST', headers: { authorization: `Bearer ${info.token}` }, body,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, result: { version: 'large-write' } })
    expect(receivedBytes).toBe(Buffer.byteLength(content))
  })

  it('returns a structured error for oversized RPC requests and remains available', async () => {
    let handled = false
    host = new MobileHostServer({
      'project.write': async () => {
        handled = true
        return { version: 'unexpected' }
      },
      'project.list': async () => [],
    })
    const info = await host.start()
    const response = await fetch(`${info.origin}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}` },
      body: JSON.stringify({
        v: MOBILE_HOST_PROTOCOL_VERSION,
        type: 'request',
        id: 'oversized-write',
        method: 'project.write',
        params: { projectId: 'p', path: 'large.txt', content: 'x'.repeat(DEFAULT_PROTOCOL_LIMITS.maxRequestBytes) },
      }),
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: `protocol payload exceeds ${DEFAULT_PROTOCOL_LIMITS.maxRequestBytes} bytes`,
        retryable: false,
      },
    })
    expect(handled).toBe(false)

    const healthy = await fetch(`${info.origin}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}` },
      body: JSON.stringify({ v: MOBILE_HOST_PROTOCOL_VERSION, type: 'request', id: 'after-oversized', method: 'project.list', params: {} }),
    })
    expect(healthy.status).toBe(200)
    expect(await healthy.json()).toMatchObject({ ok: true, result: [] })
  })

  it('accepts the authenticated RunWhale stop endpoint', async () => {
    host = new MobileHostServer({})
    const info = await host.start()
    const response = await fetch(`${info.origin}/__runwhale/stop`, {
      method: 'POST', headers: { authorization: `Bearer ${info.token}` },
    })
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ stopping: true })
  })

  it('journals monotonic reconnect events', async () => {
    host = new MobileHostServer({})
    const info = await host.start()
    host.emit('preview.log', { line: 'one' })
    host.emit('preview.log', { line: 'two' })
    const response = await fetch(`${info.origin}/events?after=1`, { headers: { authorization: `Bearer ${info.token}` } })
    expect(await response.json()).toMatchObject({ gap: false, events: [{ sequence: 2 }] })
  })

  it('cancels an in-flight RPC with the typed ABORTED error', async () => {
    host = new MobileHostServer({
      'project.list': async (_params, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
    })
    const info = await host.start()
    const request = fetch(`${info.origin}/rpc`, {
      method: 'POST', headers: { authorization: `Bearer ${info.token}` },
      body: JSON.stringify({ v: MOBILE_HOST_PROTOCOL_VERSION, type: 'request', id: 'slow-request', method: 'project.list', params: {} }),
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    const cancellation = await fetch(`${info.origin}/rpc`, {
      method: 'POST', headers: { authorization: `Bearer ${info.token}` },
      body: JSON.stringify({ v: MOBILE_HOST_PROTOCOL_VERSION, type: 'cancel', id: 'cancel-1', requestId: 'slow-request', reason: 'user stopped task' }),
    })
    expect(await cancellation.json()).toMatchObject({ ok: true, result: { cancelled: true } })
    expect(await (await request).json()).toMatchObject({ error: { code: 'ABORTED', message: 'user stopped task', retryable: false } })
  })
})
