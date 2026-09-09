import { Worker } from 'node:worker_threads'
import type { MobileDiagnostic, MobileSourceFile, MobileTypeScriptProject } from './language-service.js'

export interface MobileTypeScriptDiagnosticsRequest extends MobileTypeScriptProject {
  files: readonly MobileSourceFile[]
}

export const MOBILE_TYPESCRIPT_TIMEOUT_MS = 30_000

// Reuse the shipped task worker; each batch owns one fresh project snapshot.
export async function runMobileTypeScriptDiagnostics(
  request: MobileTypeScriptDiagnosticsRequest,
  signal: AbortSignal,
  workerUrl = new URL('./task-worker.js', import.meta.url),
  timeoutMs = MOBILE_TYPESCRIPT_TIMEOUT_MS,
): Promise<MobileDiagnostic[]> {
  signal.throwIfAborted()
  const worker = new Worker(workerUrl, {
    workerData: { kind: 'typescript-diagnostics', ...request },
    env: {},
    resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 },
  })
  return new Promise((resolve, reject) => {
    let diagnostics: MobileDiagnostic[] | undefined
    let failure: Error | undefined
    let termination: Promise<number> | undefined
    const stop = (error: Error): void => {
      failure ??= error
      termination ??= worker.terminate()
    }
    const abort = (): void => stop(new Error('TypeScript diagnostics cancelled'))
    const timer = setTimeout(() => stop(new Error(`TypeScript diagnostics timed out after ${timeoutMs}ms; validation is incomplete. Do not retry without narrowing the check or fixing its cause.`)), timeoutMs)
    signal.addEventListener('abort', abort, { once: true })
    worker.once('message', (message: { diagnostics: MobileDiagnostic[] }) => { diagnostics = message.diagnostics })
    worker.once('error', (error) => stop(error))
    worker.once('exit', (code) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      // Keep the tool active until the worker has actually stopped.
      if (failure) reject(failure)
      else if (code !== 0 || !diagnostics) reject(new Error(`TypeScript diagnostics worker exited without a result (code ${code})`))
      else resolve(diagnostics)
    })
    if (signal.aborted) abort()
  })
}
