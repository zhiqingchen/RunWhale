export type AppDialogActionTone = 'cancel' | 'primary' | 'danger'

export const appDialogVisualContract = {
  maxWidth: 420,
  viewportHorizontalPadding: 18,
  cornerRadius: 22,
  contentPadding: 20,
  contentGap: 18,
  headingGap: 12,
  closeTargetSize: 44,
  titleSize: 17,
  titleLineHeight: 23,
  descriptionSize: 12,
  descriptionLineHeight: 18,
  viewportVerticalPadding: 16,
  actionGap: 8,
  actionMinimumHeight: 44,
  actionHorizontalPadding: 16,
  actionVerticalPadding: 8,
  actionLabelLineHeight: 20,
  actionMinimumWidth: 112,
} as const

export function appDialogMaximumHeight(viewportHeight: number, insetTop: number, insetBottom: number): number {
  const availableHeight = viewportHeight - insetTop - insetBottom - 2 * appDialogVisualContract.viewportVerticalPadding
  return Math.max(appDialogVisualContract.actionMinimumHeight, availableHeight)
}

export function appDialogActionVariant(tone: AppDialogActionTone): 'ghost' | 'primary' | 'danger' {
  if (tone === 'danger') return 'danger'
  if (tone === 'primary') return 'primary'
  return 'ghost'
}
