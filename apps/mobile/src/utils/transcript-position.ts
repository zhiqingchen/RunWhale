export const TRANSCRIPT_END_THRESHOLD = 80
export const TRANSCRIPT_USER_END_THRESHOLD = 1

export interface TranscriptPositionCoordinator {
  contentSizeChanged(height: number): number | undefined
  viewportSizeChanged(height: number): number | undefined
  scrolled(offsetY: number): void
  userScrollBegan(): void
  userScrollEnded(continuesWithMomentum: boolean): number | undefined
  momentumScrollEnded(): number | undefined
  startFollowing(): number | undefined
  stopFollowing(): void
  targetOffset(): number | undefined
}

export function transcriptHistoryWindow(totalRows: number, visibleLimit: number): { start: number; hidden: number } {
  const total = Math.max(0, Math.floor(totalRows))
  const limit = Math.max(0, Math.floor(visibleLimit))
  const start = Math.max(0, total - limit)
  return { start, hidden: start }
}

export function isTranscriptNearEnd(contentHeight: number, viewportHeight: number, offsetY: number, threshold = TRANSCRIPT_END_THRESHOLD): boolean {
  return Math.max(0, contentHeight - viewportHeight - offsetY) <= threshold
}

export function shouldFollowTranscriptAfterUserScroll(contentHeight: number, viewportHeight: number, offsetY: number): boolean {
  return isTranscriptNearEnd(contentHeight, viewportHeight, offsetY, TRANSCRIPT_USER_END_THRESHOLD)
}

export function transcriptEndOffset(contentHeight: number, viewportHeight: number): number {
  return Math.max(0, contentHeight - viewportHeight)
}

export function createTranscriptPositionCoordinator(): TranscriptPositionCoordinator {
  let contentHeight: number | undefined
  let viewportHeight: number | undefined
  let offsetY: number | undefined
  let followingLatest = true
  let userScrollPhase: 'idle' | 'dragging' | 'momentum' = 'idle'

  const targetOffset = (): number | undefined => {
    if (!followingLatest || userScrollPhase !== 'idle' || contentHeight === undefined || viewportHeight === undefined || viewportHeight <= 0) return undefined
    return transcriptEndOffset(contentHeight, viewportHeight)
  }

  const settleUserScroll = () => {
    followingLatest = contentHeight !== undefined
      && viewportHeight !== undefined
      && offsetY !== undefined
      && shouldFollowTranscriptAfterUserScroll(contentHeight, viewportHeight, offsetY)
  }

  return {
    contentSizeChanged(height) {
      contentHeight = height
      return targetOffset()
    },
    viewportSizeChanged(height) {
      viewportHeight = height
      return targetOffset()
    },
    scrolled(nextOffsetY) {
      offsetY = nextOffsetY
    },
    userScrollBegan() {
      followingLatest = false
      userScrollPhase = 'dragging'
    },
    userScrollEnded(continuesWithMomentum) {
      if (userScrollPhase !== 'dragging') return targetOffset()
      if (continuesWithMomentum) {
        userScrollPhase = 'momentum'
        return undefined
      }
      userScrollPhase = 'idle'
      settleUserScroll()
      return targetOffset()
    },
    momentumScrollEnded() {
      if (userScrollPhase === 'momentum') {
        userScrollPhase = 'idle'
        settleUserScroll()
      }
      return targetOffset()
    },
    startFollowing() {
      followingLatest = true
      userScrollPhase = 'idle'
      return targetOffset()
    },
    stopFollowing() {
      followingLatest = false
      userScrollPhase = 'idle'
    },
    targetOffset,
  }
}

export function shouldMaintainTranscriptVisiblePosition(rowCount: number): boolean {
  return rowCount > 0
}
