import { describe, expect, it } from 'vitest'
import { createTranscriptPositionCoordinator, isTranscriptNearEnd, shouldFollowTranscriptAfterUserScroll, shouldMaintainTranscriptVisiblePosition, transcriptEndOffset, transcriptHistoryWindow } from '../src/utils/transcript-position'

describe('transcript positioning', () => {
  it('calculates the exact current end without estimated row metrics', () => {
    expect(transcriptEndOffset(4_000, 800)).toBe(3_200)
    expect(transcriptEndOffset(600, 800)).toBe(0)
  })

  it('keeps converging while historical rows finish measuring', () => {
    const position = createTranscriptPositionCoordinator()
    expect(position.viewportSizeChanged(800)).toBeUndefined()
    expect(position.contentSizeChanged(4_000)).toBe(3_200)
    position.scrolled(3_050)
    expect(position.targetOffset()).toBe(3_200)
    expect(position.contentSizeChanged(4_800)).toBe(4_000)
    position.scrolled(3_900)
    expect(position.contentSizeChanged(5_200)).toBe(4_400)
  })

  it('cancels a queued follow when the user starts reading older rows', () => {
    const position = createTranscriptPositionCoordinator()
    position.viewportSizeChanged(800)
    expect(position.contentSizeChanged(4_000)).toBe(3_200)
    position.userScrollBegan()
    expect(position.targetOffset()).toBeUndefined()
    position.scrolled(1_400)
    expect(position.contentSizeChanged(4_800)).toBeUndefined()
    expect(position.userScrollEnded(false)).toBeUndefined()
    expect(position.contentSizeChanged(5_000)).toBeUndefined()
  })

  it('recomputes the exact end when the viewport changes', () => {
    const position = createTranscriptPositionCoordinator()
    position.contentSizeChanged(4_000)
    expect(position.viewportSizeChanged(800)).toBe(3_200)
    position.scrolled(3_200)
    expect(position.viewportSizeChanged(600)).toBe(3_400)
    position.scrolled(3_400)
    expect(position.viewportSizeChanged(1_000)).toBe(3_000)
  })

  it('resumes following only when a user gesture ends within one pixel', () => {
    const position = createTranscriptPositionCoordinator()
    position.viewportSizeChanged(800)
    position.contentSizeChanged(4_000)
    position.userScrollBegan()
    position.scrolled(3_198)
    expect(position.userScrollEnded(false)).toBeUndefined()
    position.userScrollBegan()
    position.scrolled(3_199)
    expect(position.userScrollEnded(false)).toBe(3_200)
    expect(position.contentSizeChanged(4_400)).toBe(3_600)
  })

  it('waits for user momentum and ignores programmatic momentum as user intent', () => {
    const position = createTranscriptPositionCoordinator()
    position.viewportSizeChanged(800)
    position.contentSizeChanged(4_000)
    position.userScrollBegan()
    position.scrolled(2_800)
    expect(position.userScrollEnded(true)).toBeUndefined()
    expect(position.contentSizeChanged(4_400)).toBeUndefined()
    position.scrolled(3_600)
    expect(position.momentumScrollEnded()).toBe(3_600)

    position.scrolled(2_000)
    expect(position.momentumScrollEnded()).toBe(3_600)
    expect(position.contentSizeChanged(4_800)).toBe(4_000)
  })

  it('stops following when earlier history is prepended', () => {
    const position = createTranscriptPositionCoordinator()
    position.viewportSizeChanged(800)
    position.contentSizeChanged(4_000)
    position.stopFollowing()
    expect(position.targetOffset()).toBeUndefined()
    expect(position.contentSizeChanged(5_000)).toBeUndefined()
  })

  it('returns to the bottom on request and keeps following as rows finish measuring', () => {
    const position = createTranscriptPositionCoordinator()
    position.viewportSizeChanged(800)
    position.contentSizeChanged(4_000)
    position.userScrollBegan()
    position.scrolled(1_400)
    position.userScrollEnded(true)

    expect(position.startFollowing()).toBe(3_200)
    expect(position.momentumScrollEnded()).toBe(3_200)
    expect(position.contentSizeChanged(4_800)).toBe(4_000)

    position.userScrollBegan()
    position.scrolled(2_000)
    position.userScrollEnded(false)
    expect(position.contentSizeChanged(5_000)).toBeUndefined()
  })

  it('does not preserve a stale offset while an empty-session header changes after startup', () => {
    expect(shouldMaintainTranscriptVisiblePosition(0)).toBe(false)
    expect(shouldMaintainTranscriptVisiblePosition(1)).toBe(true)
  })

  it('distinguishes following the latest message from reading older transcript content', () => {
    expect(isTranscriptNearEnd(4_000, 800, 3_150)).toBe(true)
    expect(isTranscriptNearEnd(4_000, 800, 1_400)).toBe(false)
  })

  it('stops following when the user pulls away from the bottom', () => {
    expect(shouldFollowTranscriptAfterUserScroll(4_000, 800, 3_150)).toBe(false)
    expect(shouldFollowTranscriptAfterUserScroll(4_000, 800, 3_199)).toBe(true)
    expect(shouldFollowTranscriptAfterUserScroll(4_000, 800, 3_200)).toBe(true)
  })

  it('keeps the one-row boundary for a 121-item projected history and loads the next 16-item page', () => {
    expect(transcriptHistoryWindow(121, 120)).toEqual({ start: 1, hidden: 1 })
    expect(transcriptHistoryWindow(121, 120 + 16)).toEqual({ start: 0, hidden: 0 })
  })
})
