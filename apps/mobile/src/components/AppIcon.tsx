import type { LucideIcon } from '@/components/icons'
import type { ColorValue } from 'react-native'

export function AppIcon({ icon: Icon, color, size = 16, strokeWidth = 2 }: {
  icon: LucideIcon
  color: ColorValue
  size?: number
  strokeWidth?: number
}) {
  return <Icon color={color as string} size={size} strokeWidth={strokeWidth} />
}
