import { createServer, type Server } from 'node:http'
import type { Socket } from 'node:net'
import { access, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { nativePreviewConsoleSource } from './preview-console.js'
import { webPreviewTestingScript } from '@runwhale/mobile-protocol'
import type { MetroMiddleWare } from '@expo/metro/metro'
import {
  isNativePreviewBuiltIn,
  nativePreviewPackageName,
  NATIVE_PREVIEW_BLOCKED_MODULES,
  NATIVE_PREVIEW_INTERNAL_MODULES,
  NATIVE_PREVIEW_MODULES,
} from '@runwhale/mobile-runtime/native-preview-modules'

import { webTransformerPath } from './web-transformer.js'
import {
  isWebAssetPath, readLiveWebAsset, readWebDocument, renderWebCss, renderWebDocument,
  webAsset, type WebPreviewDocument,
} from './web-document.js'

export type MetroPlatform = 'android' | 'ios' | 'web'

export interface MetroBundle {
  platform: MetroPlatform
  webDocument?: WebPreviewDocument
  code: string
  map: string
  durationMs: number
  requestPath: string
  /** Exact persisted bytes are retained when a bundle is restored from cache. */
  codeBytes?: Uint8Array
  mapBytes?: Uint8Array
  /** Live-only identity used to ensure HMR is never attached to a cached bundle. */
  projectRoot?: string
  bundlerKey?: string
}

let packedMapSupportInstalled = false

export class MobileMetroRuntime {
  private server: Server | undefined
  private servingSockets = new Set<Socket>()
  private bundler: { key: string; middleware: MetroMiddleWare; hmrGraphId?: string } | undefined
  private activeProjectRoot: string | undefined
  private changeSnapshot = new Map<string, string>()
  private changeSynchronization: Promise<void> = Promise.resolve()
  private changePoll: NodeJS.Timeout | undefined
  constructor(
    private readonly moduleStore: string,
    private readonly additionalWatchRoots: readonly string[] = [],
    private readonly disableHierarchicalLookup = false,
    private readonly pollProjectChanges = false,
  ) {}

  async prewarm(): Promise<void> {
    await loadMetroTooling()
    await installExpoPackedMapSupport()
  }

  async bundle(projectRoot: string, platform: MetroPlatform): Promise<MetroBundle> {
    // Metro is deliberately loaded on demand: its worker paths are materialized
    // only in the shared module store and must not prevent the host from booting.
    const [{ getDefaultConfig }, metro, outputBundle] = await loadMetroTooling()
    await installExpoPackedMapSupport()
    const [root, store] = await Promise.all([
      realpath(resolve(projectRoot)),
      realpath(resolve(this.moduleStore)),
    ])
    this.activeProjectRoot = root
    // A deployed pnpm store keeps transitive packages under node_modules/.pnpm.
    // Metro's file map does not always traverse that hidden virtual store through
    // symlinks, so watch it explicitly while retaining the post-resolution guard.
    const linkedInternalModuleRoots = (await Promise.all(
      [...NATIVE_PREVIEW_INTERNAL_MODULES].map(async (name) => {
        try {
          const root = await realpath(join(store, ...name.split('/')))
          return within(store, root) ? undefined : root
        } catch {
          return undefined
        }
      }),
    )).filter((root): root is string => root !== undefined)
    const moduleRoots = [store, ...this.additionalWatchRoots.map((path) => resolve(path)), ...linkedInternalModuleRoots]
    const watchRoots = [root, ...moduleRoots]
    try { watchRoots.push(await realpath(resolve(store, '.pnpm'))) } catch { /* hoisted stores may not expose a virtual store */ }
    const base = getDefaultConfig(root)
    const originalResolve = base.resolver.resolveRequest
    const unsupportedNativeDependencies = platform === 'web'
      ? new Set<string>()
      : await unsupportedProjectNativeDependencies(root, platform)
    const resolveRequest: NonNullable<typeof base.resolver.resolveRequest> = (context, moduleName, targetPlatform) => {
      const packageName = nativePreviewPackageName(moduleName)
      const catalogModule = NATIVE_PREVIEW_MODULES.find((module) => module.name === packageName)
      // Platform and host-module policy applies to project code. Trusted ABI
      // packages may import another catalog package's platform-safe fallback
      // (Expo Router does this with expo-glass-effect on Android).
      const originatesInStore = moduleRoots.some((moduleRoot) => within(moduleRoot, context.originModulePath))
      if (platform !== 'web' && !originatesInStore && catalogModule && !catalogModule.platforms.includes(platform)) {
        throw new Error(`Native Preview exposes ${packageName} only on ${catalogModule.platforms.join(' and ')}`)
      }
      if (platform !== 'web' && !originatesInStore && NATIVE_PREVIEW_BLOCKED_MODULES.has(packageName)) {
        throw new Error(`Native Preview does not expose ${packageName}; use a supported v1 built-in module or Web Preview`)
      }
      if (platform !== 'web' && !originatesInStore && unsupportedNativeDependencies.has(packageName)) {
        throw new Error(`Native Preview cannot load project-native package ${packageName}; host native modules are fixed by the v1 ABI`)
      }
      const requestName = nativePreviewRequestName(moduleName, platform)
      // Metro's native fallback is useful on iOS and Android, but on web it
      // resolves generic Expo imports such as `./runtime` to `runtime.native`
      // before `runtime.ts`. That pulls React Native core into the browser
      // graph even though the root package is correctly aliased to RN Web.
      let resolverContext = platform === 'web' ? { ...context, preferNativePlatform: false } : context
      if (platform !== 'web' && isNativePreviewBuiltIn(requestName, platform)) {
        // ABI packages always come from the shared store. A project's local
        // node_modules cannot replace JavaScript while the native host remains
        // pinned to a different implementation.
        resolverContext = {
          ...resolverContext,
          originModulePath: join(store, '__runwhale_native_preview__.js'),
          nodeModulesPaths: [store],
          disableHierarchicalLookup: true,
        }
      }
      const resolved = originalResolve
        ? originalResolve(resolverContext, requestName, targetPlatform)
        : resolverContext.resolveRequest(resolverContext, requestName, targetPlatform)
      if (resolved.type === 'sourceFile' && !watchRoots.some((allowed) => within(allowed, resolved.filePath))) {
        throw new Error(`Metro resolver blocked path outside project/module store: ${resolved.filePath}`)
      }
      return resolved
    }
    const config = {
      ...base,
      // Node Mobile's iOS V8 port can crash while several Metro worker
      // isolates tear down together. One worker makes Metro transform inline,
      // preserving Preview behavior without creating WorkerThreads or falling
      // back to unsupported child processes.
      maxWorkers: 1,
      transformerPath: platform === 'web' ? await webTransformerPath(store, base.transformerPath) : base.transformerPath,
      watchFolders: watchRoots,
      resolver: {
        ...base.resolver,
        nodeModulesPaths: [store],
        disableHierarchicalLookup: this.disableHierarchicalLookup,
        // Embedded Node never ships a Watchman daemon. Selecting Metro's Node
        // watcher directly avoids a failed Watchman probe on every device boot.
        useWatchman: false,
        resolveRequest,
      },
      serializer: platform === 'web' ? {
        ...base.serializer,
        getModulesRunBeforeMainModule: () => [],
        getPolyfills: () => [],
      } : base.serializer,
    }
    const started = Date.now()
    const entry = await writePreviewEntry(root, platform)
    const key = `${root}\0${platform}`
    if (this.bundler?.key !== key) {
      await this.bundler?.middleware.end()
      // Native Preview consumes one immutable bundle and is explicitly rebuilt
      // on every run. Keeping Metro's Node watcher alive there opens one file
      // descriptor per directory in the shared module store on iOS. Only Web
      // Preview needs the live watcher for its HMR session.
      this.bundler = { key, middleware: await metro.createConnectMiddleware(config, { watch: previewBundleMode(platform).hot, waitForBundler: true }) }
      this.changeSnapshot = await projectSourceSnapshot(root)
    } else {
      // Agent writes replace files atomically, and native watcher delivery can
      // lag behind an immediate preview.run. Publish the precise snapshot delta
      // before Metro reads its incremental graph instead of sleeping and hoping
      // that the platform watcher wins the race.
      await this.synchronizeProjectChanges(root)
    }
    const build = () => outputBundle.build(this.bundler!.middleware.metroServer, {
      entryFile: entry,
      platform,
      dev: previewBundleMode(platform).dev,
      minify: false,
      inlineSourceMap: false,
      createModuleIdFactory: config.serializer.createModuleIdFactory,
      customResolverOptions: {},
      customTransformOptions: { routerRoot: 'app' },
      unstable_transformProfile: 'default',
    })
    let sourceAtBuildStart = new Map(this.changeSnapshot)
    let result = await build()
    for (let retry = 0; retry < 2; retry += 1) {
      const sourceAtBuildEnd = await projectSourceSnapshot(root)
      if (sameSourceSnapshot(sourceAtBuildStart, sourceAtBuildEnd)) break
      await this.synchronizeProjectChanges(root)
      sourceAtBuildStart = sourceAtBuildEnd
      result = await build()
      if (retry === 1 && !sameSourceSnapshot(sourceAtBuildStart, await projectSourceSnapshot(root))) {
        throw new Error('Project source kept changing while Preview was building; run Preview again')
      }
    }
    if (previewBundleMode(platform).hot) {
      // outputBundle.build intentionally creates a one-shot graph. Seed Metro's
      // incremental graph only for Web, where the live HMR socket consumes it.
      const incrementalBundler = this.bundler.middleware.metroServer.getBundler()
      const previousRevision = this.bundler.hmrGraphId
        ? incrementalBundler.getRevisionByGraphId(this.bundler.hmrGraphId)
        : undefined
      const { revision } = previousRevision
        ? await incrementalBundler.updateGraph(await previousRevision, false)
        : await incrementalBundler.initializeGraph(entry, {
          customTransformOptions: { routerRoot: 'app' },
          dev: previewBundleMode(platform).dev,
          minify: false,
          platform,
          type: 'module',
          unstable_transformProfile: 'default',
        }, {
          customResolverOptions: {},
          dev: previewBundleMode(platform).dev,
        }, {
          onProgress: null,
          shallow: false,
          lazy: false,
        })
      this.bundler.hmrGraphId = revision.graphId
    }
    return {
      platform,
      ...(platform === 'web' ? { webDocument: await readWebDocument(root) } : {}),
      code: result.code,
      map: result.map ?? '',
      durationMs: Date.now() - started,
      requestPath: metroRequestPath(root, entry),
      projectRoot: root,
      bundlerKey: key,
    }
  }

  async serve(bundle: MetroBundle, options: { live?: boolean } = {}): Promise<{ port: number; token: string; bundleUrl: string }> {
    await this.stopServing()
    const token = randomBytes(32).toString('base64url')
    const code = bundle.codeBytes ? Buffer.from(bundle.codeBytes) : Buffer.from(bundle.code)
    const map = bundle.mapBytes ? Buffer.from(bundle.mapBytes) : Buffer.from(bundle.map)
    const liveBundler = options.live !== false && bundle.bundlerKey === this.bundler?.key
      ? this.bundler
      : undefined
    const mode = previewBundleMode(bundle.platform)
    const hot = mode.hot && Boolean(liveBundler)
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost')
      // JSX resource URLs cannot inherit the page query string. Same-origin
      // subresource requests may present the token through their Referer instead.
      let assetReferrerAuthorized = false
      if (bundle.platform === 'web' && isWebAssetPath(url.pathname) && request.headers.referer) {
        try {
          const referrer = new URL(request.headers.referer)
          assetReferrerAuthorized = referrer.origin === `http://127.0.0.1:${(server.address() as { port: number }).port}`
            && safeEqual(referrer.searchParams.get('token'), token)
        } catch { /* An absent or malformed credential is unauthorized. */ }
      }
      if (!safeEqual(url.searchParams.get('token'), token) && !assetReferrerAuthorized) {
        response.writeHead(401, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
        response.end('Unauthorized')
        return
      }
      if (url.pathname === bundle.requestPath) {
        response.writeHead(200, {
          'content-type': 'application/javascript; charset=utf-8',
          'content-length': code.byteLength,
          'cache-control': 'no-store',
        })
        response.end(code)
        return
      }
      if (url.pathname === '/' && bundle.platform === 'web') {
        const bundlePath = `${bundle.requestPath}?platform=web&dev=true&minify=false&hot=${String(hot)}&transform.routerRoot=app&token=${encodeURIComponent(token)}`
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'same-origin',
          'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:*; font-src 'self' data:",
        })
        response.end(renderWebDocument(bundle.webDocument, bundlePath, token))
        return
      }
      if (bundle.platform === 'web' && isWebAssetPath(url.pathname)) {
        const read = liveBundler && bundle.projectRoot
          ? readLiveWebAsset(bundle.projectRoot, url.pathname)
          : Promise.resolve(webAsset(bundle.webDocument, url.pathname))
        void read.then((asset) => {
          if (!asset) { response.writeHead(404).end(); return }
          response.writeHead(200, { 'content-type': asset.contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
          const content = Buffer.from(asset.content, 'base64')
          response.end(asset.contentType.startsWith('text/css') ? renderWebCss(content.toString('utf8'), asset.path, token) : content)
        }).catch(() => { response.writeHead(500).end('Web asset could not be read') })
        return
      }
      if (url.pathname === '/index.map') {
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': map.byteLength,
          'cache-control': 'no-store',
        })
        response.end(map)
        return
      }
      response.writeHead(404).end()
    })
    server.on('connection', (socket) => {
      this.servingSockets.add(socket)
      socket.once('close', () => this.servingSockets.delete(socket))
    })
    liveBundler?.middleware.attachHmrServer(server)
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolveListen)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Metro preview did not bind a port')
    this.server = server
    if (this.pollProjectChanges && liveBundler && bundle.projectRoot) await this.startChangePolling(bundle.projectRoot)
    return {
      port: address.port,
      token,
      bundleUrl: `http://127.0.0.1:${address.port}${bundle.requestPath}?platform=${bundle.platform}&dev=${String(mode.dev)}&minify=false&hot=${String(hot)}&transform.routerRoot=app&token=${encodeURIComponent(token)}`,
    }
  }

  async stop(): Promise<void> {
    const bundler = this.bundler
    this.bundler = undefined
    let failure: unknown
    try {
      await this.stopServing()
    } catch (error) {
      failure = error
    }
    try {
      await bundler?.middleware.end()
    } catch (error) {
      failure ??= error
    }
    if (failure) throw failure
  }

  private async stopServing(): Promise<void> {
    const server = this.server
    this.server = undefined
    if (this.changePoll) clearTimeout(this.changePoll)
    this.changePoll = undefined
    if (server) await new Promise<void>((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose())
      // A Preview bundle may still have a keep-alive client when iOS is about
      // to suspend the app. Waiting for that client can leave stale Preview
      // state across foreground recovery, so terminate Preview-only sockets.
      server.closeAllConnections()
      for (const socket of this.servingSockets) socket.destroy()
      this.servingSockets.clear()
    })
  }

  private async startChangePolling(root: string): Promise<void> {
    if (this.changePoll) clearTimeout(this.changePoll)
    if (this.changeSnapshot.size === 0) this.changeSnapshot = await projectSourceSnapshot(root)
    const poll = async (): Promise<void> => {
      if (!this.server || this.activeProjectRoot !== root) return
      try {
        await this.synchronizeProjectChanges(root)
      } catch {
        // Native watcher delivery is the primary path. Polling is only the
        // bounded fallback, so a transient scan/stat race must not stop Node.
      } finally {
        if (this.server && this.activeProjectRoot === root) this.changePoll = setTimeout(() => { void poll() }, 250)
      }
    }
    this.changePoll = setTimeout(() => { void poll() }, 250)
  }

  private synchronizeProjectChanges(root: string): Promise<boolean> {
    const synchronization = this.changeSynchronization.then(async () => {
      const next = await projectSourceSnapshot(root)
      if (this.changeSnapshot.size === 0) {
        this.changeSnapshot = next
        return false
      }
      let changed = false
      for (const [path, fingerprint] of next) {
        const previous = this.changeSnapshot.get(path)
        if (previous !== fingerprint) {
          changed = true
          await this.publishFileChange(root, path, previous === undefined ? 'added' : 'modified')
        }
      }
      for (const path of this.changeSnapshot.keys()) {
        if (!next.has(path)) {
          changed = true
          await this.publishFileChange(root, path, 'removed')
        }
      }
      this.changeSnapshot = next
      return changed
    })
    this.changeSynchronization = synchronization.then(() => undefined, () => undefined)
    return synchronization
  }

  private async publishFileChange(root: string, path: string, type: 'added' | 'modified' | 'removed'): Promise<void> {
    const middleware = this.bundler?.middleware
    if (!middleware || !within(root, path)) return
    const bundler = middleware.metroServer.getBundler().getBundler()
    const dependencyGraph = await bundler.getDependencyGraph() as unknown as {
      _fileSystem: {
        lookup(path: string): { exists: boolean; type?: string; metadata?: unknown[] }
        addOrModify(path: string, metadata: unknown[]): void
        remove(path: string): void
      }
    }
    const relativePath = relative(root, path)
    const changes = {
      addedDirectories: new Set<string>(),
      removedDirectories: new Set<string>(),
      addedFiles: new Map<string, { isSymlink: boolean; modifiedTime: number | null }>(),
      modifiedFiles: new Map<string, { isSymlink: boolean; modifiedTime: number | null }>(),
      removedFiles: new Map<string, { isSymlink: boolean; modifiedTime: number | null }>(),
    }
    if (type === 'removed') {
      dependencyGraph._fileSystem.remove(path)
      changes.removedFiles.set(relativePath, { isSymlink: false, modifiedTime: null })
    } else {
      const info = await stat(path)
      if (!info.isFile()) return
      const current = dependencyGraph._fileSystem.lookup(path)
      const metadata = current.exists && current.type === 'f' && current.metadata
        ? [...current.metadata]
        : [info.mtimeMs, info.size, 0, null, 0, null]
      metadata[0] = info.mtimeMs
      metadata[1] = info.size
      metadata[3] = null
      dependencyGraph._fileSystem.addOrModify(path, metadata)
      changes[type === 'added' ? 'addedFiles' : 'modifiedFiles'].set(relativePath, { isSymlink: false, modifiedTime: info.mtimeMs })
    }
    bundler.getWatcher().emit('change', { changes, logger: null, rootDir: root })
  }
}

function nativePreviewRequestName(moduleName: string, platform: MetroPlatform): string {
  if (platform === 'web' && (moduleName === 'react-native' || moduleName === 'react-native/index')) {
    return 'react-native-web'
  }
  // The public package and API remain unchanged for project code. Native
  // Preview resolves only its root entry to a host-owned implementation so it
  // can never reach Studio's process-wide RNCAsyncStorage native module.
  if (platform !== 'web' && (
    moduleName === '@react-native-async-storage/async-storage'
      || moduleName === '@react-native-async-storage/async-storage/index'
  )) {
    return '@runwhale/native-preview-shims/async-storage'
  }
  return moduleName
}

let metroTooling: ReturnType<typeof loadMetroToolingUncached> | undefined

function loadMetroTooling() {
  metroTooling ??= loadMetroToolingUncached()
  return metroTooling
}

function loadMetroToolingUncached() {
  return Promise.all([
    import('@expo/metro-config'),
    import('@expo/metro/metro'),
    import('@expo/metro/metro/shared/output/bundle'),
  ])
}

async function installExpoPackedMapSupport(): Promise<void> {
  if (packedMapSupportInstalled) return
  const [bundlerNamespace, packedMap, sourceMap] = await Promise.all([
    import('@expo/metro/metro/Bundler'),
    import('@expo/metro-config/build/serializer/packedMap'),
    import('@expo/metro-config/build/serializer/sourceMap'),
  ])
  type MetroTransformResult = { output?: readonly unknown[] | null }
  type BundlerPrototype = { transformFile: (...args: any[]) => Promise<MetroTransformResult> }
  type BundlerConstructor = { prototype: BundlerPrototype }
  const importedDefault = (bundlerNamespace as unknown as { default: unknown }).default
  const Bundler = (typeof importedDefault === 'function'
    ? importedDefault
    : (importedDefault as { default?: unknown } | null)?.default) as BundlerConstructor | undefined
  if (!Bundler?.prototype) throw new Error('Metro Bundler constructor is unavailable')
  const prototype = Bundler.prototype
  const originalTransformFile = prototype.transformFile
  prototype.transformFile = async function (...args) {
    return packedMap.wrapTransformResultMaps(await originalTransformFile.apply(this, args))
  }
  sourceMap.patchMetroSourceMapStringForPackedMaps()
  packedMapSupportInstalled = true
}

function within(root: string, candidate: string): boolean {
  const path = relative(root, resolve(candidate))
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function safeEqual(value: string | null, expected: string): boolean {
  if (value === null) return false
  const left = Buffer.from(value)
  const right = Buffer.from(expected)
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

function previewBundleMode(platform: MetroPlatform): { dev: boolean; hot: boolean } {
  const web = platform === 'web'
  return { dev: web, hot: web }
}

async function writePreviewEntry(root: string, platform: MetroPlatform): Promise<string> {
  const directory = resolve(root, '.runwhale')
  const path = resolve(directory, `metro-${platform}-entry.tsx`)
  await mkdir(directory, { recursive: true })
  const requestPath = metroRequestPath(root, path)
  const projectEntry = await resolveProjectEntry(root, platform)
  const fastRefresh = platform === 'web'
    ? `import MetroHMRClient from 'metro-runtime/src/modules/HMRClient'\nconst previewScriptSource = document.currentScript?.getAttribute('src')\nconst previewHot = previewScriptSource !== null && previewScriptSource !== undefined && new URL(previewScriptSource, location.origin).searchParams.get('hot') === 'true'\nif (__DEV__ && previewHot) {\n  const client = new MetroHMRClient(location.origin.replace(/^http/, 'ws') + '/hot')\n  client.enable()\n  const entry = new URL('${requestPath}', location.origin)\n  entry.search = location.search\n  entry.searchParams.set('platform', 'web')\n  entry.searchParams.set('dev', 'true')\n  entry.searchParams.set('minify', 'false')\n  entry.searchParams.set('hot', 'true')\n  entry.searchParams.set('transform.routerRoot', 'app')\n  client.send(JSON.stringify({ type: 'register-entrypoints', entryPoints: [entry.toString()] }))\n  ;(globalThis as typeof globalThis & { __RUNWHALE_HMR_CLIENT__?: unknown }).__RUNWHALE_HMR_CLIENT__ = client\n}\n`
    : ''
  const source = projectEntry.kind === 'expo-router'
    ? `${fastRefresh}import { AppRegistry } from 'react-native'\nimport App from '../app/index'\nAppRegistry.registerComponent('main', () => App)\n${platform === 'web' ? `AppRegistry.runApplication('main', { rootTag: document.getElementById('root') })\n` : ''}`
    : `${fastRefresh}import '../${projectEntry.path}'\n`
  await writeFile(resolve(directory, 'preview-testing.js'), platform === 'web' ? webPreviewTestingScript : nativePreviewConsoleSource)
  await writeFile(path, `import './preview-testing'\n${source}`)
  return path
}

async function unsupportedProjectNativeDependencies(root: string, platform: Exclude<MetroPlatform, 'web'>): Promise<Set<string>> {
  let manifest: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> }
  try {
    manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as typeof manifest
  } catch {
    return new Set()
  }
  const unsupported = new Set<string>()
  const names = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})])
  for (const name of names) {
    if (isNativePreviewBuiltIn(name, platform) || NATIVE_PREVIEW_BLOCKED_MODULES.has(name)) continue
    const packageRoot = join(root, 'node_modules', ...name.split('/'))
    let packageManifest: { codegenConfig?: unknown }
    try {
      packageManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as typeof packageManifest
    } catch {
      continue
    }
    if (packageManifest.codegenConfig !== undefined
      || await existsPath(join(packageRoot, 'expo-module.config.json'))
      || await existsPath(join(packageRoot, 'react-native.config.js'))) {
      unsupported.add(name)
    }
  }
  return unsupported
}

async function existsPath(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function resolveProjectEntry(root: string, platform: MetroPlatform): Promise<{ kind: 'expo-router' } | { kind: 'source'; path: string }> {
  let manifest: { entry?: Partial<Record<MetroPlatform, unknown>> } | undefined
  try { manifest = JSON.parse(await readFile(join(root, 'runwhale.json'), 'utf8')) as { entry?: Partial<Record<MetroPlatform, unknown>> } } catch { /* Projects without metadata use entry discovery. */ }
  const configured = manifest?.entry?.[platform]
  if (configured === undefined && manifest) throw new Error(`Project does not declare a Preview entry for ${platform} in runwhale.json`)
  if (configured === 'expo-router/entry' || configured === undefined) return { kind: 'expo-router' }
  if (typeof configured !== 'string' || configured.length === 0 || configured.includes('\0')) throw new Error(`Project has an invalid ${platform} Preview entry`)
  const absolute = resolve(root, configured)
  if (!within(root, absolute)) throw new Error(`Project ${platform} Preview entry escapes the project root`)
  const info = await stat(absolute).catch(() => undefined)
  if (!info?.isFile()) throw new Error(`Project ${platform} Preview entry does not exist: ${configured}`)
  return { kind: 'source', path: relative(root, absolute).split(sep).join('/') }
}

function metroRequestPath(root: string, entry: string): string {
  const relativeEntry = relative(root, entry).split(sep).join('/').replace(/\.[^.]+$/, '.bundle')
  return `/${relativeEntry}`
}

const PREVIEW_SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])
const PREVIEW_IGNORED_DIRECTORIES = new Set(['.runwhale', '.git', 'node_modules'])

async function projectSourceSnapshot(root: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>()
  const directories = [root]
  while (directories.length > 0 && snapshot.size < 2_048) {
    const directory = directories.pop()!
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (snapshot.size >= 2_048) break
      if (entry.isDirectory()) {
        if (!PREVIEW_IGNORED_DIRECTORIES.has(entry.name)) directories.push(join(directory, entry.name))
        continue
      }
      if (!entry.isFile() || !PREVIEW_SOURCE_EXTENSIONS.has(extension(entry.name))) continue
      const path = join(directory, entry.name)
      const info = await stat(path)
      snapshot.set(path, `${info.mtimeMs}:${info.ctimeMs}:${info.size}:${info.ino}`)
    }
  }
  return snapshot
}

function sameSourceSnapshot(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
  if (left.size !== right.size) return false
  for (const [path, fingerprint] of left) {
    if (right.get(path) !== fingerprint) return false
  }
  return true
}

function extension(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot).toLowerCase()
}
