import { EventEmitter } from 'node:events'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { Worker } from 'node:worker_threads'

export interface TaskRunRequest {
  root: string
  entry: string
  args?: string[]
  timeoutMs?: number
  maxOutputBytes?: number
}

export interface TaskResult {
  id: string
  exitCode: number
  output: string
  durationMs: number
  error?: string
}

export interface StartedTask {
  id: string
  result: Promise<TaskResult>
}

interface TaskEvents {
  output: [id: string, chunk: string]
  state: [id: string, state: 'running' | 'completed' | 'failed' | 'cancelled']
}

export class MobileTaskRunner extends EventEmitter<TaskEvents> {
  private readonly workers = new Map<string, { worker: Worker; roots: readonly string[]; cancel: () => Promise<number> }>()
  private sequence = 0

  constructor(private readonly workerUrl: URL = new URL('./task-worker.js', import.meta.url)) {
    super()
  }

  hasRunningTaskForRoot(root: string): boolean {
    const selected = resolve(root)
    return [...this.workers.values()].some((active) => active.roots.includes(selected))
  }

  async run(request: TaskRunRequest): Promise<TaskResult> {
    return (await this.start(request)).result
  }

  async start(request: TaskRunRequest): Promise<StartedTask> {
    const requestedRoot = resolve(request.root)
    const root = await realpath(request.root)
    const entry = await realpath(resolve(root, request.entry))
    const path = relative(root, entry)
    if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('task entry escapes project root')
    const id = `task-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`
    const startedAt = Date.now()
    const timeoutMs = Math.min(request.timeoutMs ?? 30_000, 10 * 60_000)
    const maxOutputBytes = request.maxOutputBytes ?? 256 * 1024
    let output = ''
    let outputBytes = 0
    const worker = new Worker(this.workerUrl, {
      workerData: { entry, args: request.args ?? [] },
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
    })
    let failure: { exitCode: number; error: string; state: 'failed' | 'cancelled' } | undefined
    let termination: Promise<number> | undefined
    const stop = (exitCode: number, error: string, state: 'failed' | 'cancelled' = 'failed'): Promise<number> => {
      failure ??= { exitCode, error, state }
      return termination ??= worker.terminate()
    }
    this.workers.set(id, {
      worker,
      roots: requestedRoot === root ? [root] : [requestedRoot, root],
      cancel: () => stop(130, 'task cancelled', 'cancelled'),
    })
    const result = new Promise<TaskResult>(resolveResult => {
      const timer = setTimeout(() => {
        void stop(124, `task timed out after ${timeoutMs}ms`)
      }, timeoutMs)
      worker.on('message', (message: unknown) => {
        if (failure || typeof message !== 'object' || message === null) return
        const record = message as Record<string, unknown>
        if (record.type === 'output' && typeof record.chunk === 'string') {
          const bytes = Buffer.byteLength(record.chunk)
          if (outputBytes + bytes <= maxOutputBytes) {
            output += record.chunk
            outputBytes += bytes
            this.emit('output', id, record.chunk)
          } else {
            void stop(1, `task output exceeded ${maxOutputBytes} bytes`)
          }
        }
      })
      worker.once('error', error => { void stop(1, String(error)) })
      worker.once('exit', code => {
        clearTimeout(timer)
        this.workers.delete(id)
        const exitCode = failure?.exitCode ?? code
        const error = failure?.error ?? (code === 0 ? undefined : `worker exited with code ${code}`)
        this.emit('state', id, failure?.state ?? (code === 0 ? 'completed' : 'failed'))
        resolveResult({ id, durationMs: Date.now() - startedAt, exitCode, output, ...(error ? { error } : {}) })
      })
    })
    this.emit('state', id, 'running')
    return { id, result }
  }

  async cancel(id: string): Promise<boolean> {
    const active = this.workers.get(id)
    if (!active) return false
    await active.cancel()
    return true
  }
}
