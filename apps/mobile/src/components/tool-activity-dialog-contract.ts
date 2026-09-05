export const toolActivityDialogContract = {
  heightRatio: 0.5,
  minimumHeight: 240,
  maximumHeight: 520,
  cornerRadius: 24,
  headerPaddingLeft: 10,
  headerPaddingRight: 10,
  headerGap: 8,
  closeTargetSize: 44,
  toolRowMinimumHeight: 48,
} as const

export interface ToolActivityDialogSelection {
  activityId?: string
  itemId?: string
}

export type ToolActivityDialogSelectionAction =
  | { type: 'sync'; open: boolean; activityId?: string; initialItemId?: string }
  | { type: 'select'; activityId: string; itemId: string }
  | { type: 'back'; activityId: string }

export function toolActivityDialogSelectionReducer(
  state: ToolActivityDialogSelection,
  action: ToolActivityDialogSelectionAction,
): ToolActivityDialogSelection {
  if (action.type === 'select') return { activityId: action.activityId, itemId: action.itemId }
  if (action.type === 'back') return { activityId: action.activityId }
  if (!action.open || !action.activityId) return state.activityId === undefined && state.itemId === undefined ? state : {}
  if (state.activityId === action.activityId) return state
  return { activityId: action.activityId, ...(action.initialItemId ? { itemId: action.initialItemId } : {}) }
}

export function toolActivityDialogHeight(usableHeight: number): number {
  const boundedUsableHeight = Math.max(0, usableHeight)
  return Math.min(
    boundedUsableHeight,
    Math.max(
      Math.min(toolActivityDialogContract.minimumHeight, boundedUsableHeight),
      Math.min(toolActivityDialogContract.maximumHeight, Math.round(boundedUsableHeight * toolActivityDialogContract.heightRatio)),
    ),
  )
}
