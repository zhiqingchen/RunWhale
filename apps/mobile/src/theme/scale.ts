export const radius = { small: 8, medium: 14, large: 22 } as const

export const typeScale = {
  pageTitle: 26,
  display: 22,
  title: 18,
  heading: 15,
  body: 14,
  label: 12,
  caption: 11,
  micro: 10,
  button: 14,
} as const

export const topLevelPageTitleStyle = {
  fontSize: typeScale.pageTitle,
  lineHeight: 32,
  fontWeight: '900',
  letterSpacing: -0.7,
} as const

export const topLevelScreenLayout = {
  topPadding: 12,
  headerMinHeight: 60,
} as const

export const controlSize = {
  compact: 36,
  regular: 44,
  prominent: 48,
} as const
