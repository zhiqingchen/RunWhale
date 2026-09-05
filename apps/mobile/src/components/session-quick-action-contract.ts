export const sessionQuickActionDialogContract = {
  heightRatio: 0.5,
  minimumHeight: 240,
  maximumHeight: 520,
  cornerRadius: 24,
  headerMinimumHeight: 58,
  headerPaddingLeft: 18,
  headerPaddingRight: 10,
  headerGap: 8,
  closeTargetSize: 44,
  optionMinimumHeight: 48,
  spaciousOptionMinimumHeight: 64,
  spaciousOptionGap: 8,
  spaciousOptionIconSize: 40,
  spaciousContentPaddingTop: 16,
  spaciousContentPaddingBottom: 24,
} as const

export function sessionQuickActionDialogHeight(usableHeight: number): number {
  const boundedUsableHeight = Math.max(0, usableHeight)
  return Math.min(
    boundedUsableHeight,
    Math.max(
      Math.min(sessionQuickActionDialogContract.minimumHeight, boundedUsableHeight),
      Math.min(sessionQuickActionDialogContract.maximumHeight, Math.round(boundedUsableHeight * sessionQuickActionDialogContract.heightRatio)),
    ),
  )
}

export function sessionQuickActionDialogContentHeight(usableHeight: number, optionCount: number, bottomInset: number): number {
  const boundedUsableHeight = Math.max(0, usableHeight)
  const boundedOptionCount = Math.max(0, Math.floor(optionCount))
  const optionsHeight = boundedOptionCount * sessionQuickActionDialogContract.spaciousOptionMinimumHeight
    + Math.max(0, boundedOptionCount - 1) * sessionQuickActionDialogContract.spaciousOptionGap
  const desiredHeight = sessionQuickActionDialogContract.headerMinimumHeight
    + sessionQuickActionDialogContract.spaciousContentPaddingTop
    + optionsHeight
    + sessionQuickActionDialogContract.spaciousContentPaddingBottom
    + Math.max(0, bottomInset)

  return Math.min(boundedUsableHeight, sessionQuickActionDialogContract.maximumHeight, desiredHeight)
}
