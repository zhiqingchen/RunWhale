export const settingsAccessibilityContract = {
  buttonRole: 'button',
  radioRole: 'radio',
} as const

export function settingsChoiceAccessibility(
  label: string,
  optionLabel: string,
  description?: string,
): { accessibilityLabel: string; accessibilityHint?: string } {
  return {
    accessibilityLabel: `${label}, ${optionLabel}`,
    ...(description ? { accessibilityHint: description } : {}),
  }
}

export function settingsRadioAccessibilityState(
  checked: boolean,
  operationalState: { busy?: boolean; disabled?: boolean } = {},
): { checked: boolean; busy?: boolean; disabled?: boolean } {
  return { ...operationalState, checked }
}
