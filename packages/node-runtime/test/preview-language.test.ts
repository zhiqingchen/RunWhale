import { describe, expect, it } from 'vitest'
import { MobileMetroRuntime } from '../src/metro-runtime.js'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

describe('Preview language boundary', () => {
  it('bundles the SDK for both native platforms and web from the shared store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-sdk-'))
    const repo = resolve(import.meta.dirname, '../../..')
    const metro = new MobileMetroRuntime(join(repo, 'packages/runtime-module-store/node_modules'), [join(repo, 'node_modules/.pnpm')])
    try {
      await writeFile(join(root, 'package.json'), JSON.stringify({ main: 'index.tsx' }))
      await mkdir(join(root, 'app'))
      await writeFile(join(root, 'app/index.tsx'), "import { useLanguage } from '@runwhale/sdk'; import { Text } from 'react-native'; export default function App() { const { language } = useLanguage(); return <Text>{language}</Text> }")
      for (const platform of ['ios', 'android', 'web'] as const) {
        const bundle = await metro.bundle(root, platform)
        expect(bundle.code).toContain('/__runwhale/sdk/v1/language')
        expect(bundle.code.includes(platform === 'web' ? 'navigator.language' : "get('RunWhaleSettings')"), `${platform} environment`).toBe(true)
      }
    } finally { await metro.stop(); await rm(root, { recursive: true, force: true }) }
  }, 120_000)
  it('authenticates read-only access, streams changes, and serves current preferences after reopening cached bytes', async () => {
    const metro = new MobileMetroRuntime('/unused')
    const bundle = { platform: 'ios' as const, restricted: true, code: '', map: '', durationMs: 0, requestPath: '/app.bundle' }
    try {
      const served = await metro.serve(bundle)
      const url = new URL('/__runwhale/sdk/v1/language', served.bundleUrl)
      expect((await fetch(url)).status).toBe(401)
      url.searchParams.set('token', served.token)
      expect((await fetch(url)).status).toBe(503)
      metro.language.set('fr')
      expect((await fetch(url, { method: 'POST' })).status).toBe(403)
      const initial = await (await fetch(url)).json()
      expect(initial.language).toBe('fr')
      url.searchParams.set('after', String(initial.revision))
      const changed = fetch(url).then(result => result.json())
      metro.language.set('ja')
      expect((await changed).language).toBe('ja')
      expect(() => metro.language.set('invalid')).toThrow('Unsupported')
      const reopened = await metro.serve(bundle, { live: false })
      const next = new URL('/__runwhale/sdk/v1/language', reopened.bundleUrl)
      next.searchParams.set('token', reopened.token)
      expect((await (await fetch(next)).json()).language).toBe('ja')
    } finally { await metro.stop() }
  })
})
