import { renderSlot } from '#extensions'
import type { MobileModelProvider } from '@runwhale/mobile-protocol'
import { AppIcon } from './AppIcon'
import { Cpu } from './icons'
import { useAppColors } from '@/theme/tokens'

export function ProviderIcon({ provider, size = 18, color }: { provider: MobileModelProvider; size?: number; color?: string }) {
  const colors = useAppColors()
  const custom = renderSlot('model.icon', { provider, size, color })
  if (custom) return custom
  return <AppIcon icon={Cpu} color={color ?? colors.text} size={size} />
}
