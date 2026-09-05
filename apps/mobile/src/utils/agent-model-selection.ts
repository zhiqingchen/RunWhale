import type { MobileModelProvider } from '@runwhale/mobile-protocol'

export const agentModelSelectorContract = {
  widthRatio: 0.42,
  minimumWidth: 84,
  maximumWidth: 168,
} as const

export function agentModelSelectorWidth(viewportWidth: number): number {
  const boundedViewportWidth = Math.max(0, viewportWidth)
  return Math.min(
    boundedViewportWidth,
    Math.max(
      Math.min(agentModelSelectorContract.minimumWidth, boundedViewportWidth),
      Math.min(agentModelSelectorContract.maximumWidth, Math.round(boundedViewportWidth * agentModelSelectorContract.widthRatio)),
    ),
  )
}

export function isMobileModelProvider(value: string): value is MobileModelProvider {
  return value === 'deepseek' || value === 'openai' || value === 'anthropic' || value === 'google'
}
