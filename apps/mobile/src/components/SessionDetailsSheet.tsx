import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Button } from 'heroui-native/button'
import { Spinner } from 'heroui-native/spinner'
import type { MobileAgentPreset, MobileModelProvider } from '@runwhale/mobile-protocol'
import { AppIcon } from './AppIcon'
import { Bot, Check, ChevronRight, Copy, FileText, ShieldCheck } from './icons'
import { PendingButton } from './PendingButton'
import { ProviderLogo } from './ProviderLogo'
import { TranscriptDetailsSheet } from './TranscriptDetailsSheet'
import { useClipboardCopyFeedback } from './TranscriptCodeBlock'
import { providerLabel } from '@/hooks/agent-panel-types'
import { useI18n } from '@/i18n'
import { type ThemeColors, useAppColors } from '@/theme/tokens'
import type { AgentSessionHistoryState } from '@/utils/agent-feedback'

export function SessionDetailsSheet({ open, onOpenChange, title, provider, model, preset, permissionLabel, planMode, systemPrompt, historyState, onRetry }: {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  provider: MobileModelProvider
  model: string
  preset: MobileAgentPreset
  permissionLabel: string
  planMode: boolean
  systemPrompt?: string
  historyState: AgentSessionHistoryState
  onRetry(): void
}) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const [showInstructions, setShowInstructions] = useState(false)
  const { copyState, copy } = useClipboardCopyFeedback(systemPrompt ?? '')
  useEffect(() => { if (open) setShowInstructions(false) }, [open])
  const reading = showInstructions && Boolean(systemPrompt)
  const canRetry = !systemPrompt && historyState === 'failed'
  const mode = t(preset === 'minimal' ? 'minimalPreset' : 'standardPreset')

  return <TranscriptDetailsSheet
    open={open}
    onOpenChange={onOpenChange}
    title={t(reading ? 'systemPrompt' : 'sessionDetails')}
    expanded={reading}
    minimumHeight={460}
    onBack={reading ? () => setShowInstructions(false) : undefined}
    testID="session-details-sheet"
    action={reading ? <PendingButton size="sm" variant="ghost" accessibilityLabel={t(copyState === 'copied' ? 'copied' : 'copy')} isPending={copyState === 'copying'} onPress={() => { void copy() }} testID="session-instructions-copy" style={styles.copyButton}>
      {({ isPending }) => <>{isPending ? <Spinner size="sm" color={colors.accent} /> : <AppIcon icon={copyState === 'copied' ? Check : Copy} color={colors.accent} size={16} />}<Button.Label style={styles.copyLabel}>{t(copyState === 'copied' ? 'copied' : 'copy')}</Button.Label></>}
    </PendingButton> : undefined}
  >
    {reading ? <ScrollView key="instructions" testID="session-instructions-text" style={styles.scroll} contentContainerStyle={styles.instructions} bounces={false}>
      <Text style={styles.caption}>{t('sessionInstructionsDescription')}</Text>
      {copyState === 'failed' ? <Text accessibilityRole="alert" style={styles.error}>{t('codeCopyFailed')}</Text> : null}
      <Text selectable style={styles.prompt}>{systemPrompt}</Text>
    </ScrollView> : <ScrollView key="overview" style={styles.scroll} contentContainerStyle={styles.overview} bounces={false}>
      <Text style={styles.sessionTitle}>{title}</Text>
      <View style={styles.configuration}>
        <View style={styles.row}>
          <View style={styles.rowIcon}><ProviderLogo provider={provider} size={20} color={colors.text} /></View>
          <View style={styles.rowText}><Text style={styles.label}>{t('model')} · {providerLabel(provider)}</Text><Text selectable style={styles.value}>{model}</Text></View>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <View style={styles.rowIcon}><AppIcon icon={Bot} color={colors.muted} size={19} /></View>
          <View style={styles.rowText}><Text style={styles.label}>{t('sessionRunMode')}</Text><Text style={styles.value}>{mode}{planMode ? ` · ${t('sessionPlanMode')}` : ''}</Text></View>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <View style={styles.rowIcon}><AppIcon icon={ShieldCheck} color={colors.muted} size={19} /></View>
          <View style={styles.rowText}><Text style={styles.label}>{t('permissionMode')}</Text><Text style={styles.value}>{permissionLabel}</Text></View>
        </View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={canRetry ? `${t('systemPrompt')} · ${t('retry')}` : t('systemPrompt')} accessibilityState={{ disabled: !systemPrompt && !canRetry }} disabled={!systemPrompt && !canRetry} onPress={canRetry ? onRetry : () => setShowInstructions(true)} testID="session-instructions-action" style={({ pressed }) => [styles.instructionsRow, pressed && styles.pressed]}>
        <View style={styles.instructionsIcon}><AppIcon icon={FileText} color={colors.accent} size={21} /></View>
        <View style={styles.rowText}>
          <Text style={styles.instructionsTitle}>{t('systemPrompt')}</Text>
          <Text style={styles.caption}>{t(systemPrompt ? 'sessionInstructionsDescription' : historyState === 'loading' ? 'restoringSessionHistory' : historyState === 'failed' ? 'sessionHistoryLoadFailed' : 'sessionInstructionsEmpty')}</Text>
        </View>
        {systemPrompt ? <AppIcon icon={ChevronRight} color={colors.accent} size={18} /> : historyState === 'loading' ? <Spinner size="sm" color={colors.accent} /> : canRetry ? <Text style={styles.copyLabel}>{t('retry')}</Text> : null}
      </Pressable>
    </ScrollView>}
  </TranscriptDetailsSheet>
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  scroll: { flex: 1 },
  overview: { padding: 16, gap: 14 },
  sessionTitle: { color: colors.text, fontSize: 18, lineHeight: 25, fontWeight: '800' },
  configuration: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.canvas, overflow: 'hidden' },
  row: { minHeight: 58, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowIcon: { width: 24, alignItems: 'center' },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  label: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  value: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  divider: { marginLeft: 50, backgroundColor: colors.border, height: StyleSheet.hairlineWidth },
  instructionsRow: { minHeight: 76, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: colors.accentDeep },
  instructionsIcon: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  instructionsTitle: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  caption: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  pressed: { opacity: 0.7 },
  instructions: { padding: 20, gap: 16 },
  prompt: { color: colors.text, fontSize: 15, lineHeight: 25 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  copyButton: { minHeight: 44, minWidth: 76, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  copyLabel: { color: colors.accent, fontSize: 12, fontWeight: '700' },
}) }
