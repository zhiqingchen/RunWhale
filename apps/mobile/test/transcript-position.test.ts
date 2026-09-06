import { describe, expect, it } from 'vitest'
import { createTranscriptPositionCoordinator, isTranscriptAtBottom, transcriptHistoryWindow } from '../src/utils/transcript-position'

describe('transcript positioning', () => {
  it('starts at the latest message without waiting for content measurements', () => {
    const position = createTranscriptPositionCoordinator()
    expect(position.targetOffset()).toBe(0)
    expect(isTranscriptAtBottom(0)).toBe(true)
    expect(isTranscriptAtBottom(1)).toBe(true)
    expect(isTranscriptAtBottom(80)).toBe(false)
  })

  it('stops following while the user reads older messages, including momentum', () => {
    const position = createTranscriptPositionCoordinator()
    position.userScrollBegan()
    position.scrolled(800)
    expect(position.targetOffset()).toBeUndefined()
    expect(position.userScrollEnded(true)).toBeUndefined()
    position.scrolled(1_200)
    expect(position.momentumScrollEnded()).toBeUndefined()
    expect(position.targetOffset()).toBeUndefined()
  })

  it('resumes following only when a user gesture ends within one pixel of the bottom', () => {
    const position = createTranscriptPositionCoordinator()
    position.userScrollBegan()
    position.scrolled(2)
    expect(position.userScrollEnded(false)).toBeUndefined()
    position.userScrollBegan()
    position.scrolled(1)
    expect(position.userScrollEnded(true)).toBeUndefined()
    position.scrolled(0)
    expect(position.momentumScrollEnded()).toBe(0)
  })

  it('keeps the reader in place during pagination and follows again on request', () => {
    const position = createTranscriptPositionCoordinator()
    position.stopFollowing()
    expect(position.targetOffset()).toBeUndefined()
    expect(position.startFollowing()).toBe(0)
    expect(position.momentumScrollEnded()).toBe(0)
    expect(transcriptHistoryWindow(121, 120)).toEqual({ start: 1, hidden: 1 })
    expect(transcriptHistoryWindow(121, 136)).toEqual({ start: 0, hidden: 0 })
  })

  it('finishes an explicit jump to the oldest loaded message as rows measure', () => {
    const position = createTranscriptPositionCoordinator()
    position.viewportSizeChanged(800)
    position.contentSizeChanged(4_000)
    expect(position.startFollowingOldest()).toBe(3_200)
    position.contentSizeChanged(5_200)
    expect(position.targetOffset()).toBe(4_400)
    position.stopFollowing()
    position.contentSizeChanged(6_000)
    expect(position.targetOffset()).toBeUndefined()
  })
})
