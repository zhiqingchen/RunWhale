import { lstat, mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunWhaleRuntimeHost, hasSuccessfulWorkspaceMutation, metroDiagnostic, repairInterruptedSessionSeed } from '../src/runtime-host.js'
import { MobileGitRepository, MobilePackageInstaller, validateGitHubSshPrivateKey } from '@runwhale/mobile-runtime'
import { MobileProjectFileSystem } from '@runwhale/mobile-runtime/sandbox'

const hosts: RunWhaleRuntimeHost[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(hosts.splice(0).map((host) => host.stop()))
})

describe('RunWhaleRuntimeHost', () => {
  it('atomically imports a GitHub commit as a new project without starting project work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-github-import-'))
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: async () => ({ text: '' }) } })
    hosts.push(host)
    const info = await host.start()
    const rpc = createRuntimeRpc(info)
    const snapshot = vi.spyOn(MobileGitRepository, 'importGitHubSnapshot').mockImplementation(async (dir) => {
      await writeFile(join(dir, 'README.md'), '# Imported\n')
      await new MobileGitRepository(dir).ensureInitialized()
      return { access: 'public', remoteUrl: 'https://github.com/example/repository.git' }
    })
    const reference = { owner: 'example', repo: 'repository', commit: 'a'.repeat(40) }

    const first = await rpc('project.import.githubSnapshot', reference)
    const second = await rpc('project.import.githubSnapshot', reference)

    expect(first).toMatchObject({ ok: true, result: { id: 'repository', name: 'repository', ...reference, access: 'public' } })
    expect(second).toMatchObject({ ok: true, result: { id: 'repository-2' } })
    expect(snapshot).toHaveBeenCalledTimes(2)
    expect(await readFile(join(root, 'projects', 'repository', 'README.md'), 'utf8')).toBe('# Imported\n')
    expect(await readdir(join(root, 'projects', 'repository'))).not.toContain('node_modules')
    expect(await readdir(join(root, 'projects', 'repository', '.runwhale'))).not.toContain('sessions')
  })

  it('rolls back an interrupted GitHub snapshot import', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-github-rollback-'))
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'android', agent: { run: async () => ({ text: '' }) } })
    hosts.push(host)
    const info = await host.start()
    const rpc = createRuntimeRpc(info)
    vi.spyOn(MobileGitRepository, 'importGitHubSnapshot').mockImplementation(async (dir) => {
      await writeFile(join(dir, 'partial.txt'), 'partial')
      throw new Error('download interrupted')
    })

    expect(await rpc('project.import.githubSnapshot', { owner: 'example', repo: 'broken', commit: 'b'.repeat(40) })).toMatchObject({ error: { message: 'download interrupted' } })
    expect((await readdir(join(root, 'projects'))).filter((name) => name.startsWith('.github-') || name === 'broken')).toEqual([])
  })

  it('uses only non-force publishing and rejects a post-push SHA mismatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-github-share-'))
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: async () => ({ text: '' }) } })
    hosts.push(host)
    const info = await host.start()
    const rpc = createRuntimeRpc(info)
    await rpc('project.create', { id: 'shared', name: 'Shared' })
    const before = { branch: 'main', head: 'c'.repeat(40), remote: { name: 'origin', url: 'https://github.com/example/shared.git', owner: 'example', repo: 'shared', commit: 'd'.repeat(40) }, worktreeClean: true, changedPaths: [], remoteAccessible: true, remoteMatchesHead: false, canPublish: true, shareable: false, blockers: [{ code: 'REMOTE_SHA_MISMATCH', message: 'mismatch' }] }
    vi.spyOn(MobileGitRepository.prototype, 'inspectShare').mockResolvedValueOnce(before as any).mockResolvedValueOnce(before as any)
    const push = vi.spyOn(MobileGitRepository.prototype, 'push').mockResolvedValue({ remote: 'origin', branch: 'main', ok: true, refs: {} })

    expect(await rpc('git.share.publish', { projectId: 'shared' })).toMatchObject({ error: { message: expect.stringContaining('does not match') } })
    expect(push).toHaveBeenCalledWith('origin', 'main', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })
  it('detects only successful file-changing Agent tool results for automatic commits', () => {
    const events = [
      { type: 'tool/call', data: { callId: 'read', name: 'read_files' } },
      { type: 'tool/result', data: { message: { source: { callId: 'read' }, content: [{ type: 'tool-result', isError: false }] } } },
      { type: 'tool/call', data: { callId: 'failed-write', name: 'write_file' } },
      { type: 'tool/result', data: { message: { source: { callId: 'failed-write' }, content: [{ type: 'tool-result', isError: true }] } } },
      { type: 'tool/call', data: { callId: 'commit', name: 'git_commit' } },
      { type: 'tool/result', data: { message: { source: { callId: 'commit' }, content: [{ type: 'tool-result', isError: false }] } } },
      { type: 'tool/call', data: { callId: 'batch-write', name: 'write_files' } },
      { type: 'tool/result', data: { message: { source: { callId: 'batch-write' }, content: [{ type: 'tool-result', isError: false }] } } },
    ]
    expect(hasSuccessfulWorkspaceMutation(events.slice(0, 6))).toBe(false)
    expect(hasSuccessfulWorkspaceMutation(events)).toBe(true)
    expect(hasSuccessfulWorkspaceMutation(events, events.length)).toBe(false)
  })

  it('repairs only the legacy interrupted seed-boundary gap', () => {
    const broken = [
      { type: 'turn/end', seq: 0, time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'agent/inbox/spliced', seq: 2, time: 2, data: { target: 'next-turn' } },
      { type: 'turn/start', seq: 3, time: 3, data: { turn: 2 } },
    ]
    expect(repairInterruptedSessionSeed(broken, 'failed')).toEqual([
      broken[0],
      { type: 'session/end-seed', seq: 1, time: 2, data: {} },
      broken[1],
      broken[2],
    ])
    expect(repairInterruptedSessionSeed(broken, 'completed')).toBe(broken)
    const ambiguous = [broken[0], { ...broken[1], type: 'assistant/message' }]
    expect(repairInterruptedSessionSeed(ambiguous, 'failed')).toBe(ambiguous)

    const missingSetupEvents = [
      broken[0],
      { ...broken[1], seq: 3 },
      { ...broken[2], seq: 4 },
    ]
    expect(repairInterruptedSessionSeed(missingSetupEvents, 'failed')).toEqual([broken[0]])

    const incompleteResume = [
      broken[0],
      { type: 'session/end-seed', seq: 1, time: 2, data: {} },
      { type: 'agent/inbox/spliced', seq: 2, time: 3, data: { target: 'next-turn' } },
      { type: 'turn/start', seq: 3, time: 4, data: { turn: 2 } },
      { type: 'assistant/chunk', seq: 4, time: 5 },
    ]
    expect(repairInterruptedSessionSeed(incompleteResume, 'failed')).toEqual([broken[0]])
  })

  it('migrates an interrupted Android session before retrying it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-interrupted-seed-'))
    let receivedSeed: readonly unknown[] = []
    const host = new RunWhaleRuntimeHost({
      root,
      moduleStore: join(root, 'modules'),
      platform: 'android',
      agent: {
        run: async ({ sessionId: _sessionId, prompt: _prompt, seed = [] }) => {
          receivedSeed = seed
          return { text: 'Recovered.', events: seed }
        },
      },
    })
    hosts.push(host)
    const info = await host.start()
    const rpc = createRuntimeRpc(info)
    await rpc('project.create', { id: 'interrupted-project', name: 'Interrupted Project' })
    const sessionDirectory = join(root, 'projects', 'interrupted-project', '.runwhale', 'sessions')
    await mkdir(sessionDirectory, { recursive: true })
    await writeFile(join(sessionDirectory, 'broken-session.json'), `${JSON.stringify({
      sessionId: 'broken-session',
      projectId: 'interrupted-project',
      title: 'Interrupted session',
      updatedAt: 1,
      state: 'failed',
      events: [
        { type: 'turn/end', seq: 0, time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
        { type: 'agent/inbox/spliced', seq: 2, time: 2, data: { target: 'next-turn' } },
        { type: 'turn/start', seq: 3, time: 3, data: { turn: 2 } },
      ],
    })}\n`)

    expect(await rpc('agent.run', {
      projectId: 'interrupted-project',
      sessionId: 'broken-session',
      prompt: 'Retry',
    })).toMatchObject({ ok: true })
    expect(receivedSeed).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'session/end-seed', seq: 1 }),
    ]))
    expect(receivedSeed.map((event: any) => event.seq)).toEqual([0, 1, 2, 3])
    const saved = JSON.parse(await readFile(join(sessionDirectory, 'broken-session.json'), 'utf8'))
    expect(saved.events.map((event: any) => event.seq)).toEqual([0, 1, 2, 3])
  })

  it('copies app-container images into a project and passes only verified bytes to Agent', async () => {
    const container = await mkdtemp(join(tmpdir(), 'runwhale-attachment-container-'))
    const root = join(container, 'Library', 'Application Support', 'runwhale-runtime')
    const cache = join(container, 'Library', 'Caches')
    await mkdir(cache, { recursive: true })
    const image = join(cache, 'pixel.png')
    await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
    let received: readonly { data: Uint8Array; mediaType: string; name?: string }[] = []
    const host = new RunWhaleRuntimeHost({
      root,
      moduleStore: join(root, 'modules'),
      platform: 'ios',
      agent: { run: async ({ attachments = [] }) => { received = attachments; return { text: 'Attached.', events: [{ type: 'turn/end' }] } } },
    })
    hosts.push(host)
    const info = await host.start()
    const rpc = async (method: string, params: unknown) => fetch(`${info.origin}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }),
    }).then((response) => response.json()) as Promise<any>
    await rpc('project.create', { id: 'image-project', name: 'Image project' })
    const attached = await rpc('project.attach', { projectId: 'image-project', sourcePath: image, name: '../screen.png', mediaType: 'image/png' })
    expect(attached).toMatchObject({ ok: true, result: { name: 'screen.png', mediaType: 'image/png' } })
    expect(attached.result.path).toMatch(/^\.runwhale\/attachments\/[0-9a-f-]+\.png$/)
    expect((await rpc('agent.run', { projectId: 'image-project', prompt: 'Inspect', attachmentPaths: [attached.result.path] })).ok).toBe(true)
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ mediaType: 'image/png' })
    expect(Buffer.from(received[0]!.data).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const outside = join(tmpdir(), 'outside-image.png')
    await writeFile(outside, await readFile(image))
    expect(await rpc('project.attach', { projectId: 'image-project', sourcePath: outside, name: 'outside.png', mediaType: 'image/png' })).toMatchObject({ error: { message: expect.stringContaining('application container') } })
  })

  it('maps Metro diagnostics to a source location for Studio', () => {
    expect(metroDiagnostic(new Error('SyntaxError: /projects/game/app/index.tsx:19:7 Unexpected token'))).toMatchObject({
      path: '/projects/game/app/index.tsx',
      line: 19,
      column: 7,
    })
  })

  it('attributes Node task diagnostics to the originating project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-task-diagnostic-'))
    const host = new RunWhaleRuntimeHost({
      root,
      moduleStore: join(root, 'modules'),
      platform: 'android',
      agent: { run: async () => ({ text: '' }) },
      taskWorkerUrl: new URL('../../mobile-runtime/src/task-worker.ts', import.meta.url),
    })
    hosts.push(host)
    const info = await host.start()
    const rpc = createRuntimeRpc(info)
    await rpc('project.create', { id: 'task-diagnostic-project', name: 'Task Diagnostic Project' })
    await rpc('project.write', { projectId: 'task-diagnostic-project', path: 'fail.ts', content: 'throw new Error("project task failed")\n' })

    const task = await rpc('task.run', { projectId: 'task-diagnostic-project', entry: 'fail.ts' })
    const diagnostic = await waitForHostEvent(info.origin, info.token, 'diagnostic')

    expect(diagnostic).toMatchObject({
      name: 'diagnostic',
      data: {
        source: 'node-task',
        projectId: 'task-diagnostic-project',
        taskId: task.result.taskId,
        message: 'Error: project task failed',
      },
    })
  })

  it('derives active Preview state from the live Preview instead of a stale snapshot', () => {
    const host = new RunWhaleRuntimeHost({ root: join(tmpdir(), 'runwhale-preview-state'), moduleStore: join(tmpdir(), 'runwhale-preview-modules'), platform: 'ios', agent: { run: async () => ({ text: '' }) } })
    const activePreview = { projectId: 'preview-state', platform: 'ios' as const, port: 31_337, token: 'ephemeral', bundleUrl: 'http://127.0.0.1:31337', startedAt: 1 }
    Object.assign(host, { preview: activePreview, state: { ...host.snapshot(), activeProjectId: 'preview-state', activePreview: { platform: 'ios', port: 31_337, startedAt: 1 } } })
    expect(host.snapshot().activePreview).toMatchObject({ platform: 'ios', port: 31_337 })
    Object.assign(host, { preview: undefined })
    expect(host.snapshot().activePreview).toBeUndefined()
  })

  it('runs the Preview target declared by the project instead of an Agent-selected platform', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-agent-preview-target-'))
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: async () => ({ text: '' }) } })
    hosts.push(host)
    const info = await host.start()
    const rpc = createRuntimeRpc(info)
    await rpc('project.create', { id: 'native-project', name: 'Native project' })
    const projectRoot = join(root, 'projects', 'native-project')
    await writeFile(join(projectRoot, 'runwhale.json'), `${JSON.stringify({
      schemaVersion: 1,
      id: 'native-project',
      name: 'Native project',
      runtimeAbi: { ios: 'runwhale-expo57-ios-v1' },
      entry: { ios: 'index.tsx' },
      preview: { target: 'native' },
      capabilities: [],
      tasks: {},
      source: { kind: 'local' },
    })}\n`)
    const runPreview = vi.spyOn(host as any, 'runPreview').mockResolvedValue({ port: 31_337, token: 'token', bundleUrl: 'http://127.0.0.1:31337' })

    const signal = new AbortController().signal
    await host.runAgentPreview(projectRoot, 'agent-session', signal)

    expect(runPreview).toHaveBeenCalledWith('native-project', 'ios', signal, 'agent-session')
  })

  it('runs deterministic sessions without injecting bundled project files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-host-'))
    const seeds: Array<readonly unknown[]> = []
    const agent = { run: async ({ seed = [] }: import('../src/agent-driver.js').AgentRunOptions) => {
      seeds.push(seed)
      return { text: 'Request completed.', events: [...seed, { type: 'turn/end' }] }
    } }
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'android', agent })
    hosts.push(host)
    const info = await host.start()
    const rpc = async (method: string, params: unknown) => {
      const response = await fetch(`${info.origin}/rpc`, {
        method: 'POST',
        headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }),
      })
      return response.json() as Promise<{ ok: boolean; result: any }>
    }
    const created = await rpc('project.create', { id: 'studio-project', name: 'Studio project' })
    expect(created.ok).toBe(true)
    const id = created.result.id as string
    expect(id).toBe('studio-project')
    const initialFiles = await readdir(join(root, 'projects', id))
    expect(initialFiles).toEqual(expect.arrayContaining(['.runwhale', '.git', '.gitignore', 'runwhale.json']))
    expect(initialFiles).not.toContain('app')
    expect(initialFiles).not.toContain('package.json')
    expect(JSON.parse(await readFile(join(root, 'projects', id, 'runwhale.json'), 'utf8'))).toMatchObject({ entry: {}, runtimeAbi: {}, source: { kind: 'local' } })
    const replay = await rpc('agent.run', { projectId: id, prompt: 'Inspect this empty project' })
    expect(replay.ok).toBe(true)
    const continued = await rpc('agent.run', { projectId: id, sessionId: replay.result.sessionId, prompt: 'Continue the inspection' })
    expect(continued.ok).toBe(true)
    expect(seeds[1]).toHaveLength(1)
    expect(await readdir(join(root, 'projects', id))).not.toEqual(expect.arrayContaining(['app', 'package.json']))
    const snapshot = await rpc('host.snapshot', {})
    expect(snapshot.result.snapshot.nodeVersion).toBe('24.19.0')
    expect(snapshot.result.events.length).toBeGreaterThan(0)
    expect(snapshot.result.snapshot.lastEventSequence).toBeGreaterThan(0)
  })

  it('validates and forwards the selected model provider profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-model-profile-'))
    let receivedProfile: unknown
    const host = new RunWhaleRuntimeHost({
      root,
      moduleStore: join(root, 'modules'),
      platform: 'android',
      agent: { run: async ({ sessionId: _sessionId, prompt: _prompt, seed: _seed, projectRoot: _projectRoot, signal: _signal, onEvent: _onEvent, planMode: _planMode, provider: _provider, model: _model, agentPreset: _agentPreset, attachments: _attachments, modelProfile }) => {
        receivedProfile = modelProfile
        return { text: 'Configured.', events: [] }
      } },
    })
    hosts.push(host)
    const rpc = createRuntimeRpc(await host.start())
    await rpc('project.create', { id: 'model-profile-project', name: 'Model profile' })
    const modelProfile = {
      baseURL: 'http://127.0.0.1:8000/v1',
      models: [{ id: ' private-coder ', name: ' Private Coder ', contextWindow: 65_536, maxTokens: 8_192 }],
    }
    expect(await rpc('agent.run', { projectId: 'model-profile-project', prompt: 'Inspect', provider: 'openai', model: 'private-coder', modelProfile })).toMatchObject({ ok: true })
    expect(receivedProfile).toEqual({
      baseURL: modelProfile.baseURL,
      models: [{ id: 'private-coder', name: 'Private Coder', contextWindow: 65_536, maxTokens: 8_192 }],
    })
    expect(await rpc('agent.run', {
      projectId: 'model-profile-project',
      prompt: 'Inspect',
      modelProfile: { baseURL: 'file:///tmp/models', models: [{ id: 'unsafe' }] },
    })).toMatchObject({ error: { message: 'model base URL must use HTTP or HTTPS' } })
  })

  it('renames project metadata without changing its id, directory, or Git history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-rename-project-'))
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: async () => ({ text: '' }) } })
    hosts.push(host)
    const info = await host.start()
    const rpc = async (method: string, params: unknown) => fetch(`${info.origin}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }),
    }).then((response) => response.json()) as Promise<any>

    await rpc('project.create', { id: 'rename-project', name: 'Before' })
    const projectRoot = join(root, 'projects', 'rename-project')
    const historyBefore = await new MobileGitRepository(projectRoot).log(10)
    expect(await rpc('project.rename', { projectId: 'rename-project', name: '  Meteor   Dodge  ' })).toMatchObject({
      ok: true,
      result: { id: 'rename-project', name: 'Meteor Dodge' },
    })
    expect(JSON.parse(await readFile(join(projectRoot, 'runwhale.json'), 'utf8'))).toMatchObject({ id: 'rename-project', name: 'Meteor Dodge' })
    expect((await rpc('project.list', {})).result).toEqual([expect.objectContaining({ id: 'rename-project', name: 'Meteor Dodge' })])
    expect(await new MobileGitRepository(projectRoot).log(10)).toEqual(historyBefore)
    expect(await rpc('project.rename', { projectId: 'rename-project', name: '../unsafe' })).toMatchObject({ error: { message: 'invalid project name: invalid-character' } })
  })

  it('deletes only one managed project tree, clears active state, and treats a missing retry as success', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-delete-project-'))
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: async () => ({ text: '' }) } })
    hosts.push(host)
    const info = await host.start()
    const rpc = createRuntimeRpc(info)

    await rpc('project.create', { id: 'delete-project', name: 'Delete Project' })
    await rpc('project.create', { id: 'sibling-project', name: 'Sibling Project' })
    const deletedRoot = join(root, 'projects', 'delete-project')
    const siblingRoot = join(root, 'projects', 'sibling-project')
    await mkdir(join(deletedRoot, '.runwhale', 'sessions'), { recursive: true })
    await mkdir(join(deletedRoot, 'node_modules', 'local-package'), { recursive: true })
    await writeFile(join(deletedRoot, '.runwhale', 'sessions', 'session.json'), '{"events":[]}\n')
    await writeFile(join(deletedRoot, 'node_modules', 'local-package', 'index.js'), 'module.exports = true\n')
    await writeFile(join(siblingRoot, 'sibling.txt'), 'keep sibling\n')
    await mkdir(join(root, '.runwhale', 'attachments'), { recursive: true })
    await mkdir(join(root, '.runwhale', 'npm-cache'), { recursive: true })
    await writeFile(join(root, '.runwhale', 'attachments', 'sha256-global.bin'), 'keep attachment\n')
    await writeFile(join(root, '.runwhale', 'npm-cache', 'shared-cache'), 'keep npm cache\n')
    await writeFile(join(root, 'modules', 'shared-module'), 'keep module\n')
    await rpc('host.start', { projectRoot: 'delete-project' })

    expect(await rpc('project.delete', { projectId: 'delete-project' })).toMatchObject({ result: { deleted: true } })
    await expect(lstat(deletedRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(siblingRoot, 'sibling.txt'), 'utf8')).resolves.toBe('keep sibling\n')
    await expect(readFile(join(root, '.runwhale', 'attachments', 'sha256-global.bin'), 'utf8')).resolves.toBe('keep attachment\n')
    await expect(readFile(join(root, '.runwhale', 'npm-cache', 'shared-cache'), 'utf8')).resolves.toBe('keep npm cache\n')
    await expect(readFile(join(root, 'modules', 'shared-module'), 'utf8')).resolves.toBe('keep module\n')

    const snapshot = await rpc('host.snapshot', {})
    expect(snapshot.result.snapshot.activeProjectId).toBeUndefined()
    expect(snapshot.result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'project.changed', data: { projectId: 'delete-project', deleted: true } }),
    ]))
    expect(await rpc('project.delete', { projectId: 'delete-project' })).toMatchObject({ result: { deleted: false } })
    expect(await rpc('project.delete', { projectId: '../sibling-project' })).toMatchObject({ error: { message: 'invalid project id' } })
    await expect(readFile(join(siblingRoot, 'sibling.txt'), 'utf8')).resolves.toBe('keep sibling\n')
  })

  it('refuses linked and non-directory deletion targets without touching their bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-delete-boundary-'))
    const outside = await mkdtemp(join(tmpdir(), 'runwhale-delete-outside-'))
    await writeFile(join(outside, 'outside.txt'), 'keep outside\n')
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'android', agent: { run: async () => ({ text: '' }) } })
    hosts.push(host)
    const info = await host.start()
    const rpc = createRuntimeRpc(info)
    await symlink(outside, join(root, 'projects', 'linked-project'))
    await writeFile(join(root, 'projects', 'file-project'), 'keep file\n')

    expect(await rpc('project.delete', { projectId: 'linked-project' })).toMatchObject({ error: { message: expect.stringContaining('symbolic link') } })
    expect(await rpc('project.delete', { projectId: 'file-project' })).toMatchObject({ error: { message: expect.stringContaining('not a directory') } })
    await expect(readFile(join(outside, 'outside.txt'), 'utf8')).resolves.toBe('keep outside\n')
    await expect(readFile(join(root, 'projects', 'file-project'), 'utf8')).resolves.toBe('keep file\n')
  })

  it('keeps Agent, Node task, and dependency activity busy until each owner stops', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-delete-busy-'))
    let markAgentStarted!: () => void
    let finishAgent!: () => void
    const agentStarted = new Promise<void>((resolve) => { markAgentStarted = resolve })
    const agentFinished = new Promise<void>((resolve) => { finishAgent = resolve })
    const packageInstaller = new MobilePackageInstaller({
      npmRoot: join(root, '.runwhale', 'npm'),
      cacheRoot: join(root, '.runwhale', 'npm-cache'),
      workerUrl: new URL(`data:text/javascript,${encodeURIComponent('setInterval(() => undefined, 1000)')}`),
    })
    const host = new RunWhaleRuntimeHost({
      root,
      moduleStore: join(root, 'modules'),
      platform: 'android',
      agent: { run: async () => { markAgentStarted(); await agentFinished; return { text: 'Done', events: [{ type: 'turn/end' }] } } },
      taskWorkerUrl: new URL('../src/task-worker.ts', import.meta.url),
      packageInstaller,
    })
    hosts.push(host)
    const info = await host.start()
    const rpc = createRuntimeRpc(info)
    for (const projectId of ['agent-project', 'task-project', 'pending-package', 'running-package']) {
      await rpc('project.create', { id: projectId, name: projectId })
    }

    const runningAgent = rpc('agent.run', { projectId: 'agent-project', prompt: 'Keep working' })
    await agentStarted
    expect(await rpc('project.delete', { projectId: 'agent-project' })).toMatchObject({ error: { message: expect.stringMatching(/busy/i) } })
    finishAgent()
    expect(await runningAgent).toMatchObject({ ok: true })
    expect(await rpc('project.delete', { projectId: 'agent-project' })).toMatchObject({ result: { deleted: true } })

    await writeFile(join(root, 'projects', 'task-project', 'hold.ts'), 'setInterval(() => undefined, 1_000)\n')
    const task = await rpc('task.run', { projectId: 'task-project', entry: 'hold.ts' })
    expect(await rpc('project.delete', { projectId: 'task-project' })).toMatchObject({ error: { message: expect.stringMatching(/busy/i) } })
    expect(await rpc('task.cancel', { taskId: task.result.taskId })).toMatchObject({ result: { cancelled: true } })
    await waitForCondition(() => !((host as any).tasks.hasRunningTaskForRoot(join(root, 'projects', 'task-project'))), 'Node task cancellation')
    expect(await rpc('project.delete', { projectId: 'task-project' })).toMatchObject({ result: { deleted: true } })

    for (const projectId of ['pending-package', 'running-package']) {
      await rpc('project.write', { projectId, path: 'package.json', content: `{"name":"${projectId}","version":"1.0.0"}\n` })
    }
    const pending = await rpc('package.plan', { projectId: 'pending-package', dependencies: { 'is-number': '7.0.0' } })
    expect(await rpc('project.delete', { projectId: 'pending-package' })).toMatchObject({ error: { message: expect.stringMatching(/busy/i) } })
    expect(await rpc('package.reject', { planId: pending.result.planId })).toMatchObject({ result: { rejected: true } })
    expect(await rpc('project.delete', { projectId: 'pending-package' })).toMatchObject({ result: { deleted: true } })

    const runningPlan = await rpc('package.plan', { projectId: 'running-package', dependencies: { 'is-number': '7.0.0' } })
    const install = await rpc('package.install', { planId: runningPlan.result.planId })
    expect(await rpc('project.delete', { projectId: 'running-package' })).toMatchObject({ error: { message: expect.stringMatching(/busy/i) } })
    expect(await rpc('package.cancel', { installId: install.result.installId })).toMatchObject({ result: { cancelled: true } })
    await waitForCondition(() => !packageInstaller.hasProjectActivity('running-package'), 'package cancellation')
    expect(await rpc('project.delete', { projectId: 'running-package' })).toMatchObject({ result: { deleted: true } })
  })

  it('reserves an Agent session before asynchronous project validation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-agent-start-race-'))
    const runAgent = vi.fn(async () => ({ text: 'Done', events: [{ type: 'turn/end' }] }))
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: runAgent } })
    hosts.push(host)
    const info = await host.start()
    const rpc = createRuntimeRpc(info)
    await rpc('project.create', { id: 'agent-start-a', name: 'Agent Start A' })
    await rpc('project.create', { id: 'agent-start-b', name: 'Agent Start B' })

    const originalBeginProjectWork = (host as any).beginProjectWork.bind(host)
    let markValidationStarted!: () => void
    let finishValidation!: () => void
    const validationStarted = new Promise<void>((resolve) => { markValidationStarted = resolve })
    const validationFinished = new Promise<void>((resolve) => { finishValidation = resolve })
    const beginSpy = vi.spyOn(host as any, 'beginProjectWork').mockImplementationOnce(async (...args: unknown[]) => {
      markValidationStarted()
      await validationFinished
      return originalBeginProjectWork(String(args[0]))
    })

    const first = rpc('agent.run', { projectId: 'agent-start-a', sessionId: 'shared-session', prompt: 'First' })
    await validationStarted
    try {
      expect(await rpc('agent.run', { projectId: 'agent-start-b', sessionId: 'shared-session', prompt: 'Second' })).toMatchObject({ error: { message: 'Agent session is already running' } })
      expect(beginSpy).toHaveBeenCalledTimes(1)
    } finally {
      finishValidation()
    }
    expect(await first).toMatchObject({ ok: true })
    expect(runAgent).toHaveBeenCalledTimes(1)
  })

  it('keeps deletion busy for the complete Agent Goal mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-goal-delete-race-'))
    let markGoalStarted!: () => void
    let finishGoal!: () => void
    const goalStarted = new Promise<void>((resolve) => { markGoalStarted = resolve })
    const goalFinished = new Promise<void>((resolve) => { finishGoal = resolve })
    const goal = { id: 'goal-1', revision: 1, objective: 'Ship safely', phase: 'active' as const, maxGoalRounds: 3, roundsStarted: 0, createdAt: 1, updatedAt: 1, activation: 'armed' as const }
    const host = new RunWhaleRuntimeHost({
      root,
      moduleStore: join(root, 'modules'),
      platform: 'android',
      agent: {
        run: async () => ({ text: '' }),
        createGoal: async () => { markGoalStarted(); await goalFinished; return goal },
        sessionEvents: () => [{ type: 'goal/change', seq: 1, data: { operation: 'create', goal } }],
      },
    })
    hosts.push(host)
    const info = await host.start()
    const rpc = createRuntimeRpc(info)
    await rpc('project.create', { id: 'goal-delete-project', name: 'Goal Delete Project' })
    await rpc('session.create', { projectId: 'goal-delete-project', sessionId: 'goal-delete-session', title: 'Goal session' })

    await rpc('agent.run', { projectId: 'goal-delete-project', sessionId: 'goal-delete-session', prompt: 'Initialize' })
    const mutation = rpc('agent.goal.create', { projectId: 'goal-delete-project', sessionId: 'goal-delete-session', objective: 'Ship safely' })
    await goalStarted
    expect(await rpc('project.delete', { projectId: 'goal-delete-project' })).toMatchObject({ error: { message: expect.stringMatching(/busy/i) } })
    finishGoal()
    expect(await mutation).toMatchObject({ result: { goal: { id: 'goal-1' } } })
    expect(await rpc('project.delete', { projectId: 'goal-delete-project' })).toMatchObject({ result: { deleted: true } })
  })

  it('serializes deletion with Preview, blocks later target work, and leaves another project Preview alone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-delete-preview-'))
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: async () => ({ text: '' }) } })
    hosts.push(host)
    const info = await host.start()
    const rpc = createRuntimeRpc(info)
    await rpc('project.create', { id: 'preview-project', name: 'Preview Project' })
    await rpc('project.create', { id: 'other-project', name: 'Other Project' })
    await rpc('host.start', { projectRoot: 'preview-project' })
    Object.assign(host, {
      preview: { projectId: 'preview-project', platform: 'ios', port: 31_337, token: 'private', bundleUrl: 'http://127.0.0.1:31337/index.bundle', startedAt: 1 },
    })
    const stopMetro = vi.spyOn((host as any).metro, 'stop').mockResolvedValue(undefined)
    let releasePreviewOperation!: () => void
    let markPreviewOperationStarted!: () => void
    const previewOperationStarted = new Promise<void>((resolve) => { markPreviewOperationStarted = resolve })
    const holdPreviewOperation = new Promise<void>((resolve) => { releasePreviewOperation = resolve })
    const priorPreviewOperation = (host as any).enqueuePreviewOperation(undefined, async () => {
      markPreviewOperationStarted()
      await holdPreviewOperation
    }) as Promise<void>
    await previewOperationStarted

    const deletion = (host as any).deleteProject('preview-project') as Promise<boolean>
    expect((host as any).deletingProjects.has('preview-project')).toBe(true)
    expect(await rpc('preview.open', { projectId: 'preview-project', platform: 'ios' })).toMatchObject({ error: { message: expect.stringContaining('being deleted') } })
    await expect(lstat(join(root, 'projects', 'preview-project'))).resolves.toMatchObject({})
    releasePreviewOperation()
    await priorPreviewOperation
    await expect(deletion).resolves.toBe(true)
    expect(stopMetro).toHaveBeenCalledTimes(1)
    expect(host.snapshot().activeProjectId).toBeUndefined()
    expect(host.snapshot().activePreview).toBeUndefined()

    await rpc('project.create', { id: 'delete-another', name: 'Delete Another' })
    await rpc('host.start', { projectRoot: 'other-project' })
    Object.assign(host, {
      preview: { projectId: 'other-project', platform: 'ios', port: 31_338, token: 'private', bundleUrl: 'http://127.0.0.1:31338/index.bundle', startedAt: 2 },
    })
    expect(await rpc('project.delete', { projectId: 'delete-another' })).toMatchObject({ result: { deleted: true } })
    expect(stopMetro).toHaveBeenCalledTimes(1)
    expect(host.snapshot()).toMatchObject({ activeProjectId: 'other-project', activePreview: { platform: 'ios', port: 31_338 } })
  })

  it('keeps a target Preview recoverable when stopping it fails, then deletes on retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-delete-preview-retry-'))
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: async () => ({ text: '' }) } })
    hosts.push(host)
    const info = await host.start()
    const rpc = createRuntimeRpc(info)
    await rpc('project.create', { id: 'preview-retry', name: 'Preview Retry' })
    await rpc('host.start', { projectRoot: 'preview-retry' })
    Object.assign(host, {
      preview: { projectId: 'preview-retry', platform: 'ios', port: 31_337, token: 'private', bundleUrl: 'http://127.0.0.1:31337/index.bundle', startedAt: 1 },
    })
    const stopMetro = vi.spyOn((host as any).metro, 'stop')
      .mockRejectedValueOnce(new Error('Metro stop failed'))
      .mockResolvedValue(undefined)

    expect(await rpc('project.delete', { projectId: 'preview-retry' })).toMatchObject({ error: { message: 'Metro stop failed' } })
    await expect(lstat(join(root, 'projects', 'preview-retry'))).resolves.toMatchObject({})
    expect(host.snapshot().activeProjectId).toBe('preview-retry')
    expect(host.snapshot().activePreview).toBeUndefined()

    expect(await rpc('project.delete', { projectId: 'preview-retry' })).toMatchObject({ result: { deleted: true } })
    await expect(lstat(join(root, 'projects', 'preview-retry'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(stopMetro).toHaveBeenCalledTimes(1)
    expect(host.snapshot().activePreview).toBeUndefined()
  })

  it('does not reactivate or recreate a project from stale work after deletion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-delete-stale-work-'))
    const runAgent = vi.fn(async () => ({ text: '' }))
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: runAgent } })
    hosts.push(host)
    const info = await host.start()
    const rpc = createRuntimeRpc(info)
    const projectRoot = join(root, 'projects', 'stale-project')
    await rpc('project.create', { id: 'stale-project', name: 'Stale Project' })
    await rpc('host.start', { projectRoot: 'stale-project' })
    expect(await rpc('project.delete', { projectId: 'stale-project' })).toMatchObject({ result: { deleted: true } })

    for (const request of [
      rpc('host.start', { projectRoot: 'stale-project' }),
      rpc('project.write', { projectId: 'stale-project', path: 'late.txt', content: 'late\n' }),
      rpc('agent.run', { projectId: 'stale-project', prompt: 'Late work' }),
    ]) {
      expect(await request).toMatchObject({ error: { message: 'project does not exist' } })
    }
    expect(runAgent).not.toHaveBeenCalled()
    await expect(lstat(projectRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(host.snapshot().activeProjectId).toBeUndefined()
  })

  it('keeps deletion busy until an in-flight project mutation finishes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-delete-mutation-'))
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'android', agent: { run: async () => ({ text: '' }) } })
    hosts.push(host)
    const info = await host.start()
    const rpc = createRuntimeRpc(info)
    await rpc('project.create', { id: 'mutation-project', name: 'Mutation Project' })
    let markWriteStarted!: () => void
    let finishWrite!: () => void
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve })
    const writeFinished = new Promise<void>((resolve) => { finishWrite = resolve })
    const originalWriteText = MobileProjectFileSystem.prototype.writeText
    const writeSpy = vi.spyOn(MobileProjectFileSystem.prototype, 'writeText').mockImplementation(async function (this: MobileProjectFileSystem, path, content, expectedVersion) {
      if (path === 'held.txt') {
        markWriteStarted()
        await writeFinished
      }
      return originalWriteText.call(this, path, content, expectedVersion)
    })

    const write = rpc('project.write', { projectId: 'mutation-project', path: 'held.txt', content: 'complete\n' })
    await writeStarted
    expect(await rpc('project.delete', { projectId: 'mutation-project' })).toMatchObject({ error: { message: expect.stringMatching(/busy/i) } })
    finishWrite()
    expect(await write).toMatchObject({ ok: true })
    writeSpy.mockRestore()
    expect(await rpc('project.delete', { projectId: 'mutation-project' })).toMatchObject({ result: { deleted: true } })
  })

  it('clones a provider-neutral Git URL into an independent project while preserving repository history', async () => {
    const clone = vi.spyOn(MobileGitRepository, 'clone').mockImplementation(async (dir, _repositoryUrl, options) => {
      if (!options) throw new Error('clone options are required')
      expect(options.signal).toBeInstanceOf(AbortSignal)
      options.onProgress?.({ phase: 'receiving', loaded: 3, total: 10 })
      options.onProgress?.({ phase: 'validating', loaded: 1, total: 1 })
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'README.md'), '# Remote project\n')
      const repository = new MobileGitRepository(dir)
      await repository.ensureInitialized('Remote repository history')
      return repository
    })
    try {
      const root = await mkdtemp(join(tmpdir(), 'runwhale-github-host-'))
      const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'android', agent: { run: async () => ({ text: '' }) } })
      hosts.push(host)
      const info = await host.start()
      const response = await fetch(`${info.origin}/rpc`, {
        method: 'POST',
        headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, type: 'request', id: 'clone-project', method: 'project.clone', params: { repositoryUrl: 'https://github.com/example/remote-game' } }),
      }).then((value) => value.json()) as any
      expect(response).toMatchObject({ ok: true, result: { id: 'remote-game', name: 'remote-game' } })
      const clonedRoot = join(root, 'projects', 'remote-game')
      expect((await new MobileGitRepository(clonedRoot).log(5))[0]?.message).toBe('Remote repository history')
      expect(JSON.parse(await readFile(join(clonedRoot, 'runwhale.json'), 'utf8'))).toMatchObject({
        id: 'remote-game',
        source: { kind: 'git', url: 'https://github.com/example/remote-game' },
      })
      const snapshot = await hostSnapshot(info.origin, info.token) as { result: { events: Array<{ name: string; data: Record<string, unknown> }> } }
      expect(snapshot.result.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'project.clone-progress',
          data: { requestId: 'clone-project', phase: 'receiving', loaded: 3, total: 10 },
        }),
        expect.objectContaining({
          name: 'project.clone-progress',
          data: { requestId: 'clone-project', phase: 'validating', loaded: 1, total: 1 },
        }),
      ]))
    } finally {
      clone.mockRestore()
    }
  })

  it('does not rewrite a manifest already committed by a cloned repository', async () => {
    const originalManifest = `${JSON.stringify({
      schemaVersion: 1,
      id: 'upstream-project',
      name: 'Upstream Project',
      runtimeAbi: {},
      entry: { web: 'src/main.tsx' },
      capabilities: [],
      tasks: {},
      source: { kind: 'local' },
    }, null, 2)}\n`
    const clone = vi.spyOn(MobileGitRepository, 'clone').mockImplementation(async (dir) => {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src', 'main.tsx'), 'export default null\n')
      await writeFile(join(dir, 'runwhale.json'), originalManifest)
      const repository = new MobileGitRepository(dir)
      await repository.ensureInitialized('Repository snapshot')
      return repository
    })
    try {
      const root = await mkdtemp(join(tmpdir(), 'runwhale-manifest-clone-'))
      const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: async () => ({ text: '' }) } })
      hosts.push(host)
      const info = await host.start()
      const rpc = createRuntimeRpc(info)

      expect(await rpc('project.clone', { repositoryUrl: 'https://github.com/example/upstream-project.git', name: 'Local Copy' })).toMatchObject({
        ok: true,
        result: { id: 'local-copy', name: 'Local Copy' },
      })
      const clonedRoot = join(root, 'projects', 'local-copy')
      expect(await readFile(join(clonedRoot, 'runwhale.json'), 'utf8')).toBe(originalManifest)
      expect(await new MobileGitRepository(clonedRoot).status()).toEqual([])
    } finally {
      clone.mockRestore()
    }
  })

  it('returns a valid SSH private key once without persisting it in host state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-ssh-'))
    const values = new Map<string, string>()
    const secrets = {
      async get(key: string) { return values.get(key) },
      async set(key: string, value: string) { values.set(key, value) },
      async delete(key: string) { values.delete(key) },
    }
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: async () => ({ text: '' }) }, secrets })
    hosts.push(host)
    const info = await host.start()
    const response = await fetch(`${info.origin}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, type: 'request', id: 'generate-ssh', method: 'ssh.generate', params: {} }),
    }).then((value) => value.json()) as any
    expect(response).toMatchObject({
      ok: true,
      result: {
        publicKey: expect.stringMatching(/^ssh-ed25519 [A-Za-z0-9+/=]+ runwhale-device$/),
        fingerprint: expect.stringMatching(/^SHA256:[A-Za-z0-9+/]+$/),
        privateKeyOneTime: expect.any(String),
      },
    })
    expect(response.result.privateKeyOneTime.length).toBeGreaterThan(100)
    expect(() => validateGitHubSshPrivateKey(response.result.privateKeyOneTime)).not.toThrow()
    const privateKey = response.result.privateKeyOneTime as string
    expect(values.get('ref:GITHUB_SSH_PRIVATE_KEY')).toBe(privateKey)
    const snapshot = JSON.stringify(await hostSnapshot(info.origin, info.token))
    expect(snapshot).not.toContain(privateKey)
    expect(JSON.stringify(await readdir(root, { recursive: true }))).not.toContain(privateKey)
    const rpc = async (method: string, params: unknown) => fetch(`${info.origin}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }),
    }).then((value) => value.json()) as Promise<any>
    expect(await rpc('ssh.credential.status', {})).toMatchObject({ result: { configured: true } })
    expect(await rpc('ssh.credential.delete', {})).toMatchObject({ result: { configured: false } })
    expect(values.has('ref:GITHUB_SSH_PRIVATE_KEY')).toBe(false)
  })

  it('keeps imported provider credentials only in the trusted host store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-credentials-'))
    const values = new Map<string, string>()
    const secrets = {
      async get(key: string) { return values.get(key) },
      async set(key: string, value: string) { values.set(key, value) },
      async delete(key: string) { values.delete(key) },
    }
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'android', agent: { run: async () => ({ text: '' }) }, secrets })
    hosts.push(host)
    const info = await host.start()
    const secret = 'sk-device-only-test-value'
    const response = await fetch(`${info.origin}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, type: 'request', id: 'credential-test', method: 'credential.set', params: { provider: 'deepseek', value: `  ${secret}  ` } }),
    })
    expect(await response.json()).toMatchObject({ ok: true, result: { configured: true } })
    expect(values.get('ref:DEEPSEEK_API_KEY')).toBe(secret)
    expect(JSON.stringify((await hostSnapshot(info.origin, info.token)))).not.toContain(secret)
    const blankResponse = await fetch(`${info.origin}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, type: 'request', id: 'credential-blank-test', method: 'credential.set', params: { provider: 'deepseek', value: '        ' } }),
    })
    expect(await blankResponse.json()).toMatchObject({ error: { message: 'invalid deepseek credential' } })
    expect(values.get('ref:DEEPSEEK_API_KEY')).toBe(secret)
  })

  it('persists model failures and exposes a failed Agent task instead of an empty completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-agent-failure-'))
    const host = new RunWhaleRuntimeHost({
      root,
      moduleStore: join(root, 'modules'),
      platform: 'android',
      agent: { run: async () => ({
        text: '',
        events: [{ type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'UNKNOWN_MODEL', message: 'unknown model' } } } }],
        failure: { code: 'UNKNOWN_MODEL', message: 'unknown model' },
      }) },
    })
    hosts.push(host)
    const info = await host.start()
    const rpc = async (method: string, params: unknown) => {
      const response = await fetch(`${info.origin}/rpc`, {
        method: 'POST',
        headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }),
      })
      return response.json() as Promise<{ ok: boolean; result?: any; error?: { message?: string } }>
    }
    const created = await rpc('project.create', { id: 'agent-failure', name: 'Agent Failure' })
    const response = await rpc('agent.run', { projectId: created.result.id, prompt: 'test failure' })
    expect(response).toMatchObject({ error: { message: expect.stringContaining('UNKNOWN_MODEL') } })
    const snapshot = await hostSnapshot(info.origin, info.token) as { result: { events: Array<{ name: string; data: Record<string, unknown> }> } }
    expect(snapshot.result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'diagnostic', data: expect.objectContaining({ source: 'agent', sessionId: expect.any(String), code: 'UNKNOWN_MODEL' }) }),
      expect.objectContaining({ name: 'task.state', data: expect.objectContaining({ state: 'failed' }) }),
    ]))
    const sessionRoot = join(root, 'projects', 'agent-failure', '.runwhale', 'sessions')
    const sessions = (await readdir(sessionRoot)).filter((name) => name.endsWith('.json'))
    expect(sessions).toHaveLength(1)
    expect(JSON.parse(await readFile(join(sessionRoot, sessions[0]!), 'utf8'))).toMatchObject({
      events: [expect.objectContaining({ type: 'turn/end' })],
    })
  })

  it('cancels a live DSH turn and persists its interrupted session state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-agent-cancel-'))
    const inboxActions: string[] = []
    const pendingMessages: Array<{ messageId: string; text: string; mode: 'followup' | 'steer' }> = []
    let finishAgent!: () => void
    const agentFinished = new Promise<void>((resolve) => { finishAgent = resolve })
    const cancelledSessions: string[] = []
    let announceCancellation!: () => void
    const cancellationStarted = new Promise<void>((resolve) => { announceCancellation = resolve })
    let releaseCancellation!: () => void
    const cancellationReleased = new Promise<void>((resolve) => { releaseCancellation = resolve })
    const host = new RunWhaleRuntimeHost({
      root,
      moduleStore: join(root, 'modules'),
      platform: 'android',
      agent: {
        run: async () => {
          await agentFinished
          return { text: '', events: [{ type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } }] }
        },
        cancel: async (sessionId) => {
          cancelledSessions.push(sessionId)
          const restoredMessages = pendingMessages.splice(0)
          announceCancellation()
          await cancellationReleased
          finishAgent()
          return { cancelled: true, restoredMessages }
        },
        message: async (_sessionId, prompt, mode) => {
          inboxActions.push(mode)
          const messageId = `queued-${pendingMessages.length + 1}`
          pendingMessages.push({ messageId, text: prompt, mode })
          return { accepted: true, messageId }
        },
        pendingMessages: async () => [...pendingMessages],
        updateMessage: async (_sessionId, messageId, prompt) => {
          inboxActions.push('updated')
          const pending = pendingMessages.find((message) => message.messageId === messageId)
          if (!pending) return { accepted: false }
          pending.messageId = 'queued-2'
          pending.text = prompt
          return { accepted: true, messageId: pending.messageId }
        },
        deleteMessage: async (_sessionId, messageId) => {
          inboxActions.push('deleted')
          const index = pendingMessages.findIndex((message) => message.messageId === messageId)
          if (index < 0) return false
          pendingMessages.splice(index, 1)
          return true
        },
      },
    })
    hosts.push(host)
    const info = await host.start()
    const call = async (envelope: Record<string, unknown>) => fetch(`${info.origin}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, ...envelope }),
    }).then((response) => response.json()) as Promise<any>
    const created = await call({ type: 'request', id: 'create-cancel', method: 'project.create', params: { id: 'cancel-agent', name: 'Cancel Agent' } })
    const running = call({ type: 'request', id: 'agent-cancel-me', method: 'agent.run', params: { projectId: created.result.id, prompt: 'keep working' } })
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(await call({ type: 'request', id: 'queue-agent-message', method: 'agent.message', params: { projectId: created.result.id, sessionId: 'live-session', prompt: 'use blue', mode: 'followup' } })).toMatchObject({ error: { message: 'Agent session is not running' } })
    const sessions = await call({ type: 'request', id: 'active-session-list', method: 'session.list', params: { projectId: created.result.id } })
    const activeSessionId = sessions.result[0].sessionId
    expect(await call({ type: 'request', id: 'queue-agent-message-active', method: 'agent.message', params: { projectId: created.result.id, sessionId: activeSessionId, prompt: 'use blue', mode: 'followup' } })).toMatchObject({ result: { accepted: true, messageId: 'queued-1' } })
    expect(await call({ type: 'request', id: 'update-agent-message', method: 'agent.message.update', params: { projectId: created.result.id, sessionId: activeSessionId, messageId: 'queued-1', prompt: 'use purple' } })).toMatchObject({ result: { accepted: true, messageId: 'queued-2' } })
    expect(await call({ type: 'request', id: 'delete-agent-message', method: 'agent.message.delete', params: { projectId: created.result.id, sessionId: activeSessionId, messageId: 'queued-2' } })).toMatchObject({ result: { deleted: true } })
    expect(inboxActions).toEqual(['followup', 'updated', 'deleted'])
    expect(await call({ type: 'request', id: 'queue-preserved-message', method: 'agent.message', params: { projectId: created.result.id, sessionId: activeSessionId, prompt: 'keep green', mode: 'followup' } })).toMatchObject({ result: { accepted: true } })
    const cancelling = call({ type: 'request', id: 'cancel-agent-request', method: 'agent.cancel', params: { projectId: created.result.id, sessionId: activeSessionId } })
    await cancellationStarted
    expect(await call({ type: 'request', id: 'queue-during-stop', method: 'agent.message', params: { projectId: created.result.id, sessionId: activeSessionId, prompt: 'must stay in composer', mode: 'followup' } })).toMatchObject({ error: { message: 'Agent session is stopping' } })
    releaseCancellation()
    expect(await cancelling).toMatchObject({ ok: true, result: { outcome: 'accepted', restoredMessages: [{ text: 'keep green', mode: 'followup' }] } })
    expect(cancelledSessions).toEqual([activeSessionId])
    expect(await running).toMatchObject({ ok: true, result: { sessionId: activeSessionId } })
    expect(await call({ type: 'request', id: 'list-restored-messages', method: 'agent.message.list', params: { projectId: created.result.id, sessionId: activeSessionId } })).toMatchObject({ result: { messages: [] } })
    expect(await call({ type: 'request', id: 'cancel-idle-agent', method: 'agent.cancel', params: { projectId: created.result.id, sessionId: activeSessionId } })).toMatchObject({ result: { outcome: 'already-idle', restoredMessages: [] } })
    const sessionRoot = join(root, 'projects', 'cancel-agent', '.runwhale', 'sessions')
    const sessionFiles = (await readdir(sessionRoot)).filter((name) => name.endsWith('.json'))
    expect(JSON.parse(await readFile(join(sessionRoot, sessionFiles[0]!), 'utf8'))).toMatchObject({
      state: 'aborted',
      events: [expect.objectContaining({ type: 'turn/end', data: expect.objectContaining({ reason: expect.objectContaining({ kind: 'aborted' }) }) })],
    })
    const snapshot = await hostSnapshot(info.origin, info.token) as { result: { events: Array<{ name: string; data: Record<string, unknown> }> } }
    expect(snapshot.result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'task.state', data: expect.objectContaining({ state: 'cancelled' }) }),
      expect.objectContaining({ name: 'agent.state', data: expect.objectContaining({ state: 'aborted' }) }),
    ]))
  })

  it('stops a run during project preparation before the Agent driver starts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-agent-preparing-cancel-'))
    const run = vi.fn(async () => ({ text: '', events: [] }))
    const cancel = vi.fn(async () => ({ cancelled: false, restoredMessages: [] }))
    const host = new RunWhaleRuntimeHost({
      root,
      moduleStore: join(root, 'modules'),
      platform: 'android',
      agent: { run, cancel },
    })
    hosts.push(host)
    const info = await host.start()
    const call = async (envelope: Record<string, unknown>) => fetch(`${info.origin}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, ...envelope }),
    }).then((response) => response.json()) as Promise<any>
    const created = await call({ type: 'request', id: 'create-preparing-cancel', method: 'project.create', params: { id: 'preparing-cancel', name: 'Preparing Cancel' } })
    let announcePreparation!: () => void
    const preparationStarted = new Promise<void>((resolve) => { announcePreparation = resolve })
    let releasePreparation!: () => void
    const preparationReleased = new Promise<void>((resolve) => { releasePreparation = resolve })
    const internals = host as unknown as {
      beginProjectWork(projectId: string): Promise<() => void>
      agentSessions: Map<string, { stopping: boolean }>
    }
    const beginProjectWork = internals.beginProjectWork.bind(host)
    internals.beginProjectWork = async (projectId) => {
      const release = await beginProjectWork(projectId)
      announcePreparation()
      await preparationReleased
      return release
    }
    const sessionId = 'preparing-session'
    const running = call({ type: 'request', id: 'run-during-preparation', method: 'agent.run', params: { projectId: created.result.id, sessionId, prompt: 'do not start' } })
    await preparationStarted
    const cancelling = call({ type: 'request', id: 'cancel-during-preparation', method: 'agent.cancel', params: { projectId: created.result.id, sessionId } })
    await vi.waitFor(() => expect(internals.agentSessions.get(sessionId)?.stopping).toBe(true))
    releasePreparation()

    expect(await cancelling).toMatchObject({ ok: true, result: { outcome: 'accepted', restoredMessages: [] } })
    expect(await running).toMatchObject({ ok: true, result: { sessionId } })
    expect(run).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    expect(await call({ type: 'request', id: 'read-preparing-cancel', method: 'session.read', params: { projectId: created.result.id, sessionId } })).toMatchObject({ result: { state: 'aborted', events: [] } })
  })

  it('publishes each consumed human message in turn order before the run completes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-agent-message-order-'))
    const sessionEvents: Array<Record<string, unknown>> = []
    const queued: Array<{ id: string; text: string }> = []
    let announceRunStarted!: () => void
    const runStarted = new Promise<void>((resolve) => { announceRunStarted = resolve })
    let announceQueueReady!: () => void
    const queueReady = new Promise<void>((resolve) => { announceQueueReady = resolve })
    let announceFollowupsPublished!: () => void
    const followupsPublished = new Promise<void>((resolve) => { announceFollowupsPublished = resolve })
    let releaseRun!: () => void
    const runReleased = new Promise<void>((resolve) => { releaseRun = resolve })
    const host = new RunWhaleRuntimeHost({
      root,
      moduleStore: join(root, 'modules'),
      platform: 'ios',
      agent: {
        run: async ({ sessionId: _sessionId, prompt: _prompt, seed: _seed, projectRoot: _projectRoot, signal: _signal, onEvent }) => {
          const emit = (event: Record<string, unknown>) => { sessionEvents.push(event); onEvent?.(event) }
          emit({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } })
          emit({ type: 'user/message', seq: 2, time: 2, data: { id: 'initial', content: [{ type: 'text', text: 'start' }], source: { kind: 'user' } } })
          emit({ type: 'assistant/chunk', seq: 3, time: 3, data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'initial answer' } } })
          emit({ type: 'turn/end', seq: 4, time: 4, data: { turn: 1, reason: { kind: 'completed' } } })
          announceRunStarted()
          await queueReady
          queued.forEach((item, index) => {
            const turn = index + 2
            const sequence = index * 4 + 5
            emit({ type: 'turn/start', seq: sequence, time: sequence, data: { turn } })
            emit({ type: 'user/message', seq: sequence + 1, time: sequence + 1, data: { id: item.id, content: [{ type: 'text', text: item.text }], source: { kind: 'user' } } })
            emit({ type: 'assistant/chunk', seq: sequence + 2, time: sequence + 2, data: { turn, step: 1, chunk: { type: 'text-delta', text: `answer ${index + 1}` } } })
            emit({ type: 'turn/end', seq: sequence + 3, time: sequence + 3, data: { turn, reason: { kind: 'completed' } } })
          })
          announceFollowupsPublished()
          await runReleased
          return { text: 'answer 2', events: sessionEvents }
        },
        message: (_sessionId, prompt) => {
          const item = { id: `queued-${queued.length + 1}`, text: prompt }
          queued.push(item)
          if (queued.length === 2) announceQueueReady()
          return { accepted: true, messageId: item.id }
        },
      },
    })
    hosts.push(host)
    const info = await host.start()
    const rpc = createRuntimeRpc(info)
    await rpc('project.create', { id: 'message-order', name: 'Message Order' })
    const running = rpc('agent.run', { projectId: 'message-order', sessionId: 'message-order-session', prompt: 'start' })
    await runStarted
    try {
      expect(await rpc('agent.message', { projectId: 'message-order', sessionId: 'message-order-session', prompt: 'first follow-up', mode: 'followup' })).toMatchObject({ result: { accepted: true, messageId: 'queued-1' } })
      expect(await rpc('agent.message', { projectId: 'message-order', sessionId: 'message-order-session', prompt: 'second follow-up', mode: 'followup' })).toMatchObject({ result: { accepted: true, messageId: 'queued-2' } })
      await followupsPublished

      const snapshot = await hostSnapshot(info.origin, info.token) as { result: { events: Array<{ name: string; data: Record<string, unknown> }> } }
      expect(snapshot.result.events.flatMap((event) => {
        if (event.name === 'agent.message') return [`message:${String(event.data.messageId)}`]
        if (event.name === 'agent.delta') return [`delta:${String(event.data.text)}`]
        return []
      })).toEqual([
        'message:initial',
        'delta:initial answer',
        'message:queued-1',
        'delta:answer 1',
        'message:queued-2',
        'delta:answer 2',
      ])
      expect(snapshot.result.events).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'agent.state', data: expect.objectContaining({ state: 'completed' }) }),
      ]))
    } finally {
      releaseRun()
    }
    expect(await running).toMatchObject({ ok: true, result: { sessionId: 'message-order-session' } })
  })

  it('streams structured DSH events and exposes recoverable session logs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-agent-session-'))
    const sessionEvents = [
      { type: 'turn/start', seq: 1, time: 10, data: { turn: 1 } },
      { type: 'user/message', seq: 2, time: 11, data: { id: 'prompt-1', content: [{ type: 'text', text: 'Build a whale game' }], source: { kind: 'user' } } },
      { type: 'assistant/chunk', seq: 3, time: 12, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Partial attempt' } } },
      { type: 'llm/retry', seq: 4, time: 13, data: { turn: 1, step: 1, retryId: 'retry-1', retry: 1, delayMs: 500 } },
      { type: 'llm/retry-started', seq: 5, time: 14, data: { turn: 1, step: 1, retryId: 'retry-1', retry: 1 } },
      { type: 'assistant/chunk', seq: 6, time: 15, data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'Inspecting files' } } },
      { type: 'assistant/chunk', seq: 7, time: 16, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Done.' } } },
      { type: 'assistant/message', seq: 8, time: 17, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Done.' }] } }, surfaceOp: 'append', sourceEventSeqs: [6, 7] },
      { type: 'tool/call', seq: 9, time: 18, data: { turn: 1, step: 1, callId: 'call-1', name: 'write_file', arguments: '{"path":"app/index.tsx","content":"ok"}' } },
      { type: 'tool/result', seq: 10, time: 19, data: { turn: 1, step: 1, message: { source: { callId: 'call-1' }, content: [{ type: 'text', text: 'written' }] } } },
      { type: 'user/message', seq: 11, time: 20, data: { content: [{ type: 'text', text: 'Live context' }], source: { kind: 'plugin', plugin: 'catalog' } } },
      { type: 'user/message', seq: 12, time: 21, data: { content: [{ type: 'text', text: 'x'.repeat(140 * 1024) }], source: { kind: 'plugin', plugin: 'large-context' } } },
      { type: 'turn/end', seq: 13, time: 22, data: { turn: 1, reason: { kind: 'completed' }, usage: { inputTokens: 120, outputTokens: 42 } } },
    ]
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let streamed!: () => void
    const ready = new Promise<void>(resolve => { streamed = resolve })
    const host = new RunWhaleRuntimeHost({
      root,
      moduleStore: join(root, 'modules'),
      platform: 'android',
      agent: {
        run: async ({ sessionId: _sessionId, prompt: _prompt, seed: _seed, projectRoot: _projectRoot, signal: _signal, onEvent }) => {
          sessionEvents.forEach((event) => onEvent?.(event))
          streamed()
          await gate
          return { text: 'Done.', events: sessionEvents }
        },
      },
    })
    hosts.push(host)
    const info = await host.start()
    const rpc = async (method: string, params: unknown) => {
      const response = await fetch(`${info.origin}/rpc`, {
        method: 'POST',
        headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }),
      })
      return response.json() as Promise<{ ok: boolean; result: any }>
    }
    const created = await rpc('project.create', { id: 'session-project', name: 'Sessions' })
    const empty = await rpc('session.create', { projectId: created.result.id, sessionId: 'mobile-session-test', title: 'New session' })
    expect(empty.result).toMatchObject({ sessionId: 'mobile-session-test', title: 'New session', state: 'idle', events: [] })
    expect((await rpc('session.list', { projectId: created.result.id })).result).toEqual([expect.objectContaining({ sessionId: 'mobile-session-test', turnCount: 0 })])
    const pendingRun = rpc('agent.run', { projectId: created.result.id, sessionId: empty.result.sessionId, prompt: 'Build a whale game', agentPreset: 'minimal', permissionMode: 'read-only' })
    await ready
    const liveRecord = await rpc('session.read', { projectId: created.result.id, sessionId: empty.result.sessionId, surfaceOnly: true })
    release()
    const run = await pendingRun
    expect(liveRecord.result.events).toEqual(sessionEvents.filter(event => event.type !== 'assistant/chunk'))
    expect(run.ok).toBe(true)
    const list = await rpc('session.list', { projectId: created.result.id })
    expect(list.result).toEqual([expect.objectContaining({
      sessionId: run.result.sessionId,
      state: 'completed',
      turnCount: 1,
      eventCount: sessionEvents.length,
      preview: 'Build a whale game',
      agentPreset: 'minimal',
      permissionMode: 'read-only',
    })])
    const restored = await rpc('session.read', { projectId: created.result.id, sessionId: run.result.sessionId })
    expect(restored.result.events).toHaveLength(sessionEvents.length)
    const forked = await rpc('session.fork', { projectId: created.result.id, sessionId: run.result.sessionId, throughSequence: 4 })
    expect(forked.result).toMatchObject({ parentSessionId: run.result.sessionId, parentEventSequence: 4, agentPreset: 'minimal', permissionMode: 'read-only' })
    expect(forked.result.events).toHaveLength(4)
    const snapshot = await hostSnapshot(info.origin, info.token) as { result: { events: Array<{ name: string; data: Record<string, unknown> }> } }
    expect(snapshot.result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'session.event', data: expect.objectContaining({
        projectId: created.result.id,
        sessionId: run.result.sessionId,
        event: expect.objectContaining({ type: 'user/message', seq: 2 }),
      }) }),
      expect.objectContaining({ name: 'session.event', data: expect.objectContaining({
        event: expect.objectContaining({ type: 'assistant/message', seq: 8 }),
      }) }),
      expect.objectContaining({ name: 'session.event', data: expect.objectContaining({
        event: sessionEvents.at(-1), afterSequence: 12,
      }) }),
      expect.objectContaining({ name: 'agent.message', data: expect.objectContaining({ messageId: 'prompt-1', sessionSequence: 2, sessionTime: 11, message: expect.objectContaining({ source: { kind: 'user' } }) }) }),
      expect.objectContaining({ name: 'agent.delta', data: expect.objectContaining({ kind: 'text', text: 'Partial attempt' }) }),
      expect.objectContaining({ name: 'agent.state', data: expect.objectContaining({ state: 'llm/retry', turn: 1, step: 1 }) }),
      expect.objectContaining({ name: 'agent.state', data: expect.objectContaining({ state: 'llm/retry-started', turn: 1, step: 1 }) }),
      expect.objectContaining({ name: 'agent.delta', data: expect.objectContaining({ kind: 'reasoning', text: 'Inspecting files' }) }),
      expect.objectContaining({ name: 'agent.delta', data: expect.objectContaining({ kind: 'text', text: 'Done.' }) }),
      expect.objectContaining({ name: 'agent.tool', data: expect.objectContaining({ phase: 'call', tool: 'write_file', path: 'app/index.tsx' }) }),
      expect.objectContaining({ name: 'agent.tool', data: expect.objectContaining({ phase: 'result', callId: 'call-1' }) }),
    ]))
    expect(snapshot.result.events.find(event => event.name === 'session.event' && event.data.sessionSequence === 12)?.data).toMatchObject({ afterSequence: 11, sessionSequence: 12 })
    expect(snapshot.result.events.find(event => event.name === 'session.event' && event.data.sessionSequence === 12)?.data.event).toBeUndefined()
    expect(snapshot.result.events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'session.event', data: expect.objectContaining({ event: expect.objectContaining({ type: 'assistant/chunk' }) }) }),
    ]))
    expect(await rpc('session.delete', { projectId: created.result.id, sessionId: run.result.sessionId })).toMatchObject({ result: { deleted: true } })
    expect(await rpc('session.delete', { projectId: created.result.id, sessionId: forked.result.sessionId })).toMatchObject({ result: { deleted: true } })
    expect((await rpc('session.list', { projectId: created.result.id })).result).toEqual([])
  })

  it('builds lightweight summaries for legacy long sessions and invalidates stale summaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-session-summary-'))
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: async () => ({ text: '' }) } })
    hosts.push(host)
    const info = await host.start()
    const rpc = createRuntimeRpc(info)
    await rpc('project.create', { id: 'summary-project', name: 'Summary Project' })
    const directory = join(root, 'projects', 'summary-project', '.runwhale', 'sessions')
    await mkdir(directory, { recursive: true })
    const sessionPath = join(directory, 'legacy-long.json')
    const summaryPath = join(directory, 'legacy-long.summary')
    const surfacePath = join(directory, 'legacy-long.surface')
    const events = [
      { type: 'user/message', data: { content: [{ type: 'text', text: 'Load this long session quickly' }] } },
      ...Array.from({ length: 1_500 }, (_, index) => ({ type: 'assistant/chunk', seq: index + 1, data: { text: `detail-${index}-${'x'.repeat(256)}` } })),
      { type: 'turn/end', data: { reason: { kind: 'completed' } } },
    ]
    await writeFile(sessionPath, `${JSON.stringify({
      sessionId: 'legacy-long', projectId: 'summary-project', title: 'Legacy long session', updatedAt: 42, state: 'completed', events,
    })}\n`)

    const readText = vi.spyOn(MobileProjectFileSystem.prototype, 'readText')
    const [restored, listed, pending] = await Promise.all([
      rpc('session.read', { projectId: 'summary-project', sessionId: 'legacy-long', surfaceOnly: true }),
      rpc('session.list', { projectId: 'summary-project' }),
      rpc('agent.message.list', { projectId: 'summary-project', sessionId: 'legacy-long' }),
    ])
    expect(restored).toMatchObject({ result: { sessionId: 'legacy-long', events: [
      expect.objectContaining({ type: 'user/message' }),
      expect.objectContaining({ type: 'turn/end' }),
    ] } })
    expect(pending).toMatchObject({ result: { messages: [] } })
    expect(listed).toMatchObject({ result: [{
      sessionId: 'legacy-long', title: 'Legacy long session', eventCount: events.length, turnCount: 1, preview: 'Load this long session quickly',
    }] })
    expect(readText.mock.calls.filter(([path]) => String(path).endsWith('legacy-long.json'))).toHaveLength(1)
    readText.mockRestore()
    expect(JSON.parse(await readFile(summaryPath, 'utf8'))).toMatchObject({
      version: 1,
      summary: { sessionId: 'legacy-long', eventCount: events.length, turnCount: 1 },
    })
    expect(JSON.parse(await readFile(surfacePath, 'utf8'))).toMatchObject({
      version: 1,
      record: { sessionId: 'legacy-long', events: [
        expect.objectContaining({ type: 'user/message' }),
        expect.objectContaining({ type: 'turn/end' }),
      ] },
    })

    const cachedReadText = vi.spyOn(MobileProjectFileSystem.prototype, 'readText')
    expect(await rpc('session.read', { projectId: 'summary-project', sessionId: 'legacy-long', surfaceOnly: true })).toMatchObject({
      result: { title: 'Legacy long session' },
    })
    expect(await rpc('session.list', { projectId: 'summary-project' })).toMatchObject({ result: [expect.objectContaining({ title: 'Legacy long session' })] })
    expect(cachedReadText.mock.calls.filter(([path]) => String(path).endsWith('legacy-long.json'))).toHaveLength(0)
    cachedReadText.mockRestore()

    await writeFile(sessionPath, `${JSON.stringify({
      sessionId: 'legacy-long', projectId: 'summary-project', title: 'Changed session', updatedAt: 84, state: 'completed', events: [],
    })}\n`)
    expect(await rpc('session.list', { projectId: 'summary-project' })).toMatchObject({ result: [{
      sessionId: 'legacy-long', title: 'Changed session', updatedAt: 84, eventCount: 0, turnCount: 0,
    }] })
    expect(JSON.parse(await readFile(summaryPath, 'utf8'))).toMatchObject({ summary: { title: 'Changed session', eventCount: 0 } })
    expect(await rpc('session.read', { projectId: 'summary-project', sessionId: 'legacy-long', surfaceOnly: true })).toMatchObject({ result: { title: 'Changed session', events: [] } })

    expect(await rpc('session.delete', { projectId: 'summary-project', sessionId: 'legacy-long' })).toMatchObject({ result: { deleted: true } })
    expect(await readdir(directory)).toEqual([])
  })

  it('persists and inherits Full Access while using never approvals inside the app container', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-full-access-host-'))
    const approvals: string[] = []
    const rootsBySession = new Map<string, readonly string[]>()
    let host!: RunWhaleRuntimeHost
    host = new RunWhaleRuntimeHost({
      root,
      moduleStore: join(root, 'modules'),
      platform: 'ios',
      agent: {
        run: async ({ sessionId }) => {
          rootsBySession.set(sessionId, host.agentFullAccessRoots(sessionId))
          approvals.push(await host.requestAgentApproval({ sessionId, toolName: 'write_file' }))
          return { text: 'Done.', events: [{ type: 'turn/end' }] }
        },
      },
    })
    hosts.push(host)
    const info = await host.start()
    const rpc = async (method: string, params: unknown) => fetch(`${info.origin}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }),
    }).then((response) => response.json()) as Promise<any>

    await rpc('project.create', { id: 'full-access-project', name: 'Full Access' })
    const run = await rpc('agent.run', { projectId: 'full-access-project', sessionId: 'full-access-session', prompt: 'Run without prompts', permissionMode: 'danger-full-access' })
    expect(run.ok).toBe(true)
    expect(approvals).toEqual(['allowed-once'])
    expect(rootsBySession.get('full-access-session')).toEqual([root])
    expect(await rpc('session.read', { projectId: 'full-access-project', sessionId: 'full-access-session' })).toMatchObject({ result: { permissionMode: 'danger-full-access' } })
    expect(await rpc('session.fork', { projectId: 'full-access-project', sessionId: 'full-access-session' })).toMatchObject({ result: { permissionMode: 'danger-full-access' } })

    const snapshot = await hostSnapshot(info.origin, info.token) as any
    expect(snapshot.result.events.some((event: any) => event.name === 'approval.requested' && event.data?.sessionId === 'full-access-session')).toBe(false)
  })

  it('installs and commits Agent dependencies after standard approval while Full Access bypasses the prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-full-access-package-'))
    const packageInstaller = new MobilePackageInstaller({
      npmRoot: join(root, '.runwhale', 'npm'),
      cacheRoot: join(root, '.runwhale', 'npm-cache'),
      workerUrl: new URL('../../mobile-runtime/test/fixtures/package-worker-cache.ts', import.meta.url),
    })
    const outcomes = new Map<string, Awaited<ReturnType<RunWhaleRuntimeHost['requestAgentPackageInstall']>>>()
    const resolvedDependencies = new Map<string, boolean>()
    let host!: RunWhaleRuntimeHost
    host = new RunWhaleRuntimeHost({
      root,
      moduleStore: join(root, 'modules'),
      platform: 'ios',
      packageInstaller,
      agent: {
        run: async ({ sessionId, prompt: _prompt, seed: _seed, projectRoot, signal }) => {
          if (!projectRoot || !signal) throw new Error('test Agent run is missing its project binding')
          const approval = await host.requestAgentApproval({ sessionId, toolName: 'package_install' }, signal)
          if (approval !== 'allowed-once') throw new Error(`unexpected package approval ${approval}`)
          outcomes.set(sessionId, await host.requestAgentPackageInstall(sessionId, projectRoot, { 'is-number': '7.0.0' }, false, signal))
          const isNumber = createRequire(join(projectRoot, 'package.json'))('is-number') as (value: unknown) => boolean
          resolvedDependencies.set(sessionId, isNumber(42))
          return { text: 'Done.', events: [{ type: 'turn/end' }] }
        },
      },
    })
    hosts.push(host)
    const info = await host.start()
    const rpc = createRuntimeRpc(info)
    const createPackageProject = async (projectId: string) => {
      await rpc('project.create', { id: projectId, name: projectId })
      await rpc('project.write', { projectId, path: 'package.json', content: `{"name":"${projectId}","version":"1.0.0"}\n` })
      const repository = new MobileGitRepository(join(root, 'projects', projectId))
      await repository.commit('Add package manifest')
      return repository
    }

    const fullProjectId = 'full-package-project'
    const fullSessionId = 'full-package-session'
    const fullRepository = await createPackageProject(fullProjectId)
    expect(await rpc('agent.run', {
      projectId: fullProjectId,
      sessionId: fullSessionId,
      prompt: 'Install is-number',
      permissionMode: 'danger-full-access',
    })).toMatchObject({ ok: true, result: { sessionId: fullSessionId } })
    expect(outcomes.get(fullSessionId)).toMatchObject({ packages: 1, offline: false })
    expect(resolvedDependencies.get(fullSessionId)).toBe(true)

    const fullSnapshot = await hostSnapshot(info.origin, info.token) as any
    expect(fullSnapshot.result.events.some((event: any) =>
      event.name === 'approval.requested' && event.data?.toolName === 'package_install')).toBe(false)
    expect(JSON.parse(await readFile(join(root, 'projects', fullProjectId, 'package.json'), 'utf8'))).toMatchObject({ dependencies: { 'is-number': '7.0.0' } })
    expect(await fullRepository.status()).toEqual([])
    expect((await fullRepository.log(1))[0]?.message).toBe('Agent update')

    const reviewProjectId = 'review-package-project'
    const reviewSessionId = 'review-package-session'
    const reviewRepository = await createPackageProject(reviewProjectId)
    let reviewSettled = false
    const reviewRun = rpc('agent.run', {
      projectId: reviewProjectId,
      sessionId: reviewSessionId,
      prompt: 'Install is-number',
      permissionMode: 'review',
    })
    void reviewRun.then(() => { reviewSettled = true }, () => { reviewSettled = true })
    const approvalEvent = await waitForHostEvent(info.origin, info.token, 'approval.requested', 'agent-tool')
    expect(approvalEvent.data).toMatchObject({ projectId: reviewProjectId, sessionId: reviewSessionId, toolName: 'package_install' })
    expect(reviewSettled).toBe(false)
    expect(JSON.parse(await readFile(join(root, 'projects', reviewProjectId, 'package.json'), 'utf8'))).not.toHaveProperty('dependencies.is-number')

    expect(await rpc('agent.approval.resolve', { requestId: approvalEvent.data.requestId, outcome: 'allowed-once' })).toMatchObject({ result: { resolved: true } })
    expect(await reviewRun).toMatchObject({ ok: true, result: { sessionId: reviewSessionId } })
    expect(outcomes.get(reviewSessionId)).toMatchObject({ packages: 1, offline: false })
    expect(resolvedDependencies.get(reviewSessionId)).toBe(true)
    expect(JSON.parse(await readFile(join(root, 'projects', reviewProjectId, 'package.json'), 'utf8'))).toMatchObject({ dependencies: { 'is-number': '7.0.0' } })
    expect(await reviewRepository.status()).toEqual([])
    expect((await reviewRepository.log(1))[0]?.message).toBe('Agent update')
  })

  it('brokers Agent approval, user questions, and plan-mode controls through authenticated RPC', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-agent-interaction-'))
    const planSelections: boolean[] = []
    let host!: RunWhaleRuntimeHost
    host = new RunWhaleRuntimeHost({
      root,
      moduleStore: join(root, 'modules'),
      platform: 'ios',
      agent: {
        run: async ({ sessionId }) => {
          const approval = await host.requestAgentApproval({ sessionId, toolName: 'typescript_program', reason: 'Run bounded project code.' })
          if (approval !== 'allowed-once') throw new Error(`unexpected approval ${approval}`)
          const answer = await host.requestAgentQuestions({
            sessionId,
            questions: [{
              id: 'plan-review',
              header: 'Plan review',
              question: 'Approve this plan?',
              detail: '# Plan\n\nImplement and verify.',
              options: [{ label: 'Approve' }, { label: 'Keep planning' }],
              intent: { kind: 'plan-review', approve: 'Approve' },
            }],
          })
          return { text: answer.answers[0]?.selected[0] ?? '', events: [{ type: 'turn/end' }] }
        },
        setPlanMode: async (_sessionId, active) => {
          planSelections.push(active)
          return { active, outcome: 'committed' as const }
        },
      },
    })
    hosts.push(host)
    const info = await host.start()
    const rpc = async (method: string, params: unknown) => fetch(`${info.origin}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }),
    }).then((response) => response.json()) as Promise<any>
    await rpc('project.create', { id: 'agent-interaction', name: 'Agent Interaction' })
    const running = rpc('agent.run', { projectId: 'agent-interaction', sessionId: 'interaction-session', prompt: 'Plan then run' })
    const approvalEvent = await waitForHostEvent(info.origin, info.token, 'approval.requested', 'agent-tool')
    expect(await rpc('agent.plan.set', { projectId: 'agent-interaction', sessionId: 'interaction-session', active: true })).toMatchObject({ result: { active: true, outcome: 'committed' } })
    expect(await rpc('agent.approval.resolve', { requestId: approvalEvent.data.requestId, outcome: 'allowed-once' })).toMatchObject({ result: { resolved: true } })
    const questionEvent = await waitForHostEvent(info.origin, info.token, 'question.requested')
    expect(await rpc('agent.question.answer', { requestId: questionEvent.data.requestId, answers: [{ id: 'plan-review', selected: ['Unknown'] }] })).toMatchObject({ error: { message: expect.stringContaining('unknown option') } })
    expect(await rpc('agent.question.answer', { requestId: questionEvent.data.requestId, answers: [{ id: 'plan-review', selected: ['Approve'] }] })).toMatchObject({ result: { resolved: true } })
    expect(await running).toMatchObject({ ok: true, result: { sessionId: 'interaction-session' } })
    expect(planSelections).toEqual([true])
    const snapshot = await hostSnapshot(info.origin, info.token) as any
    expect(snapshot.result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'approval.resolved', data: expect.objectContaining({ kind: 'agent-tool', outcome: 'allowed-once' }) }),
      expect.objectContaining({ name: 'question.resolved', data: expect.objectContaining({ outcome: 'answered' }) }),
    ]))
  })

  it('persists project-scoped Goal lifecycle mutations in the DSH session log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-agent-goal-'))
    let events: any[] = []
    let revision = 0
    let current: any
    const snapshot = (phase: 'active' | 'paused' = 'active') => ({ id: 'goal-1', revision: ++revision, objective: 'Ship the MVP', phase, maxGoalRounds: 12, roundsStarted: 1, createdAt: 10, updatedAt: 10 + revision, activation: phase === 'active' ? 'armed' as const : 'disarmed' as const })
    const append = (operation: string, goal?: any) => { events.push({ type: 'goal/change', seq: events.length + 1, time: Date.now(), data: { operation, ...(goal ? { goal, roundsStarted: goal.roundsStarted, createdAt: goal.createdAt, updatedAt: goal.updatedAt } : {}) } }) }
    const host = new RunWhaleRuntimeHost({
      root,
      moduleStore: join(root, 'modules'),
      platform: 'ios',
      agent: {
        run: async ({ sessionId: _sessionId, prompt: _prompt, seed = [] }) => { events = [...seed, { type: 'turn/end', seq: seed.length + 1, data: { turn: 1, reason: { kind: 'completed' } } }]; return { text: 'Ready', events } },
        createGoal: () => { current = snapshot(); append('create', current); return current },
        pauseGoal: () => { current = snapshot('paused'); append('pause', current); return current },
        resumeGoal: () => { current = snapshot(); append('resume', current); return current },
        clearGoal: () => { current = undefined; revision += 1; append('clear') },
        sessionEvents: () => events,
      },
    })
    hosts.push(host)
    const info = await host.start()
    const rpc = async (method: string, params: unknown) => fetch(`${info.origin}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }),
    }).then((response) => response.json()) as Promise<any>
    await rpc('project.create', { id: 'goal-project', name: 'Goal Project' })
    await rpc('project.create', { id: 'other-project', name: 'Other Project' })
    await rpc('agent.run', { projectId: 'goal-project', sessionId: 'goal-session', prompt: 'Start' })
    const created = await rpc('agent.goal.create', { projectId: 'goal-project', sessionId: 'goal-session', objective: 'Ship the MVP', maxGoalRounds: 12 })
    expect(created).toMatchObject({ result: { goal: { phase: 'active', revision: 1 } } })
    expect((await rpc('agent.goal.create', { projectId: 'other-project', sessionId: 'goal-session', objective: 'Escape scope' })).error).toBeDefined()
    const paused = await rpc('agent.goal.pause', { projectId: 'goal-project', sessionId: 'goal-session', id: 'goal-1', revision: 1 })
    const resumed = await rpc('agent.goal.resume', { projectId: 'goal-project', sessionId: 'goal-session', id: 'goal-1', revision: paused.result.goal.revision })
    expect(resumed.result.goal.phase).toBe('active')
    expect(await rpc('agent.goal.clear', { projectId: 'goal-project', sessionId: 'goal-session', id: 'goal-1', revision: resumed.result.goal.revision })).toMatchObject({ result: { cleared: true } })
    const restored = await rpc('session.read', { projectId: 'goal-project', sessionId: 'goal-session' })
    expect(restored.result.events.filter((event: any) => event.type === 'goal/change').map((event: any) => event.data.operation)).toEqual(['create', 'pause', 'resume', 'clear'])
  })

  it('marks a running session from a previous host process as interrupted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-stale-session-'))
    const host = new RunWhaleRuntimeHost({ root, moduleStore: join(root, 'modules'), platform: 'ios', agent: { run: async () => ({ text: '' }) } })
    hosts.push(host)
    const info = await host.start()
    const rpc = async (method: string, params: unknown) => fetch(`${info.origin}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }),
    }).then((response) => response.json()) as Promise<any>
    await rpc('project.create', { id: 'recovered-agent', name: 'Recovered Agent' })
    const directory = join(root, 'projects', 'recovered-agent', '.runwhale', 'sessions')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'stale.json'), JSON.stringify({
      sessionId: 'stale',
      projectId: 'recovered-agent',
      title: 'Interrupted work',
      updatedAt: 42,
      state: 'running',
      events: [{ type: 'user/message', data: { content: [{ type: 'text', text: 'Continue later' }] } }],
    }))
    expect(await rpc('session.read', { projectId: 'recovered-agent', sessionId: 'stale' })).toMatchObject({ result: { state: 'interrupted' } })
    expect(await rpc('session.list', { projectId: 'recovered-agent' })).toMatchObject({ result: [expect.objectContaining({ state: 'interrupted' })] })
  })
})

async function hostSnapshot(origin: string, token: string): Promise<unknown> {
  const response = await fetch(`${origin}/rpc`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ v: 1, type: 'request', id: 'snapshot-test', method: 'host.snapshot', params: {} }),
  })
  return response.json()
}

function createRuntimeRpc(info: { origin: string; token: string }) {
  return async (method: string, params: unknown) => fetch(`${info.origin}/rpc`, {
    method: 'POST',
    headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ v: 1, type: 'request', id: crypto.randomUUID(), method, params }),
  }).then((response) => response.json()) as Promise<any>
}

async function waitForCondition(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function waitForHostEvent(origin: string, token: string, name: string, kind?: string): Promise<any> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = await hostSnapshot(origin, token) as any
    const event = snapshot.result.events.find((item: any) => item.name === name && (kind === undefined || item.data?.kind === kind))
    if (event) return event
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for host event ${name}`)
}
