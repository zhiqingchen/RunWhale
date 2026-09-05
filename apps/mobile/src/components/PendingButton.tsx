import type { ReactNode } from 'react'
import type { AccessibilityState } from 'react-native'
import { Button, type ButtonRootProps } from 'heroui-native/button'
import { actionProgressPresentation } from '@/utils/action-progress'

type PendingButtonBaseProps<T> = T extends unknown ? Omit<T, 'accessibilityState' | 'children'> : never

export interface PendingButtonRenderState {
  isPending: boolean
}

export type PendingButtonProps = PendingButtonBaseProps<ButtonRootProps> & {
  isPending?: boolean
  accessibilityState?: AccessibilityState
  children: ReactNode | ((state: PendingButtonRenderState) => ReactNode)
}

export function PendingButton({
  isPending = false,
  isDisabled = false,
  accessibilityLiveRegion,
  accessibilityState,
  children,
  ...props
}: PendingButtonProps) {
  const progress = actionProgressPresentation(isPending, !isDisabled && !accessibilityState?.disabled)
  const content = typeof children === 'function' ? children({ isPending }) : children

  return <Button
    key={isPending ? 'pending' : 'idle'}
    {...props}
    accessibilityLiveRegion={accessibilityLiveRegion ?? progress.accessibilityLiveRegion}
    accessibilityState={{ ...accessibilityState, ...progress.accessibilityState }}
    isDisabled={progress.accessibilityState.disabled}
  >
    {content}
  </Button>
}
