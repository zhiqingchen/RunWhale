import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { RunWhaleRuntimeHost } from '../src/runtime-host.js'
import { encodeRelease, releaseHash } from '../src/app-library.js'
it('installs and opens an immutable app over real host RPC without a Workspace project or a build', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runwhale-app-rpc-'))
  const host = new RunWhaleRuntimeHost({
    root,
    moduleStore: join(root, 'absent-modules'),
    platform: 'ios',
    agent: { run: async () => ({ text: '' }) },
  })
  try {
    const info = await host.start()
    const rpc = async (method: string, params: unknown) => {
      const res = await fetch(info.origin + '/rpc', {
        method: 'POST',
        headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }),
      })
      const body = (await res.json()) as { ok: boolean; result: any; error: unknown }
      expect(body.ok, JSON.stringify(body.error)).toBe(true)
      return body.result
    }
    const bytes = encodeRelease({
      platform: 'web',
      code: 'globalThis.releaseLoaded=true',
      map: '',
      durationMs: 0,
      requestPath: '/.runwhale/metro-web-entry.bundle',
      webDocument: {
        html: '<html><body><div id="root">Installed</div></body></html>',
        assets: {
          '/icon.png': {
            content: Buffer.from('image').toString('base64'),
            contentType: 'image/png',
          },
        },
      },
    })
    const t = await rpc('library.begin', {
      appId: 'app-one',
      versionId: 'version-one',
      name: 'Demo',
      platform: 'web',
      sha256: releaseHash(bytes),
      bytes: bytes.length,
    })
    await rpc('library.chunk', { id: t.id, offset: 0, chunk: bytes.toString('base64') })
    await rpc('library.commit', { id: t.id })
    expect(await rpc('project.list', {})).toEqual([])
    const endpoint = await rpc('library.open', { appId: 'app-one' })
    expect(endpoint.restricted).toBe(true)
    expect(await (await fetch(endpoint.bundleUrl)).text()).toBe('globalThis.releaseLoaded=true')
    expect((await fetch(`http://127.0.0.1:${endpoint.port}/`)).status).toBe(401)
    const document = await fetch(`http://127.0.0.1:${endpoint.port}/?token=${endpoint.token}`)
    expect(document.headers.get('content-security-policy')).toContain("connect-src 'none'")
    expect(document.headers.get('content-security-policy')).toContain("frame-src 'none'")
    expect(document.headers.get('permissions-policy')).toContain('camera=()')
    expect(await document.text()).toContain('Installed')
    const asset = await fetch(`http://127.0.0.1:${endpoint.port}/icon.png?token=${endpoint.token}`)
    expect(asset.headers.get('content-security-policy')).toContain("connect-src 'none'")
    expect(await asset.text()).toBe('image')
    expect(await rpc('preview.stop', { projectId: endpoint.projectId })).toEqual({ stopped: true })
    const again = await rpc('library.open', { appId: 'app-one' })
    expect(again.token).not.toBe(endpoint.token)
  } finally {
    await host.stop()
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
