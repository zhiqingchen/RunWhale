import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Button } from 'heroui-native/button'
import { Spinner } from 'heroui-native/spinner'
import { AppIcon } from './AppIcon'
import { FolderTree, RefreshCw } from './icons'
import { PendingButton } from './PendingButton'
import { useI18n } from '@/i18n'
import { controlSize, typeScale, type ThemeColors, useAppColors } from '@/theme/tokens'

export function ProjectLoadFailure({ retrying, disabled, onRetry, testID }: {
  retrying: boolean
  disabled: boolean
  onRetry(): void
  testID?: string
}) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  return <View style={styles.card} testID={testID}>
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.heading}>
      <View style={styles.icon}><AppIcon icon={FolderTree} color={colors.muted} size={21} /></View>
      <View style={styles.copy}>
        <Text style={styles.title}>{t('projectLoadFailedTitle')}</Text>
        <Text style={styles.description}>{t('projectLoadFailedDescription')}</Text>
      </View>
    </View>
    <PendingButton
      size="sm"
      variant="secondary"
      isPending={retrying}
      isDisabled={disabled}
      onPress={onRetry}
      style={styles.retry}
    >
      {({ isPending }) => <View style={styles.retryContent}>
        {isPending ? <Spinner color={colors.accent} size="sm" /> : <AppIcon icon={RefreshCw} color={colors.accent} size={15} />}
        <Button.Label style={styles.retryLabel}>{t('retry')}</Button.Label>
      </View>}
    </PendingButton>
  </View>
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  card: { width: '100%', padding: 18, gap: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 5 },
  title: { color: colors.text, fontSize: typeScale.heading, lineHeight: 21, fontWeight: '700' },
  description: { color: colors.muted, fontSize: typeScale.label, lineHeight: 18 },
  retry: { alignSelf: 'flex-end', height: controlSize.regular, minHeight: controlSize.regular, borderRadius: 12, paddingHorizontal: 16, backgroundColor: colors.accentDeep, alignItems: 'center', justifyContent: 'center' },
  retryContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  retryLabel: { color: colors.accent, fontSize: typeScale.label, lineHeight: 18, fontWeight: '700' },
}) }
