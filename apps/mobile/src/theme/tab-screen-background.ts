import { Platform, type ViewStyle } from 'react-native'
import type { ThemeColors } from './palettes'

export function tabScreenBackground(colors: ThemeColors, tone: 'blue' | 'teal' | 'violet' | 'rose'): ViewStyle {
  const tints = {
    blue: [colors.accent, colors.blue, '#59CBCD'],
    teal: ['#31A9AF', colors.accent, '#75C5AF'],
    violet: [colors.blue, '#A885D9', colors.accent],
    rose: ['#BF83A8', colors.blue, '#79ADC9'],
  }
  const [primary, secondary, base] = tints[tone]
  const gradient = [
    `radial-gradient(ellipse 110% 70% at 0% 0%, ${primary}0F 0%, ${primary}00 100%)`,
    `radial-gradient(ellipse 95% 65% at 100% 30%, ${secondary}0A 0%, ${secondary}00 100%)`,
    `radial-gradient(ellipse 100% 55% at 10% 100%, ${base}08 0%, ${base}00 100%)`,
  ].join(', ')

  return {
    backgroundColor: colors.canvas,
    [Platform.OS === 'web' ? 'backgroundImage' : 'experimental_backgroundImage']: gradient,
  }
}
