import { type SessionQuickActionOption } from '@/components/SessionQuickActionDialog'
import { Camera, File, Image as ImageIcon, ListPlus, Target } from '@/components/icons'
import { useI18n } from '@/i18n'
import { MOBILE_DEFAULT_MODELS, usePreferences } from '@/state/preferences'
import { useRuntime } from '@/state/runtime'
import { runExclusiveAction } from '@/utils/action-progress'
import { agentDestructiveActionContract, agentImagePickerAvailable, agentPrimaryActionState, agentQueueActionReducer, agentResponseReducer, agentSendSubmissionBusy, idleAgentQueueActionState, idleAgentResponseState, mergeStoppedAgentMessages, performAgentDestructiveMutation, performAgentRun, resolveAgentPlanMode, restoreStoppedAgentMessages, shouldDismissConsumedQueuedMessage, type AgentDestructiveAction, type AgentQueueActionEvent, type AgentResponseEvent, type AgentSessionHistoryState } from '@/utils/agent-feedback'
import { agentGoalProjectionVersion, isAgentGoalSessionReady, parseAgentGoalCommand, projectAgentGoal, type AgentGoalCommand } from '@/utils/agent-goal'
import { latestAgentLifecycleState } from '@/utils/agent-lifecycle'
import { lastHumanUserPrompt } from '@/utils/agent-message'
import { isMobileModelProvider } from '@/utils/agent-model-selection'
import { parseAgentPlanCommand, projectAgentPlanMode, type AgentPlanCommand } from '@/utils/agent-plan'
import { insertAgentReference } from '@/utils/agent-references'
import { projectAgentTodos } from '@/utils/agent-todo'
import { agentRecoveryState, agentRunTransportRecovered, agentSessionFailureMessage, retireEndedAgentRun, type AgentRecoveryState } from '@/utils/agent-recovery'
import { isRuntimeTransportError, withAbortSignal } from '@/utils/runtime-request'
import { permissionModeChangeRequiresConfirmation, permissionModeDescriptionKeys } from '@/utils/permission-mode'
import { sessionRefreshPresentationStatus } from '@/utils/session-actions'
import { createMobileSessionId } from '@/utils/session-id'
import { mergeSessionTranscript } from '@/utils/session-transcript'
import { settingsDetailRoutes } from '@/utils/settings-routes'
import type { TranscriptBranchInFlight } from '@/utils/transcript-feedback'
import { liveAgentMessageIds, projectTranscriptUserMessages, queuedMessagesAwaitingConsumption, reconcileSubmittedTranscriptPrompt, transcriptUserMessageId, unresolvedTranscriptPrompt, type SubmittedTranscriptPrompt } from '@/utils/transcript-user'
import type { AgentGoal, AgentQuestion, AgentQuestionAnswer, AgentSessionRecord, MobileModelProvider, MobilePermissionMode } from '@runwhale/mobile-protocol'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { Keyboard } from 'react-native'
import { QUICK_ACTION_DISMISS_DELAY_MS, providerLabel, type AgentAttachmentSource, type AgentPanelProps, type ApprovalResponseAction, type GoalMutationAction, type PendingAgentMessage } from './agent-panel-types'
import { useAgentComposer } from './useAgentComposer'

export function useAgentSession({ projectId, initialSessionId, sessionSummaries, sessionSummariesRefreshing, sessionSummaryStatus, events = [], liveEvents = events, promptInsertion, onPromptInserted, onRun, onSessionChange, onRunningChange }: AgentPanelProps) {
  const router = useRouter()
  const { t } = useI18n()
  const runtime = useRuntime()
  const { busyMessageMode, modelProvider, model, modelProfiles, setModelProvider, agentPreset: defaultAgentPreset, permissionMode: defaultPermissionMode } = usePreferences()
  const [submittedPrompt, setSubmittedPrompt] = useState<SubmittedTranscriptPrompt>()
  const submittedPromptRevision = useRef(0)
  const [localRunActive, setLocalRunActive] = useState(false)
  const [runSubmitting, setRunSubmitting] = useState(false)
  const [recoveryAttempt, setRecoveryAttempt] = useState<AgentRecoveryState>()
  const runSubmissionGuard = useRef(false)
  const activeRunController = useRef<AbortController | undefined>(undefined)
  const activeRunPreviousTaskId = useRef<string | undefined>(undefined)
  const activeRunCompletion = useRef<Promise<void> | undefined>(undefined)
  const [stopping, setStopping] = useState(false)
  const stoppingRef = useRef(false)
  const directStopGuard = useRef(false)
  const [error, setError] = useState<string>()
  const [runConnectionIssue, setRunConnectionIssue] = useState<{ sessionId: string; previousTaskId?: string; afterSequence: number }>()
  const [credentialSetup, setCredentialSetup] = useState<MobileModelProvider>()
  const [sessionId, setSessionId] = useState<string | undefined>(initialSessionId)
  const [activeTaskId, setActiveTaskId] = useState<string>()
  const [liveEventFloor, setLiveEventFloor] = useState<number>()
  const latestEventSequence = useRef(0)
  latestEventSequence.current = events.at(-1)?.sequence ?? 0
  const [sessionRecord, setSessionRecord] = useState<AgentSessionRecord>()
  const [historyEventFloor, setHistoryEventFloor] = useState(-1)
  const historyRequest = useRef<{ sessionId: string; info: typeof runtime.info; eventFloor: number; pending: boolean; promise: Promise<AgentSessionRecord | undefined> } | undefined>(undefined)
  const [sessionHistoryState, setSessionHistoryState] = useState<AgentSessionHistoryState>(initialSessionId ? 'loading' : 'ready')
  const hydratedSessionHistory = useRef<string | undefined>(undefined)
  const historyRuntime = useRef<{ info: typeof runtime.info } | undefined>(undefined)
  const [forkingBranch, setForkingBranch] = useState<TranscriptBranchInFlight>()
  const forkSessionGuard = useRef(false)
  const [planChoice, setPlanChoice] = useState<{ sessionId: string | undefined; version: string; active: boolean }>()
  const [planModeSubmitting, setPlanModeSubmitting] = useState(false)
  const planModeSubmissionGuard = useRef(false)
  const [showGoal, setShowGoal] = useState(false)
  const [goalDraftObjective, setGoalDraftObjective] = useState<string>()
  const [goalSnapshot, setGoalSnapshot] = useState<{ version: string; goal: AgentGoal | undefined }>()
  const [goalLoadError, setGoalLoadError] = useState<string>()
  const [goalMutationAction, setGoalMutationAction] = useState<GoalMutationAction>()
  const goalMutationGuard = useRef(false)
  const [goalError, setGoalError] = useState<string>()
  const [sessionProvider, setSessionProvider] = useState(modelProvider)
  const [sessionModel, setSessionModel] = useState(model)
  const [sessionAgentPreset, setSessionAgentPreset] = useState(defaultAgentPreset)
  const [sessionPermissionMode, setSessionPermissionMode] = useState(defaultPermissionMode)
  const [pendingPermissionMode, setPendingPermissionMode] = useState<MobilePermissionMode>()
  const [quickAction, setQuickAction] = useState<'reference' | 'command' | 'preset' | 'permission' | 'model' | 'attachment'>()
  const [todoDialogOpen, setTodoDialogOpen] = useState(false)
  const [queued, setQueued] = useState<PendingAgentMessage[]>([])
  const [queueSubmitting, setQueueSubmitting] = useState(false)
  const queueSubmissionGuard = useRef(false)
  const queueSubmissionRevision = useRef(0)
  const queueSubmission = useRef<{ revision: number; text: string } | undefined>(undefined)
  const [queueActions, setQueueActions] = useState(idleAgentQueueActionState)
  const queueActionsRef = useRef(idleAgentQueueActionState)
  const [pendingDestructiveAction, setPendingDestructiveAction] = useState<AgentDestructiveAction>()
  const [destructiveActionBusy, setDestructiveActionBusy] = useState(false)
  const destructiveActionBusyRef = useRef(false)
  const [destructiveActionError, setDestructiveActionError] = useState<string>()
  const [approvalResponseState, setApprovalResponseState] = useState(idleAgentResponseState)
  const approvalResponseStateRef = useRef(idleAgentResponseState)
  const [approvalResponseAction, setApprovalResponseAction] = useState<ApprovalResponseAction>()
  const approvalBusy = approvalResponseState === 'busy'
  const [approvalError, setApprovalError] = useState<string>()
  const lifecycleState = useMemo(() => latestAgentLifecycleState(events, projectId, sessionId, historyEventFloor), [events, historyEventFloor, projectId, sessionId])
  const submittedLifecycleState = useMemo(() => liveEventFloor === undefined ? undefined
    : latestAgentLifecycleState(events, projectId, sessionId, liveEventFloor), [events, liveEventFloor, projectId, sessionId])
  const running = localRunActive || (lifecycleState ?? sessionRecord?.state) === 'running'
  const composer = useAgentComposer({ projectId, sessionId, running, setError, promptInsertion, onPromptInserted })
  const { prompt, attachments, setAttachments, composerInputRef, updatePrompt, draftCoordinator, draftKey, projectPaths, projectReferenceLoadState, projectReferenceError, loadProjectReferences, pickingImages, pickImages } = composer
  const permissionLabel = sessionPermissionMode === 'danger-full-access' ? t('fullAccess') : sessionPermissionMode === 'read-only' ? t('readOnly') : t('reviewMode')
  const transitionQueueAction = useCallback((event: AgentQueueActionEvent): boolean => {
    const current = queueActionsRef.current
    const next = agentQueueActionReducer(current, event)
    if (next === current) return false
    queueActionsRef.current = next
    setQueueActions(next)
    return true
  }, [])
  const transitionApprovalResponse = useCallback((event: AgentResponseEvent): boolean => {
    const current = approvalResponseStateRef.current
    const next = agentResponseReducer(current, event)
    if (next === current) return false
    approvalResponseStateRef.current = next
    setApprovalResponseState(next)
    return true
  }, [])
  const reconcileSubmittedPrompt = useCallback((selected: string, record: AgentSessionRecord | undefined, settleRevision?: number) => {
    setSubmittedPrompt((current) => reconcileSubmittedTranscriptPrompt(current, {
      sessionId: selected,
      messages: projectTranscriptUserMessages(record?.events ?? []),
      state: record?.state,
      settleRevision,
    }))
  }, [])
  const refreshSessionHistory = useCallback(async (preferredSessionId?: string, settleRevision?: number) => {
    const selected = preferredSessionId ?? sessionId
    const hydrated = !selected || hydratedSessionHistory.current === selected
    const eventFloor = latestEventSequence.current
    const observedRun = activeRunController.current
    if (selected) setSessionHistoryState(sessionRefreshPresentationStatus(hydrated, 'start'))
    if (!runtime.info) {
      if (selected && runtime.lastError) setSessionHistoryState(sessionRefreshPresentationStatus(hydrated, 'failure'))
      return
    }
    if (!selected) {
      setSessionRecord(undefined)
      setQueued([])
      setSessionHistoryState('ready')
      return
    }
    const current = historyRequest.current
    if (current?.pending && current.sessionId === selected && current.info === runtime.info && current.eventFloor === eventFloor) {
      const record = await current.promise
      reconcileSubmittedPrompt(selected, record, settleRevision)
      return record
    }
    const read = async (): Promise<AgentSessionRecord | undefined> => {
      try {
        const [record, pending] = await Promise.all([
          runtime.request('session.read', { projectId, sessionId: selected, surfaceOnly: true }),
          runtime.request('agent.message.list', { projectId, sessionId: selected }),
        ])
        if (historyRequest.current?.promise !== reading) {
          return historyRequest.current?.sessionId === selected ? historyRequest.current.promise : undefined
        }
        hydratedSessionHistory.current = selected
        // A fresh snapshot supersedes events already received before this read.
        // In particular, an old pause must not override a restarted host's state.
        setHistoryEventFloor(eventFloor)
        setSessionRecord(record)
        if (observedRun && observedRun === activeRunController.current && record.taskId && record.taskId !== activeRunPreviousTaskId.current) {
          retireEndedAgentRun(observedRun, record.state)
        }
        setRunConnectionIssue((current) => current?.sessionId === selected && agentRunTransportRecovered(record, current.previousTaskId) ? undefined : current)
        setQueued(pending.messages.map((message) => ({ messageId: message.messageId, text: message.text, mode: message.mode })))
        setSessionHistoryState('ready')
        reconcileSubmittedPrompt(selected, record, settleRevision)
        return record
      } catch (cause) {
        if (historyRequest.current?.promise !== reading) {
          if (historyRequest.current?.sessionId === selected) return historyRequest.current.promise
          throw cause
        }
        if (selected && !hydrated && sessionSummaryStatus === 'ready' && !sessionSummariesRefreshing && !sessionSummaries.some((item) => item.sessionId === selected)) {
          hydratedSessionHistory.current = selected
          setSessionRecord(undefined)
          setQueued([])
          setSessionHistoryState('ready')
          reconcileSubmittedPrompt(selected, undefined, settleRevision)
          return
        }
        if (selected) setSessionHistoryState(sessionRefreshPresentationStatus(hydratedSessionHistory.current === selected, 'failure'))
        throw cause
      }
    }
    const reading = read().finally(() => {
      if (historyRequest.current?.promise === reading) historyRequest.current.pending = false
    })
    historyRequest.current = { sessionId: selected, info: runtime.info, eventFloor, pending: true, promise: reading }
    return reading
  }, [projectId, reconcileSubmittedPrompt, runtime.info, runtime.lastError, runtime.request, sessionId, sessionSummaries, sessionSummariesRefreshing, sessionSummaryStatus])
  const refreshHistoryFromEvent = useEffectEvent((selected?: string) => { void refreshSessionHistory(selected).catch(() => undefined) })
  useEffect(() => {
    if (!runConnectionIssue) return
    if (runConnectionIssue.sessionId !== sessionId || latestAgentLifecycleState(events, projectId, sessionId, runConnectionIssue.afterSequence)) {
      setRunConnectionIssue(undefined)
    }
  }, [events, projectId, runConnectionIssue, sessionId])
  useEffect(() => {
    if (runConnectionIssue && runtime.info) refreshHistoryFromEvent(runConnectionIssue.sessionId)
  }, [runConnectionIssue, runtime.info])
  useEffect(() => {
    if ((historyRuntime.current && historyRuntime.current.info === runtime.info) || sessionSummaryStatus === 'loading' || sessionSummariesRefreshing) return
    historyRuntime.current = { info: runtime.info }
    refreshHistoryFromEvent()
  }, [runtime.info, sessionId, sessionSummariesRefreshing, sessionSummaryStatus])
  useEffect(() => {
    if (sessionRecord?.state !== 'running' || liveEventFloor !== undefined) return
    setLiveEventFloor(0)
    if (sessionRecord.taskId) setActiveTaskId(sessionRecord.taskId)
  }, [liveEventFloor, sessionRecord?.state, sessionRecord?.taskId])
  useEffect(() => {
    if (lifecycleState === 'completed' || lifecycleState === 'failed' || lifecycleState === 'aborted' || lifecycleState === 'paused') {
      refreshHistoryFromEvent(sessionId)
    }
  }, [lifecycleState, sessionId])
  useEffect(() => {
    // The host may finish while iOS leaves the original fetch suspended. Retire
    // that transport so its submission guard cannot keep Retry locked. Events
    // before this submission's floor must never cancel a fresh retry.
    retireEndedAgentRun(activeRunController.current, submittedLifecycleState)
  }, [liveEventFloor, submittedLifecycleState])
  useEffect(() => { onRunningChange?.(running) }, [onRunningChange, running])
  useEffect(() => () => { onRunningChange?.(false) }, [onRunningChange])
  useEffect(() => { setSessionProvider(modelProvider); setSessionModel(model) }, [model, modelProvider])
  useEffect(() => {
    if (sessionRecord) {
      setSessionAgentPreset(sessionRecord.agentPreset ?? defaultAgentPreset)
      setSessionPermissionMode(sessionRecord.permissionMode ?? defaultPermissionMode)
    } else {
      setSessionAgentPreset(defaultAgentPreset)
      setSessionPermissionMode(defaultPermissionMode)
    }
  }, [defaultAgentPreset, defaultPermissionMode, sessionRecord])
  const pendingAgentApproval = useMemo(() => {
    const resolved = new Set(events.filter((event) => event.name === 'approval.resolved' && (event.data as { kind?: unknown })?.kind === 'agent-tool').map((event) => String((event.data as { requestId?: unknown })?.requestId ?? '')))
    return [...events].reverse().find((event) => event.name === 'approval.requested'
      && (event.data as { kind?: unknown })?.kind === 'agent-tool'
      && (event.data as { projectId?: unknown })?.projectId === projectId
      && (event.data as { sessionId?: unknown })?.sessionId === sessionId
      && !resolved.has(String((event.data as { requestId?: unknown })?.requestId ?? '')))
  }, [events, projectId, sessionId])
  const pendingQuestion = useMemo(() => {
    const resolved = new Set(events.filter((event) => event.name === 'question.resolved').map((event) => String((event.data as { requestId?: unknown })?.requestId ?? '')))
    return [...events].reverse().find((event) => event.name === 'question.requested'
      && (event.data as { projectId?: unknown })?.projectId === projectId
      && (event.data as { sessionId?: unknown })?.sessionId === sessionId
      && !resolved.has(String((event.data as { requestId?: unknown })?.requestId ?? '')))
  }, [events, projectId, sessionId])
  const currentLiveEvents = useMemo(() => liveEventFloor === undefined
    ? []
    : liveEvents.filter((event) => event.sequence > liveEventFloor), [liveEventFloor, liveEvents])
  const transcript = useMemo(() => mergeSessionTranscript(
    sessionRecord?.sessionId === sessionId ? sessionRecord?.events ?? [] : [],
    currentLiveEvents,
    { projectId, sessionId },
  ), [currentLiveEvents, projectId, sessionId, sessionRecord])
  const currentSessionEvents = transcript.events
  useEffect(() => {
    if (transcript.repair && sessionId) refreshHistoryFromEvent(sessionId)
  }, [sessionId, transcript.repair])
  // Queued messages belong to the session, including runs resumed after backgrounding.
  const consumedMessageIds = useMemo(() => liveAgentMessageIds(liveEvents, {
    projectId,
    ...(sessionId === undefined ? {} : { sessionId }),
  }), [liveEvents, projectId, sessionId])
  const visibleQueued = useMemo(() => queuedMessagesAwaitingConsumption(queued, consumedMessageIds), [consumedMessageIds, queued])
  useEffect(() => {
    // Retire consumed rows before their events leave the live event window.
    if (visibleQueued.length !== queued.length) setQueued(visibleQueued)
  }, [queued, visibleQueued])
  useEffect(() => {
    if (!pendingDestructiveAction || !shouldDismissConsumedQueuedMessage(pendingDestructiveAction, destructiveActionBusy, consumedMessageIds)) return
    transitionQueueAction({ type: 'finish', messageId: pendingDestructiveAction.messageId, action: 'delete' })
    setPendingDestructiveAction(undefined)
    setDestructiveActionError(undefined)
  }, [consumedMessageIds, destructiveActionBusy, pendingDestructiveAction, transitionQueueAction])
  const agentTodos = useMemo(() => projectAgentTodos(
    sessionRecord && sessionRecord.sessionId === sessionId ? sessionRecord.events : [],
    currentLiveEvents,
    {
      projectId,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(activeTaskId === undefined ? {} : { taskId: activeTaskId }),
    },
  ), [activeTaskId, currentLiveEvents, projectId, sessionId, sessionRecord])
  const completedTodoCount = agentTodos?.filter((todo) => todo.status === 'completed').length ?? 0
  useEffect(() => { if (!agentTodos) setTodoDialogOpen(false) }, [agentTodos])
  const planProjection = useMemo(() => projectAgentPlanMode(currentSessionEvents, events, {
    projectId,
    ...(sessionId === undefined ? {} : { sessionId }),
  }), [currentSessionEvents, events, projectId, sessionId])
  const planVersion = JSON.stringify(planProjection)
  const planMode = planChoice && planChoice.sessionId === sessionId && planChoice.version === planVersion
    ? planChoice.active : planProjection.observed && planProjection.active
  const setPlanMode = (active: boolean) => setPlanChoice({ sessionId, version: planVersion, active })
  const sendBusy = agentSendSubmissionBusy(planModeSubmitting, running, runSubmitting, queueSubmitting)
  const admissionSubmitting = runSubmitting && !running
  const sendAvailable = running ? Boolean(prompt.trim()) : Boolean(prompt.trim()) || attachments.length > 0
  const primaryAction = agentPrimaryActionState(running, stopping, sendAvailable, sendBusy)
  const imagePickerAvailable = agentImagePickerAvailable(running, attachments.length)
  const goalProjection = useMemo(() => projectAgentGoal(currentSessionEvents, currentLiveEvents, {
    projectId,
    ...(sessionId === undefined ? {} : { sessionId }),
  }), [currentLiveEvents, currentSessionEvents, projectId, sessionId])
  const goalProjectionVersion = agentGoalProjectionVersion(goalProjection)
  const goal = goalSnapshot?.version === goalProjectionVersion ? goalSnapshot.goal
    : goalProjection.goal ? { ...goalProjection.goal, activation: goalSnapshot?.goal?.activation ?? 'disarmed' as const } : undefined
  const setGoal = (value: AgentGoal | undefined) => setGoalSnapshot({ version: goalProjectionVersion, goal: value })
  const ongoingGoal = goal?.phase === 'complete' ? undefined : goal
  const goalSessionReady = isAgentGoalSessionReady({ sessionId, connected: Boolean(runtime.info), localRunActive, submittedLifecycleState, lifecycleState, record: sessionRecord })
  useEffect(() => {
    setGoalSnapshot(undefined)
    setGoalLoadError(undefined)
  }, [sessionId])
  useEffect(() => {
    if (!goalSessionReady || !sessionId) {
      setGoalLoadError(undefined)
      return
    }
    let active = true
    void runtime.request('agent.goal.get', { projectId, sessionId, provider: sessionProvider, model: sessionModel, modelProfile: modelProfiles[sessionProvider] }).then((result) => {
      if (active) {
        setGoalLoadError(undefined)
        setGoal(result.goal)
      }
    }).catch((cause) => {
      if (active) setGoalLoadError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { active = false }
  }, [goalProjectionVersion, goalSessionReady, modelProfiles, projectId, running, runtime.info, runtime.request, sessionId, sessionModel, sessionProvider])
  const retryPrompt = useMemo(() => lastHumanUserPrompt(currentSessionEvents), [currentSessionEvents])
  const transcriptUserMessages = useMemo(() => projectTranscriptUserMessages(currentSessionEvents), [currentSessionEvents])
  const currentSubmittedPrompt = submittedPrompt?.sessionId === sessionId ? submittedPrompt : undefined
  const livePrompt = unresolvedTranscriptPrompt(transcriptUserMessages, currentSubmittedPrompt)
  useEffect(() => {
    setSubmittedPrompt((current) => current && current.sessionId !== sessionId ? undefined : current)
  }, [sessionId])
  const recoveryState = agentRecoveryState(lifecycleState ?? sessionRecord?.state) ?? recoveryAttempt
  const recoveryMessage = error ?? (recoveryState === 'failed' ? agentSessionFailureMessage(currentSessionEvents, sessionRecord?.failure) : undefined)
  const sessionRetryAvailable = (!running || Boolean(recoveryAttempt) && submittedLifecycleState !== 'running') && (Boolean(retryPrompt) || recoveryState === 'paused') && Boolean(recoveryState)
  const retryPending = runSubmitting || stopping
  const configuredModels = useMemo(() => Array.from(new Set([
    sessionModel,
    ...modelProfiles[sessionProvider].models.map((entry) => entry.id),
  ])), [modelProfiles, sessionModel, sessionProvider])
  const quickActionOptions = useMemo<SessionQuickActionOption[]>(() => {
    if (quickAction === 'reference') return [
      ...projectPaths.map((path) => ({ id: `file:${path}`, label: path, section: t('fileReferences') })),
      ...sessionSummaries.map((session) => ({ id: `session:${session.sessionId}`, label: session.title, description: session.preview, section: t('sessionReferences') })),
    ]
    if (quickAction === 'command') return [
      {
        id: planMode ? '/plan off' : '/plan',
        label: planMode ? '/plan off' : '/plan',
        icon: ListPlus,
        description: t(planMode ? 'commandPlanOff' : 'commandPlan'),
        selected: planMode,
        disabled: planModeSubmitting,
      },
      { id: '/goal', label: '/goal', icon: Target, description: t('commandGoal'), selected: Boolean(ongoingGoal), disabled: Boolean(goalMutationAction) },
    ]
    if (quickAction === 'attachment') return [
      { id: 'camera', label: t('camera'), icon: Camera },
      { id: 'photos', label: t('photos'), icon: ImageIcon },
      { id: 'files', label: t('file'), icon: File },
    ]
    if (quickAction === 'preset') return [
      { id: 'standard', label: t('standardPreset'), selected: sessionAgentPreset === 'standard' },
      { id: 'minimal', label: t('minimalPreset'), selected: sessionAgentPreset === 'minimal' },
    ]
    if (quickAction === 'permission') return [
      { id: 'review', label: t('reviewWrites'), description: t(permissionModeDescriptionKeys.review), selected: sessionPermissionMode === 'review' },
      { id: 'read-only', label: t('readOnly'), description: t(permissionModeDescriptionKeys['read-only']), selected: sessionPermissionMode === 'read-only' },
      { id: 'danger-full-access', label: t('fullAccess'), description: t(permissionModeDescriptionKeys['danger-full-access']), selected: sessionPermissionMode === 'danger-full-access' },
    ]
    if (quickAction === 'model') return [
      ...(Object.keys(MOBILE_DEFAULT_MODELS) as MobileModelProvider[]).map((provider) => ({
        id: `provider:${provider}`,
        label: providerLabel(provider),
        section: t('provider'),
        selected: sessionProvider === provider,
        disabled: false,
      })),
      ...configuredModels.map((modelOption) => ({
        id: `model:${modelOption}`,
        label: modelOption,
        section: t('model'),
        selected: sessionModel === modelOption,
        disabled: false,
      })),
    ]
    return []
  }, [configuredModels, goalMutationAction, ongoingGoal, planMode, planModeSubmitting, projectPaths, quickAction, sessionAgentPreset, sessionModel, sessionPermissionMode, sessionProvider, sessionSummaries, t])
  const runPrompt = async (value: string, requestedPlanMode = planMode, draftToConsume = value, recover = false) => {
    if (runSubmissionGuard.current) return
    let resume = false
    let nextPrompt = value.trim() || (attachments.length > 0 ? t('imageOnlyPrompt') : '')
    if (!nextPrompt && !recover) return
    const submittedAttachments = recover ? [] : attachments
    const targetSessionId = sessionId ?? createMobileSessionId()
    const submission = runExclusiveAction(runSubmissionGuard, async () => {
      setRunSubmitting(true)
      if (recover) setRecoveryAttempt(recoveryState)
      setError(undefined)
      setRunConnectionIssue(undefined)
      try {
        let previousTaskId = sessionRecord?.taskId
        if (recover) {
          const latest = await refreshSessionHistory(targetSessionId)
          if (!latest) throw new Error(t('sessionRecoveryUnavailable'))
          previousTaskId = latest.taskId
          if (latest.state === 'running' || latest.state === 'completed') return
          resume = latest.state === 'paused'
          nextPrompt = resume ? '' : lastHumanUserPrompt(latest.events)
          if (!resume && !nextPrompt) throw new Error(t('sessionRetryPromptMissing'))
        }
        const credential = await runtime.request('credential.status', { provider: sessionProvider })
        if (!credential.configured) {
          setCredentialSetup(sessionProvider)
          return
        }
        if (!sessionId) {
          setSessionId(targetSessionId)
          onSessionChange?.(targetSessionId)
        }
        const runController = new AbortController()
        activeRunController.current = runController
        activeRunPreviousTaskId.current = previousTaskId
        setLocalRunActive(true)
        setError(undefined)
        const submissionRevision = submittedPromptRevision.current + 1
        submittedPromptRevision.current = submissionRevision
        if (!resume) setSubmittedPrompt({ sessionId: targetSessionId, id: transcriptUserMessageId(transcriptUserMessages.length + 1), revision: submissionRevision, text: nextPrompt })
        // Include events received during the credential check, so a late
        // terminal event from the previous run cannot cancel this retry.
        setLiveEventFloor(latestEventSequence.current)
        setActiveTaskId(undefined)
        if (!recover) {
          updatePrompt((current) => current.trim() === draftToConsume.trim() ? '' : current)
          // onRun resolves after the full Agent turn, so consume images with the text now.
          setAttachments((current) => current.filter((attachment) => !submittedAttachments.includes(attachment)))
        }
        await performAgentRun({
          clearPersistedDraft: () => recover ? Promise.resolve() : withAbortSignal(runController.signal, () => draftCoordinator.clear(draftKey)),
          run: async () => {
            const result = await withAbortSignal(runController.signal, () => onRun({ prompt: nextPrompt, resume, sessionId: targetSessionId, planMode: requestedPlanMode, provider: sessionProvider, model: sessionModel, agentPreset: sessionAgentPreset, permissionMode: sessionPermissionMode, attachments: submittedAttachments, signal: runController.signal, modelProfile: modelProfiles[sessionProvider] }))
            setSessionId(result.sessionId)
            onSessionChange?.(result.sessionId)
            setActiveTaskId(result.taskId)
            void refreshSessionHistory(result.sessionId, submissionRevision).catch(() => undefined)
          },
          recover: async (cause) => {
            if (!runController.signal.aborted && isRuntimeTransportError(cause) && (cause.method === 'agent.run' || cause.method === 'agent.resume')) {
              // Losing the long-lived RPC does not mean the host stopped its
              // task. Reconcile through history/events without resubmitting it.
              setRunConnectionIssue({ sessionId: targetSessionId, previousTaskId, afterSequence: latestEventSequence.current })
              return
            }
            if (!runController.signal.aborted && (cause as { code?: unknown })?.code !== 'ABORTED' && submittedAttachments.length > 0) {
              setAttachments((current) => [...submittedAttachments, ...current])
            }
            if (isMissingCredentialFailure(cause)) {
              if (!recover) updatePrompt(nextPrompt)
              setCredentialSetup(sessionProvider)
            } else if ((cause as { code?: unknown })?.code !== 'ABORTED') setError(cause instanceof Error ? cause.message : String(cause))
            void refreshSessionHistory(targetSessionId, submissionRevision).catch(() => undefined)
          },
          finish: () => {
            if (activeRunController.current === runController) activeRunController.current = undefined
            setLocalRunActive(false)
            setStopping(false)
          },
        })
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setRunSubmitting(false)
        setRecoveryAttempt(undefined)
      }
    }).then(() => undefined)
    activeRunCompletion.current = submission
    try {
      await submission
    } finally {
      if (activeRunCompletion.current === submission) activeRunCompletion.current = undefined
    }
  }
  const retrySession = () => runPrompt('', planMode, '', true)
  const queueMessage = async (value: string, mode: 'followup' | 'steer' = 'followup') => {
    if (!sessionId || stoppingRef.current) return false
    const submissionRevision = queueSubmissionRevision.current
    return (await runExclusiveAction(queueSubmissionGuard, async () => {
      const activeSubmission = { revision: submissionRevision, text: value }
      queueSubmission.current = activeSubmission
      setQueueSubmitting(true)
      setError(undefined)
      try {
        const result = await runtime.request('agent.message', { projectId, sessionId, prompt: value, mode })
        if (submissionRevision !== queueSubmissionRevision.current) return
        if (!result.accepted || !result.messageId) throw new Error(t('queueNoLongerPending'))
        setQueued((current) => [...current, { messageId: result.messageId!, text: value, mode }])
        updatePrompt((current) => current.trim() === value ? '' : current)
        return true
      } catch (cause) {
        if (submissionRevision === queueSubmissionRevision.current) setError(cause instanceof Error ? cause.message : String(cause))
        return false
      } finally {
        if (queueSubmission.current === activeSubmission) queueSubmission.current = undefined
        setQueueSubmitting(false)
      }
    })) ?? false
  }
  const consumeCommandDraft = (command: string) => {
    updatePrompt((current) => current.trim() === command ? '' : current)
  }
  const executePlanCommand = async (command: AgentPlanCommand, rawCommand: string) => {
    const hasDraftAttachments = !running && attachments.length > 0
    if (command.kind === 'leave' && hasDraftAttachments) {
      setError(t('planOffWithImages'))
      return
    }
    if (!await setAgentPlanMode(command.kind === 'enter')) return
    if (command.kind === 'enter' && (command.message || hasDraftAttachments)) {
      if (running) {
        if (command.message && await queueMessage(command.message, 'steer')) consumeCommandDraft(rawCommand)
      } else await runPrompt(command.message ?? '', true, rawCommand)
      return
    }
    consumeCommandDraft(rawCommand)
  }
  const executeGoalCommand = async (command: AgentGoalCommand, rawCommand: string) => {
    setGoalError(undefined)
    if (!running && attachments.length > 0) {
      setError(t('goalWithImages'))
      return
    }
    if (command.kind === 'open') {
      consumeCommandDraft(rawCommand)
      setGoalDraftObjective(undefined)
      setShowGoal(true)
      return
    }
    if (command.kind === 'invalid-edit') {
      consumeCommandDraft(rawCommand)
      setGoalDraftObjective(undefined)
      setGoalError(t('goalEditRequiresObjective'))
      setShowGoal(true)
      return
    }
    const objective = command.kind === 'create' || command.kind === 'edit' ? command.objective : undefined
    if (objective) setGoalDraftObjective(objective)
    const succeeded = await mutateGoal(command.kind, objective)
    if (succeeded) {
      consumeCommandDraft(rawCommand)
      setGoalDraftObjective(undefined)
    } else {
      if (goalSessionReady) consumeCommandDraft(rawCommand)
      setShowGoal(true)
    }
  }
  const submit = () => {
    if (stoppingRef.current) return
    const value = prompt.trim()
    if (!value && attachments.length === 0) return
    const planCommand = parseAgentPlanCommand(value)
    if (planCommand) { void executePlanCommand(planCommand, value); return }
    const goalCommand = parseAgentGoalCommand(value)
    if (goalCommand) { void executeGoalCommand(goalCommand, value); return }
    if (running) {
      void queueMessage(value, busyMessageMode)
      return
    }
    void runPrompt(value)
  }
  const stopAgent = async () => {
    if (!sessionId || stoppingRef.current) return
    const locallyQueued = queued
    const concurrentSubmission = queueSubmission.current
    stoppingRef.current = true
    queueSubmissionRevision.current += 1
    activeRunController.current?.abort(Object.assign(new Error('Agent stopped by user'), { code: 'ABORTED' }))
    try {
      await runExclusiveAction(directStopGuard, async () => {
        setStopping(true)
        setError(undefined)
        const [result] = await Promise.all([
          runtime.cancelAgent(projectId, sessionId),
          activeRunCompletion.current ?? Promise.resolve(),
        ])
        const restoredMessages = mergeStoppedAgentMessages(locallyQueued, result.restoredMessages)
        if (restoredMessages.length > 0) updatePrompt((current) => restoreStoppedAgentMessages(current, restoredMessages, concurrentSubmission?.text))
        setQueued([])
        setLocalRunActive(false)
        setQueueSubmitting(false)
        setStopping(false)
        stoppingRef.current = false
        await refreshSessionHistory(sessionId).catch(() => undefined)
      })
    } catch (cause) {
      setStopping(false)
      stoppingRef.current = false
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const forkSession = async (throughSequence?: number) => {
    if (!sessionId || running) return
    await runExclusiveAction(forkSessionGuard, async () => {
      setForkingBranch({ ...(throughSequence === undefined ? {} : { throughSequence }) })
      setError(undefined)
      try {
        const child = await runtime.request('session.fork', { projectId, sessionId, ...(throughSequence === undefined ? {} : { throughSequence }) })
        setSessionId(child.sessionId)
        setSessionRecord(child)
        onSessionChange?.(child.sessionId)
        setActiveTaskId(undefined)
        await refreshSessionHistory(child.sessionId).catch(() => undefined)
      } catch {
        setError(t('branchFailed'))
      } finally {
        setForkingBranch(undefined)
      }
    })
  }
  const convertQueuedMessageToSteer = async (message: PendingAgentMessage) => {
    if (!sessionId || message.mode === 'steer') return
    if (!transitionQueueAction({ type: 'start', messageId: message.messageId, action: 'convert' })) return
    try {
      const removed = await runtime.request('agent.message.delete', { projectId, sessionId, messageId: message.messageId })
      if (!removed.deleted) { setError(t('queueNoLongerPending')); return }
      const result = await runtime.request('agent.message', { projectId, sessionId, prompt: message.text, mode: 'steer' })
      if (!result.accepted || !result.messageId) { setError(t('queueNoLongerPending')); return }
      setQueued((current) => current.map((item) => item.messageId === message.messageId ? { ...item, mode: 'steer', messageId: result.messageId! } : item))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { transitionQueueAction({ type: 'finish', messageId: message.messageId, action: 'convert' }) }
  }
  const performApprovalResponse = async (action: ApprovalResponseAction, respond: () => Promise<void>) => {
    if (!transitionApprovalResponse('start')) return
    setApprovalResponseAction(action)
    setApprovalError(undefined)
    try {
      await respond()
    } catch (cause) {
      setApprovalError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      transitionApprovalResponse('finish')
      setApprovalResponseAction(undefined)
    }
  }
  const resolveAgentApproval = async (approved: boolean) => {
    const requestId = String((pendingAgentApproval?.data as { requestId?: unknown } | undefined)?.requestId ?? '')
    if (!requestId) return
    await performApprovalResponse(approved ? 'approve' : 'reject', async () => {
      await runtime.request('agent.approval.resolve', { requestId, outcome: approved ? 'allowed-once' : 'rejected' })
    })
  }
  const answerQuestion = async (answers: AgentQuestionAnswer[]) => {
    const requestId = String((pendingQuestion?.data as { requestId?: unknown } | undefined)?.requestId ?? '')
    if (!requestId) return
    await performApprovalResponse('answer', async () => {
      const result = await runtime.request('agent.question.answer', { requestId, answers })
      if (!result.resolved) throw new Error(t('questionNoLongerPending'))
      const questions = (pendingQuestion?.data as { questions?: AgentQuestion[] } | undefined)?.questions ?? []
      const review = questions.find((question) => question.intent?.kind === 'plan-review')
      const reviewAnswer = answers.find((answer) => answer.id === review?.id)
      if (review && reviewAnswer?.selected.includes(review.intent!.approve)) setPlanMode(false)
    })
  }
  const setAgentPlanMode = async (next: boolean): Promise<boolean> => {
    return (await runExclusiveAction(planModeSubmissionGuard, async () => {
      const previous = planMode
      setPlanModeSubmitting(true)
      setPlanMode(next)
      setError(undefined)
      try {
        if (!running || !sessionId) return true
        const result = await runtime.request('agent.plan.set', { projectId, sessionId, active: next })
        setPlanMode(resolveAgentPlanMode(previous, result))
        return true
      } catch (cause) {
        setPlanMode(resolveAgentPlanMode(previous))
        setError(cause instanceof Error ? cause.message : String(cause))
        return false
      } finally {
        setPlanModeSubmitting(false)
      }
    })) ?? false
  }
  const mutateGoal = async (action: GoalMutationAction, objective?: string): Promise<boolean> => {
    if (!sessionId || !goalSessionReady) {
      setGoalError(t('goalRequiresSession'))
      return false
    }
    return (await runExclusiveAction(goalMutationGuard, async () => {
      setGoalMutationAction(action)
      setGoalError(undefined)
      setGoalLoadError(undefined)
      try {
        const current = (await runtime.request('agent.goal.get', { projectId, sessionId, provider: sessionProvider, model: sessionModel, modelProfile: modelProfiles[sessionProvider] })).goal
        if (action === 'create') {
          if (current && current.phase !== 'complete') {
            setGoal(current)
            throw new Error(t('goalAlreadyActive'))
          }
          const result = await runtime.request('agent.goal.create', { projectId, sessionId, objective: objective ?? '' })
          setGoal(result.goal)
        } else if (action === 'clear' && current) {
          const ref = { projectId, sessionId, id: current.id, revision: current.revision }
          await runtime.request('agent.goal.clear', ref)
          setGoal(undefined)
        } else if (action === 'edit' && current?.phase === 'complete') {
          setGoalMutationAction('create')
          setGoal((await runtime.request('agent.goal.create', { projectId, sessionId, objective: objective ?? current.objective })).goal)
        } else if (current && current.phase !== 'complete') {
          setGoal(current)
          const ref = { projectId, sessionId, id: current.id, revision: current.revision }
          if (action === 'edit') setGoal((await runtime.request('agent.goal.edit', { ...ref, objective: objective ?? current.objective })).goal)
          else if (action === 'pause') setGoal((await runtime.request('agent.goal.pause', ref)).goal)
          else if (action === 'resume') setGoal((await runtime.request('agent.goal.resume', ref)).goal)
        } else if (action === 'clear') setGoal(undefined)
        else throw new Error(t('goalNoLongerAvailable'))
        await refreshSessionHistory(sessionId)
        return true
      } catch (cause) {
        setGoalError(cause instanceof Error ? cause.message : String(cause))
        return false
      } finally {
        setGoalMutationAction(undefined)
      }
    })) ?? false
  }
  const confirmDestructiveAction = async () => {
    if (!pendingDestructiveAction || destructiveActionBusyRef.current) return
    const action = pendingDestructiveAction
    destructiveActionBusyRef.current = true
    try {
      const succeeded = await performAgentDestructiveMutation({
        action,
        projectId,
        sessionId,
        queueNoLongerPendingMessage: t('queueNoLongerPending'),
        deleteQueuedMessage: (input) => runtime.request('agent.message.delete', input),
        onBusyChange: setDestructiveActionBusy,
        onError: setDestructiveActionError,
      })
      if (!succeeded) return
      if (action.kind === 'delete-queued-message') {
        setQueued((current) => current.filter((item) => item.messageId !== action.messageId))
        transitionQueueAction({ type: 'finish', messageId: action.messageId, action: 'delete' })
      }
      setPendingDestructiveAction(undefined)
    } finally {
      destructiveActionBusyRef.current = false
    }
  }
  const dismissDestructiveAction = () => {
    if (destructiveActionBusyRef.current) return
    if (pendingDestructiveAction) {
      transitionQueueAction({ type: 'finish', messageId: pendingDestructiveAction.messageId, action: 'delete' })
    }
    setPendingDestructiveAction(undefined)
  }
  const destructiveActionCopy = {
    title: t('deleteQueuedMessageConfirmationTitle'),
    description: t('deleteQueuedMessageConfirmationBody'),
    confirmLabel: t('delete'),
    contract: agentDestructiveActionContract.queuedMessageDelete,
  }
  const changePermissionMode = (nextMode: MobilePermissionMode) => {
    if (!permissionModeChangeRequiresConfirmation(sessionPermissionMode, nextMode)) {
      setSessionPermissionMode(nextMode)
      return
    }
    setPendingPermissionMode(nextMode)
  }
  const openQuickAction = (action: 'reference' | 'command' | 'preset' | 'permission' | 'model' | 'attachment') => {
    Keyboard.dismiss()
    setQuickAction(action)
  }
  const selectQuickAction = (option: SessionQuickActionOption) => {
    const currentAction = quickAction
    if (option.disabled) return
    if (currentAction === 'attachment') {
      setQuickAction(undefined)
      if (option.id === 'camera' || option.id === 'photos' || option.id === 'files') {
        const source: AgentAttachmentSource = option.id
        setTimeout(() => { void pickImages(source) }, QUICK_ACTION_DISMISS_DELAY_MS)
      }
      return
    }
    if (currentAction === 'model') {
      if (option.id.startsWith('provider:')) {
        const nextProvider = option.id.slice('provider:'.length)
        if (!isMobileModelProvider(nextProvider) || nextProvider === sessionProvider) return
        setSessionProvider(nextProvider)
        setSessionModel(modelProfiles[nextProvider].models[0]?.id ?? MOBILE_DEFAULT_MODELS[nextProvider])
        return
      }
      if (option.id.startsWith('model:')) {
        const nextModel = option.id.slice('model:'.length)
        if (!configuredModels.includes(nextModel)) return
        setSessionModel(nextModel)
        setQuickAction(undefined)
      }
      return
    }
    setQuickAction(undefined)
    if (currentAction === 'reference') {
      if (option.id.startsWith('file:')) updatePrompt((value) => insertAgentReference(value, option.id.slice('file:'.length)))
      else if (option.id.startsWith('session:')) updatePrompt((value) => insertAgentReference(value, option.id))
      return
    }
    if (currentAction === 'command') {
      if (option.id === '/goal') {
        void executeGoalCommand({ kind: 'open' }, '/goal')
      } else if (option.id === '/plan' || option.id === '/plan off') {
        void setAgentPlanMode(option.id === '/plan')
      }
      return
    }
    if (currentAction === 'preset' && (option.id === 'standard' || option.id === 'minimal')) { setSessionAgentPreset(option.id); return }
    if (currentAction === 'permission' && (option.id === 'review' || option.id === 'read-only' || option.id === 'danger-full-access')) changePermissionMode(option.id)
  }
  const openCredentialSettings = () => {
    const provider = credentialSetup ?? sessionProvider
    if (provider !== modelProvider) setModelProvider(provider)
    setCredentialSetup(undefined)
    router.push(settingsDetailRoutes.models)
  }
  return {
    running, stopping, error, credentialSetup, setCredentialSetup, sessionId,
    sessionRecord, sessionHistoryState, forkingBranch, planMode, planModeSubmitting, showGoal,
    setShowGoal, goalDraftObjective, setGoalDraftObjective, goal, goalMutationAction, goalError: goalError ?? goalLoadError,
    setGoalError, sessionProvider, sessionModel, sessionAgentPreset, setSessionPermissionMode, pendingPermissionMode,
    setPendingPermissionMode, quickAction, setQuickAction, todoDialogOpen, setTodoDialogOpen, queueActions,
    pendingDestructiveAction, setPendingDestructiveAction, destructiveActionBusy, destructiveActionError, setDestructiveActionError, approvalResponseAction,
    approvalBusy, approvalError, permissionLabel, admissionSubmitting, primaryAction, imagePickerAvailable,
    transitionQueueAction, refreshSessionHistory, pendingAgentApproval, pendingQuestion, currentSessionEvents, visibleQueued,
    agentTodos, completedTodoCount, ongoingGoal, goalSessionReady, retryPrompt, currentSubmittedPrompt,
    livePrompt, runConnectionIssue, sessionRetryAvailable, recoveryState, recoveryMessage, retryPending, quickActionOptions, runPrompt, retrySession, submit, stopAgent,
    forkSession, convertQueuedMessageToSteer, resolveAgentApproval, answerQuestion, setAgentPlanMode, mutateGoal,
    confirmDestructiveAction, dismissDestructiveAction, destructiveActionCopy, openQuickAction, selectQuickAction, openCredentialSettings,
    composer,
  }
}

function isMissingCredentialFailure(cause: unknown): boolean {
  const error = cause as { code?: unknown; message?: unknown } | undefined
  return error?.code === 'MISSING_CREDENTIAL' || (typeof error?.message === 'string' && error.message.startsWith('MISSING_CREDENTIAL:'))
}
