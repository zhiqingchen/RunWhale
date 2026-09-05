import type { MobileModelProvider } from '@runwhale/mobile-protocol'
import { Anthropic, DeepSeek, Google, OpenAI, type RNIconProps } from '@lobehub/icons-rn'
import type { ComponentType } from 'react'

type ProviderIconDefinition = {
  ColorIcon?: ComponentType<RNIconProps>
  Icon: ComponentType<RNIconProps>
  color: string
}

const providerIcons = {
  anthropic: { Icon: Anthropic, color: Anthropic.colorPrimary },
  deepseek: { ColorIcon: DeepSeek.Color, Icon: DeepSeek, color: DeepSeek.colorPrimary },
  google: { ColorIcon: Google.Color, Icon: Google, color: Google.colorPrimary },
  openai: { Icon: OpenAI, color: OpenAI.colorPrimary },
} satisfies Record<MobileModelProvider, ProviderIconDefinition>

export function ProviderLogo({ provider, size = 18, color }: { provider: MobileModelProvider; size?: number; color?: string }) {
  const { ColorIcon, Icon, color: defaultColor } = providerIcons[provider] as ProviderIconDefinition
  const Logo = color || !ColorIcon ? Icon : ColorIcon

  return <Logo accessibilityLabel={provider} color={color ?? (ColorIcon ? undefined : defaultColor)} size={size} />
}
