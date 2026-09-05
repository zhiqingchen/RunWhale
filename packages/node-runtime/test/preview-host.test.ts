import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunWhaleRuntimeHost } from '../src/runtime-host.js'
import { readPreviewArtifact, writePreviewArtifact } from '../src/preview-artifact.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())) })

describe('Preview cache host flow', () => {
  it('reports a miss, restores the cached endpoint, and then resumes that active Preview', async () => {
    const { host, root, rpc } = await startedHost('ios')
    const projectId = 'cached-project'
    const project = join(root, 'projects', projectId)
    await mkdir(project, { recursive: true })

    await expect(rpc('preview.open', { projectId, platform: 'ios' })).resolves.toMatchObject({
      ok: true,
      result: { status: 'missing' },
    })
    const code = 'globalThis.cachedPreview = "last successful build 🐋"\n'
    await writePreviewArtifact(project, { projectId, platform: 'ios', runtimeAbi: host.snapshot().runtimeAbi }, previewBundle('ios', code), 3)

    const cached = await rpc('preview.open', { projectId, platform: 'ios' })
    expect(cached).toMatchObject({ ok: true, result: { status: 'ready', source: 'cache' } })
    expect(await (await fetch(cached.result.endpoint.bundleUrl)).text()).toBe(code)

    const active = await rpc('preview.open', { projectId, platform: 'ios' })
    expect(active).toMatchObject({ ok: true, result: { status: 'ready', source: 'active', endpoint: cached.result.endpoint } })

    expect(await rpc('preview.stop', { projectId })).toMatchObject({ ok: true, result: { stopped: true } })
    const reopened = await rpc('preview.open', { projectId, platform: 'ios' })
    expect(reopened).toMatchObject({ ok: true, result: { status: 'ready', source: 'cache' } })
    expect(reopened.result.endpoint.token).not.toBe(cached.result.endpoint.token)
  })

  it('keeps preview.run as a forced rebuild and stores its newest successful output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-preview-host-'))
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: async () => ({ text: '' }) } })
    const metro = (host as unknown as { metro: Record<string, unknown> }).metro
    let build = 0
    const bundle = vi.fn(async () => previewBundle('ios', `globalThis.build = ${++build}\n`))
    const serve = vi.fn(async () => ({ port: 41_000 + build, token: `token-${build}`, bundleUrl: `http://127.0.0.1:${41_000 + build}/bundle` }))
    Object.assign(metro, { prewarm: async () => undefined, bundle, serve, stop: async () => undefined })
    const info = await host.start()
    cleanups.push(async () => { await host.stop(); await rm(root, { recursive: true, force: true }) })
    const rpc = rpcClient(info.origin, info.token)
    const projectId = 'forced-build'
    const project = join(root, 'projects', projectId)
    await mkdir(project, { recursive: true })
    await writeFile(join(project, 'runwhale.json'), `${JSON.stringify({
      schemaVersion: 1,
      id: projectId,
      name: 'Forced build',
      runtimeAbi: { ios: host.snapshot().runtimeAbi },
      entry: { ios: 'index.tsx' },
      capabilities: [],
      tasks: {},
      source: { kind: 'local' },
    })}\n`)

    expect(await rpc('preview.run', { projectId, platform: 'ios' })).toMatchObject({ ok: true, result: { projectId, platform: 'ios', revision: 1 } })
    expect(await rpc('preview.run', { projectId, platform: 'ios' })).toMatchObject({ ok: true, result: { projectId, platform: 'ios', revision: 2 } })
    expect(bundle).toHaveBeenCalledTimes(2)
    expect(serve).toHaveBeenNthCalledWith(1, expect.objectContaining({ code: 'globalThis.build = 1\n' }), { live: true })
    expect(serve).toHaveBeenNthCalledWith(2, expect.objectContaining({ code: 'globalThis.build = 2\n' }), { live: true })
    await expect(readPreviewArtifact(project, { projectId, platform: 'ios', runtimeAbi: host.snapshot().runtimeAbi })).resolves.toMatchObject({
      code: 'globalThis.build = 2\n',
      revision: 2,
    })
  })

  it('attributes Agent publications while sharing one project revision sequence across sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-agent-preview-publication-'))
    const notifyPreview = vi.fn(async () => true)
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: async () => ({ text: '' }), notifyPreview } })
    const metro = (host as unknown as { metro: Record<string, unknown> }).metro
    let build = 0
    Object.assign(metro, {
      prewarm: async () => undefined,
      bundle: async () => previewBundle('ios', `globalThis.agentBuild = ${++build}\n`),
      serve: async () => ({ port: 43_000 + build, token: `agent-token-${build}`, bundleUrl: `http://127.0.0.1:${43_000 + build}/bundle` }),
      stop: async () => undefined,
    })
    const info = await host.start()
    cleanups.push(async () => { await host.stop(); await rm(root, { recursive: true, force: true }) })
    const projectId = 'agent-publication'
    await writePreviewProject(root, projectId, host.snapshot().runtimeAbi)
    const project = join(root, 'projects', projectId)

    await expect(host.runAgentPreview(project, 'session-a', new AbortController().signal)).resolves.toMatchObject({ revision: 1, requestedBySessionId: 'session-a' })
    await expect(host.runAgentPreview(project, 'session-b', new AbortController().signal)).resolves.toMatchObject({ revision: 2, requestedBySessionId: 'session-b' })

    const logs = await rpcRequest(info.origin, info.token, 'preview.logs', { projectId, afterSequence: 0 })
    expect(logs.result.events.filter((event: any) => event.name === 'preview.ready').map((event: any) => event.data)).toEqual([
      expect.objectContaining({ projectId, revision: 1, requestedBySessionId: 'session-a' }),
      expect.objectContaining({ projectId, revision: 2, requestedBySessionId: 'session-b' }),
    ])

    const report = (params: object) => rpcRequest(info.origin, info.token, 'preview.report', params)
    const current = { projectId, sessionId: 'session-b', platform: 'ios', revision: 2, status: 'opened' }
    expect(await report({ ...current, sessionId: 'session-a', revision: 1 })).toMatchObject({ result: { recorded: false, notified: false } })
    expect(await report({ ...current, sessionId: 'session-a' })).toMatchObject({ result: { recorded: false, notified: false } })
    expect(await report(current)).toMatchObject({ result: { recorded: true, notified: true } })
    expect(await report(current)).toMatchObject({ result: { recorded: true, notified: true } })
    expect(notifyPreview).toHaveBeenCalledTimes(1)
    expect(notifyPreview).toHaveBeenCalledWith('session-b', expect.stringContaining('opened'))
    const failure = { ...current, status: 'failed', message: 'Animation failed at http://127.0.0.1:43002/bundle?token=fixture-private authorization=Bearer fixture-secret' }
    expect(await report(failure)).toMatchObject({ result: { recorded: true, notified: true } })
    await report(failure)
    await report(current)
    expect(notifyPreview).toHaveBeenCalledTimes(2)
    expect(notifyPreview).toHaveBeenLastCalledWith('session-b', expect.stringContaining('Animation failed at <redacted-url> authorization=Bearer <redacted>'))
    const deviceLogs = host.agentPreviewLogs(project, 0).filter((event: any) => event.data.source === 'preview')
    expect(deviceLogs).toHaveLength(2)
    expect(JSON.stringify(deviceLogs)).not.toMatch(/fixture-private|fixture-secret/)
  })

  it('restores a cached Preview from a brand-new host instance using the same root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-preview-host-'))
    const projectId = 'restart-cache'
    const project = join(root, 'projects', projectId)
    const code = 'globalThis.persistedPreview = "survived restart \ud83d\udc0b"\n'
    let currentHost: RunWhaleRuntimeHost | undefined
    cleanups.push(async () => {
      await currentHost?.stop()
      await rm(root, { recursive: true, force: true })
    })

    const firstHost = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: async () => ({ text: '' }) } })
    currentHost = firstHost
    await firstHost.start()
    await mkdir(project, { recursive: true })
    await writePreviewArtifact(project, {
      projectId,
      platform: 'ios',
      runtimeAbi: firstHost.snapshot().runtimeAbi,
    }, previewBundle('ios', code), 4)
    await firstHost.stop()
    currentHost = undefined

    const restartedHost = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: async () => ({ text: '' }) } })
    currentHost = restartedHost
    const restartedInfo = await restartedHost.start()
    const reopened = await rpcRequest(restartedInfo.origin, restartedInfo.token, 'preview.open', { projectId, platform: 'ios' })

    expect(reopened).toMatchObject({ ok: true, result: { status: 'ready', source: 'cache' } })
    expect(await (await fetch(reopened.result.endpoint.bundleUrl)).text()).toBe(code)
  })

  it('continues the persisted project revision when Run skips cache-first open', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-preview-revision-'))
    const projectId = 'persisted-revision'
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: async () => ({ text: '' }) } })
    const metro = (host as unknown as { metro: Record<string, unknown> }).metro
    Object.assign(metro, {
      prewarm: async () => undefined,
      bundle: async () => previewBundle('ios', 'globalThis.revision = 8\n'),
      serve: async () => ({ port: 44_008, token: 'revision-8', bundleUrl: 'http://127.0.0.1:44008/bundle' }),
      stop: async () => undefined,
    })
    const info = await host.start()
    cleanups.push(async () => { await host.stop(); await rm(root, { recursive: true, force: true }) })
    await writePreviewProject(root, projectId, host.snapshot().runtimeAbi)
    const project = join(root, 'projects', projectId)
    await writePreviewArtifact(project, {
      projectId,
      platform: 'ios',
      runtimeAbi: host.snapshot().runtimeAbi,
    }, previewBundle('ios', 'globalThis.revision = 7\n'), 7)

    await expect(rpcRequest(info.origin, info.token, 'preview.run', { projectId, platform: 'ios' })).resolves.toMatchObject({
      ok: true,
      result: { projectId, revision: 8 },
    })
  })

  it('does not publish a cancelled build and runs a newer queued Preview afterward', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-preview-host-'))
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: async () => ({ text: '' }) } })
    const internals = host as unknown as { metro: Record<string, unknown>; previewOperations: Promise<void> }
    let markCancelledBuildStarted!: () => void
    let releaseCancelledBuild!: (bundle: ReturnType<typeof previewBundle>) => void
    let releaseStop!: () => void
    const cancelledBuildStarted = new Promise<void>((resolve) => { markCancelledBuildStarted = resolve })
    const cancelledBuild = new Promise<ReturnType<typeof previewBundle>>((resolve) => { releaseCancelledBuild = resolve })
    const stopFinished = new Promise<void>((resolve) => { releaseStop = resolve })
    const cancelledProjectId = 'cancelled-build'
    const newerProjectId = 'newer-build'
    const stop = vi.fn(() => stopFinished)
    const bundle = vi.fn(async (projectRoot: string) => {
      if (projectRoot === join(root, 'projects', cancelledProjectId)) {
        markCancelledBuildStarted()
        return cancelledBuild
      }
      expect(stop).toHaveBeenCalledTimes(1)
      return previewBundle('ios', 'globalThis.previewBuild = "newer"\n')
    })
    const serve = vi.fn(async () => ({
      port: 42_000,
      token: 'newer-token',
      bundleUrl: 'http://127.0.0.1:42000/bundle',
    }))
    Object.assign(internals.metro, { prewarm: async () => undefined, bundle, serve, stop })
    const info = await host.start()
    cleanups.push(async () => { await host.stop(); await rm(root, { recursive: true, force: true }) })
    await Promise.all([
      writePreviewProject(root, cancelledProjectId, host.snapshot().runtimeAbi),
      writePreviewProject(root, newerProjectId, host.snapshot().runtimeAbi),
    ])

    const cancelledRequestId = 'cancelled-preview-run'
    const cancelledRequest = rpcRequest(info.origin, info.token, 'preview.run', {
      projectId: cancelledProjectId,
      platform: 'ios',
    }, cancelledRequestId)
    await cancelledBuildStarted
    const firstQueueTail = internals.previewOperations
    const newerRequest = rpcRequest(info.origin, info.token, 'preview.run', {
      projectId: newerProjectId,
      platform: 'ios',
    }, 'newer-preview-run')

    try {
      await vi.waitFor(() => expect(internals.previewOperations).not.toBe(firstQueueTail))
      const cancellation = await cancelRpc(info.origin, info.token, cancelledRequestId, 'superseded by newer Preview')
      expect(cancellation).toMatchObject({ ok: true, result: { cancelled: true } })
      expect(serve).not.toHaveBeenCalled()
    } finally {
      releaseCancelledBuild(previewBundle('ios', 'globalThis.previewBuild = "cancelled"\n'))
    }

    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1))
    expect(bundle).toHaveBeenCalledTimes(1)
    releaseStop()

    await expect(cancelledRequest).resolves.toMatchObject({
      error: { code: 'ABORTED', message: 'superseded by newer Preview', retryable: false },
    })
    await expect(newerRequest).resolves.toMatchObject({
      ok: true,
      result: { token: 'newer-token' },
    })
    expect(bundle).toHaveBeenCalledTimes(2)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(serve).toHaveBeenCalledTimes(1)
    expect(serve).toHaveBeenCalledWith(expect.objectContaining({ code: 'globalThis.previewBuild = "newer"\n' }), { live: true })
    expect(host.snapshot().activeProjectId).toBe(newerProjectId)
    await expect(readPreviewArtifact(join(root, 'projects', cancelledProjectId), {
      projectId: cancelledProjectId,
      platform: 'ios',
      runtimeAbi: host.snapshot().runtimeAbi,
    })).resolves.toBeUndefined()
    await expect(rpcRequest(info.origin, info.token, 'preview.open', {
      projectId: newerProjectId,
      platform: 'ios',
    })).resolves.toMatchObject({
      ok: true,
      result: { status: 'ready', source: 'active', endpoint: { token: 'newer-token' } },
    })
  })

  it('preserves an active Preview when a replacement build is cancelled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-preview-preserve-'))
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: async () => ({ text: '' }) } })
    const metro = (host as unknown as { metro: Record<string, unknown> }).metro
    const activeProjectId = 'active-preview'
    const replacementProjectId = 'cancelled-replacement'
    let markReplacementStarted!: () => void
    let releaseReplacement!: (bundle: ReturnType<typeof previewBundle>) => void
    const replacementStarted = new Promise<void>((resolve) => { markReplacementStarted = resolve })
    const replacementBuild = new Promise<ReturnType<typeof previewBundle>>((resolve) => { releaseReplacement = resolve })
    const bundle = vi.fn(async (projectRoot: string) => {
      if (projectRoot === join(root, 'projects', replacementProjectId)) {
        markReplacementStarted()
        return replacementBuild
      }
      return previewBundle('ios', 'globalThis.previewBuild = "active"\n')
    })
    const serve = vi.fn(async () => ({
      port: 42_001,
      token: 'active-token',
      bundleUrl: 'http://127.0.0.1:42001/bundle',
    }))
    const stop = vi.fn(async () => undefined)
    Object.assign(metro, { prewarm: async () => undefined, bundle, serve, stop })
    const info = await host.start()
    cleanups.push(async () => { await host.stop(); await rm(root, { recursive: true, force: true }) })
    await Promise.all([
      writePreviewProject(root, activeProjectId, host.snapshot().runtimeAbi),
      writePreviewProject(root, replacementProjectId, host.snapshot().runtimeAbi),
    ])
    const activeRoot = join(root, 'projects', activeProjectId)
    const replacementRoot = join(root, 'projects', replacementProjectId)
    await expect(host.runAgentPreview(activeRoot, 'active-session', new AbortController().signal)).resolves.toMatchObject({ token: 'active-token' })

    const controller = new AbortController()
    const replacement = host.runAgentPreview(replacementRoot, 'replacement-session', controller.signal)
    void replacement.catch(() => undefined)
    await replacementStarted
    controller.abort(new Error('replacement cancelled'))
    releaseReplacement(previewBundle('ios', 'globalThis.previewBuild = "replacement"\n'))

    await expect(replacement).rejects.toThrow('replacement cancelled')
    expect(stop).not.toHaveBeenCalled()
    expect(serve).toHaveBeenCalledTimes(1)
    expect(host.snapshot().activeProjectId).toBe(activeProjectId)
    await expect(rpcRequest(info.origin, info.token, 'preview.open', {
      projectId: activeProjectId,
      platform: 'ios',
    })).resolves.toMatchObject({
      ok: true,
      result: { status: 'ready', source: 'active', endpoint: { token: 'active-token' } },
    })
    await expect(readPreviewArtifact(replacementRoot, {
      projectId: replacementProjectId,
      platform: 'ios',
      runtimeAbi: host.snapshot().runtimeAbi,
    })).resolves.toBeUndefined()
  })
})

async function startedHost(platform: 'android' | 'ios') {
  const root = await mkdtemp(join(tmpdir(), 'runwhale-preview-host-'))
  const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform, agent: { run: async () => ({ text: '' }) } })
  const info = await host.start()
  cleanups.push(async () => { await host.stop(); await rm(root, { recursive: true, force: true }) })
  return { host, root, rpc: rpcClient(info.origin, info.token) }
}

function rpcClient(origin: string, token: string) {
  return async (method: string, params: unknown): Promise<any> => rpcRequest(origin, token, method, params)
}

function rpcRequest(origin: string, token: string, method: string, params: unknown, id: string = crypto.randomUUID()): Promise<any> {
  return fetch(`${origin}/rpc`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ v: 1, type: 'request', id, method, params }),
  }).then((response) => response.json())
}

function cancelRpc(origin: string, token: string, requestId: string, reason: string): Promise<any> {
  return fetch(`${origin}/rpc`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ v: 1, type: 'cancel', id: crypto.randomUUID(), requestId, reason }),
  }).then((response) => response.json())
}

async function writePreviewProject(root: string, projectId: string, runtimeAbi: string): Promise<void> {
  const project = join(root, 'projects', projectId)
  await mkdir(project, { recursive: true })
  await writeFile(join(project, 'runwhale.json'), `${JSON.stringify({
    schemaVersion: 1,
    id: projectId,
    name: projectId,
    runtimeAbi: { ios: runtimeAbi },
    entry: { ios: 'index.tsx' },
    capabilities: [],
    tasks: {},
    source: { kind: 'local' },
  })}\n`)
}

function previewBundle(platform: 'android' | 'ios' | 'web', code: string) {
  return {
    platform,
    code,
    map: '{"version":3,"sources":[],"mappings":""}',
    durationMs: 25,
    requestPath: `/.runwhale/metro-${platform}-entry.bundle`,
  }
}
