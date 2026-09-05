import { describe, expect, it } from 'vitest'
import { createLatestOnlyWriter } from '../src/latest-only-writer.js'

describe('latest-only writer', () => {
  it('coalesces queued snapshots while preserving the active and newest writes', async () => {
    const written: number[] = []
    let releaseFirst!: () => void
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve })
    const writer = createLatestOnlyWriter<number>(async (value) => {
      written.push(value)
      if (value === 1) await firstBlocked
    })

    const first = writer.write(1)
    const second = writer.write(2)
    const newest = writer.write(3)
    expect(written).toEqual([1])

    releaseFirst()
    await Promise.all([first, second, newest])
    expect(written).toEqual([1, 3])
  })

  it('starts a fresh drain after the previous one completes', async () => {
    const written: string[] = []
    const writer = createLatestOnlyWriter<string>(async (value) => { written.push(value) })

    await writer.write('first')
    await writer.write('second')
    expect(written).toEqual(['first', 'second'])
  })
})
