import { randomUUID } from 'node:crypto'
import { previewEvidenceText, previewRepairMessage, type PreviewEndpoint, type PreviewTestCommand, type PreviewTestObservation, type PreviewTestRequest, type PreviewTestResult } from '@runwhale/mobile-protocol'

interface PendingProbe {
  request: PreviewTestRequest
  endpoint: PreviewEndpoint
  command: PreviewTestCommand
  claimed: boolean
  finish(result: PreviewTestResult): void
}

/** Studio owns the views; the Agent host owns request lifetime and attribution. */
export class PreviewTesting {
  private readonly pending = new Map<string, PendingProbe>()

  constructor(
    private readonly active: () => PreviewEndpoint | undefined,
    private readonly publish: (request: PreviewTestRequest) => void,
  ) {}

  async query(projectId: string, command: PreviewTestCommand, signal: AbortSignal): Promise<PreviewTestObservation> {
    signal.throwIfAborted()
    const endpoint = this.active()
    if (!endpoint || endpoint.projectId !== projectId) throw new Error('Run this project Preview before testing it.')
    if (command.kind === 'action' && (!command.snapshotId || !command.nodeId)) throw new Error('Inspect the Preview before selecting an action target.')
    const request: PreviewTestRequest = { id: randomUUID(), kind: command.kind, projectId, platform: endpoint.platform, revision: endpoint.revision, expiresAt: Date.now() + 15_000 }
    return new Promise<PreviewTestObservation>((resolve, reject) => {
      const finish = (result: PreviewTestResult) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.pending.delete(request.id)
        if (result.error) reject(new Error(previewRepairMessage(result.error) ?? 'Preview inspection failed.'))
        else resolve({ ...result, projectId, revision: endpoint.revision, platform: endpoint.platform })
      }
      const abort = () => finish({ timestamp: Date.now(), error: 'Preview testing was cancelled.' })
      const timer = setTimeout(() => finish({ timestamp: Date.now(), error: 'Preview testing timed out. Keep this project Preview open and try again.' }), 15_000)
      this.pending.set(request.id, { request, endpoint, command, claimed: false, finish })
      signal.addEventListener('abort', abort, { once: true })
      this.publish(request)
    })
  }

  claim(id: string, projectId: string, revision: number): { command?: PreviewTestCommand } {
    const pending = this.current(id, projectId, revision)
    if (!pending || pending.claimed) return {}
    pending.claimed = true
    return { command: pending.command }
  }

  complete(id: string, projectId: string, revision: number, result: PreviewTestResult): boolean {
    const pending = this.current(id, projectId, revision)
    if (!pending?.claimed) return false
    // Images travel only in the bounded completion RPC, never in the event journal.
    const wire = JSON.stringify(result)
    if (!result || typeof result !== 'object' || Buffer.byteLength(wire) > 480_000 || !Number.isFinite(result.timestamp)) {
      pending.finish({ timestamp: Date.now(), error: 'Preview returned an invalid or oversized observation.' })
      return false
    }
    if (!result.error && ((pending.command.kind === 'inspect' && (!Array.isArray(result.nodes) || !result.snapshotId))
      || (pending.command.kind === 'screenshot' && (!result.image || result.image.mediaType !== 'image/jpeg'))
      || (pending.command.kind === 'logs' && !Array.isArray(result.logs))
      || (pending.command.kind === 'close' && result.closed !== true)
      || (pending.command.kind === 'action' && result.performed !== true))) {
      pending.finish({ timestamp: Date.now(), error: 'Preview did not return the requested test evidence.' })
      return false
    }
    const sanitized = {
      ...result,
      ...(result.logs ? { logs: result.logs.slice(-100).map((log) => ({ ...log, message: previewEvidenceText(log.message) })) } : {}),
      ...(result.nodes ? { nodes: result.nodes.slice(0, 250).map((node) => ({ ...node,
        ...(node.text === undefined ? {} : { text: previewEvidenceText(node.text) }),
        ...(node.label === undefined ? {} : { label: previewEvidenceText(node.label) }),
        ...(node.value === undefined ? {} : { value: previewEvidenceText(node.value) }),
      })) } : {}),
    }
    pending.finish(sanitized)
    if (pending.command.kind === 'close' && result.closed) this.cancelAll()
    return true
  }

  cancelAll(): void {
    for (const pending of this.pending.values()) pending.finish({ timestamp: Date.now(), error: 'Preview changed, closed, or stopped. Inspect the current Preview again.' })
  }

  private current(id: string, projectId: string, revision: number): PendingProbe | undefined {
    const pending = this.pending.get(id)
    if (!pending || pending.request.projectId !== projectId || pending.request.revision !== revision) return undefined
    if (pending.endpoint !== this.active() || pending.request.expiresAt <= Date.now()) {
      pending.finish({ timestamp: Date.now(), error: 'Preview changed or the test request expired. Inspect again.' })
      return undefined
    }
    return pending
  }
}
