import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { AppDialog } from './AppDialog'
import { AppIcon } from './AppIcon'
import { Bot, CircleX } from './icons'
import { useI18n } from '@/i18n'
import { type ThemeColors, useAppColors } from '@/theme/tokens'
import { nativePreviewDiagnosticSummary, previewRepairMessage } from '@/utils/preview-diagnostic'

export function PreviewErrorDialog({ error, agentNotified, onClose, onRepair }: {
  error?: string
  agentNotified: boolean
  onClose(): void
  onRepair(prompt: string): void
}) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const diagnostic = nativePreviewDiagnosticSummary(error)
  const repairMessage = previewRepairMessage(error)
  return <AppDialog
    compact
    open={Boolean(error)}
    onOpenChange={(open) => { if (!open) onClose() }}
    title={t('previewBuildFailed')}
    closeLabel={t('close')}
    actions={repairMessage ? [{
      label: t(agentNotified ? 'viewAgent' : 'fixWithAgent'),
      tone: 'primary',
      testID: 'preview-fix-with-agent',
      onPress: () => {
        onClose()
        onRepair(agentNotified ? '' : t('fixPreviewPrompt', { message: repairMessage }))
      },
    }] : []}
    testID="preview-error-dialog"
  >
    <View style={styles.details}>
      <View style={styles.detailsHeading}>
        <AppIcon icon={CircleX} color={colors.danger} size={15} />
        <Text style={styles.detailsLabel}>{t('previewErrorDetails')}</Text>
      </View>
      <Text selectable style={styles.message}>{diagnostic?.message}</Text>
    </View>
    {agentNotified ? <View style={styles.notice}>
      <AppIcon icon={Bot} color={colors.accent} size={16} />
      <Text style={styles.noticeText}>{t('previewAgentNotified')}</Text>
    </View> : null}
  </AppDialog>
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  details: { padding: 12, gap: 8, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.canvas },
  detailsHeading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  detailsLabel: { color: colors.muted, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  message: { color: colors.text, fontSize: 12, lineHeight: 18 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noticeText: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 18 },
}) }
