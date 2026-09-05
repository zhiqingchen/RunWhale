import { AppIcon } from '@/components/AppIcon'
import { PendingButton } from '@/components/PendingButton'
import { CircleX, History } from '@/components/icons'
import { useI18n } from '@/i18n'
import { controlSize, useAppColors } from '@/theme/tokens'
import type { AgentRecoveryState } from '@/utils/agent-recovery'
import { Button } from 'heroui-native/button'
import { Spinner } from 'heroui-native/spinner'
import { StyleSheet, Text, View } from 'react-native'

export function SessionRecoveryCard({ state, message, pending, onRetry }: {
  state: AgentRecoveryState
  message?: string
  pending: boolean
  onRetry(): void
}) {
  const { t } = useI18n()
  const colors = useAppColors()
  const failed = state === 'failed'
  const tone = failed ? colors.danger : colors.muted
  const title = t(state === 'paused' ? 'statePaused' : failed ? 'stateFailed' : state === 'aborted' ? 'stateAborted' : 'stateInterrupted')
  const fallback = t(state === 'paused' ? 'sessionPausedBody' : failed ? 'sessionFailedBody' : state === 'aborted' ? 'sessionStoppedBody' : 'sessionInterruptedBody')
  return <View style={[styles.card, { backgroundColor: colors.panel, borderColor: colors.border, borderLeftColor: tone }]}>
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.header}>
      <AppIcon icon={failed ? CircleX : History} color={tone} size={18} />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: tone }]}>{title}</Text>
        <Text selectable style={[styles.message, { color: colors.muted }]}>{message?.trim() || fallback}</Text>
      </View>
    </View>
    <PendingButton size="sm" variant="secondary" accessibilityLabel={t(state === 'paused' ? 'continueSession' : 'retry')} isPending={pending} onPress={onRetry} style={styles.retry} testID="agent-session-retry">
      {({ isPending }) => <View pointerEvents="none" style={[styles.retryContent, { backgroundColor: colors.accentDeep }]}>
        {isPending ? <Spinner size="sm" color={colors.blue} /> : null}
        <Button.Label style={[styles.retryLabel, { color: colors.blue }]}>{t(state === 'paused' ? 'continueSession' : 'retry')}</Button.Label>
      </View>}
    </PendingButton>
  </View>
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderLeftWidth: 3, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  header: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  copy: { flex: 1, gap: 4 },
  title: { fontSize: 13, fontWeight: '900' },
  message: { fontSize: 12, lineHeight: 18 },
  retry: { height: controlSize.regular, minHeight: controlSize.regular, minWidth: 64, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 9, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  retryContent: { minHeight: controlSize.compact, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  retryLabel: { fontSize: 12, lineHeight: 18, fontWeight: '800' },
})
