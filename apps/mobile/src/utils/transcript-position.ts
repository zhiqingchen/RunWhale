export interface TranscriptPositionCoordinator {
  contentSizeChanged(height: number): void
  viewportSizeChanged(height: number): void
  scrolled(offsetY: number): void
  userScrollBegan(): void
  userScrollEnded(continuesWithMomentum: boolean): number | undefined
  momentumScrollEnded(): number | undefined
  startFollowing(): number | undefined
  startFollowingOldest(): number | undefined
  stopFollowing(): void
  targetOffset(): number | undefined
}

export function transcriptHistoryWindow(totalRows: number, visibleLimit: number): { start: number; hidden: number } {
  const total = Math.max(0, Math.floor(totalRows))
  const limit = Math.max(0, Math.floor(visibleLimit))
  const start = Math.max(0, total - limit)
  return { start, hidden: start }
}

export function isTranscriptAtBottom(offsetY: number): boolean {
  return offsetY <= 1
}

export function createTranscriptPositionCoordinator(): TranscriptPositionCoordinator {
  let offsetY = 0
  let contentHeight = 0
  let viewportHeight = 0
  let followingEdge: 'latest' | 'oldest' | undefined = 'latest'
  let userScrollPhase: 'idle' | 'dragging' | 'momentum' = 'idle'

  const targetOffset = (): number | undefined => {
    // The newest end is always zero, independent of row measurement or keyboard size.
    if (!followingEdge || userScrollPhase !== 'idle') return undefined
    return followingEdge === 'latest' ? 0 : Math.max(0, contentHeight - viewportHeight)
  }

  const settleUserScroll = () => {
    followingEdge = isTranscriptAtBottom(offsetY) ? 'latest' : undefined
  }

  return {
    contentSizeChanged(height) { contentHeight = height },
    viewportSizeChanged(height) { viewportHeight = height },
    scrolled(nextOffsetY) {
      offsetY = nextOffsetY
    },
    userScrollBegan() {
      followingEdge = undefined
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
      followingEdge = 'latest'
      userScrollPhase = 'idle'
      return targetOffset()
    },
    startFollowingOldest() {
      followingEdge = 'oldest'
      userScrollPhase = 'idle'
      return targetOffset()
    },
    stopFollowing() {
      followingEdge = undefined
      userScrollPhase = 'idle'
    },
    targetOffset,
  }
}
