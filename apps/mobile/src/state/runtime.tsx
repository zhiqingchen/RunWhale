import type { StudioAgentRunOptions } from '@/utils/agent-run'
import { NodeHost, type NativeNodeSnapshot } from '@runwhale/node-host'
import * as SecureStore from 'expo-secure-store'
import { AppState, Platform } from 'react-native'
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { GitHubCommitReference, HostEvent, MobileHostMethod, MobileHostRequestMap, PreviewEndpoint, PreviewOpenResult, ProjectCloneProgress } from '@runwhale/mobile-protocol'
import { projectCloneProgressFromEvent } from '@/utils/clone-progress'
import { synchronizeRuntimeCredentials } from '@/utils/runtime-credential-sync'
import { parseRuntimeHostInfo, type RuntimeHostInfo } from '@/utils/runtime-host-info'
import { nativeRuntimeRecoveryAction, publishRuntimeHost, runtimeBootPollingAction, runtimeConnectionRecoveryAllowed, runtimeHostPublicationReady, runtimeLifecycleAttemptActive } from '@/utils/runtime-startup'
import { RUNTIME_BOOT_PROBE_TIMEOUT_MS, RUNTIME_BOOT_TIMEOUT_MS, RUNTIME_RECONNECT_TIMEOUT_MS, RUNTIME_CREDENTIAL_READ_TIMEOUT_MS, RUNTIME_REQUEST_TIMEOUT_GRACE_MS, runtimeBootStepTimeoutMs, runtimeRequestTimeoutMs, withClientDeadline } from '@/utils/runtime-request'
import { appendLiveTranscriptEvent, compactLiveTranscriptEvents } from '@/utils/live-transcript-events'
import { runtimeProjectFileContent, type StudioProject } from './project-data'

export type HostInfo = RuntimeHostInfo
export type { AgentImageDraft } from '@/utils/agent-image'

interface RuntimeContextValue {
  snapshot: NativeNodeSnapshot
  info?: HostInfo
  lastError?: string
  credentialSyncWarning?: string
  dismissCredentialSyncWarning(): void
  nativePreviewDiagnostic?: string
  events: HostEvent[]
  liveTranscriptEvents: HostEvent[]
  retryRuntime(): Promise<void>
  request<M extends MobileHostMethod>(method: M, params: MobileHostRequestMap[M]['params']): Promise<MobileHostRequestMap[M]['result']>
  registerFileFlush(flush: (projectId: string) => Promise<void>): () => void
  initializeProject(project: StudioProject): Promise<string>
  cloneProject(repositoryUrl: string, name?: string, onProgress?: (progress: ProjectCloneProgress) => void): Promise<StudioProject>
  importGithubSnapshot(reference: GitHubCommitReference, onProgress?: (progress: ProjectCloneProgress) => void): Promise<StudioProject>
  deleteProject(projectId: string): Promise<boolean>
  runAgent(project: StudioProject, options: StudioAgentRunOptions): Promise<{ sessionId: string; taskId: string }>
  cancelAgent(projectId: string, sessionId: string): Promise<MobileHostRequestMap['agent.cancel']['result']>
  openPreview(projectId: string, platform: 'android' | 'ios' | 'web', requestId: string): Promise<PreviewOpenResult>
  runPreview(project: StudioProject, platform: 'android' | 'ios' | 'web', requestId: string): Promise<PreviewEndpoint>
  openNativePreview(bundleUrl: string, requestId: string, projectId: string): Promise<{ opened: true }>
  cancelPreviewLaunch(requestId: string): void
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null)
const NODE_RELAUNCH_REQUIRED = 'Embedded Node stopped and cannot restart inside the current app process. Fully close and reopen RunWhale.'

export function RuntimeProvider({ children }: PropsWithChildren) {
  const [snapshot, setSnapshot] = useState<NativeNodeSnapshot>(() => NodeHost.snapshot())
  const [info, setInfo] = useState<HostInfo>()
  const [lastError, setLastError] = useState<string>()
  const [credentialSyncWarning, setCredentialSyncWarning] = useState<string>()
  const [nativePreviewDiagnostic, setNativePreviewDiagnostic] = useState<string>()
  const [events, setEvents] = useState<HostEvent[]>([])
  const [liveTranscriptEvents, setLiveTranscriptEvents] = useState<HostEvent[]>([])
  const lastEventSequence = useRef(0)
  const activeAgentRequest = useRef<{ requestId: string; projectId: string; sessionId?: string } | undefined>(undefined)
  const cloneProgressListeners = useRef(new Map<string, (progress: ProjectCloneProgress) => void>())
  const cancelledPreviewLaunches = useRef(new Set<string>())
  const activeProjectId = useRef<string | undefined>(undefined)
  const infoRef = useRef<HostInfo | undefined>(undefined)
  const retryBootRef = useRef<() => Promise<void>>(async () => undefined)
  const publishHost = useCallback((hostInfo: HostInfo | undefined) => {
    publishRuntimeHost(infoRef, setInfo, hostInfo)
  }, [])
  const dismissCredentialSyncWarning = useCallback(() => setCredentialSyncWarning(undefined), [])

  useEffect(() => {
    if (Platform.OS === 'web') {
      setSnapshot({ state: 'stopped' })
      return
    }
    let cancelled = false
    let activationRevision = 0
    let currentAppState = AppState.currentState
    const isLifecycleActive = () => !cancelled
    const isAppActive = () => runtimeConnectionRecoveryAllowed(currentAppState)
    let eventSocket: WebSocket | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let reconnectAttempts = 0
    let bootPromise: Promise<void> | undefined
    let recoveryPromise: Promise<void> | undefined
    let bootRevision = 0
    let hasActivatedHost = false
    let connectionController = new AbortController()
    const appendEvent = (event: HostEvent) => setEvents((current) => {
      if (current.some((item) => item.sequence === event.sequence)) return current
      lastEventSequence.current = Math.max(lastEventSequence.current, event.sequence)
      return [...current, event].sort((left, right) => left.sequence - right.sequence).slice(-500)
    })
    const dispatchCloneProgress = (event: HostEvent) => {
      const progress = projectCloneProgressFromEvent(event)
      if (!progress) return
      try {
        cloneProgressListeners.current.get(progress.requestId)?.(progress)
      } catch { /* a presentation callback must not break runtime event recovery */ }
    }
    const publishEvent = (event: HostEvent) => {
      dispatchCloneProgress(event)
      setLiveTranscriptEvents((current) => appendLiveTranscriptEvent(current, event))
      appendEvent(event)
    }
    const closeEventSocket = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = undefined
      const socket = eventSocket
      eventSocket = undefined
      if (socket) {
        socket.onclose = null
        socket.close()
      }
    }
    const connectEvents = (hostInfo: HostInfo, after: number) => {
      if (!isLifecycleActive() || !isAppActive()) return
      closeEventSocket()
      const separator = hostInfo.websocketUrl.includes('?') ? '&' : '?'
      const socket = new WebSocket(`${hostInfo.websocketUrl}${separator}after=${after}`)
      eventSocket = socket
      socket.onopen = () => { if (isLifecycleActive()) reconnectAttempts = 0 }
      socket.onmessage = (message) => {
        if (!isLifecycleActive()) return
        try {
          const event = JSON.parse(String(message.data)) as HostEvent
          publishEvent(event)
        } catch { /* ignore malformed native socket data */ }
      }
      socket.onclose = () => {
        if (eventSocket === socket) eventSocket = undefined
        if (isLifecycleActive() && isAppActive()) {
          const delayMs = Math.min(5_000, 500 * (2 ** Math.min(reconnectAttempts, 4)))
          reconnectTimer = setTimeout(() => { void recoverHost(hostInfo) }, delayMs)
        }
      }
    }
    const activateHost = async (hostInfo: HostInfo, bootDeadlineAt: number, isParentAttemptActive: () => boolean, signal: AbortSignal): Promise<boolean> => {
      const currentActivationRevision = ++activationRevision
      const isActivationActive = () => isLifecycleActive()
        && isParentAttemptActive()
        && runtimeLifecycleAttemptActive(currentAppState, currentActivationRevision, activationRevision)
      let published = false
      try {
        // host.json survives process restarts. Do not publish its endpoint until
        // the currently running embedded host answers with the matching token.
        await rpc(hostInfo, 'host.snapshot', { afterSequence: 0 }, undefined, runtimeBootClientTimeoutMs(bootDeadlineAt, RUNTIME_BOOT_PROBE_TIMEOUT_MS), signal)
        if (!isActivationActive()) return false
        const native = NodeHost.snapshot()
        if (native.state !== 'running') throw new Error(`embedded Node entered ${native.state} before host activation completed`)
        await synchronizeRuntimeCredentials({
          isActive: isActivationActive,
          readProvider: (provider) => withinRuntimeBootDeadline(bootDeadlineAt, () => SecureStore.getItemAsync(`${provider}.api-key`), RUNTIME_CREDENTIAL_READ_TIMEOUT_MS, signal),
          setProvider: async (provider, value) => {
            await rpc(hostInfo, 'credential.set', { provider, value }, undefined, runtimeBootClientTimeoutMs(bootDeadlineAt, runtimeRequestTimeoutMs('credential.set') + RUNTIME_REQUEST_TIMEOUT_GRACE_MS), signal)
          },
          deleteProvider: async (provider) => {
            await rpc(hostInfo, 'credential.delete', { provider }, undefined, runtimeBootClientTimeoutMs(bootDeadlineAt, runtimeRequestTimeoutMs('credential.delete') + RUNTIME_REQUEST_TIMEOUT_GRACE_MS), signal)
          },
          readSsh: () => withinRuntimeBootDeadline(bootDeadlineAt, () => SecureStore.getItemAsync('github.ssh-private-key'), RUNTIME_CREDENTIAL_READ_TIMEOUT_MS, signal),
          setSsh: async (value) => {
            await rpc(hostInfo, 'ssh.credential.set', { privateKey: value }, undefined, runtimeBootClientTimeoutMs(bootDeadlineAt, runtimeRequestTimeoutMs('ssh.credential.set') + RUNTIME_REQUEST_TIMEOUT_GRACE_MS), signal)
          },
          deleteSsh: async () => {
            await rpc(hostInfo, 'ssh.credential.delete', {}, undefined, runtimeBootClientTimeoutMs(bootDeadlineAt, runtimeRequestTimeoutMs('ssh.credential.delete') + RUNTIME_REQUEST_TIMEOUT_GRACE_MS), signal)
          },
          onSynchronized: async (credentialSyncFailures) => {
            const synchronized = await rpc(hostInfo, 'host.snapshot', { afterSequence: 0 }, undefined, runtimeBootClientTimeoutMs(bootDeadlineAt, RUNTIME_BOOT_PROBE_TIMEOUT_MS), signal)
            if (!isActivationActive()) return
            const synchronizedNative = NodeHost.snapshot()
            if (!runtimeHostPublicationReady(synchronized.snapshot.state, synchronizedNative.state)) {
              throw new Error(`embedded Node host entered ${synchronized.snapshot.state} while native runtime reported ${synchronizedNative.state} during credential synchronization`)
            }
            setNativePreviewDiagnostic(NodeHost.takeNativePreviewDiagnostic() ?? undefined)
            setLastError(undefined)
            setCredentialSyncWarning(credentialSyncFailures.length > 0 ? `credential sync failed: ${credentialSyncFailures.join(', ')}` : undefined)
            synchronized.events.forEach(dispatchCloneProgress)
            setEvents(synchronized.events.slice(-500))
            setLiveTranscriptEvents(compactLiveTranscriptEvents(synchronized.events))
            lastEventSequence.current = synchronized.snapshot.lastEventSequence
            reconnectAttempts = 0
            connectEvents(hostInfo, synchronized.snapshot.lastEventSequence)
            hasActivatedHost = true
            publishHost(hostInfo)
            published = true
          },
        })
        return published
      } catch (error) {
        if (!isActivationActive()) return false
        throw error
      }
    }
    const boot = (retry = false): Promise<void> => {
      if (!isLifecycleActive() || !isAppActive()) return Promise.resolve()
      if (bootPromise) return bootPromise
      const currentBootRevision = ++bootRevision
      const signal = connectionController.signal
      const isBootActive = () => isLifecycleActive()
        && runtimeLifecycleAttemptActive(currentAppState, currentBootRevision, bootRevision)
      const pending = (async () => {
        const bootTimeoutMs = retry || hasActivatedHost ? RUNTIME_RECONNECT_TIMEOUT_MS : RUNTIME_BOOT_TIMEOUT_MS
        const bootDeadlineAt = Date.now() + bootTimeoutMs
        const native = NodeHost.snapshot()
        setSnapshot(native)
        if (native.state === 'failed' || native.state === 'stopping') {
          throw new Error(native.lastError ?? NODE_RELAUNCH_REQUIRED)
        }
        // A suspended iOS listener may be defunct even while Node is alive.
        // Repair it through the native mailbox, then wait for that publication.
        const previousHost = parseRuntimeHostInfo(NodeHost.readHostInfo())
        const recoveryId = retry && native.state === 'running' && Platform.OS === 'ios'
          ? await withinRuntimeBootDeadline(bootDeadlineAt, () => NodeHost.recoverTransport(), RUNTIME_BOOT_PROBE_TIMEOUT_MS, signal)
          : undefined
        // Foreground and Retry can coalesce into a newer mailbox request. Any
        // replacement endpoint is acceptable once activation authenticates it.
        const isRequestedHost = (host: HostInfo) => !recoveryId || host.recoveryId === recoveryId || Boolean(previousHost && !sameHost(previousHost, host))
        if (!isBootActive()) return
        if (native.state === 'running') {
          const published = parseRuntimeHostInfo(NodeHost.readHostInfo())
          if (published && isRequestedHost(published)) {
            try { if (await activateHost(published, bootDeadlineAt, isBootActive, signal)) return } catch { /* native state can briefly outlive its localhost server */ }
          }
        }
        if (!isBootActive()) return
        publishHost(undefined)
        closeEventSocket()
        let lastBootError: unknown
        // Only a cold boot starts Node; recovery replaces its transport.
        if (native.state === 'stopped') await withinRuntimeBootDeadline(bootDeadlineAt, () => NodeHost.startBundled(), bootTimeoutMs, signal)
        if (!isBootActive()) return
        const startedNative = NodeHost.snapshot()
        let pollingAction = runtimeBootPollingAction(startedNative.state)
        if (pollingAction !== 'continue') {
          lastBootError = new Error(startedNative.lastError ?? `embedded Node entered ${startedNative.state} during startup`)
        }
        while (isBootActive() && pollingAction === 'continue' && Date.now() < bootDeadlineAt) {
          const hostInfo = parseRuntimeHostInfo(NodeHost.readHostInfo())
          if (hostInfo && isRequestedHost(hostInfo)) {
            try {
              if (await activateHost(hostInfo, bootDeadlineAt, isBootActive, signal)) return
            } catch (error) {
              lastBootError = error
            }
          }
          const pollDelayMs = runtimeBootStepTimeoutMs(bootDeadlineAt, 100)
          if (pollDelayMs === 0) break
          await delay(pollDelayMs)
          const currentNative = NodeHost.snapshot()
          pollingAction = runtimeBootPollingAction(currentNative.state)
          if (pollingAction !== 'continue') {
            lastBootError = new Error(currentNative.lastError ?? `embedded Node entered ${currentNative.state} during startup`)
          }
        }
        if (isBootActive() && Date.now() >= bootDeadlineAt) throw runtimeBootTimeoutError()
        if (isBootActive()) throw new Error(lastBootError instanceof Error
          ? `embedded Node host did not become reachable: ${lastBootError.message}`
          : 'embedded Node host did not publish its localhost endpoint')
      })()
      const handled = pending.catch((error) => {
        if (isBootActive()) setLastError(error instanceof Error ? error.message : String(error))
      }).finally(() => {
        if (bootPromise === handled) bootPromise = undefined
      })
      bootPromise = handled
      return handled
    }
    function recoverHost(staleHost: HostInfo): Promise<void> {
      if (!isLifecycleActive() || !isAppActive() || bootPromise) return Promise.resolve()
      if (recoveryPromise) return recoveryPromise
      const pending = (async () => {
        const recoveryDeadlineAt = Date.now() + RUNTIME_RECONNECT_TIMEOUT_MS
        const recoveryBootRevision = bootRevision
        const recoveryActivationRevision = activationRevision
        const signal = connectionController.signal
        const isRecoveryActive = () => isLifecycleActive()
          && runtimeLifecycleAttemptActive(currentAppState, recoveryBootRevision, bootRevision)
        try {
          const current = await rpc(staleHost, 'host.snapshot', { afterSequence: lastEventSequence.current }, undefined, runtimeBootClientTimeoutMs(recoveryDeadlineAt, RUNTIME_BOOT_PROBE_TIMEOUT_MS), signal)
          if (!isRecoveryActive() || recoveryActivationRevision !== activationRevision || bootPromise) return
          if (!runtimeHostPublicationReady(current.snapshot.state, NodeHost.snapshot().state)) throw new Error('embedded Node host is no longer running')
          if (infoRef.current && !sameHost(infoRef.current, staleHost)) return
          publishHost(staleHost)
          current.events.forEach(publishEvent)
          lastEventSequence.current = Math.max(lastEventSequence.current, current.snapshot.lastEventSequence)
          reconnectAttempts = 0
          setLastError(undefined)
          connectEvents(staleHost, lastEventSequence.current)
          return
        } catch (error) {
          if (!isRecoveryActive() || recoveryActivationRevision !== activationRevision || bootPromise) return
          reconnectAttempts += 1
          if (infoRef.current && !sameHost(infoRef.current, staleHost)) return
          publishHost(undefined)
          const native = NodeHost.snapshot()
          setSnapshot(native)
          if (native.state === 'stopped' || native.state === 'stopping' || native.state === 'failed') {
            setLastError(native.lastError ?? NODE_RELAUNCH_REQUIRED)
            return
          }
          let retryHost = staleHost
          let recoveryError = error
          if (Platform.OS === 'ios' && reconnectAttempts === 3) {
            try {
              await withinRuntimeBootDeadline(recoveryDeadlineAt, () => NodeHost.recoverTransport(), RUNTIME_BOOT_PROBE_TIMEOUT_MS, signal)
            } catch (repairError) {
              recoveryError = repairError
            }
            if (!isRecoveryActive() || recoveryActivationRevision !== activationRevision || bootPromise) return
          }
          const published = parseRuntimeHostInfo(NodeHost.readHostInfo())
          if (published && !sameHost(published, staleHost)) {
            retryHost = published
            try {
              // A false result means a newer lifecycle/activation attempt owns
              // recovery now. Do not fall back to the obsolete endpoint.
              if (await activateHost(published, recoveryDeadlineAt, isRecoveryActive, signal)) return
              return
            } catch (activationError) {
              recoveryError = activationError
            }
          }
          if (!isRecoveryActive()) return
          if (infoRef.current && !sameHost(infoRef.current, retryHost)) return
          if (reconnectAttempts >= 3) setLastError(`embedded Node connection lost: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`)
          if (isLifecycleActive() && isAppActive()) {
            const delayMs = Math.min(5_000, 500 * (2 ** Math.min(reconnectAttempts, 4)))
            reconnectTimer = setTimeout(() => { void recoverHost(retryHost) }, delayMs)
          }
        }
      })()
      const handled = pending.finally(() => {
        if (recoveryPromise === handled) recoveryPromise = undefined
      })
      recoveryPromise = handled
      return handled
    }
    retryBootRef.current = () => {
      if (bootPromise) return bootPromise
      // Retire the previous recovery before its delayed responses can publish.
      activationRevision += 1
      bootRevision += 1
      connectionController.abort()
      connectionController = new AbortController()
      recoveryPromise = undefined
      closeEventSocket()
      publishHost(undefined)
      setCredentialSyncWarning(undefined)
      return boot(true)
    }
    const subscription = NodeHost.addListener('onNodeState', (native) => {
      if (!isLifecycleActive()) return
      setSnapshot(native)
      const activeHost = infoRef.current
      const recoveryAction = nativeRuntimeRecoveryAction({
        nativeState: native.state,
        hasHostInfo: Boolean(activeHost),
        bootInFlight: Boolean(bootPromise || recoveryPromise),
      })
      if (native.state !== 'running') {
        activationRevision += 1
        publishHost(undefined)
        closeEventSocket()
      }
      if (native.state === 'stopped' || native.state === 'stopping' || native.state === 'failed') {
        setLastError(native.lastError ?? NODE_RELAUNCH_REQUIRED)
      }
      if (recoveryAction === 'boot') void boot()
    })
    void boot()
    const appState = AppState.addEventListener('change', (state) => {
      if (!isLifecycleActive()) return
      currentAppState = state
      if (state === 'active') {
        if (connectionController.signal.aborted) connectionController = new AbortController()
        // iOS rejects ordinary network work once the app is suspended. Start a
        // fresh foreground recovery window; only a successful probe clears an
        // existing reachability error.
        reconnectAttempts = 0
        const previewDiagnostic = NodeHost.takeNativePreviewDiagnostic()
        setNativePreviewDiagnostic(previewDiagnostic ?? undefined)
        if (infoRef.current) void recoverHost(infoRef.current)
        else void boot()
        return
      }
      if (state !== 'background' && !(Platform.OS === 'ios' && state === 'inactive')) return
      // Native iOS lifecycle owns the background allowance and checkpoint RPC.
      // Retire only the Studio connection here; an Agent may still finish.
      activationRevision += 1
      bootRevision += 1
      bootPromise = undefined
      recoveryPromise = undefined
      connectionController.abort()
      closeEventSocket()
    })
    return () => {
      cancelled = true
      connectionController.abort()
      retryBootRef.current = async () => undefined
      closeEventSocket()
      subscription.remove()
      appState.remove()
    }
  }, [publishHost])

  const retryRuntime = useCallback(async (): Promise<void> => {
    const native = NodeHost.snapshot()
    setSnapshot(native)
    if (native.state === 'stopped' || native.state === 'stopping' || native.state === 'failed') {
      publishHost(undefined)
      setLastError(native.lastError ?? NODE_RELAUNCH_REQUIRED)
      return
    }
    // Keep the failure boundary and its pending Retry button visible until a
    // verified activation clears the error, or the bounded attempt fails.
    await retryBootRef.current()
  }, [publishHost])

  const fileFlush = useRef<(projectId: string) => Promise<void>>(async () => { throw new Error('Project drafts are still loading.') })
  const registerFileFlush = useCallback((flush: (projectId: string) => Promise<void>) => {
    fileFlush.current = flush
    return () => { if (fileFlush.current === flush) fileFlush.current = async () => { throw new Error('Project drafts are unavailable.') } }
  }, [])

  const request = useCallback(async <M extends MobileHostMethod>(method: M, params: MobileHostRequestMap[M]['params']) => {
    if (!infoRef.current) throw new Error('embedded Node runtime is still starting')
    if (['agent.run', 'agent.resume', 'agent.message', 'agent.goal.create', 'agent.goal.edit', 'agent.goal.resume', 'preview.run', 'preview.open'].includes(method)) {
      const { projectId } = params as { projectId: string }
      await fileFlush.current(projectId)
    }
    return rpc(infoRef.current, method, params)
  }, [])

  const activateProject = useCallback(async (projectId: string): Promise<string> => {
    await fileFlush.current(projectId)
    activeProjectId.current = projectId
    await request('host.start', { projectRoot: projectId })
    return projectId
  }, [request])

  const initializeProject = useCallback(async (project: StudioProject): Promise<string> => {
    const listed = await request('project.list', {})
    if (listed.some((item) => item.id === project.id)) return project.id
    const created = await request('project.create', { id: project.id, name: project.name })
    for (const file of project.files) {
      await request('project.write', { projectId: created.id, path: file.path, content: runtimeProjectFileContent(project, created.id, file) })
    }
    return created.id
  }, [request])

  const cloneProject = useCallback(async (repositoryUrl: string, name?: string, onProgress?: (progress: ProjectCloneProgress) => void): Promise<StudioProject> => {
    const hostInfo = infoRef.current
    if (!hostInfo) throw new Error('embedded Node runtime is still starting')
    const requestId = `${Platform.OS}-clone-${Date.now()}-${Math.random().toString(36).slice(2)}`
    if (onProgress) cloneProgressListeners.current.set(requestId, onProgress)
    try {
      const cloned = await rpc(hostInfo, 'project.clone', { repositoryUrl, ...(name?.trim() ? { name: name.trim() } : {}) }, requestId)
      const listed = await request('project.files', { projectId: cloned.id })
      return { id: cloned.id, name: cloned.name, description: `Git · ${repositoryUrl.trim()}`, updatedAt: cloned.updatedAt, files: [], filePaths: listed.paths }
    } finally {
      cloneProgressListeners.current.delete(requestId)
    }
  }, [request])

  const importGithubSnapshot = useCallback(async (reference: GitHubCommitReference, onProgress?: (progress: ProjectCloneProgress) => void): Promise<StudioProject> => {
    const hostInfo = infoRef.current
    if (!hostInfo) throw new Error('embedded Node runtime is still starting')
    const requestId = `${Platform.OS}-github-import-${Date.now()}-${Math.random().toString(36).slice(2)}`
    if (onProgress) cloneProgressListeners.current.set(requestId, onProgress)
    try {
      const imported = await rpc(hostInfo, 'project.import.githubSnapshot', reference, requestId)
      const listed = await request('project.files', { projectId: imported.id })
      return {
        id: imported.id,
        name: imported.name,
        description: '',
        updatedAt: imported.updatedAt,
        source: { type: 'github', owner: imported.owner, repo: imported.repo, commit: imported.commit },
        files: [],
        filePaths: listed.paths,
      }
    } finally {
      cloneProgressListeners.current.delete(requestId)
    }
  }, [request])

  const deleteProject = useCallback(async (projectId: string): Promise<boolean> => {
    const result = await request('project.delete', { projectId })
    if (activeProjectId.current === projectId) activeProjectId.current = undefined
    return result.deleted
  }, [request])

  const runAgent = useCallback(async (project: StudioProject, { prompt, initialTitle, resume, sessionId, planMode, provider, model, agentPreset, permissionMode, attachments = [], signal, modelProfile }: StudioAgentRunOptions): Promise<{ sessionId: string; taskId: string }> => {
    throwIfAgentRunAborted(signal)
    const projectId = await activateProject(project.id)
    throwIfAgentRunAborted(signal)
    if (!infoRef.current) throw new Error('embedded Node runtime is still starting')
    const uploaded = []
    for (const attachment of attachments) {
      uploaded.push(await request('project.attach', { projectId, sourcePath: attachment.sourcePath, name: attachment.name, mediaType: attachment.mediaType }))
      throwIfAgentRunAborted(signal)
    }
    const requestId = `${Platform.OS}-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`
    activeAgentRequest.current = { requestId, projectId, ...(sessionId ? { sessionId } : {}) }
    let result: MobileHostRequestMap['agent.run']['result']
    try {
      result = resume && sessionId
        ? await rpc(infoRef.current, 'agent.resume', { projectId, sessionId, provider, model, modelProfile }, requestId, undefined, signal)
        : await rpc(infoRef.current, 'agent.run', {
        projectId,
        prompt,
        ...(initialTitle ? { initialTitle } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(planMode === undefined ? {} : { planMode }),
        ...(provider ? { provider } : {}),
        ...(model?.trim() ? { model: model.trim() } : {}),
        ...(modelProfile ? { modelProfile } : {}),
        ...(agentPreset ? { agentPreset } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(uploaded.length > 0 ? { attachmentPaths: uploaded.map((attachment) => attachment.path) } : {}),
      }, requestId, undefined, signal)
    } finally {
      if (activeAgentRequest.current?.requestId === requestId) activeAgentRequest.current = undefined
    }
    throwIfAgentRunAborted(signal)
    return { sessionId: result.sessionId, taskId: result.taskId }
  }, [activateProject, request])

  const cancelAgent = useCallback(async (projectId: string, sessionId: string): Promise<MobileHostRequestMap['agent.cancel']['result']> => {
    const active = activeAgentRequest.current
    const hostInfo = infoRef.current
    const result = await request('agent.cancel', { projectId, sessionId })
    if (result.outcome === 'accepted' || !active || !hostInfo || active.projectId !== projectId || active.sessionId !== sessionId) return result
    if (await cancelRpc(hostInfo, active.requestId, 'Agent stopped by user')) {
      return { outcome: 'accepted', restoredMessages: [] }
    }
    return request('agent.cancel', { projectId, sessionId })
  }, [request])

  const openPreview = useCallback(async (projectId: string, platform: 'android' | 'ios' | 'web', requestId: string) => {
    if (cancelledPreviewLaunches.current.has(requestId)) throw new Error('Preview launch cancelled')
    await fileFlush.current(projectId)
    const hostInfo = infoRef.current
    if (!hostInfo) throw new Error('embedded Node runtime is still starting')
    try {
      return await rpc(hostInfo, 'preview.open', { projectId, platform }, requestId)
    } finally {
      cancelledPreviewLaunches.current.delete(requestId)
    }
  }, [])

  const runPreview = useCallback(async (project: StudioProject, platform: 'android' | 'ios' | 'web', requestId: string) => {
    try {
      if (cancelledPreviewLaunches.current.has(requestId)) throw new Error('Preview launch cancelled')
      const projectId = await activateProject(project.id)
      if (cancelledPreviewLaunches.current.has(requestId)) throw new Error('Preview launch cancelled')
      const hostInfo = infoRef.current
      if (!hostInfo) throw new Error('embedded Node runtime is still starting')
      return await rpc(hostInfo, 'preview.run', { projectId, platform }, requestId)
    } finally {
      cancelledPreviewLaunches.current.delete(requestId)
    }
  }, [activateProject])

  const openNativePreview = useCallback(async (bundleUrl: string, requestId: string, projectId: string): Promise<{ opened: true }> => {
    if (cancelledPreviewLaunches.current.has(requestId)) {
      cancelledPreviewLaunches.current.delete(requestId)
      throw new Error('Preview launch cancelled')
    }
    let result: { opened: boolean }
    try {
      result = await NodeHost.openNativePreview(bundleUrl, requestId, projectId)
    } catch (error) {
      if (!cancelledPreviewLaunches.current.has(requestId)) {
        const diagnostic = NodeHost.takeNativePreviewDiagnostic()
        if (diagnostic) setNativePreviewDiagnostic(diagnostic)
      }
      throw error
    } finally {
      cancelledPreviewLaunches.current.delete(requestId)
    }
    if (result?.opened !== true) {
      const diagnostic = NodeHost.takeNativePreviewDiagnostic()
      if (diagnostic) setNativePreviewDiagnostic(diagnostic)
      throw new Error(diagnostic ?? 'Native Preview did not mount its first content')
    }
    setNativePreviewDiagnostic(undefined)
    return { opened: true }
  }, [])

  const cancelPreviewLaunch = useCallback((requestId: string): void => {
    cancelledPreviewLaunches.current.add(requestId)
    NodeHost.cancelNativePreviewOpen(requestId)
    const hostInfo = infoRef.current
    if (hostInfo) void cancelRpc(hostInfo, requestId, 'Preview route changed').catch(() => undefined)
  }, [])

  const value = useMemo<RuntimeContextValue>(() => ({ snapshot, info, lastError, credentialSyncWarning, dismissCredentialSyncWarning, nativePreviewDiagnostic, events, liveTranscriptEvents, retryRuntime, request, registerFileFlush, initializeProject, cloneProject, importGithubSnapshot, deleteProject, runAgent, cancelAgent, openPreview, runPreview, openNativePreview, cancelPreviewLaunch }), [snapshot, info, lastError, credentialSyncWarning, dismissCredentialSyncWarning, nativePreviewDiagnostic, events, liveTranscriptEvents, retryRuntime, request, registerFileFlush, initializeProject, cloneProject, importGithubSnapshot, deleteProject, runAgent, cancelAgent, openPreview, runPreview, openNativePreview, cancelPreviewLaunch])
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
}

async function rpc<M extends MobileHostMethod>(info: HostInfo, method: M, params: MobileHostRequestMap[M]['params'], requestId = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2)}`, clientTimeoutMs?: number, callerSignal?: AbortSignal): Promise<MobileHostRequestMap[M]['result']> {
  const timeoutMs = runtimeRequestTimeoutMs(method)
  return withClientDeadline(clientTimeoutMs ?? timeoutMs + RUNTIME_REQUEST_TIMEOUT_GRACE_MS, async (signal) => {
    const response = await fetch(`${info.origin}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        v: 1,
        type: 'request',
        id: requestId,
        method,
        params,
        timeoutMs,
      }),
      signal,
    })
    const envelope = await response.json() as { ok?: boolean; result?: MobileHostRequestMap[M]['result']; error?: { code?: string; message?: string } }
    if (!response.ok || !envelope.ok || envelope.result === undefined) throw new RuntimeRpcError(envelope.error?.message ?? `runtime RPC ${method} failed`, envelope.error?.code)
    return envelope.result
  }, () => new RuntimeRpcError(`runtime RPC ${method} timed out`, 'TIMEOUT'), callerSignal)
}

function runtimeBootTimeoutError(): Error {
  return new Error('embedded Node runtime connection timed out. Please retry.')
}

function runtimeBootClientTimeoutMs(bootDeadlineAt: number | undefined, maximumMs: number): number | undefined {
  if (bootDeadlineAt === undefined) return undefined
  const timeoutMs = runtimeBootStepTimeoutMs(bootDeadlineAt, maximumMs)
  if (timeoutMs === 0) throw runtimeBootTimeoutError()
  return timeoutMs
}

function withinRuntimeBootDeadline<T>(bootDeadlineAt: number | undefined, operation: () => Promise<T>, maximumMs = RUNTIME_BOOT_TIMEOUT_MS, signal?: AbortSignal): Promise<T> {
  const timeoutMs = runtimeBootClientTimeoutMs(bootDeadlineAt, maximumMs)
  if (timeoutMs === undefined) return operation()
  return withClientDeadline(timeoutMs, async () => operation(), runtimeBootTimeoutError, signal)
}

class RuntimeRpcError extends Error {
  constructor(message: string, readonly code?: string) { super(message) }
}

async function cancelRpc(info: HostInfo, requestId: string, reason: string): Promise<boolean> {
  return withClientDeadline(30_000 + RUNTIME_REQUEST_TIMEOUT_GRACE_MS, async (signal) => {
    const response = await fetch(`${info.origin}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        v: 1,
        type: 'cancel',
        id: `${Platform.OS}-cancel-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        requestId,
        reason,
      }),
      signal,
    })
    const envelope = await response.json() as { ok?: boolean; result?: { cancelled?: boolean }; error?: { message?: string } }
    if (!response.ok || !envelope.ok) throw new Error(envelope.error?.message ?? 'unable to stop Agent')
    return envelope.result?.cancelled === true
  }, () => new RuntimeRpcError('runtime cancellation request timed out', 'TIMEOUT'))
}

function throwIfAgentRunAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw Object.assign(new Error('Agent stopped by user'), { code: 'ABORTED' })
}

function sameHost(left: HostInfo, right: HostInfo): boolean {
  return left.origin === right.origin && left.token === right.token
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function useRuntime(): RuntimeContextValue {
  const value = useContext(RuntimeContext)
  if (!value) throw new Error('useRuntime must be used inside RuntimeProvider')
  return value
}
