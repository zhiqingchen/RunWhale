import { createHash } from 'node:crypto'
import type { ClientChannel, ConnectConfig } from 'ssh2'
import { Client, utils as sshUtils } from 'ssh2'
import type { GitHttpRequest, GitHttpResponse, HttpClient } from 'isomorphic-git'
import { normalizeGitRepositoryUrl } from './git.js'

const MAX_ADVERTISEMENT_BYTES = 4 * 1024 * 1024
const MAX_RESPONSE_BYTES = 120 * 1024 * 1024
const MAX_STDERR_BYTES = 16 * 1024
export const GITHUB_SSH_PRIVATE_KEY_REFERENCE = 'ref:GITHUB_SSH_PRIVATE_KEY'
const GITHUB_SSH_FINGERPRINTS = new Set([
  'uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s',
  'p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM',
  '+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU',
])

type GitSshService = 'git-upload-pack' | 'git-receive-pack'

interface GitSshSession {
  advertisement(): Promise<Uint8Array>
  exchange(body: AsyncIterableIterator<Uint8Array>): AsyncIterableIterator<Uint8Array>
  close(): void
}

interface GitHubSshHttpOptions {
  signal?: AbortSignal
  openSession?: (remote: GitHubSshRemote, privateKey: string, service: GitSshService, signal?: AbortSignal) => Promise<GitSshSession>
  createConnection?: () => Client
}

export interface GitHubSshRemote {
  url: string
  host: 'github.com' | 'ssh.github.com'
  port: 22 | 443
  owner: string
  repository: string
  path: string
  httpUrl: string
}

/**
 * Adapts GitHub's SSH smart-protocol channel to isomorphic-git's HTTP client
 * seam. The private key is held only by the closure for one operation.
 */
export function createGitHubSshHttpClient(repositoryUrl: string, privateKey: string, options: GitHubSshHttpOptions = {}): { remote: GitHubSshRemote; http: HttpClient; dispose(): void } {
  const remote = parseGitHubSshRemote(repositoryUrl)
  validateGitHubSshPrivateKey(privateKey)
  const sessions = new Map<GitSshService, GitSshSession>()
  const openSession = options.openSession ?? ((remote, key, service, signal) => openGitHubSshSession(remote, key, service, signal, options.createConnection))
  const closeAll = () => {
    for (const session of sessions.values()) session.close()
    sessions.clear()
  }
  const onAbort = () => closeAll()
  const dispose = () => {
    options.signal?.removeEventListener('abort', onAbort)
    closeAll()
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })

  return {
    remote,
    dispose,
    http: {
      async request(request: GitHttpRequest): Promise<GitHttpResponse> {
        throwIfAborted(options.signal)
        const service = requestService(request.url)
        if (request.method === 'GET') {
          sessions.get(service)?.close()
          const session = await openSession(remote, privateKey, service, options.signal)
          sessions.set(service, session)
          try {
            const advertisement = await session.advertisement()
            return response(request, `application/x-${service}-advertisement`, byteIterator([
              packetLine(`# service=${service}\n`),
              Buffer.from('0000'),
              advertisement,
            ]))
          } catch (error) {
            if (sessions.get(service) === session) sessions.delete(service)
            session.close()
            throw error
          }
        }
        if (request.method === 'POST' && request.body) {
          const session = sessions.get(service)
          if (!session) throw new Error(`GitHub SSH ${service} session was not discovered`)
          sessions.delete(service)
          return response(request, `application/x-${service}-result`, session.exchange(request.body))
        }
        throw new Error('GitHub SSH transport received an unsupported Git request')
      },
    },
  }
}

export function parseGitHubSshRemote(value: string): GitHubSshRemote {
  const normalized = normalizeGitRepositoryUrl(value)
  const url = new URL(normalized)
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'ssh:' || (host !== 'github.com' && host !== 'ssh.github.com')) throw new Error('GitHub SSH remote must use github.com')
  if ((url.username || 'git') !== 'git') throw new Error('GitHub SSH remote username must be git')
  const port = Number(url.port || (host === 'ssh.github.com' ? 443 : 22))
  if ((host === 'github.com' && port !== 22) || (host === 'ssh.github.com' && port !== 443)) throw new Error('GitHub SSH remote port is invalid')
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/').map((part) => decodeURIComponent(part))
  if (parts.length !== 2) throw new Error('GitHub SSH remote must name one owner and repository')
  const owner = parts[0]!
  const repository = parts[1]!.replace(/\.git$/i, '')
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(repository) || repository === '.' || repository === '..') {
    throw new Error('GitHub SSH repository owner or name is invalid')
  }
  const path = `${owner}/${repository}.git`
  return {
    url: `ssh://git@${host}${port === 22 ? '' : `:${port}`}/${path}`,
    host: host as GitHubSshRemote['host'],
    port: port as GitHubSshRemote['port'],
    owner,
    repository,
    path,
    httpUrl: `https://github.com/${path}`,
  }
}

export function verifyGitHubHostKey(key: Uint8Array): boolean {
  return GITHUB_SSH_FINGERPRINTS.has(createHash('sha256').update(key).digest('base64').replace(/=+$/u, ''))
}

export function generateGitHubSshKeyPair(): { publicKey: string; fingerprint: string; privateKeyOneTime: string } {
  const generated = sshUtils.generateKeyPairSync('ed25519', { comment: 'runwhale-device' })
  const fields = generated.public.trim().split(/\s+/)
  if (fields[0] !== 'ssh-ed25519' || !fields[1]) throw new Error('unable to encode Ed25519 public key')
  const blob = Buffer.from(fields[1], 'base64')
  return {
    publicKey: generated.public.trim(),
    fingerprint: `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/u, '')}`,
    privateKeyOneTime: generated.private,
  }
}

export function validateGitHubSshPrivateKey(value: string): void {
  if (!value || value.length > 64 * 1024 || value.includes('\0')) throw new Error('GitHub SSH private key is invalid')
  const parsed = sshUtils.parseKey(value)
  if (parsed instanceof Error) throw new Error('GitHub SSH private key is invalid')
  const keys = Array.isArray(parsed) ? parsed : [parsed]
  if (keys.length !== 1 || keys[0]?.type !== 'ssh-ed25519') throw new Error('GitHub SSH private key must use Ed25519')
}

async function openGitHubSshSession(
  remote: GitHubSshRemote,
  privateKey: string,
  service: GitSshService,
  signal?: AbortSignal,
  createConnection: () => Client = () => new Client(),
): Promise<GitSshSession> {
  throwIfAborted(signal)
  const connection = createConnection()
  return new Promise<GitSshSession>((resolve, reject) => {
    let settled = false
    let liveSession: LiveGitSshSession | undefined
    const fail = (cause: Error) => {
      const error = safeSshError(cause)
      if (liveSession) {
        liveSession.fail(error)
        return
      }
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      connection.end()
      reject(error)
    }
    const abort = () => fail(new Error('GitHub SSH operation was cancelled'))
    signal?.addEventListener('abort', abort, { once: true })
    connection.on('error', fail)
    connection.once('ready', () => {
      if (settled) return
      connection.exec(`${service} '${remote.path}'`, (error, opened) => {
        if (error) { fail(error); return }
        if (settled) { opened.close(); return }
        signal?.removeEventListener('abort', abort)
        liveSession = new LiveGitSshSession(connection, opened, signal)
        settled = true
        resolve(liveSession)
      })
    })
    const config: ConnectConfig = {
      host: remote.host,
      port: remote.port,
      username: 'git',
      privateKey,
      readyTimeout: 20_000,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 2,
      hostVerifier: (key: Buffer | string) => Buffer.isBuffer(key) && verifyGitHubHostKey(key),
      algorithms: {
        serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-512', 'rsa-sha2-256'],
      },
    }
    try {
      connection.connect(config)
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

class LiveGitSshSession implements GitSshSession {
  private readonly queue: ChannelQueue
  private stderr = ''
  private closed = false

  constructor(private readonly connection: Client, private readonly channel: ClientChannel, private readonly signal?: AbortSignal) {
    this.queue = new ChannelQueue(channel, signal)
    channel.stderr.on('data', (chunk: Buffer | string) => {
      if (Buffer.byteLength(this.stderr) >= MAX_STDERR_BYTES) return
      this.stderr = `${this.stderr}${String(chunk)}`.slice(0, MAX_STDERR_BYTES)
    })
    channel.stderr.on('error', (error: Error) => this.queue.fail(error))
    channel.on('exit', (code?: number) => {
      if (code && code !== 0) this.queue.fail(new Error(this.stderr.trim() || `GitHub SSH service exited with code ${code}`))
    })
  }

  fail(error: Error): void {
    this.queue.fail(error)
  }

  async advertisement(): Promise<Uint8Array> {
    return this.queue.readPacketSequence(MAX_ADVERTISEMENT_BYTES)
  }

  async * exchange(body: AsyncIterableIterator<Uint8Array>): AsyncIterableIterator<Uint8Array> {
    try {
      for await (const chunk of body) {
        throwIfAborted(this.signal)
        if (!this.channel.write(chunk)) await new Promise<void>((resolve) => this.channel.once('drain', resolve))
      }
      this.channel.end()
      let bytes = 0
      for await (const chunk of this.queue.remaining()) {
        bytes += chunk.byteLength
        if (bytes > MAX_RESPONSE_BYTES) throw new Error('GitHub SSH response exceeds 120 MB')
        yield chunk
      }
    } finally {
      this.close()
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.channel.close()
    this.connection.end()
  }
}

class ChannelQueue {
  private readonly chunks: Buffer[] = []
  private readonly waiters: Array<() => void> = []
  private buffered = Buffer.alloc(0)
  private ended = false
  private error?: Error

  constructor(channel: ClientChannel, signal?: AbortSignal) {
    channel.on('data', (chunk: Buffer | string) => { this.chunks.push(Buffer.from(chunk)); this.wake() })
    channel.once('end', () => { this.ended = true; this.wake() })
    channel.once('close', () => { this.ended = true; this.wake() })
    channel.on('error', (error: Error) => this.fail(error))
    signal?.addEventListener('abort', () => this.fail(new Error('GitHub SSH operation was cancelled')), { once: true })
  }

  fail(error: Error): void {
    this.error ??= safeSshError(error)
    this.ended = true
    this.wake()
  }

  async readPacketSequence(maximumBytes: number): Promise<Uint8Array> {
    while (true) {
      const end = packetSequenceEnd(this.buffered)
      if (end !== undefined) {
        const result = this.buffered.subarray(0, end)
        this.buffered = this.buffered.subarray(end)
        return result
      }
      const chunk = await this.next()
      if (!chunk) throw this.error ?? new Error('GitHub SSH service ended before advertising repository refs')
      this.buffered = Buffer.concat([this.buffered, chunk])
      if (this.buffered.byteLength > maximumBytes) throw new Error('GitHub SSH ref advertisement exceeds 4 MB')
    }
  }

  async * remaining(): AsyncIterableIterator<Uint8Array> {
    if (this.buffered.byteLength > 0) { yield this.buffered; this.buffered = Buffer.alloc(0) }
    while (true) {
      const chunk = await this.next()
      if (!chunk) {
        if (this.error) throw this.error
        return
      }
      yield chunk
    }
  }

  private async next(): Promise<Buffer | undefined> {
    while (this.chunks.length === 0 && !this.ended) await new Promise<void>((resolve) => this.waiters.push(resolve))
    if (this.chunks.length > 0) return this.chunks.shift()
    if (this.error) throw this.error
    return undefined
  }

  private wake(): void {
    for (const waiter of this.waiters.splice(0)) waiter()
  }
}

function requestService(value: string): GitSshService {
  const url = new URL(value)
  const service = url.searchParams.get('service') ?? url.pathname.split('/').at(-1)
  if (service !== 'git-upload-pack' && service !== 'git-receive-pack') throw new Error('GitHub SSH transport received an unknown Git service')
  return service
}

function response(request: GitHttpRequest, contentType: string, body: AsyncIterableIterator<Uint8Array>): GitHttpResponse {
  return {
    url: request.url,
    method: request.method,
    statusCode: 200,
    statusMessage: 'OK',
    headers: { 'content-type': contentType },
    body,
  }
}

function packetLine(value: string): Buffer {
  const body = Buffer.from(value)
  return Buffer.concat([Buffer.from((body.byteLength + 4).toString(16).padStart(4, '0')), body])
}

function packetSequenceEnd(buffer: Buffer): number | undefined {
  let offset = 0
  while (buffer.byteLength - offset >= 4) {
    const header = buffer.subarray(offset, offset + 4).toString('ascii')
    if (!/^[0-9a-f]{4}$/i.test(header)) throw new Error('GitHub SSH service returned an invalid packet line')
    const length = Number.parseInt(header, 16)
    if (length === 0) return offset + 4
    if (length < 4) throw new Error('GitHub SSH service returned an unsupported packet line')
    if (buffer.byteLength - offset < length) return undefined
    offset += length
  }
  return undefined
}

async function* byteIterator(chunks: readonly Uint8Array[]): AsyncIterableIterator<Uint8Array> {
  for (const chunk of chunks) yield chunk
}

function safeSshError(error: unknown): Error {
  const message = String(error instanceof Error ? error.message : error).replace(/-----BEGIN[\s\S]*?PRIVATE KEY-----/g, '[redacted private key]').slice(0, 500)
  return new Error(message || 'GitHub SSH transport failed')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('GitHub SSH operation was cancelled')
}
