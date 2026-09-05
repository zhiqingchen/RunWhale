import { describe, expect, it } from 'vitest'
import { settingsControlColors, settingsControlColorsFor } from '../src/theme/settings-control-colors'
import { colors, darkColors } from '../src/theme/palettes'

describe('Settings control contrast', () => {
  it.each(Object.entries(settingsControlColors))('%s theme keeps control text readable', (_name, theme) => {
    expect(contrast(theme.primaryForeground, theme.primaryBackground)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(theme.choiceForeground, theme.choiceBackground)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(theme.choiceSelectedForeground, theme.choiceSelectedBackground)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(theme.dangerSoftForeground, theme.dangerSoftBackground)).toBeGreaterThanOrEqual(4.5)
    const panel = _name === 'dark' ? darkColors.panel : colors.panel
    expect(contrast(theme.successForeground, panel)).toBeGreaterThanOrEqual(4.5)
  })

  it('selects the semantic control palette from the app theme', () => {
    expect(settingsControlColorsFor(colors)).toBe(settingsControlColors.light)
    expect(settingsControlColorsFor(darkColors)).toBe(settingsControlColors.dark)
    expect(settingsControlColors.light.choiceBackground).toBe(colors.canvas)
    expect(settingsControlColors.dark.choiceBackground).toBe(darkColors.canvas)
  })
})

function contrast(foreground: string, background: string): number {
  const foregroundLuminance = luminance(foreground)
  const backgroundLuminance = luminance(background)
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g)
  if (!channels || channels.length !== 3) throw new Error(`invalid color: ${hex}`)
  const [red, green, blue] = channels.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!
}
