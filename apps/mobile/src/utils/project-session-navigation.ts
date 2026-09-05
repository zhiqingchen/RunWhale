export type ProjectSessionSurface = 'agent' | 'files' | 'preview'

export const projectSessionNavigationContract = {
  headerMinHeight: 52,
  backActionSize: 44,
  surfaceActionSize: 44,
  actionVisualSize: 36,
} as const

export function projectSessionSurfaceActionState(
  activeSurface: ProjectSessionSurface,
  surface: 'files' | 'preview',
  previewBusy: boolean,
): { selected: boolean; busy: boolean; disabled: boolean } {
  const busy = surface === 'preview' && previewBusy
  return { selected: surface === activeSurface, busy, disabled: busy }
}
