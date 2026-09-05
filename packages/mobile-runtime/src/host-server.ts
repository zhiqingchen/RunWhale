import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  DEFAULT_PROTOCOL_LIMITS,
  EventJournal,
  MOBILE_HOST_PROTOCOL_VERSION,
  ProtocolDecodeError,
  decodeClientEnvelope,
  encodedBytes,
  type HostEvent,
  type HostEventName,
  type MobileError,
  type MobileHostRequestMap,
  type MobileHostMethod,
  type RequestEnvelope,
  type ResponseEnvelope,
} from '@runwhale/mobile-protocol'
import { WebSocket, WebSocketServer } from 'ws'

export interface RpcServerInfo { port: number; token: string; origin: string; websocketUrl: string }
export type RpcHandler<M extends MobileHostMethod> = (
  params: MobileHostRequestMap[M]['params'],
  context: { signal: AbortSignal; request: RequestEnvelope<M> },
) => MobileHostRequestMap[M]['result'] | Promise<MobileHostRequestMap[M]['result']>
export type RpcHandlers = { [M in MobileHostMethod]?: RpcHandler<M> }

class RequestAbortedError extends Error {}
class RequestTimeoutError extends Error {}

export class MobileHostServer {
  private server: Server | undefined
  private readonly sockets = new Set<WebSocket>()
  private readonly active = new Map<string, AbortController>()
  private readonly journal = new EventJournal()
  constructor(private readonly handlers: RpcHandlers) {}

  get lastEventSequence(): number { return this.journal.lastSequence }

  eventsAfter(sequence = 0): HostEvent[] { return this.journal.after(sequence) }

  async start(): Promise<RpcServerInfo> {
    if (this.server) throw new Error('mobile host server is already running')
    const token = randomBytes(32).toString('base64url')
    const ws = new WebSocketServer({ noServer: true, maxPayload: DEFAULT_PROTOCOL_LIMITS.maxPayloadBytes })
    const server = createServer((request, response) => { void this.route(request, response, token) })
    server.on('upgrade', (request, socket, head) => {
      if (!this.authorized(request, token) || new URL(request.url ?? '/', 'http://localhost').pathname !== '/events') {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      ws.handleUpgrade(request, socket, head, (client) => {
        this.sockets.add(client)
        client.once('close', () => this.sockets.delete(client))
        const after = Number(new URL(request.url ?? '/', 'http://localhost').searchParams.get('after') ?? 0)
        for (const event of this.journal.after(Number.isSafeInteger(after) && after >= 0 ? after : 0)) client.send(JSON.stringify(event))
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('host server did not bind a TCP port')
    this.server = server
    const origin = `http://127.0.0.1:${address.port}`
    return { port: address.port, token, origin, websocketUrl: `ws://127.0.0.1:${address.port}/events?token=${encodeURIComponent(token)}` }
  }

  emit<T>(name: HostEventName, data: T): HostEvent<T> {
    const event = this.journal.append(name, data)
    const wire = JSON.stringify(event)
    for (const socket of this.sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue
      if (socket.bufferedAmount + encodedBytes(wire) > DEFAULT_PROTOCOL_LIMITS.maxQueuedBytes) {
        socket.close(1013, 'backpressure')
      } else socket.send(wire)
    }
    return event
  }

  async stop(): Promise<void> {
    for (const controller of this.active.values()) controller.abort(new RequestAbortedError('runtime stopped'))
    this.active.clear()
    for (const socket of this.sockets) socket.close(1001, 'runtime stopped')
    this.sockets.clear()
    const server = this.server
    this.server = undefined
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }

  private async route(request: IncomingMessage, response: ServerResponse, token: string): Promise<void> {
    response.setHeader('cache-control', 'no-store')
    response.setHeader('content-type', 'application/json')
    if (!this.authorized(request, token)) return this.json(response, 401, { error: 'unauthorized' })
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (request.method === 'GET' && url.pathname === '/health') return this.json(response, 200, { ok: true, node: process.version, sequence: this.journal.lastSequence })
    if (request.method === 'GET' && url.pathname === '/events') {
      const after = Number(url.searchParams.get('after') ?? 0)
      if (!Number.isSafeInteger(after) || after < 0) return this.json(response, 400, { error: 'invalid sequence' })
      return this.json(response, 200, { events: this.journal.after(after), gap: this.journal.hasGapAfter(after) })
    }
    if (request.method === 'POST' && url.pathname === '/__runwhale/stop') {
      this.json(response, 202, { stopping: true })
      queueMicrotask(() => { void this.stop() })
      return
    }
    if (request.method !== 'POST' || url.pathname !== '/rpc') return this.json(response, 404, { error: 'not found' })
    try {
      const envelope = decodeClientEnvelope(await this.readBody(request), DEFAULT_PROTOCOL_LIMITS.maxRequestBytes)
      if (envelope.type === 'cancel') {
        const controller = this.active.get(envelope.requestId)
        controller?.abort(new RequestAbortedError(envelope.reason ?? 'cancelled'))
        return this.json(response, 200, this.success(envelope.id, envelope.requestId, { cancelled: Boolean(controller) }))
      }
      const handler = this.handlers[envelope.method] as RpcHandler<typeof envelope.method> | undefined
      if (!handler) return this.json(response, 200, this.failure(envelope.id, envelope.id, { code: 'UNSUPPORTED', message: `unsupported method: ${envelope.method}`, retryable: false }))
      const controller = new AbortController()
      this.active.set(envelope.id, controller)
      const timeout = setTimeout(() => controller.abort(new RequestTimeoutError('request timed out')), envelope.timeoutMs ?? DEFAULT_PROTOCOL_LIMITS.requestTimeoutMs)
      try {
        const result = await handler(envelope.params, { signal: controller.signal, request: envelope })
        if (controller.signal.aborted) throw controller.signal.reason
        return this.json(response, 200, this.success(envelope.id, envelope.id, result))
      } finally {
        clearTimeout(timeout)
        this.active.delete(envelope.id)
      }
    } catch (error) {
      const protocol = error instanceof ProtocolDecodeError
      const aborted = error instanceof RequestAbortedError
      const timedOut = error instanceof RequestTimeoutError
      const mobileError: MobileError = {
        code: protocol ? error.code : aborted ? 'ABORTED' : timedOut ? 'TIMEOUT' : 'INTERNAL',
        message: error instanceof Error ? error.message : String(error),
        retryable: timedOut || (!protocol && !aborted),
      }
      const status = protocol ? error.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400 : 500
      return this.json(response, status, { error: mobileError })
    }
  }

  private readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let bytes = 0
      let overflowed = false
      request.on('data', (chunk: Buffer) => {
        if (overflowed) return
        bytes += chunk.byteLength
        if (bytes > DEFAULT_PROTOCOL_LIMITS.maxRequestBytes) {
          overflowed = true
          chunks.length = 0
          reject(new ProtocolDecodeError(`protocol payload exceeds ${DEFAULT_PROTOCOL_LIMITS.maxRequestBytes} bytes`, 'PAYLOAD_TOO_LARGE'))
        } else chunks.push(chunk)
      })
      request.once('end', () => {
        if (!overflowed) resolve(Buffer.concat(chunks).toString('utf8'))
      })
      request.once('error', reject)
    })
  }

  private authorized(request: IncomingMessage, expected: string): boolean {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const header = request.headers.authorization
    const supplied = header?.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token')
    if (!supplied) return false
    const left = Buffer.from(supplied)
    const right = Buffer.from(expected)
    return left.byteLength === right.byteLength && timingSafeEqual(left, right)
  }

  private success(id: string, requestId: string, result: unknown): ResponseEnvelope {
    return { v: MOBILE_HOST_PROTOCOL_VERSION, type: 'response', id: `response:${id}`, requestId, ok: true, result }
  }

  private failure(id: string, requestId: string, error: MobileError): ResponseEnvelope {
    return { v: MOBILE_HOST_PROTOCOL_VERSION, type: 'response', id: `response:${id}`, requestId, ok: false, error }
  }

  private json(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status)
    response.end(JSON.stringify(value))
  }
}
