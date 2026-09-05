export interface ActionProgressPresentation {
  showSpinner: boolean
  accessibilityLiveRegion: 'polite'
  accessibilityState: {
    busy: boolean
    disabled: boolean
  }
}

export const actionErrorPresentation = {
  accessibilityRole: 'alert',
  accessibilityLiveRegion: 'assertive',
  status: 'danger',
} as const

export interface ActionInFlightGuard {
  current: boolean
}

export async function runExclusiveAction<T>(guard: ActionInFlightGuard, action: () => Promise<T>): Promise<T | undefined> {
  if (guard.current) return undefined
  guard.current = true
  try {
    return await action()
  } finally {
    guard.current = false
  }
}

export function actionProgressPresentation(busy: boolean, available: boolean): ActionProgressPresentation {
  return {
    showSpinner: busy,
    accessibilityLiveRegion: 'polite',
    accessibilityState: {
      busy,
      disabled: busy || !available,
    },
  }
}
