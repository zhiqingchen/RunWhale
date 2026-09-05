export const settingsLayout = {
  detailHorizontalPadding: 16,
  cardPadding: 14,
  optionGap: 8,
  providerButtonMinimumWidth: 140,
  minimumTouchTarget: 44,
  stackedRowFontScale: 1.5,
} as const

export function settingsProviderColumnCount(viewportWidth: number, fontScale = 1): 1 | 2 {
  const availableWidth = Math.max(0, viewportWidth - 2 * (settingsLayout.detailHorizontalPadding + settingsLayout.cardPadding))
  const scaledMinimumWidth = settingsLayout.providerButtonMinimumWidth * Math.max(1, fontScale)
  return availableWidth >= 2 * scaledMinimumWidth + settingsLayout.optionGap ? 2 : 1
}

export function settingsUseStackedRows(fontScale: number): boolean {
  return fontScale >= settingsLayout.stackedRowFontScale
}
