export interface WebPreviewOverlayPresentation {
  mounted: boolean
  visible: boolean
  pointerEvents: 'auto' | 'none'
  accessibilityElementsHidden: boolean
  importantForAccessibility: 'auto' | 'no-hide-descendants'
}

export const webPreviewOverlayControlContract = {
  closeSize: 48,
  safeAreaGap: 8,
  feedbackVariant: 'scale-highlight' as const,
}

export interface WebPreviewControlPosition {
  x: number
  y: number
}

export interface WebPreviewControlInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export function webPreviewControlInitialPosition(
  viewport: { width: number; height: number },
  insets: WebPreviewControlInsets,
): WebPreviewControlPosition {
  return clampWebPreviewControlPosition({ x: viewport.width, y: insets.top }, viewport, insets)
}

export function clampWebPreviewControlPosition(
  position: WebPreviewControlPosition,
  viewport: { width: number; height: number },
  insets: WebPreviewControlInsets,
): WebPreviewControlPosition {
  const { closeSize, safeAreaGap } = webPreviewOverlayControlContract
  const minimumX = insets.left + safeAreaGap
  const minimumY = insets.top + safeAreaGap
  const maximumX = Math.max(minimumX, viewport.width - insets.right - safeAreaGap - closeSize)
  const maximumY = Math.max(minimumY, viewport.height - insets.bottom - safeAreaGap - closeSize)
  return {
    x: Math.min(maximumX, Math.max(minimumX, position.x)),
    y: Math.min(maximumY, Math.max(minimumY, position.y)),
  }
}

export function webPreviewOverlayPresentation(hasActivePreview: boolean, requestedVisible: boolean): WebPreviewOverlayPresentation {
  const visible = hasActivePreview && requestedVisible
  return {
    mounted: hasActivePreview,
    visible,
    pointerEvents: visible ? 'auto' : 'none',
    accessibilityElementsHidden: !visible,
    importantForAccessibility: visible ? 'auto' : 'no-hide-descendants',
  }
}
