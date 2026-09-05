import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Button } from 'heroui-native/button'
import { Spinner } from 'heroui-native/spinner'
import type { AgentGoal } from '@runwhale/mobile-protocol'
import { AppIcon } from '@/components/AppIcon'
import { Pause, Pencil, Play, Target, Trash2 } from '@/components/icons'
import { PendingButton } from '@/components/PendingButton'
import { useI18n } from '@/i18n'
import { type ThemeColors, useAppColors } from '@/theme/tokens'

type GoalMutationAction = 'create' | 'edit' | 'pause' | 'resume' | 'clear'

export function AgentGoalBar({ goal, sessionReady, busyAction, error, onEdit, onPause, onResume, onClear }: {
  goal?: AgentGoal
  sessionReady: boolean
  busyAction?: GoalMutationAction
  error?: string
  onEdit(): void
  onPause(): void
  onResume(): void
  onClear(): void
}) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  if (!goal || goal.phase === 'complete') return null

  const phaseLabel = {
    active: t('goalBarActive'),
    paused: t('goalBarPaused'),
    blocked: t('goalBarBlocked'),
  }[goal.phase]
  const busy = Boolean(busyAction) || !sessionReady
  const visibleError = error ?? (!sessionReady ? t('goalRequiresSession') : undefined)
  const canPause = goal.phase === 'active' && goal.activation !== 'disarmed'
  const canResume = goal.phase === 'paused' || goal.phase === 'blocked' || (goal.phase === 'active' && goal.activation === 'disarmed')

  return <View testID="agent-goal-bar" style={styles.bar}>
    <View style={styles.goalIcon}><AppIcon icon={Target} color={colors.accent} size={16} /></View>
    <View style={styles.copy}>
      <Text style={styles.phase}>{phaseLabel}</Text>
      <Text numberOfLines={1} style={styles.objective}>{goal.objective}</Text>
      {goal.phase === 'blocked' && goal.blockedReason?.message ? <Text numberOfLines={1} style={styles.blockedReason}>{goal.blockedReason.message}</Text> : null}
      {visibleError ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" numberOfLines={2} style={styles.error}>{visibleError}</Text> : null}
    </View>
    <View style={styles.actions}>
      {canPause ? <PendingButton
        isIconOnly
        size="sm"
        variant="ghost"
        accessibilityLabel={t('pauseGoal')}
        isPending={busyAction === 'pause'}
        isDisabled={busy}
        onPress={onPause}
        style={styles.action}
      >{({ isPending }) => isPending ? <Spinner size="sm" color={colors.muted} /> : <AppIcon icon={Pause} color={colors.muted} size={16} />}</PendingButton> : null}
      {canResume ? <PendingButton
        isIconOnly
        size="sm"
        variant="ghost"
        accessibilityLabel={t('resumeGoal')}
        isPending={busyAction === 'resume'}
        isDisabled={busy}
        onPress={onResume}
        style={styles.action}
      >{({ isPending }) => isPending ? <Spinner size="sm" color={colors.muted} /> : <AppIcon icon={Play} color={colors.muted} size={16} />}</PendingButton> : null}
      <Button isIconOnly size="sm" variant="ghost" accessibilityLabel={t('editGoal')} isDisabled={busy} onPress={onEdit} style={styles.action}>
        <AppIcon icon={Pencil} color={colors.muted} size={16} />
      </Button>
      <PendingButton
        isIconOnly
        size="sm"
        variant="ghost"
        accessibilityLabel={t('clearGoal')}
        isPending={busyAction === 'clear'}
        isDisabled={busy}
        onPress={onClear}
        style={styles.action}
      >{({ isPending }) => isPending ? <Spinner size="sm" color={colors.muted} /> : <AppIcon icon={Trash2} color={colors.muted} size={16} />}</PendingButton>
    </View>
  </View>
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  bar: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 4, paddingVertical: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 13, backgroundColor: colors.raised },
  goalIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.accentDeep, alignItems: 'center', justifyContent: 'center' },
  copy: { minWidth: 0, flex: 1 },
  phase: { color: colors.text, fontSize: 11, lineHeight: 15, fontWeight: '800' },
  objective: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  blockedReason: { color: colors.warning, fontSize: 10, lineHeight: 14 },
  error: { color: colors.danger, fontSize: 10, lineHeight: 14 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  action: { width: 44, height: 44, minWidth: 44, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center' },
}) }
