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
  private readonly workers = new Map<string, { worker: Worker; roots: readonly string[] }>()
  private readonly cancelled = new Set<string>()
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
    this.emit('state', id, 'running')

    const worker = new Worker(this.workerUrl, {
      workerData: { entry, args: request.args ?? [] },
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
    })
    this.workers.set(id, { worker, roots: requestedRoot === root ? [root] : [requestedRoot, root] })
    const result = new Promise<TaskResult>(resolveResult => {
      let settled = false
      const finish = (result: Omit<TaskResult, 'id' | 'durationMs'>, state: 'completed' | 'failed' | 'cancelled'): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.workers.delete(id)
        this.emit('state', id, state)
        resolveResult({ id, durationMs: Date.now() - startedAt, ...result })
      }
      const timer = setTimeout(() => {
        void worker.terminate()
        finish({ exitCode: 124, output, error: `task timed out after ${timeoutMs}ms` }, 'failed')
      }, timeoutMs)
      worker.on('message', (message: unknown) => {
        if (typeof message !== 'object' || message === null) return
        const record = message as Record<string, unknown>
        if (record.type === 'output' && typeof record.chunk === 'string') {
          const bytes = Buffer.byteLength(record.chunk)
          if (outputBytes + bytes <= maxOutputBytes) {
            output += record.chunk
            outputBytes += bytes
            this.emit('output', id, record.chunk)
          } else {
            void worker.terminate()
            finish({ exitCode: 1, output, error: `task output exceeded ${maxOutputBytes} bytes` }, 'failed')
          }
        }
        if (record.type === 'done') {
          const error = typeof record.error === 'string' ? record.error : undefined
          finish({ exitCode: error ? 1 : 0, output, ...(error ? { error } : {}) }, error ? 'failed' : 'completed')
        }
      })
      worker.once('error', error => finish({ exitCode: 1, output, error: error.message }, 'failed'))
      worker.once('exit', code => {
        if (this.cancelled.delete(id)) {
          finish({ exitCode: 130, output, error: 'task cancelled' }, 'cancelled')
          return
        }
        if (!settled) finish({ exitCode: code ?? 1, output, ...(code === 0 ? {} : { error: `worker exited with code ${code}` }) }, code === 0 ? 'completed' : 'failed')
      })
    })
    return { id, result }
  }

  async cancel(id: string): Promise<boolean> {
    const active = this.workers.get(id)
    if (!active) return false
    this.cancelled.add(id)
    await active.worker.terminate()
    return true
  }
}
