export type RuntimeStartupScreen = 'content' | 'failed'
export type NativeRuntimeRecoveryAction = 'none' | 'boot'
export type RuntimeBootPollingAction = 'continue' | 'fail'

type NativeRuntimeState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed'

interface RuntimeStartupState {
  isWeb: boolean
  nativeState: NativeRuntimeState
  hasHostInfo: boolean
  hostError?: string
}

interface NativeRuntimeRecoveryState {
  nativeState: NativeRuntimeState
  hasHostInfo: boolean
  bootInFlight: boolean
}

export function runtimeConnectionRecoveryAllowed(appState: string | null): boolean {
  // React Native can briefly report no state while the bridge initializes. It
  // is safe to bootstrap then; only an observed suspension transition must
  // prevent localhost recovery work.
  return appState === null || appState === 'unknown' || appState === 'active'
}

export function runtimeLifecycleAttemptActive(
  appState: string | null,
  attemptRevision: number,
  currentRevision: number,
): boolean {
  return runtimeConnectionRecoveryAllowed(appState) && attemptRevision === currentRevision
}

export function publishRuntimeHost<T>(
  reference: { current: T | undefined },
  publish: (value: T | undefined) => void,
  value: T | undefined,
): void {
  reference.current = value
  publish(value)
}

export function nativeRuntimeRecoveryAction({
  nativeState,
  hasHostInfo,
  bootInFlight,
}: NativeRuntimeRecoveryState): NativeRuntimeRecoveryAction {
  if (bootInFlight) return 'none'
  if (nativeState === 'running') return hasHostInfo ? 'none' : 'boot'
  return 'none'
}

export function runtimeBootPollingAction(nativeState: NativeRuntimeState): RuntimeBootPollingAction {
  if (nativeState !== 'stopped' && nativeState !== 'failed') return 'continue'
  return 'fail'
}

export function runtimeHostPublicationReady(hostState: NativeRuntimeState, nativeState: NativeRuntimeState): boolean {
  return hostState === 'running' && nativeState === 'running'
}

export function runtimeStartupScreen({
  isWeb,
  nativeState,
  hasHostInfo,
  hostError,
}: RuntimeStartupState): RuntimeStartupScreen {
  if (isWeb) return 'content'
  if (nativeState === 'failed' || (!hasHostInfo && hostError)) return 'failed'
  return 'content'
}
