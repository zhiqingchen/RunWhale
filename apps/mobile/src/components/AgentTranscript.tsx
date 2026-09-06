import { memo, type ReactNode, type Ref, type RefObject, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Bot, Check, ChevronDown, ChevronRight, Circle, CircleCheck, CircleX, Code2, Copy, Database, GitBranch, History, Image as ImageIcon, Maximize2, RefreshCw } from '@/components/icons'
import { FlatList, Image, type LayoutChangeEvent, type ListRenderItemInfo, type NativeScrollEvent, type NativeSyntheticEvent, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { NodeHost } from '@runwhale/node-host'
import { Alert } from 'heroui-native/alert'
import { Button } from 'heroui-native/button'
import { Spinner } from 'heroui-native/spinner'
import { useI18n } from '@/i18n'
import { type ThemeColors, useAppColors } from '@/theme/tokens'
import { AppIcon } from '@/components/AppIcon'
import { PendingButton } from '@/components/PendingButton'
import { TranscriptCodeBlock, useClipboardCopyFeedback } from '@/components/TranscriptCodeBlock'
import { ToolActivityDialog } from '@/components/ToolActivityDialog'
import { TranscriptTextDetails } from '@/components/TranscriptDetailsSheet'
import { ImageLightbox } from '@/components/ImageLightbox'
import { storedAgentImageUri } from '@/utils/agent-image'
import { agentKeyboardDismissMode } from '@/utils/agent-keyboard'
import { actionErrorPresentation } from '@/utils/action-progress'
import { createTranscriptPositionCoordinator, transcriptHistoryWindow } from '@/utils/transcript-position'
import { assistantMessageCopyText, transcriptBranchActionState, type AssistantMessageBlock, transcriptInteractionContract, transcriptLayoutContract, type TranscriptBranchInFlight } from '@/utils/transcript-feedback'
import { type ToolActivityGroup, type ToolActivitySessionEvent, type ToolActivityState } from '@/utils/tool-activity'
import { contextDetailSummary, type TranscriptContextRecord } from '@/utils/transcript-context'
import { projectSessionTranscript, type SessionTranscriptRow } from '@/utils/session-transcript'
import { type PendingTranscriptPrompt } from '@/utils/transcript-user'

interface TranscriptImage { attachmentId?: string; name: string; width?: number; height?: number; bytes?: number }

export type TranscriptRow = SessionTranscriptRow
  | { kind: 'live-prompt'; id: string; text: string }
  | { kind: 'live-working'; id: string; label: string }

// Older pages append to the inverted list, preserving the visible messages.
const HISTORY_PAGE_SIZE = 16
const TRANSCRIPT_MAINTAIN_VISIBLE_POSITION = { minIndexForVisible: 0 } as const
const TRANSCRIPT_WINDOW_SIZE = 15
const TRANSCRIPT_BATCHING_PERIOD = 16
const MESSAGE_ACTION_HIT_SLOP = { top: 0, right: 6, bottom: 0, left: 6 } as const

export interface AgentTranscriptHandle {
  scrollToBottom(): void
  scrollToTop(): void
}

export function AgentTranscript({ ref, events, livePrompt, liveWorkingLabel, onBranch, branching, branchAvailable = true, followPaused = false, header, footer, listRef, onScroll, onScrollEndDrag, onMomentumScrollEnd, onContentSizeChange }: {
  ref?: Ref<AgentTranscriptHandle>
  events: readonly unknown[]
  livePrompt?: PendingTranscriptPrompt
  liveWorkingLabel?: string
  onBranch?(sequence?: number): void
  branching?: TranscriptBranchInFlight
  branchAvailable?: boolean
  followPaused?: boolean
  header?: ReactNode
  footer?: ReactNode
  listRef?: RefObject<FlatList<TranscriptRow> | null>
  onScroll?(event: NativeSyntheticEvent<NativeScrollEvent>): void
  onScrollEndDrag?(): void
  onMomentumScrollEnd?(): void
  onContentSizeChange?(width: number, height: number): void
}) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useTranscriptStyles()
  const [visibleLimit, setVisibleLimit] = useState(120)
  const [preserveVisiblePosition, setPreserveVisiblePosition] = useState(false)
  const fallbackListRef = useRef<FlatList<TranscriptRow>>(null)
  const resolvedListRef = listRef ?? fallbackListRef
  const positionCoordinator = useRef(createTranscriptPositionCoordinator())
  const hasRows = useRef(false)
  const historyLoadPending = useRef(false)
  const scrollToEdgeFrame = useRef<number | undefined>(undefined)
  const onBranchRef = useRef(onBranch)
  const [selectedActivityId, setSelectedActivityId] = useState<string>()
  const [selectedDetailId, setSelectedDetailId] = useState<string>()
  useEffect(() => { onBranchRef.current = onBranch }, [onBranch])
  const historyRows = useMemo(() => projectSessionTranscript(events as ToolActivitySessionEvent[], Boolean(liveWorkingLabel)), [events, liveWorkingLabel])
  const liveRows = useMemo<TranscriptRow[]>(() => {
    const rows: TranscriptRow[] = []
    if (livePrompt && !historyRows.some(row => row.id === livePrompt.id)) rows.push({ kind: 'live-prompt', ...livePrompt })
    if (liveWorkingLabel) rows.push({ kind: 'live-working', id: 'live-working', label: liveWorkingLabel })
    return rows
  }, [historyRows, livePrompt, liveWorkingLabel])
  const historyWindow = transcriptHistoryWindow(historyRows.length, visibleLimit)
  const loadEarlierLabel = t(historyWindow.hidden === 1 ? 'loadEarlierSingular' : 'loadEarlier', { count: historyWindow.hidden })
  const visibleHistoryRows = useMemo(() => historyRows.slice(historyWindow.start), [historyRows, historyWindow.start])
  const rows = useMemo(() => [...visibleHistoryRows, ...liveRows].reverse(), [liveRows, visibleHistoryRows])
  hasRows.current = rows.length > 0
  const selectedActivity = useMemo(() => rows.find((row): row is Extract<TranscriptRow, { kind: 'activity' }> => row.kind === 'activity' && row.activity.id === selectedActivityId)?.activity, [rows, selectedActivityId])
  const selectedDetail = useMemo(() => rows.find(row => (row.kind === 'context' || row.kind === 'notice') && row.id === selectedDetailId), [rows, selectedDetailId])
  const selectedFailedItemId = selectedActivity?.items.find((item) => item.state === 'failed')?.id

  useEffect(() => { historyLoadPending.current = false }, [historyWindow.start])

  const cancelScheduledScroll = useCallback(() => {
    if (scrollToEdgeFrame.current === undefined) return
    cancelAnimationFrame(scrollToEdgeFrame.current)
    scrollToEdgeFrame.current = undefined
  }, [])

  const loadEarlier = useCallback(() => {
    if (historyLoadPending.current || historyWindow.hidden === 0) return
    positionCoordinator.current.stopFollowing()
    setPreserveVisiblePosition(true)
    cancelScheduledScroll()
    historyLoadPending.current = true
    setVisibleLimit((value) => value + HISTORY_PAGE_SIZE)
  }, [cancelScheduledScroll, historyWindow.hidden])

  const scheduleScrollToEdge = useCallback(() => {
    if (followPaused || scrollToEdgeFrame.current !== undefined) return
    scrollToEdgeFrame.current = requestAnimationFrame(() => {
      scrollToEdgeFrame.current = undefined
      if (!hasRows.current) return
      const offset = positionCoordinator.current.targetOffset()
      if (offset !== undefined) resolvedListRef.current?.scrollToOffset({ offset, animated: false })
    })
  }, [followPaused, resolvedListRef])

  useEffect(() => cancelScheduledScroll, [cancelScheduledScroll])
  useEffect(() => {
    if (followPaused) cancelScheduledScroll()
    else scheduleScrollToEdge()
  }, [cancelScheduledScroll, followPaused, scheduleScrollToEdge])

  useImperativeHandle(ref, () => ({
    scrollToBottom() {
      setPreserveVisiblePosition(false)
      const offset = positionCoordinator.current.startFollowing()
      if (offset !== undefined) resolvedListRef.current?.scrollToOffset({ offset, animated: false })
    },
    scrollToTop() {
      setPreserveVisiblePosition(false)
      cancelScheduledScroll()
      const offset = positionCoordinator.current.startFollowingOldest()
      if (offset !== undefined) resolvedListRef.current?.scrollToOffset({ offset, animated: false })
    },
  }), [cancelScheduledScroll, resolvedListRef])

  const handleContentSizeChange = useCallback((width: number, height: number) => {
    positionCoordinator.current.contentSizeChanged(height)
    if (rows.length > 0) scheduleScrollToEdge()
    onContentSizeChange?.(width, height)
  }, [onContentSizeChange, rows.length, scheduleScrollToEdge])

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    positionCoordinator.current.viewportSizeChanged(event.nativeEvent.layout.height)
    if (rows.length > 0) scheduleScrollToEdge()
  }, [rows.length, scheduleScrollToEdge])

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    positionCoordinator.current.scrolled(event.nativeEvent.contentOffset.y)
    onScroll?.(event)
  }, [onScroll])

  const branchEnabled = Boolean(onBranch)
  const handleBranch = useCallback((sequence?: number) => onBranchRef.current?.(sequence), [])
  const selectActivity = useCallback((activityId: string) => setSelectedActivityId(activityId), [])
  const selectDetails = useCallback((contextId: string) => setSelectedDetailId(contextId), [])
  const renderRow = useCallback(({ item }: ListRenderItemInfo<TranscriptRow>) => <TranscriptRowView
    row={item}
    onBranch={branchEnabled ? handleBranch : undefined}
    branching={branching}
    branchAvailable={branchAvailable}
    onSelectActivity={selectActivity}
    onSelectDetails={selectDetails}
    styles={styles}
    workingColor={colors.accent}
  />, [branchAvailable, branchEnabled, branching, colors.accent, handleBranch, selectActivity, selectDetails, styles])

  const beginUserScroll = useCallback(() => {
    positionCoordinator.current.userScrollBegan()
    setPreserveVisiblePosition(true)
    cancelScheduledScroll()
  }, [cancelScheduledScroll])

  const endUserDrag = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    positionCoordinator.current.scrolled(event.nativeEvent.contentOffset.y)
    const targetOffsetY = event.nativeEvent.targetContentOffset?.y
    const continuesWithMomentum = Math.abs(event.nativeEvent.velocity?.y ?? 0) > 0
      || (targetOffsetY !== undefined && Math.abs(targetOffsetY - event.nativeEvent.contentOffset.y) > 1)
    const offset = positionCoordinator.current.userScrollEnded(continuesWithMomentum)
    setPreserveVisiblePosition(offset === undefined)
    if (offset !== undefined) scheduleScrollToEdge()
  }, [scheduleScrollToEdge])

  const endMomentumScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    positionCoordinator.current.scrolled(event.nativeEvent.contentOffset.y)
    const offset = positionCoordinator.current.momentumScrollEnded()
    setPreserveVisiblePosition(offset === undefined)
    if (offset !== undefined) scheduleScrollToEdge()
  }, [scheduleScrollToEdge])

  const historyHeader = <>{header}{historyWindow.hidden > 0 && <Pressable
      accessibilityRole="button"
      accessibilityLabel={loadEarlierLabel}
      onPress={loadEarlier}
      style={({ pressed }) => [styles.loadEarlier, pressed && styles.loadEarlierPressed]}
    >
      <View style={styles.loadEarlierIcon}><AppIcon icon={History} color={colors.blue} size={15} strokeWidth={2.25} /></View>
      <Text numberOfLines={1} style={styles.loadEarlierText}>{loadEarlierLabel}</Text>
    </Pressable>}</>

  return <><FlatList
    ref={resolvedListRef}
    style={styles.virtualList}
    contentContainerStyle={styles.list}
    data={rows}
    inverted={rows.length > 0}
    renderItem={renderRow}
    keyExtractor={transcriptRowKey}
    initialNumToRender={18}
    maxToRenderPerBatch={24}
    updateCellsBatchingPeriod={TRANSCRIPT_BATCHING_PERIOD}
    windowSize={TRANSCRIPT_WINDOW_SIZE}
    removeClippedSubviews={false}
    // Native anchoring must not move the list away from the edge JS is following.
    maintainVisibleContentPosition={rows.length > 0 && (preserveVisiblePosition || followPaused) ? TRANSCRIPT_MAINTAIN_VISIBLE_POSITION : undefined}
    ListEmptyComponent={header || footer ? null : <Text style={styles.empty}>{t('sessionNoMessages')}</Text>}
    ListHeaderComponent={rows.length > 0 ? <>{footer}</> : historyHeader}
    ListFooterComponent={rows.length > 0 ? historyHeader : <>{footer}</>}
    scrollEventThrottle={120}
    onLayout={handleLayout}
    onScroll={handleScroll}
    onScrollBeginDrag={beginUserScroll}
    onScrollEndDrag={(event) => { endUserDrag(event); onScrollEndDrag?.() }}
    onMomentumScrollEnd={(event) => { endMomentumScroll(event); onMomentumScrollEnd?.() }}
    onContentSizeChange={handleContentSizeChange}
    automaticallyAdjustKeyboardInsets={false}
    contentInsetAdjustmentBehavior="never"
    keyboardDismissMode={agentKeyboardDismissMode(Platform.OS)}
    keyboardShouldPersistTaps="handled"
  /><ToolActivityDialog
    open={Boolean(selectedActivityId && selectedActivity)}
    onOpenChange={(open) => { if (!open) setSelectedActivityId(undefined) }}
    activity={selectedActivity}
    initialItemId={selectedFailedItemId}
    testID="tool-activity-dialog"
  /><TranscriptTextDetails
    open={Boolean(selectedDetail)}
    onOpenChange={(open) => { if (!open) setSelectedDetailId(undefined) }}
    title={selectedDetail?.kind === 'notice' ? noticeLabel(selectedDetail.label, t) : selectedDetail?.kind === 'context' ? selectedDetail.context.details[0]?.sourceName ?? t('context') : ''}
    text={selectedDetail?.kind === 'notice' ? selectedDetail.text : selectedDetail?.kind === 'context' ? selectedDetail.context.details.map(detail => detail.text).join('\n') : ''}
    testID="transcript-details-sheet"
  /></>
}

const TranscriptRowView = memo(function TranscriptRowView({ row, onBranch, branching, branchAvailable, onSelectActivity, onSelectDetails, styles, workingColor }: {
  row: TranscriptRow
  onBranch?(sequence?: number): void
  branching?: TranscriptBranchInFlight
  branchAvailable: boolean
  onSelectActivity(activityId: string): void
  onSelectDetails(contextId: string): void
  styles: ReturnType<typeof createStyles>
  workingColor: string
}) {
  if (row.kind === 'user') { const images = messageImages(row.event.data); return <View style={styles.userBubbleRow}><View style={styles.userBubble}>{images.length > 0 && <MessageImageGallery images={images} />}{Boolean(row.text) && <TranscriptRichText text={row.text} inverted />}</View></View> }
  if (row.kind === 'assistant') return <AssistantMessage status={row.status} event={row.event} blocks={row.blocks} branchSequence={row.branchSequence} onBranch={onBranch} branching={branching} branchAvailable={branchAvailable} />
  if (row.kind === 'activity') return <ToolActivityCard activity={row.activity} onPress={() => onSelectActivity(row.activity.id)} />
  if (row.kind === 'turn') return <TurnFooter event={row.event} />
  if (row.kind === 'notice') return <TranscriptNotice row={row} onPress={() => onSelectDetails(row.id)} />
  if (row.kind === 'context') return <ContextCard context={row.context} onSelectDetails={onSelectDetails} />
  if (row.kind === 'live-prompt') return <View style={styles.userBubbleRow}><View style={styles.userBubble}><TranscriptRichText text={row.text} inverted /></View></View>
  if (row.kind === 'live-working') return <View accessible accessibilityRole="progressbar" accessibilityLabel={row.label} accessibilityLiveRegion="polite" style={styles.liveWorking}><Spinner size="sm" color={workingColor} /><Text style={styles.liveWorkingText}>{row.label}</Text></View>
  return null
})

function AssistantMessage({ status, event, blocks, branchSequence, onBranch, branching, branchAvailable }: { status: Extract<TranscriptRow, { kind: 'assistant' }>['status']; event?: ToolActivitySessionEvent; blocks: AssistantMessageBlock[]; branchSequence?: number; onBranch?(sequence?: number): void; branching?: TranscriptBranchInFlight; branchAvailable: boolean }) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useTranscriptStyles()
  const answer = assistantMessageCopyText(blocks)
  const { copyState, copy } = useClipboardCopyFeedback(answer)
  const copyBusy = copyState === 'copying'
  const copyLabel = copyState === 'copied' ? t('copied') : t('copyResponse')
  const settled = status !== 'streaming'
  return <View style={styles.assistant}>
    <MessageHeader label={t('agent')} time={event?.time} action={settled ? <View style={styles.messageActions}>
      {answer ? <PendingButton isIconOnly size="sm" variant="ghost" accessibilityRole="button" accessibilityLabel={copyLabel} hitSlop={MESSAGE_ACTION_HIT_SLOP} isPending={copyBusy} isDisabled={!answer} onPress={() => { void copy() }} style={styles.assistantCopyButton}>
        {({ isPending }) => isPending ? <Spinner size="sm" color={colors.accent} /> : <AppIcon icon={copyState === 'copied' ? Check : Copy} color={copyState === 'copied' ? colors.accent : colors.muted} size={16} />}
      </PendingButton> : undefined}
      {onBranch && branchSequence !== undefined && answer ? <AssistantMessageBranchAction sequence={branchSequence} onBranch={onBranch} branching={branching} available={branchAvailable} /> : undefined}
    </View> : <View accessible accessibilityRole="progressbar" accessibilityLabel={t('agentWorking')} accessibilityLiveRegion="polite" style={styles.assistantStreaming}><Spinner size="sm" color={colors.accent} /></View>} />
    {blocks.map((block, blockIndex) => block.kind === 'reasoning'
      ? <ReasoningBlock key={blockIndex} text={block.text} />
      : <TranscriptRichText key={blockIndex} text={block.text} />)}
    {status === 'interrupted' ? <View accessible accessibilityLabel={t('stateStopped')} style={styles.assistantInterrupted}><AppIcon icon={Circle} color={colors.muted} size={12} /></View> : null}
    {settled && copyState === 'failed' ? <Alert {...actionErrorPresentation}>
      <Alert.Indicator iconProps={{ size: 17 }} />
      <Alert.Content><Alert.Description>{t('responseCopyFailed')}</Alert.Description></Alert.Content>
    </Alert> : null}
  </View>
}

function MessageHeader({ label, time, action }: { label: string; time?: number; action?: ReactNode }) {
  const styles = useTranscriptStyles()
  return <View style={styles.messageHeader}><View accessible accessibilityLabel={label} style={[styles.messageAvatar, styles.agentAvatar]}><AppIcon icon={Bot} color="#FFFFFF" size={12} /></View><View style={styles.messageHeaderSpacer} />{action}{time !== undefined && <Text style={styles.messageTime}>{formatMessageTime(time)}</Text>}</View>
}

function AssistantMessageBranchAction({ sequence, onBranch, branching, available }: { sequence?: number; onBranch(sequence?: number): void; branching?: TranscriptBranchInFlight; available: boolean }) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useTranscriptStyles()
  const actionState = transcriptBranchActionState(branching, sequence, available)
  return <PendingButton isIconOnly size="sm" variant="ghost" accessibilityLabel={t('branchFromMessage')} hitSlop={MESSAGE_ACTION_HIT_SLOP} isPending={actionState.busy} isDisabled={!actionState.available} onPress={() => onBranch(sequence)} style={styles.messageTextAction}>{({ isPending }) => isPending ? <Spinner size="sm" color={colors.accent} /> : <AppIcon icon={GitBranch} color={colors.muted} size={16} />}</PendingButton>
}

function TranscriptNotice({ row, onPress }: { row: Extract<TranscriptRow, { kind: 'notice' }>; onPress(): void }) {
  const { t } = useI18n()
  const colors = useAppColors()
  const label = noticeLabel(row.label, t)
  const error = row.label === 'error' ? asRecord(row.event.data?.reason)?.error : row.event.data?.error
  const summary = conciseToolValue(error) ?? contextDetailSummary(row.text)
  return <TranscriptDetailCard
    label={label}
    title={summary || label}
    onPress={onPress}
    failed={row.failed}
    running={row.busy}
    icon={row.busy ? <Spinner size="sm" color={colors.blue} /> : <AppIcon icon={row.failed ? CircleX : ({ command: Code2, compaction: Database, retry: RefreshCw, error: CircleX, 'max-tokens': Circle })[row.label]} color={row.failed ? colors.danger : colors.blue} size={17} />}
  />
}

function noticeLabel(label: Extract<TranscriptRow, { kind: 'notice' }>['label'], t: ReturnType<typeof useI18n>['t']): string {
  return t(({ command: 'commands', compaction: 'compactionSummary', retry: 'modelRetry', error: 'stateFailed', 'max-tokens': 'maxTokensReached' } as const)[label])
}

function ContextCard({ context, onSelectDetails }: { context: TranscriptContextRecord; onSelectDetails(contextId: string): void }) {
  const { t } = useI18n()
  const colors = useAppColors()
  const detail = context.details[0]
  return <TranscriptDetailCard label={t('context')} title={detail?.sourceName ?? detail?.sourceKind ?? t('context')} summary={contextDetailSummary(detail?.text ?? '')} onPress={() => onSelectDetails(context.id)} icon={<AppIcon icon={Database} color={colors.blue} size={17} />} />
}

function TranscriptDetailCard({ icon, label, title, summary, onPress, failed, running }: {
  icon: ReactNode
  label: string
  title: string
  summary?: string
  onPress(): void
  failed?: boolean
  running?: boolean
}) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useTranscriptStyles()
  return <Button size="sm" variant="ghost" accessibilityLabel={[label, title, summary].filter(Boolean).join(', ')} accessibilityHint={t('details')} onPress={onPress} style={[styles.activity, running && styles.activityRunning]}>
    <View pointerEvents="none" style={styles.activityIcon}>{icon}</View>
    <View style={styles.activityCopy}>
      <Text numberOfLines={summary ? 1 : 2} style={[styles.activityTools, failed && styles.danger]}>{title}</Text>
      {summary ? <Text numberOfLines={1} style={styles.activityDetail}>{summary}</Text> : null}
    </View>
    <AppIcon icon={ChevronRight} color={colors.muted} size={14} />
  </Button>
}

function ReasoningBlock({ text }: { text: string }) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useTranscriptStyles()
  const [open, setOpen] = useState(false)
  return <View style={styles.reasoning}>
    <Button size="sm" variant="ghost" accessibilityState={{ expanded: open }} onPress={() => setOpen((value) => !value)} style={styles.reasoningHeader}>
      <View style={styles.iconTitle}><AppIcon icon={open ? ChevronDown : ChevronRight} color={colors.accent} size={14} /><Text style={styles.reasoningTitle}>{t('reasoning')}</Text></View>
      <Text style={styles.reasoningMeta}>{t(text.length === 1 ? 'characterCountSingular' : 'characterCount', { count: text.length })}</Text>
    </Button>
    <TranscriptTextDetails open={open} onOpenChange={setOpen} title={t('reasoning')} text={text} />
  </View>
}

function ToolActivityCard({ activity, onPress }: { activity: ToolActivityGroup; onPress(): void }) {
  const { t } = useI18n()
  const colors = useAppColors()
  const countLabel = t(activity.items.length === 1 ? 'toolActivityCountSingular' : 'toolActivityCount', { count: activity.items.length })
  const statusLabel = toolActivityStatusLabel(activity.state, t)
  const failed = activity.items.find((item) => item.state === 'failed')
  const running = [...activity.items].reverse().find((item) => item.state === 'running')
  const settledTarget = [...activity.items].reverse().find((item) => item.target)?.target
  const detail = failed
    ? conciseToolValue(failed.error ?? failed.output)
    : running ? [running.name.trim() || t('unknownTool'), running.target].filter(Boolean).join(' · ') : settledTarget
  const icon = activity.state === 'failed' ? CircleX : activity.state === 'succeeded' ? CircleCheck : Circle
  return <TranscriptDetailCard
    label={[t('toolActivity'), countLabel, statusLabel].join(', ')}
    title={toolNameSummary(activity, t('unknownTool'))}
    summary={detail}
    onPress={onPress}
    failed={activity.state === 'failed'}
    running={activity.state === 'running'}
    icon={activity.state === 'running' ? <Spinner color={colors.blue} size="sm" /> : <AppIcon icon={icon} color={activity.state === 'failed' ? colors.danger : colors.accent} size={17} />}
  />
}

function TurnFooter({ event }: { event: ToolActivitySessionEvent }) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useTranscriptStyles()
  const reason = asRecord(event.data?.reason)
  const kind = String(reason?.kind ?? 'completed')
  return <View accessible accessibilityLabel={`${t('turnNumber', { count: Number(event.data?.turn ?? 0) })}, ${localizedState(kind, t)}`} style={styles.turnFooter}>
    <AppIcon icon={History} color={colors.muted} size={12} />
    <Text style={styles.turnText}>{String(event.data?.turn ?? '')}</Text>
    <AppIcon icon={kind === 'error' ? CircleX : kind === 'stop' || kind === 'completed' ? Check : Circle} color={kind === 'error' ? colors.danger : colors.muted} size={13} />
  </View>
}

export const TranscriptRichText = memo(function TranscriptRichText({ text, inverted = false }: { text: string; inverted?: boolean }) {
  const { t } = useI18n()
  const styles = useTranscriptStyles()
  const parts = useMemo(() => markdownParts(text), [text])
  return <View style={styles.rich}>{parts.map((part, index) => part.kind === 'code'
    ? <TranscriptCodeBlock key={index} code={part.text} language={part.language} copyLabel={t('copy')} copiedLabel={t('copied')} copyFailedLabel={t('codeCopyFailed')} />
    : <MarkdownText key={index} text={part.text} inverted={inverted} />)}</View>
})

const MarkdownText = memo(function MarkdownText({ text, inverted }: { text: string; inverted: boolean }) {
  const styles = useTranscriptStyles()
  return <View style={styles.markdown}>{text.split('\n').map((line, index) => {
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    const numbered = line.match(/^\s*(\d+)\.\s+(.+)$/)
    const quote = line.match(/^>\s?(.*)$/)
    const body = heading?.[2] ?? bullet?.[1] ?? numbered?.[2] ?? quote?.[1] ?? line
    return <View key={index} style={[styles.markdownLine, quote && styles.quoteLine]}>
      {bullet && <Text style={[styles.marker, inverted && styles.inverted]}>•</Text>}
      {numbered && <Text style={[styles.marker, inverted && styles.inverted]}>{numbered[1]}.</Text>}
      <Text selectable style={[styles.paragraph, inverted && styles.inverted, heading && (heading[1]!.length === 1 ? styles.heading1 : heading[1]!.length === 2 ? styles.heading2 : styles.heading3), quote && styles.quoteText]}>{inlineMarkdown(body, styles, inverted)}</Text>
    </View>
  })}</View>
})

function inlineMarkdown(text: string, styles: ReturnType<typeof createStyles>, inverted: boolean) {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\[[^\]]+\]\([^)]+\))/g)
  return tokens.map((token, index) => {
    if (token.startsWith('`') && token.endsWith('`')) return <Text key={index} style={[styles.inlineCode, inverted && styles.inlineCodeInverted]}>{token.slice(1, -1)}</Text>
    if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) return <Text key={index} style={styles.bold}>{token.slice(2, -2)}</Text>
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    return <Text key={index} style={[link && styles.link, link && inverted && styles.linkInverted]}>{link?.[1] ?? token}</Text>
  })
}

function MessageImageGallery({ images }: { images: TranscriptImage[] }) {
  const styles = useTranscriptStyles()
  const [selected, setSelected] = useState<{ uri: string; name: string }>()
  const [failed, setFailed] = useState<Record<number, true>>({})
  return <>
    <View style={styles.messageImages}>{images.map((image, imageIndex) => {
      const uri = failed[imageIndex] ? undefined : messageImageUri(image)
      if (!uri) return <View key={imageIndex} style={styles.messageImageFallback}><AppIcon icon={ImageIcon} color="#FFFFFF" size={13} /><Text numberOfLines={2} style={styles.userMessageImage}>{image.name}</Text></View>
      return <Pressable key={imageIndex} accessibilityRole="button" accessibilityLabel={image.name} onPress={() => setSelected({ uri, name: image.name })} style={images.length === 1 ? styles.messageImageSingle : styles.messageImageMultiple}>
        <Image source={{ uri }} resizeMode="cover" onError={() => setFailed((current) => ({ ...current, [imageIndex]: true }))} style={styles.messageImageThumbnail} />
        <View style={styles.messageImageExpand}><AppIcon icon={Maximize2} color="#FFFFFF" size={12} /></View>
      </Pressable>
    })}</View>
    <ImageLightbox uri={selected?.uri} name={selected?.name ?? ''} onClose={() => setSelected(undefined)} />
  </>
}

function messageImageUri(image: TranscriptImage): string | undefined {
  return image.attachmentId ? storedAgentImageUri(NodeHost.runtimeRoot(), image.attachmentId) : undefined
}

function messageImages(data: Record<string, unknown> | undefined): TranscriptImage[] {
  const message = asRecord(data?.message) ?? data
  const content = Array.isArray(message?.content) ? message.content : []
  return content.flatMap((value) => {
    const block = asRecord(value)
    const attachment = asRecord(block?.attachment)
    if (block?.type !== 'image' || !attachment) return []
    return [{
      ...(typeof attachment.attachmentId === 'string' ? { attachmentId: attachment.attachmentId } : {}),
      name: typeof attachment.name === 'string' ? attachment.name : 'image',
      ...(typeof attachment.width === 'number' ? { width: attachment.width } : {}),
      ...(typeof attachment.height === 'number' ? { height: attachment.height } : {}),
      ...(typeof attachment.bytes === 'number' ? { bytes: attachment.bytes } : {}),
    }]
  })
}

function formatMessageTime(value: number): string {
  const milliseconds = value < 1_000_000_000_000 ? value * 1_000 : value
  return new Date(milliseconds).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}


function localizedState(state: string, t: ReturnType<typeof useI18n>['t']): string {
  if (state === 'completed' || state === 'stop') return t('stateCompleted')
  if (state === 'error' || state === 'failed') return t('stateFailed')
  if (state === 'aborted' || state === 'cancelled') return t('stateAborted')
  if (state === 'running') return t('stateRunning')
  if (state === 'paused') return t('statePaused')
  if (state === 'interrupted') return t('stateInterrupted')
  if (state === 'max-tokens') return t('maxTokensReached')
  return state
}

function toolActivityStatusLabel(state: ToolActivityState, t: ReturnType<typeof useI18n>['t']): string {
  if (state === 'running') return t('stateRunning')
  if (state === 'failed') return t('stateFailed')
  if (state === 'stopped') return t('stateStopped')
  return t('stateCompleted')
}

function toolNameSummary(activity: ToolActivityGroup, unknownTool: string): string {
  const counts = new Map<string, number>()
  for (const item of activity.items) {
    const name = item.name.trim() || unknownTool
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts].map(([name, count]) => count === 1 ? name : `${name} ×${count}`).join(' · ')
}

function conciseToolValue(value: unknown): string | undefined {
  const text = firstToolText(value)?.trim().replace(/\s+/g, ' ')
  if (!text) return undefined
  return text.length <= 180 ? text : `${text.slice(0, 177)}…`
}

function firstToolText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = firstToolText(item)
      if (text) return text
    }
    return undefined
  }
  const record = asRecord(value)
  if (!record) return undefined
  for (const key of ['message', 'text', 'error', 'reason', 'content']) {
    const text = firstToolText(record[key])
    if (text) return text
  }
  return undefined
}

function markdownParts(value: string): Array<{ kind: 'text'; text: string } | { kind: 'code'; text: string; language: string }> {
  const rows: Array<{ kind: 'text'; text: string } | { kind: 'code'; text: string; language: string }> = []
  const pattern = /```([^\n`]*)\n([\s\S]*?)```/g
  let start = 0
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > start) rows.push({ kind: 'text', text: value.slice(start, index) })
    rows.push({ kind: 'code', language: match[1]!.trim(), text: match[2]! })
    start = index + match[0].length
  }
  if (start < value.length) rows.push({ kind: 'text', text: value.slice(start) })
  return rows.length ? rows : [{ kind: 'text', text: value }]
}

function transcriptRowKey(row: TranscriptRow): string { return row.id }

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function useTranscriptStyles() { const colors = useAppColors(); return useMemo(() => createStyles(colors), [colors]) }
function createStyles(colors: ThemeColors) { return StyleSheet.create({
  virtualList: { flex: 1, backgroundColor: colors.canvas },
  list: { padding: transcriptLayoutContract.listPadding, gap: transcriptLayoutContract.listGap },
  loadEarlier: { minHeight: transcriptInteractionContract.loadEarlierMinimumHeight, maxWidth: '100%', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingRight: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 22, backgroundColor: colors.panel, shadowColor: '#15336A', shadowOpacity: 0.05, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  loadEarlierPressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  loadEarlierIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.accentDeep },
  loadEarlierText: { flexShrink: 1, color: colors.blue, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  empty: { color: colors.muted, lineHeight: 20, paddingVertical: 8 },
  userBubbleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  userBubble: { alignSelf: 'flex-end', maxWidth: '92%', borderRadius: 12, backgroundColor: colors.accent, padding: 13 },
  messageHeader: { height: transcriptLayoutContract.messageHeaderHeight, marginTop: transcriptLayoutContract.messageHeaderMarginTop, marginBottom: transcriptLayoutContract.messageHeaderMarginBottom, flexDirection: 'row', alignItems: 'center', gap: 8 },
  messageActions: { flexDirection: 'row', alignItems: 'center' },
  messageAvatar: { width: 21, height: 21, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#4C6DB3' },
  agentAvatar: { backgroundColor: '#6F63E8' },
  messageHeaderSpacer: { flex: 1 },
  messageTime: { color: colors.muted, fontSize: 9 },
  messageImages: { maxWidth: 220, flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 },
  messageImageSingle: { width: 220, height: 176, borderRadius: 9, overflow: 'hidden', backgroundColor: 'rgba(255, 255, 255, 0.12)' },
  messageImageMultiple: { width: 108, height: 108, borderRadius: 8, overflow: 'hidden', backgroundColor: 'rgba(255, 255, 255, 0.12)' },
  messageImageThumbnail: { width: '100%', height: '100%' },
  messageImageExpand: { position: 'absolute', right: 6, bottom: 6, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(7, 12, 24, 0.66)' },
  messageImageFallback: { width: 220, minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: 'rgba(255, 255, 255, 0.12)' },
  userMessageImage: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  messageTextAction: { width: 32, height: transcriptInteractionContract.branchMinimumSize, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center' },
  assistant: { minWidth: 0, padding: transcriptLayoutContract.messageCardPadding, gap: transcriptLayoutContract.messageCardGap, borderWidth: 1, borderColor: colors.border, borderRadius: transcriptLayoutContract.messageCardRadius, backgroundColor: colors.panel, shadowColor: '#15336A', shadowOpacity: 0.04, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  assistantCopyButton: { width: 32, height: transcriptInteractionContract.assistantCopyMinimumSize, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center' },
  assistantStreaming: { width: 32, height: transcriptInteractionContract.assistantCopyMinimumSize, alignItems: 'center', justifyContent: 'center' },
  assistantInterrupted: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, backgroundColor: colors.raised, paddingHorizontal: 8, paddingVertical: 4 },
  rich: { minWidth: 0, gap: 8 },
  markdown: { minWidth: 0, gap: 3 },
  markdownLine: { minWidth: 0, flexDirection: 'row', gap: 6 },
  marker: { color: colors.blue, width: 18, textAlign: 'right', lineHeight: 21, fontWeight: '800' },
  paragraph: { minWidth: 0, flexShrink: 1, color: colors.text, lineHeight: 21 },
  heading1: { fontSize: 20, lineHeight: 27, fontWeight: '900' },
  heading2: { fontSize: 17, lineHeight: 24, fontWeight: '900' },
  heading3: { fontSize: 14, lineHeight: 22, fontWeight: '900' },
  quoteLine: { borderLeftWidth: 3, borderLeftColor: '#A99AF4', paddingLeft: 9 },
  quoteText: { color: colors.muted },
  bold: { fontWeight: '900' },
  link: { color: colors.blue, textDecorationLine: 'underline' },
  linkInverted: { color: '#FFFFFF' },
  inlineCode: { fontFamily: 'monospace', color: colors.blue, backgroundColor: colors.raised },
  inlineCodeInverted: { color: '#FFFFFF', backgroundColor: 'rgba(255, 255, 255, 0.16)' },
  inverted: { color: '#FFFFFF' },
  reasoning: { borderLeftWidth: 2, borderLeftColor: '#9A88FF', paddingLeft: 10, gap: 7 },
  reasoningHeader: { width: '100%', minHeight: transcriptInteractionContract.disclosureMinimumHeight, paddingHorizontal: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconTitle: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  reasoningTitle: { color: '#6C5AD9', fontSize: 11, fontWeight: '900' },
  reasoningMeta: { color: colors.muted, fontSize: 10 },
  activity: { width: '100%', minHeight: transcriptInteractionContract.disclosureMinimumHeight, height: 'auto', borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: colors.panel, padding: transcriptLayoutContract.toolCardPadding, flexDirection: 'row', alignItems: 'center', gap: 9 },
  activityRunning: { borderLeftWidth: 2, borderLeftColor: colors.blue, backgroundColor: colors.accentDeep },
  activityIcon: { width: 20, minHeight: 20, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  activityCopy: { flex: 1, minWidth: 0, gap: 2 },
  activityTools: { color: colors.text, fontSize: 11, lineHeight: 17, fontWeight: '700' },
  activityDetail: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  liveWorking: { padding: 12, borderRadius: 9, backgroundColor: colors.panel, flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveWorkingText: { color: colors.muted, fontSize: 12 },
  turnFooter: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 5, paddingTop: 3 },
  turnText: { color: colors.muted, fontSize: 10 },
  danger: { color: colors.danger },
}) }
