import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativePreviewLauncher, NativePreviewLaunchCancelled } from '../src/utils/native-preview-launch'

afterEach(() => vi.useRealTimers())

function fixture() {
  const pending = new Map<string, { resolve(result: { opened: boolean }): void; reject(error: Error): void }>()
  const native = {
    openNativePreview: vi.fn((_url: string, requestId: string, _projectId: string) => new Promise<{ opened: boolean }>((resolve, reject) => {
      if (pending.size) throw new Error('Another Native Preview launch is still in progress')
      pending.set(requestId, { resolve, reject })
    })),
    cancelNativePreviewOpen: vi.fn((_requestId: string) => true),
  }
  const launcher = new NativePreviewLauncher(native, 1000)
  const settle = (id: string, error?: Error) => {
    const request = pending.get(id)!
    pending.delete(id)
    if (error) request.reject(error)
    else request.resolve({ opened: true })
  }
  return { launcher, native, settle }
}

describe('shared Native Preview launching', () => {
  it('coalesces simultaneous opens of the same project revision and keeps surviving callers alive', async () => {
    const { launcher, native, settle } = fixture()
    const first = launcher.open('bundle-a', 'request-a', 'project-a')
    const second = launcher.open('bundle-a', 'request-b', 'project-a')
    const cancelled = expect(first).rejects.toBeInstanceOf(NativePreviewLaunchCancelled)
    launcher.cancel('request-a')
    await cancelled
    expect(native.openNativePreview).toHaveBeenCalledOnce()
    expect(native.cancelNativePreviewOpen).not.toHaveBeenCalled()
    settle('request-a')
    await expect(second).resolves.toEqual({ opened: true })
  })

  it('waits for cancellation to settle, skips superseded queued revisions, and opens the latest', async () => {
    const { launcher, native, settle } = fixture()
    const first = launcher.open('bundle-a', 'request-a', 'project-a')
    const firstCancelled = expect(first).rejects.toBeInstanceOf(NativePreviewLaunchCancelled)
    const second = launcher.open('bundle-b', 'request-b', 'project-a')
    const secondCancelled = expect(second).rejects.toBeInstanceOf(NativePreviewLaunchCancelled)
    const latest = launcher.open('bundle-c', 'request-c', 'project-a')
    await Promise.all([firstCancelled, secondCancelled])
    expect(native.cancelNativePreviewOpen).toHaveBeenCalledWith('request-a')
    expect(native.openNativePreview).toHaveBeenCalledOnce()
    settle('request-a', new Error('Native launch cancelled'))
    await vi.waitFor(() => expect(native.openNativePreview).toHaveBeenCalledTimes(2))
    expect(native.openNativePreview).toHaveBeenLastCalledWith('bundle-c', 'request-c', 'project-a')
    settle('request-c')
    await expect(latest).resolves.toEqual({ opened: true })
  })

  it('releases a stalled launch at its deadline so a later request can proceed', async () => {
    vi.useFakeTimers()
    const { launcher, native, settle } = fixture()
    native.cancelNativePreviewOpen.mockImplementation((id) => { settle(id, new Error('Cancelled')); return true })
    const timeout = expect(launcher.open('bundle-a', 'request-a', 'project-a')).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(1000)
    await timeout
    const retry = launcher.open('bundle-a', 'request-b', 'project-a')
    settle('request-b')
    await expect(retry).resolves.toEqual({ opened: true })
  })
})
