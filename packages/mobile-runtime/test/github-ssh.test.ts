import { EventEmitter } from 'node:events'
import type { Client, ClientCallback, ClientChannel } from 'ssh2'
import { describe, expect, it } from 'vitest'
import * as git from 'isomorphic-git'
import { createGitHubSshHttpClient, generateGitHubSshKeyPair, parseGitHubSshRemote, verifyGitHubHostKey } from '../src/github-ssh.js'

describe('GitHub SSH transport', () => {
  it('normalizes GitHub SCP and port 443 SSH remotes', () => {
    expect(parseGitHubSshRemote('git@github.com:openai/openai-node.git')).toMatchObject({
      url: 'ssh://git@github.com/openai/openai-node.git',
      host: 'github.com',
      port: 22,
      owner: 'openai',
      repository: 'openai-node',
      httpUrl: 'https://github.com/openai/openai-node.git',
    })
    expect(parseGitHubSshRemote('ssh://git@ssh.github.com:443/openai/openai-node')).toMatchObject({ host: 'ssh.github.com', port: 443 })
    expect(() => parseGitHubSshRemote('git@gitlab.com:openai/openai-node.git')).toThrow(/GitHub SSH/)
    expect(() => parseGitHubSshRemote('ssh://owner@github.com/openai/openai-node.git')).toThrow(/username/)
  })

  it('pins an official GitHub host key', () => {
    const key = Buffer.from('AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl', 'base64')
    expect(verifyGitHubHostKey(key)).toBe(true)
    expect(verifyGitHubHostKey(Buffer.from('untrusted'))).toBe(false)
  })

  it('adapts SSH advertisements and exchanges to smart HTTP without exposing the private key', async () => {
    const privateKey = generateGitHubSshKeyPair().privateKeyOneTime
    const oid = '1'.repeat(40)
    const advertisement = Buffer.concat([
      pkt(`${oid} HEAD\0symref=HEAD:refs/heads/main agent=git/test\n`),
      pkt(`${oid} refs/heads/main\n`),
      Buffer.from('0000'),
    ])
    const requestChunks: Buffer[] = []
    let closed = false
    const transport = createGitHubSshHttpClient('git@github.com:openai/openai-node.git', privateKey, {
      openSession: async () => ({
        advertisement: async () => advertisement,
        async * exchange(body) {
          for await (const chunk of body) requestChunks.push(Buffer.from(chunk))
          yield Buffer.from('0008NAK\n')
        },
        close: () => { closed = true },
      }),
    })
    const discovered = await transport.http.request({ method: 'GET', url: `${transport.remote.httpUrl}/info/refs?service=git-upload-pack`, headers: {} })
    expect(discovered.headers?.['content-type']).toBe('application/x-git-upload-pack-advertisement')
    expect((await collect(discovered.body)).toString()).toBe(`001e# service=git-upload-pack\n0000${advertisement.toString()}`)

    let refsCloseCalls = 0
    const refsTransport = createGitHubSshHttpClient('git@github.com:openai/openai-node.git', privateKey, {
      openSession: async () => ({ advertisement: async () => advertisement, async * exchange() {}, close() { refsCloseCalls += 1 } }),
    })
    expect(await git.listServerRefs({ http: refsTransport.http, url: refsTransport.remote.httpUrl, protocolVersion: 1, symrefs: true })).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: 'HEAD', oid, target: 'refs/heads/main' }),
      expect.objectContaining({ ref: 'refs/heads/main', oid }),
    ]))
    expect(refsCloseCalls).toBe(0)
    refsTransport.dispose()
    refsTransport.dispose()
    expect(refsCloseCalls).toBe(1)

    const connected = await transport.http.request({
      method: 'POST',
      url: `${transport.remote.httpUrl}/git-upload-pack`,
      headers: {},
      body: chunks([Buffer.from('0009done\n')]),
    })
    expect((await collect(connected.body)).toString()).toBe('0008NAK\n')
    expect(Buffer.concat(requestChunks).toString()).toBe('0009done\n')
    expect(closed).toBe(false)
  })

  it('rejects setup errors while keeping later connection errors handled', async () => {
    const connection = createFakeConnection()
    connection.connect = () => {
      connection.emit('error', new Error('SSH authentication failed'))
      connection.emit('error', new Error('late setup error'))
      return connection
    }
    const transport = createGitHubSshHttpClient('git@github.com:openai/openai-node.git', generateGitHubSshKeyPair().privateKeyOneTime, {
      createConnection: () => connection as unknown as Client,
    })

    await expect(discover(transport)).rejects.toThrow('SSH authentication failed')
    expect(connection.listenerCount('error')).toBe(1)
    expect(() => connection.emit('error', new Error('another late setup error'))).not.toThrow()
  })

  it.each(['connection', 'channel'] as const)('rejects an in-flight advertisement on repeated %s errors', async (source) => {
    const connection = createFakeConnection()
    const channel = createFakeChannel()
    connection.connect = () => {
      queueMicrotask(() => connection.emit('ready'))
      return connection
    }
    connection.exec = (_command, callback) => {
      callback(undefined, channel as unknown as ClientChannel)
      queueMicrotask(() => {
        const target = source === 'connection' ? connection : channel
        target.emit('error', new Error(`${source} disconnected`))
        target.emit('error', new Error(`repeated ${source} error`))
      })
      return connection
    }
    const transport = createGitHubSshHttpClient('git@github.com:openai/openai-node.git', generateGitHubSshKeyPair().privateKeyOneTime, {
      createConnection: () => connection as unknown as Client,
    })

    await expect(discover(transport)).rejects.toThrow(`${source} disconnected`)
    const target = source === 'connection' ? connection : channel
    expect(target.listenerCount('error')).toBe(1)
    expect(() => target.emit('error', new Error(`late ${source} error`))).not.toThrow()
    expect(channel.closeCalls).toBe(1)
    expect(connection.endCalls).toBe(1)
  })
})

type FakeConnection = EventEmitter & {
  connect: () => FakeConnection
  exec: (command: string, callback: ClientCallback) => FakeConnection
  end: () => FakeConnection
  endCalls: number
}

type FakeChannel = EventEmitter & {
  stderr: EventEmitter
  write: (chunk: Uint8Array) => boolean
  end: () => void
  close: () => void
  closeCalls: number
}

function createFakeConnection(): FakeConnection {
  const connection = new EventEmitter() as FakeConnection
  connection.connect = () => connection
  connection.exec = () => connection
  connection.endCalls = 0
  connection.end = () => {
    connection.endCalls += 1
    return connection
  }
  return connection
}

function createFakeChannel(): FakeChannel {
  const channel = new EventEmitter() as FakeChannel
  channel.stderr = new EventEmitter()
  channel.write = () => true
  channel.end = () => {}
  channel.closeCalls = 0
  channel.close = () => { channel.closeCalls += 1 }
  return channel
}

async function discover(transport: ReturnType<typeof createGitHubSshHttpClient>) {
  return transport.http.request({ method: 'GET', url: `${transport.remote.httpUrl}/info/refs?service=git-upload-pack`, headers: {} })
}

async function collect(body?: AsyncIterableIterator<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = []
  if (body) for await (const chunk of body) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function* chunks(values: readonly Uint8Array[]): AsyncIterableIterator<Uint8Array> {
  for (const value of values) yield value
}

function pkt(value: string): Buffer {
  const body = Buffer.from(value)
  return Buffer.concat([Buffer.from((body.byteLength + 4).toString(16).padStart(4, '0')), body])
}
