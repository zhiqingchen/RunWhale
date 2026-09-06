import { useAgentViewport } from '@/hooks/useAgentViewport'
import { AgentGoalBar } from '@/components/AgentGoalBar'
import { AgentNotice } from '@/components/AgentNotice'
import { AgentGoalDialog } from '@/components/AgentGoalDialog'
import { AgentTodoDialog } from '@/components/AgentTodoDialog'
import { AgentTranscript, TranscriptRichText } from '@/components/AgentTranscript'
import { AppDialog } from '@/components/AppDialog'
import { AppIcon } from '@/components/AppIcon'
import { PendingButton } from '@/components/PendingButton'
import { ProviderLogo } from '@/components/ProviderLogo'
import { SessionQuickActionDialog } from '@/components/SessionQuickActionDialog'
import { SessionRecoveryCard } from '@/components/SessionRecoveryCard'
import { SessionDetailsSheet } from '@/components/SessionDetailsSheet'
import { ArrowDownToLine, ArrowUpToLine, AtSign, Check, ChevronDown, CircleDot, CornerDownRight, ListPlus, Plus, Trash2, X, Zap } from '@/components/icons'
import { providerLabel, type AgentPanelProps, type ApprovalResponseAction } from '@/hooks/agent-panel-types'
import { useAgentSession } from '@/hooks/useAgentSession'
import { useI18n } from '@/i18n'
import { radius, useAppColors, type ThemeColors } from '@/theme/tokens'
import { showAgentEmptyState } from '@/utils/agent-feedback'
import { localImageUri } from '@/utils/agent-image'
import { agentComposerBottomPadding, agentQuestionKeyboardClearance } from '@/utils/agent-keyboard'
import { agentModelSelectorWidth } from '@/utils/agent-model-selection'
import { agentPanelInteractionContract } from '@/utils/agent-panel-layout'
import { latestSessionSystemPrompt } from '@/utils/session-transcript'
import { isTranscriptAtBottom } from '@/utils/transcript-position'
import type { AgentQuestion, AgentQuestionAnswer, HostEvent } from '@runwhale/mobile-protocol'
import { Button } from 'heroui-native/button'
import { Portal } from 'heroui-native/portal'
import { Spinner } from 'heroui-native/spinner'
import { useEffect, useMemo, useState } from 'react'
import { BackHandler, Image, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FullWindowOverlay } from 'react-native-screens'

export function AgentPanel(props: AgentPanelProps) {
  const {
    running, stopping, error, credentialSetup, setCredentialSetup, sessionId,
    sessionRecord, sessionHistoryState, forkingBranch, planMode, planModeSubmitting, showGoal,
    setShowGoal, goalDraftObjective, setGoalDraftObjective, goal, goalMutationAction, goalError,
    setGoalError, sessionProvider, sessionModel, sessionAgentPreset, setSessionPermissionMode, pendingPermissionMode,
    setPendingPermissionMode, quickAction, setQuickAction, todoDialogOpen, setTodoDialogOpen, queueActions,
    pendingDestructiveAction, setPendingDestructiveAction, destructiveActionBusy, destructiveActionError, setDestructiveActionError, approvalResponseAction,
    approvalBusy, approvalError, permissionLabel, admissionSubmitting, primaryAction, imagePickerAvailable,
    transitionQueueAction, refreshSessionHistory, pendingAgentApproval, pendingQuestion, currentSessionEvents, visibleQueued,
    agentTodos, completedTodoCount, ongoingGoal, goalSessionReady, currentSubmittedPrompt,
    livePrompt, runConnectionIssue, sessionRetryAvailable, recoveryState, recoveryMessage, retryPending, quickActionOptions, retrySession, submit, stopAgent,
    forkSession, convertQueuedMessageToSteer, resolveAgentApproval, answerQuestion, setAgentPlanMode, mutateGoal,
    confirmDestructiveAction, dismissDestructiveAction, destructiveActionCopy, openQuickAction, selectQuickAction, openCredentialSettings,
    composer,
  } = useAgentSession(props)
  const { prompt, attachments, setAttachments, composerInputRef, updatePrompt, projectReferenceLoadState, projectReferenceError, loadProjectReferences, pickingImages } = composer
  const { safeAreaInsets, windowHeight, windowWidth, feedRef, transcriptRef, composerShortcutsRef, scrollOffset, transcriptAtBottom, setTranscriptAtBottom, questionInputFocused, setQuestionInputFocused, keyboardVisible, keyboardOverlap, rememberTranscriptPosition } = useAgentViewport(sessionId)
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const systemPrompt = useMemo(() => latestSessionSystemPrompt(currentSessionEvents), [currentSessionEvents])
  return <View style={[styles.root, keyboardOverlap > 0 && { paddingBottom: keyboardOverlap }]}>
    {props.onSessionDetailsOpenChange ? <SessionDetailsSheet
      key={`${props.projectId}:${sessionId ?? ''}`}
      projectId={props.projectId}
      sessionId={sessionId}
      open={Boolean(props.sessionDetailsOpen)}
      onOpenChange={props.onSessionDetailsOpenChange}
      title={props.sessionSummaries.find(session => session.sessionId === sessionId)?.title ?? sessionRecord?.title ?? t('newSession')}
      provider={sessionProvider}
      model={sessionModel}
      preset={sessionAgentPreset}
      permissionLabel={permissionLabel}
      planMode={planMode}
      systemPrompt={systemPrompt}
      historyState={sessionHistoryState}
      onRetry={() => { void refreshSessionHistory(sessionId).catch(() => undefined) }}
    /> : null}
    <AppDialog
      open={Boolean(credentialSetup)}
      onOpenChange={(open) => { if (!open) setCredentialSetup(undefined) }}
      title={t('agentCredentialRequiredTitle', { provider: providerLabel(credentialSetup ?? sessionProvider) })}
      description={t('agentCredentialRequiredBody', { provider: providerLabel(credentialSetup ?? sessionProvider) })}
      closeLabel={t('cancel')}
      actions={[
        { label: t('cancel'), tone: 'cancel', onPress: () => setCredentialSetup(undefined) },
        { label: t('openSettings'), tone: 'primary', onPress: openCredentialSettings, testID: 'agent-open-credential-settings' },
      ]}
      testID="agent-credential-required-dialog"
    />
    <AppDialog
      open={Boolean(pendingPermissionMode)}
      onOpenChange={(open) => { if (!open) setPendingPermissionMode(undefined) }}
      title={t('fullAccessConfirmationTitle')}
      description={t('fullAccessConfirmationBody')}
      closeLabel={t('cancel')}
      actions={[
        { label: t('cancel'), tone: 'cancel', onPress: () => setPendingPermissionMode(undefined) },
        { label: t('enableFullAccess'), tone: 'danger', onPress: () => { if (pendingPermissionMode) setSessionPermissionMode(pendingPermissionMode); setPendingPermissionMode(undefined) } },
      ]}
      testID="agent-full-access-dialog"
    />
    <AppDialog
      open={Boolean(pendingDestructiveAction)}
      onOpenChange={(open) => { if (!open) dismissDestructiveAction() }}
      title={destructiveActionCopy.title}
      description={destructiveActionCopy.description}
      closeLabel={t('cancel')}
      error={destructiveActionError}
      dismissible={!destructiveActionBusy}
      actions={[
        { label: t('cancel'), tone: 'cancel', disabled: destructiveActionBusy, onPress: dismissDestructiveAction },
        { label: destructiveActionCopy.confirmLabel, tone: destructiveActionCopy.contract.tone, loading: destructiveActionBusy, onPress: () => { void confirmDestructiveAction() }, testID: destructiveActionCopy.contract.actionTestID },
      ]}
      testID={destructiveActionCopy.contract.dialogTestID}
    />
    <AgentTodoDialog open={todoDialogOpen} todos={agentTodos ?? []} onOpenChange={setTodoDialogOpen} />
    <SessionQuickActionDialog
      open={Boolean(quickAction) && !(quickAction === 'reference' && projectReferenceLoadState !== 'ready')}
      onOpenChange={(open) => { if (!open) setQuickAction(undefined) }}
      title={quickAction === 'reference' ? t('references') : quickAction === 'command' ? t('commands') : quickAction === 'preset' ? t('defaultAgent') : quickAction === 'model' ? t('model') : quickAction === 'attachment' ? t('addImage') : t('permissionMode')}
      closeLabel={t('cancel')}
      options={quickActionOptions}
      emptyLabel={t('noReferences')}
      onSelect={selectQuickAction}
      fitContent={quickAction === 'attachment' || quickAction === 'command'}
      spacious={quickAction === 'attachment' || quickAction === 'command'}
      testID={quickAction ? `session-${quickAction}-dialog` : undefined}
    />
    <AppDialog
      open={quickAction === 'reference' && projectReferenceLoadState !== 'ready'}
      onOpenChange={(open) => { if (!open) setQuickAction(undefined) }}
      title={t('references')}
      closeLabel={t('cancel')}
      actions={projectReferenceLoadState === 'failed'
        ? [
            { label: t('cancel'), tone: 'cancel', onPress: () => setQuickAction(undefined) },
            { label: t('retry'), tone: 'primary', onPress: () => { void loadProjectReferences() } },
          ]
        : [{ label: t('cancel'), tone: 'cancel', onPress: () => setQuickAction(undefined) }]}
      testID="session-reference-feedback-dialog"
    >
      {projectReferenceLoadState === 'loading'
        ? <InlineProgress label={t('working')} />
        : <InlineError message={projectReferenceError ?? t('runtimeStartupFailedBody')} />}
    </AppDialog>
    <AgentGoalDialog
      open={showGoal}
      goal={goal}
      busyAction={goalMutationAction}
      error={goalError}
      sessionReady={goalSessionReady}
      suggestedObjective={goalDraftObjective}
      onOpenChange={(open) => { setShowGoal(open); if (!open) { setGoalError(undefined); setGoalDraftObjective(undefined) } }}
      onMutate={mutateGoal}
    />
    <AgentTranscript
      key={sessionId ?? 'new'}
      ref={transcriptRef}
      events={currentSessionEvents}
      livePrompt={livePrompt}
      liveWorkingLabel={running ? t('agentWorking') : undefined}
      followPaused={keyboardVisible && questionInputFocused}
      onBranch={sessionRecord ? (sequence) => { void forkSession(sequence) } : undefined}
      branching={forkingBranch}
      branchAvailable={!running}
      listRef={feedRef}
      onScroll={(event) => {
        const { contentOffset } = event.nativeEvent
        scrollOffset.current = contentOffset.y
        setTranscriptAtBottom(isTranscriptAtBottom(contentOffset.y))
      }}
      header={<>
      {sessionHistoryState === 'loading' && <View accessible accessibilityRole="progressbar" accessibilityLabel={t('restoringSessionHistory')} accessibilityLiveRegion="polite" style={styles.historyLoading}><Spinner size="sm" color={colors.accent} /><Text style={styles.historyLoadingText}>{t('restoringSessionHistory')}</Text></View>}
      {sessionHistoryState === 'failed' && <View style={styles.historyError}>
        <InlineError message={t('sessionHistoryLoadFailed')} />
        <Button size="sm" variant="secondary" onPress={() => { void refreshSessionHistory(sessionId).catch(() => undefined) }} style={styles.historyRetry}><Button.Label>{t('retry')}</Button.Label></Button>
      </View>}
      {showAgentEmptyState(sessionHistoryState, currentSessionEvents.length, running, currentSubmittedPrompt?.text ?? '') && <View
        accessible
        accessibilityLabel={`RunWhale. ${t('heroTitle')}`}
        style={[styles.emptyState, { marginTop: Math.min(104, Math.max(48, windowHeight * 0.1)) }]}
      >
        <Image source={require('../../assets/images/runwhale-adaptive-foreground.png')} resizeMode="contain" style={styles.emptyLogo} />
        <Text style={styles.emptyTagline}>{t('heroTitle')}</Text>
      </View>}
    </>}
      footer={<>
      {pendingQuestion && <QuestionCard key={pendingQuestion.sequence} event={pendingQuestion} busy={approvalBusy} pendingAction={approvalResponseAction} onInputFocus={() => { setQuestionInputFocused(true) }} onInputBlur={() => { setQuestionInputFocused(false) }} onAnswer={(answers) => { void answerQuestion(answers) }} />}
      {pendingQuestion && keyboardVisible && questionInputFocused ? <View style={styles.questionKeyboardClearance} /> : null}
      {approvalError && !pendingAgentApproval ? <InlineError message={approvalError} /> : null}
      {runConnectionIssue ? <AgentNotice connection message={t('agentConnectionInterrupted')} /> : sessionRetryAvailable && recoveryState
        ? <SessionRecoveryCard state={recoveryState} message={recoveryMessage} pending={retryPending} onOpenSettings={openCredentialSettings} onRetry={() => { void retrySession() }} />
        : error ? <InlineError message={error} /> : null}
    </>}
    />
    <View style={[styles.composer, { paddingBottom: agentComposerBottomPadding(safeAreaInsets.bottom, keyboardVisible) }]}>
      {pendingAgentApproval ? <AgentToolApprovalPopover
        event={pendingAgentApproval}
        busy={approvalBusy}
        pendingAction={approvalResponseAction}
        error={approvalError}
        onApprove={() => { void resolveAgentApproval(true) }}
        onReject={() => { void resolveAgentApproval(false) }}
      /> : null}
      {attachments.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachmentList}>{attachments.map((attachment, index) => <View key={`${attachment.sourcePath}-${index}`} accessibilityLabel={attachment.name} style={styles.attachmentPreview}>
        <Image source={{ uri: localImageUri(attachment.sourcePath) }} resizeMode="cover" style={styles.attachmentThumbnail} />
        <Button isIconOnly size="sm" variant="ghost" accessibilityLabel={t('delete')} accessibilityState={{ disabled: running || admissionSubmitting }} isDisabled={running || admissionSubmitting} onPress={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={styles.attachmentDelete}><View style={styles.attachmentDeleteSurface}><AppIcon icon={X} color="#FFFFFF" size={12} /></View></Button>
      </View>)}</ScrollView>}
      <AgentGoalBar
        goal={ongoingGoal}
        sessionReady={goalSessionReady}
        busyAction={goalMutationAction}
        error={goalError}
        onEdit={() => { Keyboard.dismiss(); setGoalError(undefined); setShowGoal(true) }}
        onPause={() => { void mutateGoal('pause') }}
        onResume={() => { void mutateGoal('resume') }}
        onClear={() => { void mutateGoal('clear') }}
      />
      {visibleQueued.length > 0 && <ScrollView
        style={styles.queue}
        contentContainerStyle={styles.queueList}
        showsVerticalScrollIndicator={visibleQueued.length > 3}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        {visibleQueued.map((message, index) => {
          const pendingAction = queueActions[message.messageId]
          const itemBusy = Boolean(pendingAction)
          const modeLabel = message.mode === 'steer' ? t('steer') : t('followup')
          return <View key={message.messageId} style={[styles.queueItem, index > 0 && styles.queueItemDivider]}>
            <View accessible accessibilityRole="text" accessibilityLabel={modeLabel} style={styles.queueMode}>
              <AppIcon icon={message.mode === 'steer' ? Zap : ListPlus} color={message.mode === 'steer' ? colors.blue : colors.muted} size={14} />
            </View>
            <Text numberOfLines={1} style={styles.queueText}>{message.text}</Text>
            {message.mode === 'followup' && <PendingButton
              isIconOnly
              size="sm"
              variant="ghost"
              accessibilityLabel={`${t('convertToSteer')}: ${message.text}`}
              accessibilityHint={t('busySteerDescription')}
              isPending={pendingAction === 'convert'}
              isDisabled={itemBusy}
              onPress={() => { void convertQueuedMessageToSteer(message) }}
              style={styles.queueIconButton}
            >
              {({ isPending }) => isPending ? <Spinner size="sm" color={colors.accent} /> : <AppIcon icon={CornerDownRight} color={colors.muted} size={16} />}
            </PendingButton>}
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              accessibilityLabel={`${t('delete')}: ${message.text}`}
              accessibilityState={{ disabled: itemBusy }}
              isDisabled={itemBusy}
              onPress={() => {
                if (!transitionQueueAction({ type: 'start', messageId: message.messageId, action: 'delete' })) return
                setDestructiveActionError(undefined)
                setPendingDestructiveAction({ kind: 'delete-queued-message', messageId: message.messageId })
              }}
              style={styles.queueIconButton}
            ><AppIcon icon={Trash2} color={colors.danger} size={15} /></Button>
          </View>
        })}
      </ScrollView>}
      <ScrollView ref={composerShortcutsRef} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.composerShortcuts}>
        {planMode ? <PendingButton
          size="sm"
          variant="ghost"
          accessibilityLabel={t('planModeOn')}
          accessibilityHint={t('commandPlanOff')}
          isPending={planModeSubmitting}
          isDisabled={planModeSubmitting}
          onPress={() => { void setAgentPlanMode(false) }}
          style={styles.shortcutChip}
        >{({ isPending }) => <View style={[styles.shortcutSurface, styles.shortcutSurfaceActive]}>{isPending ? <Spinner size="sm" color={colors.accent} /> : <AppIcon icon={ListPlus} color={colors.accent} size={13} />}<Button.Label style={styles.shortcutTextActive}>{t('planModeOn')}</Button.Label></View>}</PendingButton> : null}
        {agentTodos && completedTodoCount < agentTodos.length ? <Button
          testID="agent-todo-shortcut"
          size="sm"
          variant="ghost"
          accessibilityLabel={`${t('todo')}, ${t('todoProgress', { completed: completedTodoCount, total: agentTodos.length })}`}
          accessibilityState={{ expanded: todoDialogOpen }}
          onPress={() => { Keyboard.dismiss(); setTodoDialogOpen(true) }}
          style={styles.shortcutChip}
        ><View style={styles.shortcutSurface}><AppIcon icon={CircleDot} color={colors.accent} size={13} /><Button.Label style={styles.shortcutText}>{t('todo')} {completedTodoCount}/{agentTodos.length}</Button.Label></View></Button> : null}
        <Button size="sm" variant="ghost" accessibilityLabel={t('references')} isDisabled={admissionSubmitting} onPress={() => openQuickAction('reference')} style={styles.shortcutChip}><View style={styles.shortcutSurface}><AppIcon icon={AtSign} color={admissionSubmitting ? colors.muted : colors.text} size={13} /><Button.Label style={styles.shortcutText}>{t('references')}</Button.Label></View></Button>
        <Button size="sm" variant="ghost" accessibilityLabel={t('commands')} isDisabled={admissionSubmitting} onPress={() => openQuickAction('command')} style={styles.shortcutChip}><View style={styles.shortcutSurface}><Text style={styles.commandSlash}>/</Text><Button.Label style={styles.shortcutText}>{t('commands')}</Button.Label></View></Button>
        <Button size="sm" variant="ghost" accessibilityLabel={t('defaultAgent')} accessibilityState={{ disabled: running }} isDisabled={running} onPress={() => openQuickAction('preset')} style={styles.shortcutChip}><View style={styles.shortcutSurface}><Button.Label numberOfLines={1} style={styles.shortcutText}>{sessionAgentPreset === 'minimal' ? t('minimalPreset') : t('standardPreset')}</Button.Label></View></Button>
        <Button size="sm" variant="ghost" accessibilityLabel={t('permissionMode')} accessibilityState={{ disabled: running }} isDisabled={running} onPress={() => openQuickAction('permission')} style={[styles.shortcutChip, styles.permissionShortcut]}><View style={styles.shortcutSurface}><Button.Label numberOfLines={1} style={styles.shortcutText}>{permissionLabel}</Button.Label></View></Button>
        <Button
          testID="agent-scroll-shortcut"
          isIconOnly
          size="sm"
          variant="ghost"
          accessibilityLabel={t(transcriptAtBottom ? 'scrollToTop' : 'scrollToBottom')}
          onPress={() => transcriptAtBottom ? transcriptRef.current?.scrollToTop() : transcriptRef.current?.scrollToBottom()}
          style={[styles.shortcutChip, styles.shortcutIcon]}
        ><View style={[styles.shortcutSurface, styles.shortcutIconSurface]}><AppIcon icon={transcriptAtBottom ? ArrowUpToLine : ArrowDownToLine} color={colors.text} size={13} /></View></Button>
      </ScrollView>
      <View style={styles.composerCard}>
      <TextInput ref={composerInputRef} value={prompt} onChangeText={updatePrompt} onFocus={rememberTranscriptPosition} onBlur={rememberTranscriptPosition} onSubmitEditing={submit} multiline submitBehavior="submit" returnKeyType="send" editable={!admissionSubmitting} accessibilityLabel={t('agentMessageInput')} accessibilityState={{ disabled: admissionSubmitting }} placeholder={running ? t('queueAnotherMessage') : t('askAgent')} placeholderTextColor={colors.muted} style={styles.input} />
      <View style={styles.composerActions}>
        <PendingButton isIconOnly size="sm" variant="ghost" accessibilityLabel={t('addImage')} isPending={pickingImages} isDisabled={!imagePickerAvailable || admissionSubmitting} onPress={() => openQuickAction('attachment')} style={styles.addButton}>{({ isPending }) => <View style={styles.addButtonSurface}>{isPending ? <Spinner size="sm" color={colors.accent} /> : <AppIcon icon={Plus} color={imagePickerAvailable && !admissionSubmitting ? colors.text : colors.muted} size={18} />}</View>}</PendingButton>
        <View style={styles.composerSpacer} />
        <Button
          size="sm"
          variant="ghost"
          accessibilityLabel={`${t('model')}: ${providerLabel(sessionProvider)}, ${sessionModel}`}
          accessibilityState={{ disabled: false, expanded: quickAction === 'model' }}
          onPress={() => openQuickAction('model')}
          style={[styles.composerModelPicker, { width: agentModelSelectorWidth(windowWidth) }]}
        >
          <View style={styles.composerModelPickerSurface}>
            <ProviderLogo provider={sessionProvider} size={13} />
            <Button.Label numberOfLines={1} style={styles.composerModelPickerText}>{providerLabel(sessionProvider)} · {sessionModel}</Button.Label>
            <AppIcon icon={ChevronDown} color={colors.muted} size={10} />
          </View>
        </Button>
        <PendingButton isIconOnly size="sm" variant="ghost" accessibilityLabel={primaryAction.action === 'stop' ? (stopping ? t('stopping') : t('stop')) : (planModeSubmitting ? t('working') : t('send'))} isPending={primaryAction.pending} isDisabled={primaryAction.disabled} onPress={primaryAction.action === 'stop' ? () => { void stopAgent() } : submit} style={styles.send}>{({ isPending }) => <View style={styles.sendSurface}>{isPending ? <Spinner size="sm" color="#FFFFFF" /> : primaryAction.action === 'stop' ? <View style={styles.stopGlyph} /> : <Button.Label style={styles.sendText}>↑</Button.Label>}</View>}</PendingButton>
      </View>
      </View>
    </View>
  </View>
}

function InlineProgress({ label, emphasized = false }: { label: string; emphasized?: boolean }) {
  const colors = useAppColors()
  const styles = useAgentStyles()
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityLiveRegion="polite" style={[styles.inlineProgress, emphasized && styles.working]}>
    <Spinner size="sm" color={colors.accent} />
    <Text style={styles.workingText}>{label}</Text>
  </View>
}

function InlineError({ message }: { message: string }) {
  return <AgentNotice message={message} />
}

function AgentToolApprovalPopover({ event, busy, pendingAction, error, onApprove, onReject }: { event: HostEvent; busy: boolean; pendingAction?: ApprovalResponseAction; error?: string; onApprove(): void; onReject(): void }) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useAgentStyles()
  const safeAreaInsets = useSafeAreaInsets()
  const data = event.data as { requestId?: unknown; toolName?: unknown; reason?: unknown }
  const toolName = String(data.toolName ?? t('eventTool'))
  const reason = String(data.reason ?? '').trim()
  const isPackageInstall = toolName === 'package_install'
  useEffect(() => {
    Keyboard.dismiss()
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true)
    return () => subscription.remove()
  }, [event.sequence])
  const popover = <View
    accessibilityViewIsModal
    style={[styles.approvalPopoverPortal, { paddingTop: safeAreaInsets.top + 16, paddingBottom: safeAreaInsets.bottom + 16 }]}
    testID="agent-approval-popover-root"
  >
    <Pressable accessible={false} onPress={() => undefined} style={styles.approvalPopoverOverlay} />
    <View
      accessibilityRole="alert"
      testID={isPackageInstall ? 'agent-package-approval-popover' : 'agent-tool-approval-popover'}
      style={styles.approvalPopoverContent}
    >
      <Text accessibilityRole="header" style={styles.approvalTitle}>{t(isPackageInstall ? 'packageApprovalTitle' : 'toolApprovalTitle')}</Text>
      {isPackageInstall
        ? <Text style={styles.approvalDescription}>{t('packageApprovalDescription')}</Text>
        : reason ? <Text style={styles.approvalDescription}>{reason}</Text> : null}
      <Text style={isPackageInstall ? styles.packageChange : styles.toolApprovalName}>{isPackageInstall ? reason || toolName : toolName}</Text>
      {error ? <InlineError message={error} /> : null}
      <View style={styles.approvalActions}>
        <PendingButton accessibilityLabel={t('reject')} size="sm" variant="danger-soft" isPending={pendingAction === 'reject'} isDisabled={busy} onPress={onReject} style={styles.reject}>{({ isPending }) => <View style={styles.approvalActionContent}>{isPending ? <Spinner color={colors.danger} size="sm" /> : null}<Button.Label style={styles.rejectText}>{t('reject')}</Button.Label></View>}</PendingButton>
        <PendingButton accessibilityLabel={t('approveOnce')} size="sm" variant="primary" isPending={pendingAction === 'approve'} isDisabled={busy} onPress={onApprove} style={styles.approve}>{({ isPending }) => <View style={styles.approvalActionContent}>{isPending ? <Spinner color="#FFFFFF" size="sm" /> : null}<Button.Label style={styles.approveText}>{isPending ? t('working') : t('approveOnce')}</Button.Label></View>}</PendingButton>
      </View>
    </View>
  </View>
  return <Portal name={`agent-approval-${String(data.requestId ?? event.sequence)}`}>
    {Platform.OS === 'ios'
      ? <FullWindowOverlay unstable_accessibilityContainerViewIsModal>{popover}</FullWindowOverlay>
      : popover}
  </Portal>
}

function QuestionCard({ event, busy, pendingAction, onInputFocus, onInputBlur, onAnswer }: { event: HostEvent; busy: boolean; pendingAction?: ApprovalResponseAction; onInputFocus(): void; onInputBlur(): void; onAnswer(answers: AgentQuestionAnswer[]): void }) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const questions = (event.data as { questions?: AgentQuestion[] }).questions ?? []
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const choose = (question: AgentQuestion, label: string) => {
    if (busy) return
    setSelected((current) => {
      const prior = current[question.id] ?? []
      const next = question.multiSelect
        ? prior.includes(label) ? prior.filter((item) => item !== label) : [...prior, label]
        : prior.includes(label) ? [] : [label]
      return { ...current, [question.id]: next }
    })
  }
  const ready = questions.length > 0 && questions.every((question) => (selected[question.id]?.length ?? 0) > 0 || Boolean(custom[question.id]?.trim()))
  const submit = () => {
    if (busy || !ready) return
    onAnswer(questions.map((question) => ({
      id: question.id,
      selected: selected[question.id] ?? [],
      ...(custom[question.id]?.trim() ? { custom: custom[question.id]!.trim() } : {}),
    })))
  }
  return <View style={styles.questionCard}>
    <Text style={styles.approvalTitle}>{questions.some((question) => question.intent?.kind === 'plan-review') ? t('planReview') : t('agentQuestion')}</Text>
    {questions.map((question) => <View key={question.id} style={styles.questionItem}>
      {Boolean(question.header) && <Text style={styles.questionHeader}>{question.header}</Text>}
      <Text style={styles.questionText}>{question.question}</Text>
      {Boolean(question.detail) && <View style={styles.questionDetail}><TranscriptRichText text={question.detail!} /></View>}
      <View style={styles.questionOptions}>{(question.options ?? []).map((option) => {
        const active = selected[question.id]?.includes(option.label) === true
        return <Pressable key={option.label} accessibilityRole="button" accessibilityLabel={option.label} accessibilityHint={option.description} accessibilityState={{ selected: active, disabled: busy }} disabled={busy} onPress={() => choose(question, option.label)} style={({ pressed }) => [styles.questionOption, active && styles.questionOptionActive, (pressed || busy) && styles.questionControlDimmed]}>
          <View pointerEvents="none" style={styles.questionOptionContent}>
            <View style={[styles.questionOptionIndicator, active && styles.questionOptionActive]}>{active ? <AppIcon icon={Check} color={colors.blue} size={14} /> : null}</View>
            <View style={styles.questionOptionCopy}>
              <Text style={[styles.questionOptionLabel, active && styles.questionOptionLabelActive]}>{option.label}</Text>
              {Boolean(option.description) && <Text style={[styles.questionOptionDescription, active && styles.questionOptionLabelActive]}>{option.description}</Text>}
            </View>
          </View>
        </Pressable>
      })}</View>
      <TextInput multiline editable={!busy} accessibilityLabel={question.question} accessibilityState={{ disabled: busy }} value={custom[question.id] ?? ''} onFocus={onInputFocus} onBlur={onInputBlur} onChangeText={(text) => { if (!busy) setCustom((current) => ({ ...current, [question.id]: text })) }} placeholder={t('otherAnswer')} placeholderTextColor={colors.muted} style={styles.questionInput} />
    </View>)}
    <View style={styles.approvalActions}><PendingButton size="sm" variant="primary" isPending={pendingAction === 'answer'} isDisabled={busy || !ready} onPress={submit} style={[styles.approve, (busy || !ready) && styles.questionControlDimmed]}>{({ isPending }) => <View pointerEvents="none" style={styles.approvalActionContent}>{isPending ? <Spinner color="#FFFFFF" size="sm" /> : null}<Button.Label style={styles.approveText}>{isPending ? t('working') : t('submitAnswer')}</Button.Label></View>}</PendingButton></View>
  </View>
}

function useAgentStyles() { const colors = useAppColors(); return useMemo(() => createStyles(colors), [colors]) }

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  emptyState: { width: '100%', alignSelf: 'center', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  emptyLogo: { width: 178, height: 178, opacity: 0.7 },
  emptyTagline: { color: colors.text, fontSize: 21, lineHeight: 28, letterSpacing: -0.55, textAlign: 'center', marginTop: 12, opacity: 0.7 },
  historyLoading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  historyLoadingText: { color: colors.muted, lineHeight: 20 },
  historyError: { gap: 8, paddingVertical: 8 },
  historyRetry: { minHeight: agentPanelInteractionContract.minimumTouchTarget, alignSelf: 'flex-start' },
  inlineProgress: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  working: { padding: 12, backgroundColor: colors.panel, borderRadius: radius.small },
  workingText: { color: colors.muted, fontSize: 12 },
  queue: { maxHeight: agentPanelInteractionContract.minimumTouchTarget * 3, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.panel, overflow: 'hidden', shadowColor: '#15336A', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  queueList: { paddingHorizontal: 4 },
  queueItem: { minHeight: agentPanelInteractionContract.minimumTouchTarget, flexDirection: 'row', alignItems: 'center', paddingLeft: 6 },
  queueItemDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  queueMode: { width: 26, height: agentPanelInteractionContract.minimumTouchTarget, alignItems: 'center', justifyContent: 'center' },
  queueText: { minWidth: 0, flex: 1, color: colors.text, fontSize: 12, lineHeight: 18, paddingHorizontal: 4 },
  queueIconButton: { width: agentPanelInteractionContract.minimumTouchTarget, height: agentPanelInteractionContract.minimumTouchTarget, minWidth: agentPanelInteractionContract.minimumTouchTarget, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center' },
  approvalPopoverPortal: { position: 'absolute', inset: 0, zIndex: 1_000, elevation: 1_000, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  approvalPopoverOverlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(9, 14, 29, 0.2)' },
  approvalPopoverContent: { width: '100%', maxWidth: 420, padding: 18, gap: 9, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, shadowColor: '#09101F', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  approvalTitle: { color: colors.text, fontSize: 17, lineHeight: 23, fontWeight: '900' },
  approvalDescription: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  packageChange: { color: colors.blue, fontFamily: 'monospace', fontSize: 12, fontWeight: '700' },
  toolApprovalName: { color: colors.blue, fontFamily: 'monospace', fontSize: 12, fontWeight: '800' },
  questionCard: { padding: 14, borderRadius: radius.medium, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, gap: 10 },
  questionItem: { gap: 7 },
  questionHeader: { color: colors.blue, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 },
  questionText: { color: colors.text, fontSize: 13, fontWeight: '800', lineHeight: 19 },
  questionDetail: { minWidth: 0, padding: 10, borderRadius: 7, backgroundColor: colors.panel },
  questionOptions: { gap: 6 },
  questionOption: { minHeight: agentPanelInteractionContract.minimumTouchTarget, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, borderRadius: 8, padding: 9, gap: 2 },
  questionOptionActive: { borderColor: colors.blue, backgroundColor: colors.accentDeep },
  questionOptionContent: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  questionOptionIndicator: { width: 20, height: 20, borderRadius: 5, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  questionOptionCopy: { flex: 1, minWidth: 0, gap: 2 },
  questionControlDimmed: { opacity: 0.5 },
  questionOptionLabel: { color: colors.text, fontSize: 11, fontWeight: '800' },
  questionOptionLabelActive: { color: colors.blue },
  questionOptionDescription: { color: colors.muted, fontSize: 9, lineHeight: 14 },
  questionInput: { minHeight: agentPanelInteractionContract.minimumTouchTarget, maxHeight: 90, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.panel, color: colors.text, padding: 8, fontSize: 11, textAlignVertical: 'top' },
  questionKeyboardClearance: { height: agentQuestionKeyboardClearance(Platform.OS) },
  approvalActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  approvalActionContent: { height: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  reject: { height: agentPanelInteractionContract.minimumTouchTarget, minHeight: agentPanelInteractionContract.minimumTouchTarget, paddingHorizontal: 14, paddingVertical: 0, borderRadius: radius.small, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
  rejectText: { color: colors.muted, fontSize: 12, lineHeight: 18, fontWeight: '800', includeFontPadding: false },
  approve: { height: agentPanelInteractionContract.minimumTouchTarget, minHeight: agentPanelInteractionContract.minimumTouchTarget, paddingHorizontal: 14, paddingVertical: 0, borderRadius: radius.small, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  approveText: { color: '#FFFFFF', fontSize: 12, lineHeight: 18, fontWeight: '900', includeFontPadding: false },
  composer: { paddingHorizontal: agentPanelInteractionContract.composerHorizontalPadding, paddingTop: agentPanelInteractionContract.composerTopPadding, gap: agentPanelInteractionContract.composerSectionGap, backgroundColor: colors.canvas },
  composerCard: { padding: agentPanelInteractionContract.composerCardPadding, gap: agentPanelInteractionContract.composerCardGap, borderWidth: agentPanelInteractionContract.composerCardBorderWidth, borderColor: colors.border, borderRadius: agentPanelInteractionContract.composerCardRadius, backgroundColor: colors.panel, shadowColor: '#15336A', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  attachmentList: { gap: 8, paddingTop: 6, paddingRight: 6 },
  attachmentPreview: { width: 60, height: 60, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised },
  attachmentThumbnail: { width: 58, height: 58, borderRadius: 9 },
  attachmentDelete: { position: 'absolute', top: -12, right: -12, width: agentPanelInteractionContract.minimumTouchTarget, height: agentPanelInteractionContract.minimumTouchTarget, minWidth: agentPanelInteractionContract.minimumTouchTarget, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center' },
  attachmentDeleteSurface: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.canvas, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  composerShortcuts: { minHeight: agentPanelInteractionContract.minimumTouchTarget, flexDirection: 'row', alignItems: 'center', gap: agentPanelInteractionContract.composerActionGap, paddingRight: 4 },
  shortcutChip: { height: agentPanelInteractionContract.minimumTouchTarget, maxWidth: 132, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center' },
  shortcutSurface: { height: agentPanelInteractionContract.composerControlVisualSize, maxWidth: '100%', paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 9, backgroundColor: colors.panel },
  shortcutSurfaceActive: { borderColor: colors.accent, backgroundColor: colors.accentDeep },
  shortcutIcon: { width: agentPanelInteractionContract.minimumTouchTarget },
  shortcutIconSurface: { width: agentPanelInteractionContract.composerControlVisualSize, paddingHorizontal: 0 },
  permissionShortcut: { maxWidth: 148 },
  shortcutText: { minWidth: 0, color: colors.text, fontSize: 9, fontWeight: '800' },
  shortcutTextActive: { minWidth: 0, color: colors.accent, fontSize: 10, fontWeight: '900' },
  input: { minHeight: agentPanelInteractionContract.minimumTouchTarget, maxHeight: 96, color: colors.text, paddingHorizontal: 8, paddingTop: 5, paddingBottom: 3, fontSize: 13, lineHeight: 19, textAlignVertical: 'top' },
  composerActions: { minHeight: agentPanelInteractionContract.minimumTouchTarget, flexDirection: 'row', alignItems: 'center', gap: agentPanelInteractionContract.composerActionGap },
  addButton: { width: agentPanelInteractionContract.minimumTouchTarget, height: agentPanelInteractionContract.minimumTouchTarget, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center' },
  addButtonSurface: { width: agentPanelInteractionContract.composerControlVisualSize, height: agentPanelInteractionContract.composerControlVisualSize, borderRadius: agentPanelInteractionContract.composerControlVisualSize / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raised },
  commandSlash: { color: colors.text, fontSize: 13, fontWeight: '900' },
  composerSpacer: { flex: 1, minWidth: 0 },
  composerModelPicker: { height: agentPanelInteractionContract.minimumTouchTarget, paddingHorizontal: 0, flexShrink: 1, alignItems: 'center', justifyContent: 'center' },
  composerModelPickerSurface: { width: '100%', height: agentPanelInteractionContract.composerControlVisualSize, paddingHorizontal: 7, borderWidth: 1, borderColor: colors.border, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: colors.panel },
  composerModelPickerText: { minWidth: 0, flexShrink: 1, color: colors.muted, fontSize: 9, fontWeight: '700' },
  send: { width: agentPanelInteractionContract.minimumTouchTarget, height: agentPanelInteractionContract.minimumTouchTarget, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center' },
  sendSurface: { width: agentPanelInteractionContract.composerControlVisualSize, height: agentPanelInteractionContract.composerControlVisualSize, backgroundColor: colors.accent, borderRadius: agentPanelInteractionContract.composerControlVisualSize / 2, alignItems: 'center', justifyContent: 'center' },
  stopGlyph: { width: 12, height: 12, borderRadius: 3, backgroundColor: '#FFFFFF' },
  sendText: { color: '#FFFFFF', fontWeight: '900', fontSize: 20, lineHeight: 22 },
}) }
