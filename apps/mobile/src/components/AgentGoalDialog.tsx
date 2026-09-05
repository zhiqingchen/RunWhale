import { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { Alert } from 'heroui-native/alert'
import type { AgentGoal } from '@runwhale/mobile-protocol'
import { AppDialog } from '@/components/AppDialog'
import { useI18n } from '@/i18n'
import { type ThemeColors, useAppColors } from '@/theme/tokens'

type GoalMutationAction = 'create' | 'edit' | 'pause' | 'resume' | 'clear'
type GoalFormAction = Extract<GoalMutationAction, 'create' | 'edit'>

export function AgentGoalDialog({
  open,
  goal,
  busyAction,
  error,
  sessionReady,
  suggestedObjective,
  onOpenChange,
  onMutate,
}: {
  open: boolean
  goal?: AgentGoal
  busyAction?: GoalMutationAction
  error?: string
  sessionReady: boolean
  suggestedObjective?: string
  onOpenChange(open: boolean): void
  onMutate(action: GoalFormAction, objective?: string): Promise<boolean>
}) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const [objective, setObjective] = useState(goal?.objective ?? '')
  const wasOpen = useRef(false)

  useEffect(() => {
    if (open && !wasOpen.current) setObjective(suggestedObjective ?? goal?.objective ?? '')
    wasOpen.current = open
  }, [goal?.id, open, suggestedObjective])

  const formValid = Boolean(objective.trim())
  const busy = Boolean(busyAction)
  const primaryAction: GoalFormAction = goal && goal.phase !== 'complete' ? 'edit' : 'create'
  const phaseLabel = goal ? {
    active: t('goalPhaseActive'),
    paused: t('goalPhasePaused'),
    blocked: t('goalPhaseBlocked'),
    complete: t('goalPhaseComplete'),
  }[goal.phase] : ''

  const submit = async () => {
    if (!formValid || busy || !sessionReady) return
    if (await onMutate(primaryAction, objective.trim())) onOpenChange(false)
  }

  return <AppDialog
    open={open}
    onOpenChange={onOpenChange}
    title={primaryAction === 'edit' ? t('editGoal') : t('createGoal')}
    description={primaryAction === 'edit' ? t('goalSettingsDescription') : t('goalCreateDescription')}
    closeLabel={t('cancel')}
    dismissible={!busy}
    error={error}
    actions={[
      { label: t('cancel'), tone: 'cancel', disabled: busy, onPress: () => onOpenChange(false) },
      { label: primaryAction === 'edit' ? t('save') : t('createGoal'), tone: 'primary', loading: busyAction === primaryAction, disabled: busy || !formValid || !sessionReady, onPress: () => { void submit() }, testID: 'agent-goal-submit' },
    ]}
    testID="agent-goal-dialog"
  >
    {goal ? <GoalStatus goal={goal} statusLabel={t('goalStatus')} phaseLabel={phaseLabel} roundsLabel={t('goalRounds', { current: goal.roundsStarted, max: goal.maxGoalRounds })} colors={colors} styles={styles} /> : null}
    <View style={styles.field}>
      <Text style={styles.label}>{t('goalObjectiveLabel')}</Text>
      <TextInput
        value={objective}
        onChangeText={setObjective}
        multiline
        editable={!busy}
        accessibilityLabel={t('goalObjectiveLabel')}
        accessibilityState={{ disabled: busy }}
        placeholder={t('goalObjective')}
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        style={[styles.input, styles.objectiveInput]}
      />
      <Text style={styles.help}>{t('goalObjectiveHelp')}</Text>
    </View>
    {!sessionReady ? <Alert accessibilityRole="alert" status="warning" style={styles.sessionAlert}>
      <Alert.Indicator iconProps={{ size: 17 }} />
      <Alert.Content><Alert.Description>{t('goalRequiresSession')}</Alert.Description></Alert.Content>
    </Alert> : null}
  </AppDialog>
}

function GoalStatus({ goal, statusLabel, phaseLabel, roundsLabel, colors, styles }: { goal: AgentGoal; statusLabel: string; phaseLabel: string; roundsLabel: string; colors: ThemeColors; styles: ReturnType<typeof createStyles> }) {
  const phaseColor = goal.phase === 'active' ? colors.accent : goal.phase === 'blocked' ? colors.warning : colors.muted
  return <View style={styles.statusCard}>
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{statusLabel}</Text>
      <View style={styles.statusPill}><View style={[styles.statusDot, { backgroundColor: phaseColor }]} /><Text style={styles.statusValue}>{phaseLabel}</Text></View>
    </View>
    <Text style={styles.roundProgress}>{roundsLabel}</Text>
    {goal.blockedReason?.message ? <Text style={styles.blockedReason}>{goal.blockedReason.message}</Text> : null}
  </View>
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  statusCard: { padding: 14, gap: 8, borderRadius: 14, backgroundColor: colors.raised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  statusLabel: { color: colors.text, fontSize: 12, fontWeight: '800' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: colors.panel, paddingHorizontal: 10, paddingVertical: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusValue: { color: colors.text, fontSize: 11, fontWeight: '800' },
  roundProgress: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  blockedReason: { color: colors.warning, fontSize: 11, lineHeight: 16 },
  field: { gap: 7 },
  label: { color: colors.text, fontSize: 12, fontWeight: '800' },
  input: { width: '100%', borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.canvas, color: colors.text, fontSize: 14, paddingHorizontal: 13 },
  objectiveInput: { minHeight: 104, maxHeight: 168, paddingTop: 12, paddingBottom: 12, lineHeight: 20, textAlignVertical: 'top' },
  help: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  sessionAlert: { width: '100%' },
}) }
