export class NativePreviewLaunchCancelled extends Error {
  constructor(message = 'Native Preview launch was cancelled.') {
    super(message)
    this.name = 'NativePreviewLaunchCancelled'
  }
}

interface Caller {
  resolve(result: { opened: boolean }): void
  reject(error: unknown): void
}
interface Launch {
  bundleUrl: string
  projectId: string
  requestId: string
  callers: Map<string, Caller>
}
interface NativeLauncher {
  openNativePreview(bundleUrl: string, requestId: string, projectId: string): Promise<{ opened: boolean }>
  cancelNativePreviewOpen(requestId: string): boolean
}

/** All mounted Studio panels share one native presentation lane. */
export class NativePreviewLauncher {
  private active?: Launch
  private next?: Launch

  constructor(private readonly native: NativeLauncher, private readonly timeoutMs = 60_000) {}

  open(bundleUrl: string, requestId: string, projectId: string): Promise<{ opened: boolean }> {
    let launch = this.next
    if (!launch || launch.bundleUrl !== bundleUrl || launch.projectId !== projectId) {
      if (launch) this.cancelLaunch(launch, 'A newer Native Preview launch replaced this request.')
      launch = { bundleUrl, projectId, requestId, callers: new Map() }
      this.next = launch
    }
    const result = new Promise<{ opened: boolean }>((resolve, reject) => {
      launch.callers.set(requestId, { resolve, reject })
    })
    this.pump()
    return result
  }

  cancel(requestId: string): void {
    const launch = [this.next, this.active].find((candidate) => candidate?.callers.has(requestId))
    const caller = launch?.callers.get(requestId)
    if (!launch || !caller) return
    launch.callers.delete(requestId)
    caller.reject(new NativePreviewLaunchCancelled())
    if (!launch.callers.size) this.cancelLaunch(launch)
  }

  dispose(): void {
    if (this.next) this.cancelLaunch(this.next)
    if (this.active?.callers.size) this.cancelLaunch(this.active)
  }

  private cancelLaunch(launch: Launch, message?: string): void {
    if (this.next === launch) this.next = undefined
    for (const caller of launch.callers.values()) caller.reject(new NativePreviewLaunchCancelled(message))
    launch.callers.clear()
    if (this.active === launch) this.native.cancelNativePreviewOpen(launch.requestId)
  }

  private pump(): void {
    if (this.active || !this.next) return
    const launch = this.next
    this.active = launch
    void this.execute(launch)
  }

  private async execute(launch: Launch): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        this.native.openNativePreview(launch.bundleUrl, launch.requestId, launch.projectId),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error('Native Preview startup timed out. Try opening it again.'))
            this.native.cancelNativePreviewOpen(launch.requestId)
          }, this.timeoutMs)
        }),
      ])
      for (const caller of launch.callers.values()) caller.resolve(result)
    } catch (error) {
      for (const caller of launch.callers.values()) caller.reject(error)
    } finally {
      if (timer) clearTimeout(timer)
      launch.callers.clear()
      if (this.next === launch) this.next = undefined
      this.active = undefined
      this.pump()
    }
  }
}
