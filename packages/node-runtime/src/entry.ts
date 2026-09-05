import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { MobileHarnessOptions } from '@runwhale/dsh-mobile'
import type { MobileAgentPreset, MobileModelProvider, MobileModelProviderProfile } from '@runwhale/mobile-protocol'
import { MobilePackageInstaller } from '@runwhale/mobile-runtime/package-installer'
import { RunWhaleRuntimeHost } from './runtime-host.js'
import { createSessionAgentDriver } from './session-agent-driver.js'
import { installJitlessFetch } from './mobile-fetch.js'
import { EMBEDDED_NPM_VERSION, prepareEmbeddedNpm, prepareModuleStore } from './runtime-assets.js'

const runtimeRoot = resolve(process.argv[2] ?? process.cwd())
const agentRuntimeUrl = new URL('./runwhale-agent-runtime.mjs', import.meta.url).href
installJitlessFetch()
const moduleStore = resolve(process.argv[3] ?? join(runtimeRoot, 'node_modules'))
await mkdir(join(runtimeRoot, '.runwhale'), { recursive: true })
const npmRoot = join(runtimeRoot, '.runwhale', 'npm')
const packageInstaller = new MobilePackageInstaller({
  npmRoot,
  cacheRoot: join(runtimeRoot, '.runwhale', 'npm-cache'),
  workerUrl: new URL('./runwhale-package-worker.mjs', import.meta.url),
})
const values = new Map<string, string>()
let host: RunWhaleRuntimeHost | undefined
const secrets = {
  async get(key: string): Promise<string | undefined> { return values.get(key) },
  async set(key: string, value: string): Promise<void> { values.set(key, value) },
  async delete(key: string): Promise<void> { values.delete(key) },
}
const harnessOptions = (mode: 'deepseek' | 'deterministic', provider: MobileModelProvider, model: string, modelProfile: MobileModelProviderProfile | undefined, agentPreset: MobileAgentPreset): MobileHarnessOptions => ({
  mode,
  provider,
  model,
  ...(modelProfile ? { modelProfile } : {}),
  ...(agentPreset === 'minimal' ? {
    persona: 'You are RunWhale Minimal, a concise on-device coding agent. Use only the mobile project tools needed for the request, make the smallest verified change, and report the result directly.',
  } : {}),
  deterministicReply: deterministicReply(),
  secrets,
  attachmentRoot: join(runtimeRoot, '.runwhale', 'attachments'),
  requestApproval: (request, signal) => requireHost().requestAgentApproval(request, signal),
  requestUserQuestions: (request, signal) => requireHost().requestAgentQuestions(request, signal),
  requestPackageInstall: (sessionId, projectRoot, dependencies, offline, signal) => requireHost().requestAgentPackageInstall(sessionId, projectRoot, dependencies, offline, signal),
  workspaceServices: {
    runNodeTask: (projectRoot, entry, args, timeoutMs, signal) => requireHost().runAgentNodeTask(projectRoot, entry, args, timeoutMs, signal),
    runPreview: (projectRoot, sessionId, signal) => requireHost().runAgentPreview(projectRoot, sessionId, signal),
    reloadPreview: (projectRoot, sessionId, signal) => requireHost().reloadAgentPreview(projectRoot, sessionId, signal),
    stopPreview: (projectRoot) => requireHost().stopAgentPreview(projectRoot),
    previewLogs: async (projectRoot, afterSequence) => JSON.parse(JSON.stringify(requireHost().agentPreviewLogs(projectRoot, afterSequence))),
    permissionModeFor: (sessionId) => requireHost().agentPermissionMode(sessionId),
    fullAccessRootsFor: (sessionId) => requireHost().agentFullAccessRoots(sessionId),
    runGitNetwork: (projectRoot, operation, remote, branch, signal) => requireHost().runAgentGitNetwork(projectRoot, operation, remote, branch, signal),
  },
})
let agentRuntime: Promise<{ createMobileHarness: typeof import('@runwhale/dsh-mobile').createMobileHarness }> | undefined
const agent = createSessionAgentDriver({
  secrets,
  harnessOptions,
  deterministicReplay: process.env.RUNWHALE_DETERMINISTIC_REPLAY === '1',
  createHarness: async (options) => {
    const { createMobileHarness } = await (agentRuntime ??= import(agentRuntimeUrl))
    return createMobileHarness(options)
  },
})
const nodePlatform = String(process.platform)
const platform = nodePlatform === 'darwin' || nodePlatform === 'ios' ? 'ios' : 'android'
host = new RunWhaleRuntimeHost({
  root: runtimeRoot,
  moduleStore,
  platform,
  agent,
  secrets,
  taskWorkerUrl: new URL('./runwhale-task-worker.mjs', import.meta.url),
  packageInstaller,
  npmVersion: EMBEDDED_NPM_VERSION,
  prepareModuleStore: () => prepareModuleStore(runtimeRoot, moduleStore),
  prepareNpm: async () => { await prepareEmbeddedNpm(runtimeRoot, npmRoot) },
})
const info = await host.start()
const output = join(runtimeRoot, '.runwhale', 'host.json')
const temporary = `${output}.tmp`
await writeFile(temporary, `${JSON.stringify({ ...info, nodeVersion: process.versions.node, npmVersion: EMBEDDED_NPM_VERSION, pid: process.pid })}\n`, { mode: 0o600 })
await rename(temporary, output)

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void host.stop() })

function deterministicReply(): string {
  return 'The deterministic runtime request completed.'
}

function requireHost(): RunWhaleRuntimeHost {
  if (!host) throw new Error('mobile runtime host is still starting')
  return host
}
