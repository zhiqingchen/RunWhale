import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { watchTransportRecovery } from '../src/transport-recovery.js'

const cleanup: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function mailbox() {
  const directory = await mkdtemp(join(tmpdir(), 'runwhale-transport-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  return {
    directory,
    async write(id: string, revision: number) {
      const file = join(directory, 'transport-recovery.json')
      await writeFile(`${file}.tmp`, JSON.stringify({ id, revision }))
      await rename(`${file}.tmp`, file)
    },
  }
}

it('handles an early native request and serializes atomic replacements without losing the latest request', async () => {
  const box = await mailbox()
  await box.write('early', 1)
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const recovered: string[] = []
  let active = 0
  const onError = vi.fn()
  cleanup.push(watchTransportRecovery(box.directory, async (request) => {
    expect(++active).toBe(1)
    recovered.push(request.id)
    if (request.id === 'early') await held
    active -= 1
  }, onError))
  await vi.waitFor(() => expect(recovered).toEqual(['early']), { timeout: 3_000 })
  await box.write('middle', 2)
  await box.write('latest', 3)
  release()
  await vi.waitFor(() => expect(recovered.at(-1)).toBe('latest'), { timeout: 3_000 })
  await box.write('latest', 3)
  await box.write('after-deduplication', 4)
  await vi.waitFor(() => expect(recovered.at(-1)).toBe('after-deduplication'), { timeout: 3_000 })
  expect(recovered.filter((id) => id === 'latest')).toHaveLength(1)
  expect(onError).not.toHaveBeenCalled()
})

it('accepts a fresh Retry after a listener repair fails', async () => {
  const box = await mailbox()
  const recover = vi.fn().mockRejectedValueOnce(new Error('bind failed')).mockResolvedValue(undefined)
  const onError = vi.fn()
  cleanup.push(watchTransportRecovery(box.directory, recover, onError))
  await box.write('failed', 1)
  await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce(), { timeout: 3_000 })
  await box.write('retry', 2)
  await vi.waitFor(() => expect(recover).toHaveBeenLastCalledWith({ id: 'retry', revision: 2 }), { timeout: 3_000 })
})
