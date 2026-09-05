import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Button } from 'heroui-native/button'
import { Spinner } from 'heroui-native/spinner'
import { ArrowLeft, ChevronDown, FolderTree, RefreshCw, Smartphone } from '@/components/icons'
import { AppIcon } from '@/components/AppIcon'
import { PendingButton } from '@/components/PendingButton'
import { type ThemeColors, useAppColors } from '@/theme/tokens'
import { useI18n } from '@/i18n'
import { projectSessionNavigationContract, projectSessionSurfaceActionState, type ProjectSessionSurface } from '@/utils/project-session-navigation'

export type { ProjectSessionSurface } from '@/utils/project-session-navigation'

const surfaceIcons = {
  files: FolderTree,
  preview: Smartphone,
} as const

export function ProjectSessionNavigation({
  title,
  status,
  statusMeta,
  statusActive,
  activeSurface = 'agent',
  onSurfaceChange,
  onPreviewRun,
  previewAvailable = false,
  onBack,
  backLabel,
  previewBusy = false,
  onOpenDetails,
}: {
  title: string
  status?: string
  statusMeta?: string
  statusActive: boolean
  activeSurface?: ProjectSessionSurface
  onSurfaceChange?(surface: ProjectSessionSurface): void
  onPreviewRun?(): void
  previewAvailable?: boolean
  onBack?(): void
  backLabel?: string
  previewBusy?: boolean
  onOpenDetails?(): void
}) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const surfaceLabel = (surface: 'files' | 'preview') => surface === 'files' ? t('files') : t('preview')

  return (
    <View style={styles.header}>
      {onBack ? <Button isIconOnly size="sm" variant="ghost" accessibilityLabel={backLabel ?? t('back')} onPress={onBack} style={styles.headerAction}><View style={styles.headerActionSurface}><AppIcon icon={ArrowLeft} color={colors.accent} size={21} /></View></Button> : null}
      <Pressable accessibilityRole={onOpenDetails ? 'button' : 'header'} accessibilityLabel={onOpenDetails ? `${title} · ${t('sessionDetails')}` : title} onPress={onOpenDetails} disabled={!onOpenDetails} testID="session-details-action" style={({ pressed }) => [styles.identity, pressed && styles.identityPressed]}>
        <View style={styles.titleRow}><Text numberOfLines={1} style={styles.title}>{title}</Text>{onOpenDetails ? <AppIcon icon={ChevronDown} color={colors.muted} size={13} /> : null}</View>
        {status ? <View style={styles.statusRow}><View style={[styles.statusDot, !statusActive && styles.statusDotIdle]} /><Text numberOfLines={1} style={styles.status}>{status}</Text>{statusMeta ? <Text numberOfLines={1} style={styles.statusMeta}>· {statusMeta}</Text> : null}</View> : null}
      </Pressable>
      {onSurfaceChange ? <View style={styles.surfaceActions}>
        {(['files', 'preview'] as const).map((surface) => {
          const actionState = projectSessionSurfaceActionState(activeSurface, surface, previewBusy)
          const selected = actionState.selected
          return <PendingButton
            key={surface}
            isIconOnly
            size="sm"
            variant="ghost"
            accessibilityLabel={surfaceLabel(surface)}
            accessibilityState={{ selected }}
            isPending={actionState.busy}
            onPress={() => onSurfaceChange(selected ? 'agent' : surface)}
            style={styles.surfaceAction}
          >{({ isPending }) => isPending
            ? <View style={[styles.surfaceActionSurface, selected && styles.surfaceActionActive]}><Spinner color={colors.accent} size="sm" /></View>
            : <View style={[styles.surfaceActionSurface, selected && styles.surfaceActionActive]}><AppIcon icon={surfaceIcons[surface]} color={selected ? colors.accent : colors.muted} size={17} /></View>}</PendingButton>
        })}
        {onPreviewRun ? <PendingButton
          isIconOnly
          size="sm"
          variant="ghost"
          testID="preview-run-action"
          accessibilityLabel={t('runReload')}
          isPending={previewBusy}
          isDisabled={!previewAvailable}
          onPress={onPreviewRun}
          style={styles.surfaceAction}
        >{({ isPending }) => <View style={styles.surfaceActionSurface}>{isPending ? <Spinner color={colors.accent} size="sm" /> : <AppIcon icon={RefreshCw} color={colors.muted} size={17} />}</View>}</PendingButton> : null}
      </View> : null}
    </View>
  )
}

export function localizedSessionState(state: string, t: ReturnType<typeof useI18n>['t']): string {
  if (state === 'completed') return t('stateCompleted')
  if (state === 'failed') return t('stateFailed')
  if (state === 'aborted') return t('stateAborted')
  if (state === 'paused') return t('statePaused')
  if (state === 'interrupted') return t('stateInterrupted')
  if (state === 'running') return t('stateRunning')
  return t('stateIdle')
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  header: { minHeight: projectSessionNavigationContract.headerMinHeight, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.panel },
  headerAction: { width: projectSessionNavigationContract.backActionSize, height: projectSessionNavigationContract.backActionSize, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center' },
  headerActionSurface: { width: projectSessionNavigationContract.actionVisualSize, height: projectSessionNavigationContract.actionVisualSize, alignItems: 'center', justifyContent: 'center' },
  identity: { flex: 1, minWidth: 0, height: 44, paddingHorizontal: 2, alignItems: 'flex-start', justifyContent: 'center', gap: 3 },
  identityPressed: { opacity: 0.65 },
  titleRow: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 5 },
  title: { minWidth: 0, flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: '900' },
  statusRow: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  statusDotIdle: { backgroundColor: colors.muted },
  status: { color: colors.accent, fontSize: 9, fontWeight: '900' },
  statusMeta: { minWidth: 0, flexShrink: 1, color: colors.muted, fontSize: 9 },
  surfaceActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  surfaceAction: { width: projectSessionNavigationContract.surfaceActionSize, height: projectSessionNavigationContract.surfaceActionSize, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center' },
  surfaceActionSurface: { width: projectSessionNavigationContract.actionVisualSize, height: projectSessionNavigationContract.actionVisualSize, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  surfaceActionActive: { backgroundColor: colors.accentDeep },
}) }
