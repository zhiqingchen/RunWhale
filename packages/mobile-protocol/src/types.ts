export const MOBILE_HOST_PROTOCOL_VERSION = 1 as const

export const DEFAULT_PROTOCOL_LIMITS = {
  maxPayloadBytes: 512 * 1024,
  maxRequestBytes: 16 * 1024 * 1024,
  maxQueuedBytes: 2 * 1024 * 1024,
  maxLogBytes: 256 * 1024,
  maxEvents: 2_000,
  requestTimeoutMs: 30_000,
} as const

export type RuntimePlatform = 'android' | 'ios'
export type PreviewPlatform = RuntimePlatform | 'web'
export type MobileModelProvider = 'deepseek' | 'openai' | 'anthropic' | 'google'
export interface MobileModelDefinition {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
}
export interface MobileModelProviderProfile {
  baseURL?: string
  models: readonly MobileModelDefinition[]
}
export type MobileAgentPreset = 'standard' | 'minimal'
export const MOBILE_PERMISSION_MODES = ['review', 'read-only', 'danger-full-access'] as const
export type MobilePermissionMode = typeof MOBILE_PERMISSION_MODES[number]
export function isMobilePermissionMode(value: unknown): value is MobilePermissionMode {
  return typeof value === 'string' && (MOBILE_PERMISSION_MODES as readonly string[]).includes(value)
}
export type MobileImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
export const MOBILE_DEFAULT_MODELS: Readonly<Record<MobileModelProvider, string>> = Object.freeze({
  deepseek: 'deepseek-v4-flash',
  openai: 'gpt-5.4-mini',
  anthropic: 'claude-sonnet-4-6',
  google: 'gemini-3.5-flash',
})
export type HostState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed'

export interface HostSnapshot {
  protocolVersion: typeof MOBILE_HOST_PROTOCOL_VERSION
  runtimeAbi: string
  state: HostState
  nodeVersion?: string
  activeProjectId?: string
  activePreview?: {
    platform: PreviewPlatform
    port: number
    revision: number
    startedAt: number
  }
  lastEventSequence: number
}

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: number
}

export type ProjectClonePhase = 'preparing' | 'receiving' | 'resolving' | 'checkout' | 'validating'

export interface ProjectCloneProgress {
  requestId: string
  phase: ProjectClonePhase
  loaded: number
  total?: number
}

export interface ProjectAttachment {
  id: string
  path: string
  name: string
  mediaType: MobileImageMediaType
  size: number
}

export type GitShareBlockerCode =
  | 'DETACHED_HEAD'
  | 'DIRTY_WORKTREE'
  | 'MISSING_REMOTE'
  | 'NON_GITHUB_REMOTE'
  | 'REMOTE_UNREACHABLE'
  | 'REMOTE_SHA_MISMATCH'
  | 'SENSITIVE_CONTENT'

export interface GitShareBlocker {
  code: GitShareBlockerCode
  message: string
  paths?: string[]
}

export interface GitShareInspection {
  branch?: string
  head?: string
  remote?: {
    name: string
    url: string
    owner: string
    repo: string
    commit?: string
  }
  worktreeClean: boolean
  changedPaths: string[]
  remoteAccessible: boolean
  remoteMatchesHead: boolean
  canPublish: boolean
  shareable: boolean
  blockers: GitShareBlocker[]
}

export interface GitSharePublication {
  owner: string
  repo: string
  commit: string
  shareUrl: string
  githubUrl: string
}

export interface GitHubSnapshotImportResult extends ProjectSummary {
  owner: string
  repo: string
  commit: string
  access: 'public' | 'ssh'
}

export interface RuntimeEnvironment {
  nodeVersion: string
  npmVersion: string
  expoSdkVersion: string
  reactNativeVersion: string
  metroVersion: string
  runtimeAbi: string
  architecture: string
  moduleStore: string
  npmCache: string
  moduleStoreBytes: number
  npmCacheBytes: number
  nativePreviewModules: ReadonlyArray<{
    name: string
    version: string
    platforms: readonly RuntimePlatform[]
  }>
}

export interface AgentSessionRecord {
  sessionId: string
  projectId: string
  title: string
  updatedAt: number
  taskId?: string
  state: 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted' | 'interrupted'
  failure?: { code?: string; message: string }
  agentPreset?: MobileAgentPreset
  permissionMode?: MobilePermissionMode
  parentSessionId?: string
  parentEventSequence?: number
  events: readonly unknown[]
}

export interface AgentSessionSummary extends Omit<AgentSessionRecord, 'events'> {
  turnCount: number
  eventCount: number
  preview: string
}

export type AgentMessageMode = 'followup' | 'steer'
export type AgentApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

export interface AgentQuestionOption {
  label: string
  description?: string
}

export interface AgentQuestion {
  id: string
  question: string
  detail?: string
  header?: string
  options?: AgentQuestionOption[]
  multiSelect?: boolean
  intent?: { kind: 'plan-review'; approve: string }
}

export interface AgentQuestionAnswer {
  id: string
  selected: string[]
  custom?: string
}

export type AgentGoalPhase = 'active' | 'paused' | 'blocked' | 'complete'
export interface AgentGoal {
  id: string
  revision: number
  objective: string
  phase: AgentGoalPhase
  maxGoalRounds: number
  roundsStarted: number
  createdAt: number
  updatedAt: number
  activation?: 'armed' | 'disarmed'
  blockedReason?: { code: string; message: string }
}

export interface PreviewRunInput {
  projectId: string
  platform: PreviewPlatform
}

export interface PreviewEndpoint {
  projectId: string
  platform: PreviewPlatform
  revision: number
  port: number
  token: string
  bundleUrl: string
  requestedBySessionId?: string
}

export type PreviewOpenResult =
  | { status: 'missing' }
  | { status: 'ready'; source: 'active' | 'cache'; endpoint: PreviewEndpoint }

export interface PackageInstallPlan {
  planId: string
  projectId: string
  changes: Array<{ name: string; from?: string; to: string }>
  expiresAt: number
}

export interface AgentQueuedMessage {
  messageId: string
  text: string
  mode: AgentMessageMode
}

export interface MobileHostRequestMap {
  'host.start': { params: { projectRoot: string }; result: HostSnapshot }
  'host.suspend': { params: Record<string, never>; result: { suspended: true } }
  'host.background': { params: { revision: number; graceMs: number }; result: { suspended: boolean } }
  'host.foreground': { params: { revision: number }; result: { resumed: boolean } }
  'host.stop': { params: Record<string, never>; result: HostSnapshot }
  'host.snapshot': { params: { afterSequence?: number }; result: { snapshot: HostSnapshot; events: HostEvent[] } }
  'host.environment': { params: Record<string, never>; result: RuntimeEnvironment }
  'credential.set': { params: { provider: MobileModelProvider; value: string }; result: { configured: true } }
  'credential.delete': { params: { provider: MobileModelProvider }; result: { configured: false } }
  'credential.status': { params: { provider: MobileModelProvider }; result: { configured: boolean } }
  'ssh.generate': { params: Record<string, never>; result: { publicKey: string; fingerprint: string; privateKeyOneTime: string } }
  'ssh.credential.set': { params: { privateKey: string }; result: { configured: true } }
  'ssh.credential.delete': { params: Record<string, never>; result: { configured: false } }
  'ssh.credential.status': { params: Record<string, never>; result: { configured: boolean } }
  'project.list': { params: Record<string, never>; result: ProjectSummary[] }
  'project.create': { params: { id?: string; name: string }; result: ProjectSummary }
  'project.rename': { params: { projectId: string; name: string }; result: ProjectSummary }
  'project.delete': { params: { projectId: string }; result: { deleted: boolean } }
  'project.clone': { params: { repositoryUrl: string; name?: string }; result: ProjectSummary }
  'git.share.inspect': { params: { projectId: string }; result: GitShareInspection }
  'git.share.publish': { params: { projectId: string }; result: GitSharePublication }
  'project.import.githubSnapshot': { params: { owner: string; repo: string; commit: string; name?: string }; result: GitHubSnapshotImportResult }
  'project.attach': { params: { projectId: string; sourcePath: string; name: string; mediaType: MobileImageMediaType }; result: ProjectAttachment }
  'project.files': { params: { projectId: string }; result: { paths: string[] } }
  'project.read': { params: { projectId: string; path: string }; result: { content: string; version: string } }
  'project.write': { params: { projectId: string; path: string; content: string; expectedVersion?: string }; result: { version: string } }
  'session.create': { params: { projectId: string; sessionId?: string; title?: string }; result: AgentSessionRecord }
  'session.list': { params: { projectId: string }; result: AgentSessionSummary[] }
  'session.read': { params: { projectId: string; sessionId: string; surfaceOnly?: boolean }; result: AgentSessionRecord }
  'session.export': { params: { projectId: string; sessionId: string }; result: { path: string } }
  'session.fork': { params: { projectId: string; sessionId: string; throughSequence?: number }; result: AgentSessionRecord }
  'session.delete': { params: { projectId: string; sessionId: string }; result: { deleted: boolean } }
  'agent.run': { params: { projectId: string; prompt: string; initialTitle?: { title: string; expectedTitle: string }; sessionId?: string; planMode?: boolean; provider?: MobileModelProvider; model?: string; modelProfile?: MobileModelProviderProfile; agentPreset?: MobileAgentPreset; permissionMode?: MobilePermissionMode; attachmentPaths?: string[] }; result: { sessionId: string; taskId: string } }
  'agent.cancel': { params: { projectId: string; sessionId: string }; result: { outcome: 'accepted' | 'already-idle'; restoredMessages: AgentQueuedMessage[] } }
  'agent.resume': { params: { projectId: string; sessionId: string; provider?: MobileModelProvider; model?: string; modelProfile?: MobileModelProviderProfile }; result: { sessionId: string; taskId: string } }
  'agent.message': { params: { projectId: string; sessionId: string; prompt: string; mode: AgentMessageMode }; result: { accepted: boolean; messageId?: string } }
  'agent.message.list': { params: { projectId: string; sessionId: string }; result: { messages: AgentQueuedMessage[] } }
  'agent.message.update': { params: { projectId: string; sessionId: string; messageId: string; prompt: string }; result: { accepted: boolean; messageId?: string } }
  'agent.message.delete': { params: { projectId: string; sessionId: string; messageId: string }; result: { deleted: boolean } }
  'agent.plan.set': { params: { projectId: string; sessionId: string; active: boolean }; result: { active: boolean; pending?: boolean; outcome: 'committed' | 'queued' | 'cancelled' | 'noop' } }
  'agent.approval.resolve': { params: { requestId: string; outcome: Extract<AgentApprovalOutcome, 'allowed-once' | 'rejected'> }; result: { resolved: boolean } }
  'agent.question.answer': { params: { requestId: string; answers: AgentQuestionAnswer[] }; result: { resolved: boolean } }
  'agent.goal.get': { params: { projectId: string; sessionId: string; provider?: MobileModelProvider; model?: string; modelProfile?: MobileModelProviderProfile }; result: { goal?: AgentGoal } }
  'agent.goal.create': { params: { projectId: string; sessionId: string; objective: string; maxGoalRounds?: number }; result: { goal: AgentGoal } }
  'agent.goal.edit': { params: { projectId: string; sessionId: string; id: string; revision: number; objective?: string; maxGoalRounds?: number }; result: { goal: AgentGoal } }
  'agent.goal.pause': { params: { projectId: string; sessionId: string; id: string; revision: number }; result: { goal: AgentGoal } }
  'agent.goal.resume': { params: { projectId: string; sessionId: string; id: string; revision: number }; result: { goal: AgentGoal } }
  'agent.goal.clear': { params: { projectId: string; sessionId: string; id: string; revision: number }; result: { cleared: true } }
  'task.run': { params: { projectId: string; entry: string; args?: string[]; timeoutMs?: number }; result: { taskId: string } }
  'task.cancel': { params: { taskId: string }; result: { cancelled: boolean } }
  'package.plan': { params: { projectId: string; dependencies: Record<string, string>; offline?: boolean }; result: PackageInstallPlan }
  'package.install': { params: { planId: string }; result: { installId: string } }
  'package.reject': { params: { planId: string }; result: { rejected: boolean } }
  'package.cancel': { params: { installId: string }; result: { cancelled: boolean } }
  'preview.open': { params: PreviewRunInput; result: PreviewOpenResult }
  'preview.run': { params: PreviewRunInput; result: PreviewEndpoint }
  'preview.reload': { params: { projectId: string }; result: { reloaded: boolean } }
  'preview.stop': { params: { projectId: string }; result: { stopped: boolean } }
  'preview.logs': { params: { projectId: string; afterSequence?: number }; result: { events: HostEvent[] } }
  'preview.report': { params: { projectId: string; sessionId: string; platform: PreviewPlatform; revision: number; status: 'opened' | 'failed'; message?: string }; result: { recorded: boolean; notified: boolean } }
}

export type MobileHostMethod = keyof MobileHostRequestMap

export interface RequestEnvelope<M extends MobileHostMethod = MobileHostMethod> {
  v: typeof MOBILE_HOST_PROTOCOL_VERSION
  type: 'request'
  id: string
  method: M
  params: MobileHostRequestMap[M]['params']
  timeoutMs?: number
}

export interface CancelEnvelope {
  v: typeof MOBILE_HOST_PROTOCOL_VERSION
  type: 'cancel'
  id: string
  requestId: string
  reason?: string
}

export type MobileErrorCode =
  | 'ABORTED'
  | 'BACKPRESSURE'
  | 'CONFLICT'
  | 'INTERNAL'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'PERMISSION_DENIED'
  | 'RUNTIME_UNAVAILABLE'
  | 'TIMEOUT'
  | 'UNSUPPORTED'

export interface MobileError {
  code: MobileErrorCode
  message: string
  retryable: boolean
  details?: unknown
}

export interface ResponseEnvelope {
  v: typeof MOBILE_HOST_PROTOCOL_VERSION
  type: 'response'
  id: string
  requestId: string
  ok: boolean
  result?: unknown
  error?: MobileError
}

export type HostEventName =
  | 'approval.requested'
  | 'approval.resolved'
  | 'agent.delta'
  | 'agent.message'
  | 'agent.queue'
  | 'agent.state'
  | 'agent.tool'
  | 'diagnostic'
  | 'host.state'
  | 'preview.crashed'
  | 'preview.log'
  | 'preview.ready'
  | 'project.changed'
  | 'project.clone-progress'
  | 'question.requested'
  | 'question.resolved'
  | 'runtime.preparation'
  | 'session.event'
  | 'package.output'
  | 'package.state'
  | 'task.output'
  | 'task.state'

export interface HostEvent<T = unknown> {
  v: typeof MOBILE_HOST_PROTOCOL_VERSION
  type: 'event'
  sequence: number
  timestamp: number
  name: HostEventName
  data: T
}

export type ClientEnvelope = RequestEnvelope | CancelEnvelope
export type HostEnvelope = ResponseEnvelope | HostEvent
