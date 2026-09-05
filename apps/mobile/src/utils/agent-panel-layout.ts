import { controlSize } from '../theme/scale'

export const agentPanelInteractionContract = {
  minimumTouchTarget: controlSize.regular,
  composerControlVisualSize: controlSize.compact,
  composerHorizontalPadding: 8,
  composerTopPadding: 4,
  composerSectionGap: 3,
  composerBaseBottomPadding: 6,
  composerCardPadding: 7,
  composerCardBorderWidth: 1,
  composerCardGap: 3,
  composerCardRadius: 16,
  composerActionGap: 3,
} as const
