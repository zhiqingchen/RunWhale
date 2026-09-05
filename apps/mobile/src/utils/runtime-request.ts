import type { MobileHostMethod } from '@runwhale/mobile-protocol'

export const RUNTIME_BOOT_TIMEOUT_MS = 3 * 60_000
export const RUNTIME_RECONNECT_TIMEOUT_MS = 30_000
export const RUNTIME_BOOT_PROBE_TIMEOUT_MS = 2_000
export const RUNTIME_CREDENTIAL_READ_TIMEOUT_MS = 5_000
export const RUNTIME_REQUEST_TIMEOUT_GRACE_MS = 5_000

export function runtimeBootStepTimeoutMs(deadlineAt: number, maximumMs: number, now = Date.now()): number {
  return Math.max(0, Math.min(maximumMs, deadlineAt - now))
}

export function runtimeRequestTimeoutMs(method: MobileHostMethod): number {
  if (method === 'host.suspend' || method === 'agent.run' || method === 'agent.resume' || method === 'agent.cancel' || method === 'project.clone' || method === 'project.import.githubSnapshot' || method === 'git.share.publish') return 10 * 60_000
  if (method === 'preview.open' || method === 'preview.run' || method === 'package.install' || method === 'project.delete' || method === 'session.export') return 5 * 60_000
  return 30_000
}

export async function withClientDeadline<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutError: () => Error,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  const pending = new Promise<T>((resolve, reject) => {
    abort = () => {
      // React Native's AbortSignal may omit reason even when abort(reason) was
      // used. Preserve cancellation semantics instead of rejecting undefined.
      const reason = signal?.reason ?? Object.assign(new Error('Request cancelled'), { code: 'ABORTED' })
      reject(reason)
      controller.abort(reason)
    }
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener('abort', abort, { once: true })
    timeout = setTimeout(() => {
      const error = timeoutError()
      reject(error)
      controller.abort()
    }, timeoutMs)
    void Promise.resolve().then(() => operation(controller.signal)).then(resolve, reject)
  })
  try {
    return await pending
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    if (abort) signal?.removeEventListener('abort', abort)
  }
}
