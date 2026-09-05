import { useColorScheme } from 'react-native'
import { colors, darkColors, type ThemeColors } from './palettes'
export { controlSize, radius, topLevelPageTitleStyle, topLevelScreenLayout, typeScale } from './scale'
export { colors, darkColors, type ThemeColors } from './palettes'

export function useAppColors(): ThemeColors {
  return useColorScheme() === 'dark' ? darkColors : colors
}
