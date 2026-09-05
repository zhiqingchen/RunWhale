import { darkColors, type ThemeColors } from './palettes'

export const settingsControlColors = {
  light: {
    primaryBackground: '#2F5FDB',
    primaryForeground: '#FFFFFF',
    choiceBackground: '#F7F9FF',
    choiceForeground: '#626E91',
    choiceSelectedBackground: '#E9EEFF',
    choiceSelectedForeground: '#2F5FDB',
    dangerSoftBackground: '#FDEBEC',
    dangerSoftForeground: '#B52E4B',
    successForeground: '#168348',
  },
  dark: {
    primaryBackground: '#6D91FF',
    primaryForeground: '#090E1D',
    choiceBackground: '#090E1D',
    choiceForeground: '#98A5C8',
    choiceSelectedBackground: '#1B2B58',
    choiceSelectedForeground: '#6D91FF',
    dangerSoftBackground: '#3A1D25',
    dangerSoftForeground: '#FF718D',
    successForeground: '#52D98F',
  },
} as const

export function settingsControlColorsFor(colors: ThemeColors) {
  return colors.canvas === darkColors.canvas ? settingsControlColors.dark : settingsControlColors.light
}
