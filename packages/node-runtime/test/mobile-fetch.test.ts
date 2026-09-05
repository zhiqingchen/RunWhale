import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installJitlessFetch } from '../src/mobile-fetch.js'
import { MobileGitRepository } from '@runwhale/mobile-runtime'

const nativeGlobals = {
  fetch: globalThis.fetch,
  Headers: globalThis.Headers,
  Request: globalThis.Request,
  Response: globalThis.Response,
  FormData: globalThis.FormData,
  Blob: globalThis.Blob,
  File: globalThis.File,
  CompressionStream: globalThis.CompressionStream,
  DecompressionStream: globalThis.DecompressionStream,
}

afterEach(() => Object.assign(globalThis, nativeGlobals))

describe('jitless fetch fallback', () => {
  it('performs loopback HTTP without Node bundled fetch', async () => {
    expect(installJitlessFetch(true)).toBe(true)
    const server = createServer((_request, response) => response.end('jitless-fetch-ok'))
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('test server did not bind')
      expect(await (await fetch(`http://127.0.0.1:${address.port}`)).text()).toBe('jitless-fetch-ok')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('uses the pure-JavaScript compression path for valid Git objects', async () => {
    expect(installJitlessFetch(true)).toBe(true)
    expect(globalThis.CompressionStream).toBeUndefined()
    expect(globalThis.DecompressionStream).toBeUndefined()

    const root = await mkdtemp(join(tmpdir(), 'runwhale-jitless-git-'))
    await writeFile(join(root, 'README.md'), '# Jitless Git\n')
    const repository = new MobileGitRepository(root)
    expect(await repository.ensureInitialized()).toBe(true)
    expect((await repository.log(1))[0]?.message).toBe('Initialize RunWhale project')

    const objectDirectories = await readdir(join(root, '.git', 'objects'))
    const firstDirectory = objectDirectories.find((name) => /^[0-9a-f]{2}$/.test(name))
    expect(firstDirectory).toBeDefined()
    const firstObject = (await readdir(join(root, '.git', 'objects', firstDirectory!)))[0]
    expect(firstObject).toBeDefined()
    const bytes = await readFile(join(root, '.git', 'objects', firstDirectory!, firstObject!))
    expect(bytes.toString('utf8')).not.toBe('[object ReadableStream]')
  })
})
