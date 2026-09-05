import type { NativeNodeState } from '@runwhale/node-host'

export type RuntimeEnvironmentLoadState =
  | { status: 'loading' }
  | { status: 'ready'; npmVersion: string }
  | { status: 'failed' }

export interface RuntimeSettingsPresentation {
  npmVersion?: string
  npmStatus: RuntimeEnvironmentLoadState['status']
  failure?: 'environment' | 'runtime'
  retryTarget?: 'environment' | 'runtime'
}

export function runtimeSettingsSummaryState(
  nativeState: NativeNodeState,
  runtimeReady: boolean,
  runtimeReportedFailure: boolean,
): NativeNodeState {
  if (runtimeReportedFailure || nativeState === 'failed') return 'failed'
  if (nativeState === 'running' && !runtimeReady) return 'starting'
  return nativeState
}

export async function loadRuntimeEnvironment(load: () => Promise<{ npmVersion: string }>): Promise<Exclude<RuntimeEnvironmentLoadState, { status: 'loading' }>> {
  try {
    const environment = await load()
    return { status: 'ready', npmVersion: environment.npmVersion }
  } catch {
    return { status: 'failed' }
  }
}

export function shouldLoadRuntimeEnvironment(publishedNpmVersion?: string): publishedNpmVersion is undefined {
  return publishedNpmVersion === undefined
}

export function runtimeSettingsPresentation(
  environment: RuntimeEnvironmentLoadState,
  runtimeReportedFailure: boolean,
  publishedNpmVersion?: string,
): RuntimeSettingsPresentation {
  const npmVersion = publishedNpmVersion ?? (environment.status === 'ready' ? environment.npmVersion : undefined)
  const npmStatus = npmVersion ? 'ready' : environment.status
  const failure = runtimeReportedFailure ? 'runtime' : npmStatus === 'failed' ? 'environment' : undefined
  return {
    npmVersion,
    npmStatus,
    failure,
    retryTarget: failure,
  }
}
