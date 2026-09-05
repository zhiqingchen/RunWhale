import { join, resolve } from 'node:path'
import { connect } from 'node:net'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { MobileMetroRuntime } from '../src/metro-runtime.js'

describe('MobileMetroRuntime', () => {
  it('publishes an immediate atomic source replacement before the next build', async () => {
    const project = await mkdtemp(join(tmpdir(), 'runwhale-metro-atomic-'))
    const source = join(project, 'app.tsx')
    await writeFile(source, 'export default "before"\n')
    const metro = new MobileMetroRuntime(resolve(import.meta.dirname, '../../..'))
    const internals = metro as any
    const publishFileChange = vi.spyOn(internals, 'publishFileChange').mockResolvedValue(undefined)
    try {
      await internals.synchronizeProjectChanges(project)
      const temporary = `${source}.runwhale-test.tmp`
      await writeFile(temporary, 'export default "after!"\n')
      await rename(temporary, source)

      await expect(internals.synchronizeProjectChanges(project)).resolves.toBe(true)
      expect(publishFileChange).toHaveBeenCalledWith(project, source, 'modified')
    } finally {
      await metro.stop()
      await rm(project, { recursive: true, force: true })
    }
  })

  it('attempts all cleanup and drops stale state when stopping fails', async () => {
    const metro = new MobileMetroRuntime(resolve(import.meta.dirname, '../../..'))
    const closeAllConnections = vi.fn()
    const end = vi.fn().mockRejectedValue(new Error('bundler cleanup failed'))
    Object.assign(metro, {
      server: {
        close: (callback: (error?: Error) => void) => callback(new Error('server cleanup failed')),
        closeAllConnections,
      },
      bundler: { key: 'project\0ios', middleware: { end } },
    })

    await expect(metro.stop()).rejects.toThrow('server cleanup failed')
    expect(closeAllConnections).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(1)
    expect((metro as any).server).toBeUndefined()
    expect((metro as any).bundler).toBeUndefined()
  })

  it('bundles every Native Preview acceptance signal for both native platforms in production', async () => {
    const previousEnvironment = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    const repository = resolve(import.meta.dirname, '../../..')
    const project = resolve(import.meta.dirname, 'fixtures/native-preview')
    const metro = new MobileMetroRuntime(
      resolve(repository, 'packages/runtime-module-store/node_modules'),
      [resolve(repository, 'node_modules/.pnpm')],
      false,
    )
    try {
      for (const platform of ['ios', 'android'] as const) {
        const result = await metro.bundle(project, platform)
        expect((metro as unknown as { bundler?: { hmrGraphId?: string } }).bundler?.hmrGraphId).toBeUndefined()
        expectNativePreviewAcceptanceSignals(result.code)
        expect(result.code).not.toContain("Deep imports from the 'react-native' package are deprecated")

        const served = await metro.serve(result)
        const servedUrl = new URL(served.bundleUrl)
        expect(servedUrl.searchParams.get('dev')).toBe('false')
        expect(servedUrl.searchParams.get('hot')).toBe('false')
        const previewResponse = await fetch(served.bundleUrl, { signal: AbortSignal.timeout(90_000) })
        expect(previewResponse.status).toBe(200)
        const previewCode = await previewResponse.text()
        expect(previewCode).toBe(result.code)
        expectNativePreviewAcceptanceSignals(previewCode)
        expect(previewCode).not.toContain("Deep imports from the 'react-native' package are deprecated")

      }
    } finally {
      await metro.stop()
      if (previousEnvironment === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousEnvironment
    }
  }, 240_000)

  it('builds the same Expo Router project for web, iOS, and Android', async () => {
    const previousEnvironment = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    const repository = resolve(import.meta.dirname, '../../..')
    const project = await createExpoTestProject()
    const metro = new MobileMetroRuntime(
      resolve(repository, 'packages/runtime-module-store/node_modules'),
      [resolve(repository, 'node_modules/.pnpm')],
      false,
    )
    try {
      for (const platform of ['web', 'ios', 'android'] as const) {
        const result = await metro.bundle(project, platform)
        expect(result.code.length).toBeGreaterThan(100_000)
        expect(JSON.parse(result.map)).toMatchObject({ version: 3 })
        if (platform === 'ios') {
          const nativeMetroServer = (metro as any).bundler?.middleware.metroServer as { _serverOptions?: { watch?: boolean } } | undefined
          expect(nativeMetroServer?._serverOptions?.watch).toBe(false)

          const source = join(project, 'app/index.tsx')
          const temporary = `${source}.atomic.tmp`
          await writeFile(temporary, "import { Text, View } from 'react-native'\nexport default function App() { return <View><Text>Updated runtime test</Text></View> }\n")
          await rename(temporary, source)
          const incremental = await metro.bundle(project, platform)
          expect(incremental.bundlerKey).toBe(result.bundlerKey)
          expect(incremental.code).toContain('Updated runtime test')
          expect(incremental.code).not.toContain('Runtime test project')
        }
      }
    } finally {
      await metro.stop()
      await rm(project, { recursive: true, force: true })
      if (previousEnvironment === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousEnvironment
    }
  }, 120_000)

  it('bundles a standard React Web entry without requiring Expo or native targets', async () => {
    const previousEnvironment = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    const repository = resolve(import.meta.dirname, '../../..')
    const project = await mkdtemp(join(tmpdir(), 'runwhale-react-web-'))
    await mkdir(join(project, 'src'))
    await writeFile(join(project, 'runwhale.json'), `${JSON.stringify({ schemaVersion: 1, id: 'plain-react-web', name: 'Plain React Web', runtimeAbi: {}, entry: { web: 'src/main.tsx' }, capabilities: [], tasks: {}, source: { kind: 'local' } }, null, 2)}\n`)
    await writeFile(join(project, 'package.json'), `${JSON.stringify({ name: 'plain-react-web', private: true, dependencies: { react: '19.2.3', 'react-dom': '19.2.3' } }, null, 2)}\n`)
    await writeFile(join(project, 'src/main.tsx'), "import React from 'react'\nimport { createRoot } from 'react-dom/client'\ncreateRoot(document.getElementById('root')!).render(<main>Plain React Web</main>)\n")
    const metro = new MobileMetroRuntime(resolve(repository, 'packages/runtime-module-store/node_modules'), [resolve(repository, 'node_modules/.pnpm')], false)
    try {
      const result = await metro.bundle(project, 'web')
      expect(result.code.length).toBeGreaterThan(100_000)
      expect(result.code).toContain('Plain React Web')
      expect(result.code).toContain("searchParams.get('hot')")
      const source = join(project, 'src/main.tsx')
      const temporary = `${source}.atomic.tmp`
      await writeFile(temporary, "import React from 'react'\nimport { createRoot } from 'react-dom/client'\ncreateRoot(document.getElementById('root')!).render(<main>Updated React Web</main>)\n")
      await rename(temporary, source)
      const updated = await metro.bundle(project, 'web')
      expect(updated.code).toContain('Updated React Web')
      expect(updated.code).not.toContain('Plain React Web')
      const served = await metro.serve(updated)
      expect(new URL(served.bundleUrl).searchParams.get('hot')).toBe('true')
      await expect(metro.bundle(project, 'android')).rejects.toThrow(/does not declare a Preview entry for android/)
    } finally {
      await metro.stop()
      await rm(project, { recursive: true, force: true })
      if (previousEnvironment === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousEnvironment
    }
  }, 90_000)

  it('uses the platform-safe Expo registration path for a source entry', async () => {
    const previousEnvironment = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    const repository = resolve(import.meta.dirname, '../../..')
    const project = await mkdtemp(join(tmpdir(), 'runwhale-expo-source-'))
    await mkdir(join(project, 'src'))
    await Promise.all([
      writeFile(join(project, 'index.ts'), "import registerRootComponent from 'expo/src/launch/registerRootComponent'\nimport App from './src/App'\nregisterRootComponent(App)\n"),
      writeFile(join(project, 'src/App.tsx'), "import { Text, View } from 'react-native'\nexport default function App() { return <View><Text>Expo source preview</Text></View> }\n"),
      writeFile(join(project, 'package.json'), `${JSON.stringify({ name: 'expo-source-preview', private: true, dependencies: { expo: '57.0.19', react: '19.2.3', 'react-native': '0.86.3' } })}\n`),
      writeFile(join(project, 'runwhale.json'), `${JSON.stringify({ schemaVersion: 1, id: 'expo-source-preview', name: 'Expo source preview', runtimeAbi: {}, entry: { web: 'index.ts', ios: 'index.ts', android: 'index.ts' }, capabilities: [], tasks: {}, source: { kind: 'local' } })}\n`),
    ])
    const metro = new MobileMetroRuntime(resolve(repository, 'packages/runtime-module-store/node_modules'), [resolve(repository, 'node_modules/.pnpm')], false)
    try {
      const web = await metro.bundle(project, 'web')
      expect(web.code.length).toBeGreaterThan(100_000)
      expect(web.code).toContain('Expo source preview')
      expect(web.code).not.toContain('setUpDefaultReactNativeEnvironment')
      for (const platform of ['ios', 'android'] as const) {
        const native = await metro.bundle(project, platform)
        expect(native.code.length).toBeGreaterThan(100_000)
        expect(native.code).toContain('Expo source preview')
        expect(native.code).toContain('globalThis.expo.EventEmitter')
      }
    } finally {
      await metro.stop()
      await rm(project, { recursive: true, force: true })
      if (previousEnvironment === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousEnvironment
    }
  }, 120_000)

  it('routes Native Preview storage through the project-scoped host modules', async () => {
    const repository = resolve(import.meta.dirname, '../../..')
    const project = await mkdtemp(join(tmpdir(), 'runwhale-native-module-policy-'))
    await Promise.all([
      writeFile(join(project, 'runwhale.json'), `${JSON.stringify({ schemaVersion: 1, id: 'native-module-policy', name: 'Native module policy', runtimeAbi: { android: 'runwhale-expo57-android-v1', ios: 'runwhale-expo57-ios-v1' }, entry: { android: 'index.ts', ios: 'index.ts' }, preview: { target: 'native' }, capabilities: [], tasks: {}, source: { kind: 'local' } })}\n`),
      writeFile(join(project, 'package.json'), `${JSON.stringify({ name: 'native-module-policy', private: true, dependencies: { '@react-native-async-storage/async-storage': '2.2.0', 'expo-file-system': '57.0.6' } })}\n`),
      writeFile(join(project, 'index.ts'), "import AsyncStorage from '@react-native-async-storage/async-storage'\nimport * as FileSystem from 'expo-file-system'\nglobalThis.preview = { AsyncStorage, FileSystem }\n"),
    ])
    const metro = new MobileMetroRuntime(resolve(repository, 'packages/runtime-module-store/node_modules'), [resolve(repository, 'node_modules/.pnpm')], false)
    try {
      for (const platform of ['ios', 'android'] as const) {
        const bundle = await metro.bundle(project, platform)
        expect(bundle.code).toContain('RunWhalePreviewStorage')
        expect(bundle.code).toContain('ExpoFileSystem')
        expect(bundle.code).not.toContain('RNCAsyncStorage')
      }
    } finally {
      await metro.stop()
      await rm(project, { recursive: true, force: true })
    }
  }, 30_000)

  it('does not let a project override a Native Preview ABI package', async () => {
    const repository = resolve(import.meta.dirname, '../../..')
    const project = await mkdtemp(join(tmpdir(), 'runwhale-native-module-pin-'))
    await mkdir(join(project, 'node_modules/expo-haptics'), { recursive: true })
    await Promise.all([
      writeFile(join(project, 'runwhale.json'), `${JSON.stringify({ schemaVersion: 1, id: 'native-module-pin', name: 'Native module pin', runtimeAbi: { android: 'runwhale-expo57-android-v1' }, entry: { android: 'index.ts' }, preview: { target: 'native' }, capabilities: [], tasks: {}, source: { kind: 'local' } })}\n`),
      writeFile(join(project, 'package.json'), `${JSON.stringify({ name: 'native-module-pin', private: true, dependencies: { 'expo-haptics': '0.0.0-project-copy' } })}\n`),
      writeFile(join(project, 'node_modules/expo-haptics/package.json'), `${JSON.stringify({ name: 'expo-haptics', version: '0.0.0-project-copy', main: 'index.js' })}\n`),
      writeFile(join(project, 'node_modules/expo-haptics/index.js'), "export const projectOverride = 'PROJECT_NATIVE_OVERRIDE'\n"),
      writeFile(join(project, 'index.ts'), "import * as Haptics from 'expo-haptics'\nglobalThis.preview = Haptics\n"),
    ])
    const metro = new MobileMetroRuntime(resolve(repository, 'packages/runtime-module-store/node_modules'), [resolve(repository, 'node_modules/.pnpm')], false)
    try {
      const bundle = await metro.bundle(project, 'android')
      expect(bundle.code).not.toContain('PROJECT_NATIVE_OVERRIDE')
      expect(bundle.code).toContain('ExpoHaptics')
    } finally {
      await metro.stop()
      await rm(project, { recursive: true, force: true })
    }
  }, 90_000)

  it('stops promptly even while a Preview client keeps its socket alive', async () => {
    const metro = new MobileMetroRuntime(resolve(import.meta.dirname, '../../..'))
    const served = await metro.serve({ platform: 'ios', code: 'globalThis.preview = true', map: '{}', durationMs: 1, requestPath: '/index.bundle' })
    const url = new URL(served.bundleUrl)
    const socket = connect(served.port, '127.0.0.1')
    await new Promise<void>((resolveConnected, reject) => {
      socket.once('connect', resolveConnected)
      socket.once('error', reject)
    })
    socket.write(`GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n`)
    try {
      await expect(Promise.race([
        metro.stop().then(() => 'stopped'),
        new Promise<string>((resolveTimeout) => setTimeout(() => resolveTimeout('timeout'), 1_000)),
      ])).resolves.toBe('stopped')
      await expect(fetch(served.bundleUrl, { signal: AbortSignal.timeout(1_000) })).rejects.toThrow()
    } finally {
      socket.destroy()
      await metro.stop()
    }
  })

  it('serves cached Web Preview bytes without exposing a stale HMR endpoint', async () => {
    const metro = new MobileMetroRuntime(resolve(import.meta.dirname, '../../..'))
    const bundle = {
      platform: 'web' as const,
      code: 'globalThis.preview = "cached whale 🐋"\n',
      map: '{"version":3,"sources":[],"mappings":""}',
      durationMs: 1,
      requestPath: '/.runwhale/metro-web-entry.bundle',
    }
    const expectedCode = Buffer.from(bundle.code)
    const expectedMap = Buffer.from(bundle.map)
    const served = await metro.serve(bundle, { live: false })
    bundle.code = 'globalThis.preview = "mutated after serving"\n'
    bundle.map = '{}'
    try {
      const bundleUrl = new URL(served.bundleUrl)
      expect(bundleUrl.searchParams.get('hot')).toBe('false')
      expect(Buffer.from(await (await fetch(bundleUrl)).arrayBuffer())).toEqual(expectedCode)

      const mapUrl = new URL(bundleUrl)
      mapUrl.pathname = '/index.map'
      expect(Buffer.from(await (await fetch(mapUrl)).arrayBuffer())).toEqual(expectedMap)

      const pageUrl = new URL(bundleUrl)
      pageUrl.pathname = '/'
      const html = await (await fetch(pageUrl)).text()
      expect(html).toContain('hot=false')
      expect(html).not.toContain('hot=true')
    } finally {
      await metro.stop()
    }
  })

  it('surfaces bundle syntax errors and can release the failed graph', async () => {
    const previousEnvironment = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    const repository = resolve(import.meta.dirname, '../../..')
    const project = await mkdtemp(join(tmpdir(), 'runwhale-metro-error-'))
    await mkdir(join(project, 'app'))
    await writeFile(join(project, 'package.json'), '{"name":"broken-preview","private":true}\n')
    await writeFile(join(project, 'app/index.tsx'), 'export default function Broken( {\n')
    const metro = new MobileMetroRuntime(resolve(repository, 'node_modules'), [resolve(repository, 'node_modules/.pnpm')], false)
    try {
      await expect(metro.bundle(project, 'android')).rejects.toThrow()
    } finally {
      await metro.stop()
      if (previousEnvironment === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousEnvironment
    }
  }, 60_000)

  it('publishes Fast Refresh deltas over a localhost HMR socket', async () => {
    const previousEnvironment = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    const repository = resolve(import.meta.dirname, '../../..')
    const project = await mkdtemp(join(tmpdir(), 'runwhale-metro-hmr-'))
    const entry = join(project, 'app/index.tsx')
    await mkdir(join(project, 'app'))
    await writeFile(join(project, 'package.json'), '{"name":"hmr-preview","private":true}\n')
    await writeFile(entry, "import React from 'react'\nimport { Text } from 'react-native'\nexport default function App() { return <Text>before</Text> }\n")
    const metro = new MobileMetroRuntime(resolve(repository, 'packages/runtime-module-store/node_modules'), [resolve(repository, 'node_modules/.pnpm')], false, true)
    let socket: WebSocket | undefined
    try {
      const bundle = await metro.bundle(project, 'web')
      const served = await metro.serve(bundle)
      const initialBundle = await fetch(served.bundleUrl)
      expect(initialBundle.status).toBe(200)
      expect((await initialBundle.text()).length).toBeGreaterThan(100_000)
      const hmrUrl = new URL(served.bundleUrl)
      hmrUrl.protocol = 'ws:'
      hmrUrl.pathname = '/hot'
      hmrUrl.search = ''
      socket = new WebSocket(hmrUrl)
      await new Promise<void>((resolveOpen, reject) => {
        socket?.once('open', resolveOpen)
        socket?.once('error', reject)
      })
      const messages: Array<{ type?: string; body?: { isInitialUpdate?: boolean; modified?: unknown[] } }> = []
      socket.on('message', (wire) => messages.push(JSON.parse(String(wire))))
      socket.send(JSON.stringify({ type: 'register-entrypoints', entryPoints: [served.bundleUrl] }))
      await waitForMessage(messages, (message) => message.type === 'bundle-registered')
      await writeFile(entry, "import React from 'react'\nimport { Text } from 'react-native'\nexport default function App() { return <Text>after</Text> }\n")
      const update = await waitForMessage(messages, (message) => message.type === 'update' && message.body?.isInitialUpdate === false)
      expect(update.body?.modified?.length).toBeGreaterThan(0)
    } finally {
      socket?.close()
      await metro.stop()
      await rm(project, { recursive: true, force: true })
      if (previousEnvironment === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousEnvironment
    }
  }, 90_000)
})

async function createExpoTestProject(): Promise<string> {
  const project = await mkdtemp(join(tmpdir(), 'runwhale-expo-test-'))
  await mkdir(join(project, 'app'))
  await Promise.all([
    writeFile(join(project, 'app/_layout.tsx'), "import { Stack } from 'expo-router'\nexport default function Layout() { return <Stack screenOptions={{ headerShown: false }} /> }\n"),
    writeFile(join(project, 'app/index.tsx'), "import { Text, View } from 'react-native'\nexport default function App() { return <View><Text>Runtime test project</Text></View> }\n"),
    writeFile(join(project, 'app.json'), `${JSON.stringify({ expo: { name: 'Runtime test project', slug: 'runtime-test-project', platforms: ['ios', 'android', 'web'], plugins: ['expo-router'] } })}\n`),
    writeFile(join(project, 'package.json'), `${JSON.stringify({ name: 'runtime-test-project', private: true, main: 'expo-router/entry', dependencies: { '@babel/runtime': '7.29.7', expo: '57.0.19', 'expo-router': '57.0.18', react: '19.2.3', 'react-native': '0.86.3' } })}\n`),
    writeFile(join(project, 'runwhale.json'), `${JSON.stringify({ schemaVersion: 1, id: 'runtime-test-project', name: 'Runtime test project', runtimeAbi: { android: 'runwhale-expo57-android-v1', ios: 'runwhale-expo57-ios-v1' }, entry: { web: 'expo-router/entry', ios: 'expo-router/entry', android: 'expo-router/entry' }, capabilities: [], tasks: {}, source: { kind: 'local' } })}\n`),
  ])
  return project
}

function expectNativePreviewAcceptanceSignals(code: string): void {
  const crashMessage = 'Native Preview acceptance crash after first content'
  for (const marker of [
    'Native Preview fixture ready',
    'native-preview-dimensions',
    'Viewport:',
    'native-preview-tap',
    'native-preview-drag',
    'native-preview-scroll',
    'Native Preview bottom marker',
    'native-preview-crash',
    crashMessage,
  ]) expect(code).toContain(marker)
  const crashMessageIndex = code.indexOf(crashMessage)
  expect(code.slice(Math.max(0, crashMessageIndex - 500), crashMessageIndex + crashMessage.length + 500)).toContain('setTimeout')
}

async function waitForMessage<T>(messages: T[], predicate: (message: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const message = messages.find(predicate)
    if (message) return message
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25))
  }
  throw new Error(`timed out waiting for Metro HMR message; received ${JSON.stringify(messages)}`)
}
