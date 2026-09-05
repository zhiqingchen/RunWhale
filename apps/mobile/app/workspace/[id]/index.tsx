import { ProjectLoadFailure } from '@/components/ProjectLoadFailure'
import { useLocalSearchParams, router } from 'expo-router'
import { ArrowLeft, FileCode2, History } from '@/components/icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BackHandler, Keyboard, Platform, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { Alert } from 'heroui-native/alert'
import { Button } from 'heroui-native/button'
import { Spinner } from 'heroui-native/spinner'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import type { AgentSessionSummary } from '@runwhale/mobile-protocol'
import CodeEditor from '@/components/CodeEditor'
import { AgentPanel } from '@/components/AgentPanel'
import { PreviewPanel, type PreviewPanelHandle, type PreviewPanelPresentation } from '@/components/PreviewPanel'
import { localizedSessionState, ProjectSessionNavigation, type ProjectSessionSurface } from '@/components/ProjectSessionNavigation'
import { projectFilePaths, useProjects } from '@/state/projects'
import { controlSize, typeScale, type ThemeColors, useAppColors } from '@/theme/tokens'
import { useRuntime } from '@/state/runtime'
import { useI18n } from '@/i18n'
import { AppIcon } from '@/components/AppIcon'
import { createMobileSessionId } from '@/utils/session-id'
import { firstPromptSessionTitle, loadSessionSummariesOnce, sessionRefreshPresentationStatus, shouldInitializeSessionTitle } from '@/utils/session-actions'
import { actionErrorPresentation, runExclusiveAction } from '@/utils/action-progress'
import { workspaceAndroidBackAction, workspaceEditorContentState, workspaceFilePaneVisibility, workspacePreferredFilePath, workspacePreviewAutoOpenRequested, workspaceProjectRouteState, workspaceSupportsEmbeddedPreview, type WorkspaceFilePane, type WorkspacePreviewPresentation } from '@/utils/workspace-layout'
import { EditorDraftNotice } from '@/components/EditorDraftNotice'
import { latestAgentLifecycleState } from '@/utils/agent-lifecycle'

type ProjectSessionSummaryStatus = 'loading' | 'failed' | 'ready'

export default function WorkspaceScreen() {
  const { id, sessionId: requestedSessionId, preview, repairPrompt } = useLocalSearchParams<{ id: string; sessionId?: string; preview?: string; repairPrompt?: string }>()
  const { projects, loadStatus: projectLoadStatus, retryLoad: retryProjectLoad, updateFile, loadFile, refreshFiles, drafts, touchRecentFile } = useProjects()
  const runtime = useRuntime()
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const safeAreaInsets = useSafeAreaInsets()
  const project = projects.find((item) => item.id === id)
  const projectRouteState = workspaceProjectRouteState(projectLoadStatus, Boolean(project))
  const [retryingProjectLoad, setRetryingProjectLoad] = useState(false)
  const projectLoadRetryInFlight = useRef(false)
  const [surface, setSurface] = useState<ProjectSessionSurface>('agent')
  const [autoOpenPreview] = useState(() => workspacePreviewAutoOpenRequested(preview))
  const supportsEmbeddedPreview = workspaceSupportsEmbeddedPreview(Platform.OS, Platform.OS === 'ios' && Platform.isPad)
  const [previewPresentation, setPreviewPresentation] = useState<WorkspacePreviewPresentation>(() => autoOpenPreview && supportsEmbeddedPreview ? 'split' : 'hidden')
  const [previewBusy, setPreviewBusy] = useState(false)
  const previewRef = useRef<PreviewPanelHandle>(null)
  const requestPreviewPresentation = useCallback((nextPresentation: PreviewPanelPresentation | 'hidden') => {
    if (!supportsEmbeddedPreview) return
    const resolved = nextPresentation === 'overlay' ? 'split' : nextPresentation
    setPreviewPresentation(resolved)
    if (resolved !== 'hidden') setSurface('agent')
  }, [supportsEmbeddedPreview])
  const closePreview = useCallback(() => {
    previewRef.current?.minimize()
    setPreviewPresentation('hidden')
  }, [])
  const [sessionId, setSessionId] = useState(() => requestedSessionId ?? createMobileSessionId())
  const [sessionDetailsOpen, setSessionDetailsOpen] = useState(false)
  useEffect(() => { setSessionDetailsOpen(false) }, [sessionId])
  const [promptInsertion, setPromptInsertion] = useState<{ id: string; sessionId: string; text: string } | undefined>(() => repairPrompt
    ? { id: createMobileSessionId(), sessionId, text: repairPrompt }
    : undefined)
  useEffect(() => {
    if (repairPrompt) router.setParams({ repairPrompt: undefined })
  }, [repairPrompt])
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([])
  const [sessionSummaryStatus, setSessionSummaryStatus] = useState<ProjectSessionSummaryStatus>('loading')
  const [sessionSummariesRefreshing, setSessionSummariesRefreshing] = useState(false)
  const sessionSummaryRefreshInFlight = useRef(false)
  const hydratedSessionSummaryProject = useRef<string | undefined>(undefined)
  const [agentRunning, setAgentRunning] = useState(false)
  const [filePath, setFilePath] = useState(() => workspacePreferredFilePath(project ? projectFilePaths(project).map((path) => project.files.find((file) => file.path === path) ?? { path }) : [], project?.recentFiles))
  const selectedFileByUser = useRef(false)
  const [fileSearch, setFileSearch] = useState('')
  const [filesMounted, setFilesMounted] = useState(false)
  const [compactFilePane, setCompactFilePane] = useState<WorkspaceFilePane>('browser')
  const { width } = useWindowDimensions()
  const filePaneVisibility = workspaceFilePaneVisibility(width, compactFilePane)
  const filePaneSplit = filePaneVisibility.split
  const filePaths = project ? projectFilePaths(project) : []
  const [fileError, setFileError] = useState<string>()
  const [fileRetry, setFileRetry] = useState(0)
  const file = project?.files.find((item) => item.path === filePath)
  useEffect(() => {
    if (!filesMounted || !project || !filePath || file) return
    let current = true
    setFileError(undefined)
    void loadFile(project.id, filePath).catch((cause: unknown) => { if (current) setFileError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { current = false }
  }, [filesMounted, project?.id, filePath, file, fileRetry, loadFile])
  const editorContentState = workspaceEditorContentState(Boolean(file))
  const filteredFiles = useMemo(() => {
    const query = fileSearch.trim().toLowerCase()
    return (project ? projectFilePaths(project).map((path) => project.files.find((file) => file.path === path) ?? { path }) : []).filter((item) => !query || item.path.toLowerCase().includes(query)).sort((left, right) => left.path.localeCompare(right.path))
  }, [fileSearch, project?.filePaths, project?.files])
  const recentFiles = (project?.recentFiles ?? []).map((path) => filePaths.includes(path) ? { path } : undefined).filter((item): item is NonNullable<typeof item> => Boolean(item))
  useEffect(() => {
    if (!project || (projectFilePaths(project).includes(filePath) && (selectedFileByUser.current || !project.files.some((file) => file.path === 'runwhale.json')))) return
    setFilePath(workspacePreferredFilePath(projectFilePaths(project).map((path) => project.files.find((file) => file.path === path) ?? { path }), project.recentFiles))
  }, [filePath, project])
  useEffect(() => {
    if (requestedSessionId) setSessionId(requestedSessionId)
  }, [requestedSessionId])
  useEffect(() => {
    if (!filePaneSplit) setCompactFilePane('browser')
  }, [filePaneSplit])
  useEffect(() => {
    if (Platform.OS !== 'android') return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const action = workspaceAndroidBackAction(surface, filePaneSplit, compactFilePane)
      if (action === 'propagate') return false
      if (action === 'show-file-browser') setCompactFilePane('browser')
      else setSurface('agent')
      return true
    })
    return () => subscription.remove()
  }, [compactFilePane, filePaneSplit, surface])
  const refreshSessions = useCallback(async () => {
    const hydrated = hydratedSessionSummaryProject.current === id
    if (!runtime.info) {
      setSessionSummaryStatus(sessionRefreshPresentationStatus(hydrated, runtime.lastError ? 'failure' : 'start'))
      return
    }
    setSessionSummaryStatus(sessionRefreshPresentationStatus(hydrated, 'start'))
    setSessionSummariesRefreshing(true)
    const result = await loadSessionSummariesOnce(sessionSummaryRefreshInFlight, () => runtime.request('session.list', { projectId: id }))
    if (!result) return
    setSessionSummariesRefreshing(false)
    if (result.status === 'failed') {
      setSessionSummaryStatus(sessionRefreshPresentationStatus(hydratedSessionSummaryProject.current === id, 'failure'))
      return
    }
    hydratedSessionSummaryProject.current = id
    setSessions(result.sessions)
    setSessionSummaryStatus('ready')
  }, [id, runtime.info, runtime.lastError, runtime.request])
  const sessionLifecycleState = useMemo(() => latestAgentLifecycleState(runtime.events, id, sessionId), [id, runtime.events, sessionId])
  useEffect(() => { void refreshSessions() }, [refreshSessions])
  useEffect(() => {
    if (sessionLifecycleState === 'completed' || sessionLifecycleState === 'failed' || sessionLifecycleState === 'aborted') void refreshSessions()
  }, [refreshSessions, sessionLifecycleState])
  const retryProjects = useCallback(async () => {
    await runExclusiveAction(projectLoadRetryInFlight, async () => {
      setRetryingProjectLoad(true)
      try {
        await retryProjectLoad()
      } finally {
        setRetryingProjectLoad(false)
      }
    })
  }, [retryProjectLoad])

  const leaveProject = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/(tabs)/workspace')
  }

  if (projectRouteState === 'loading') return <SafeAreaView style={styles.safe}><View accessible accessibilityRole="progressbar" accessibilityLabel={t('working')} accessibilityLiveRegion="polite" style={styles.routeState}><Spinner color={colors.accent} /><Text style={styles.routeStateText}>{t('working')}</Text></View></SafeAreaView>
  if (projectRouteState === 'failed') {
    return <SafeAreaView style={styles.safe}><View style={styles.routeState}><View style={styles.routeFailure}>
        <ProjectLoadFailure
          retrying={retryingProjectLoad}
          disabled={projectLoadStatus !== 'failed'}
          onRetry={() => { void retryProjects() }}
          testID="project-route-load-error"
        />
        <Button size="sm" variant="secondary" onPress={leaveProject} style={[styles.routeAction, styles.routeSecondaryAction]}><Button.Label style={styles.routeSecondaryActionLabel}>{t('back')}</Button.Label></Button>
      </View>
    </View></SafeAreaView>
  }
  if (!project) return <SafeAreaView style={styles.safe}><View style={styles.routeState}><View style={styles.routeCard}>
      <Alert {...actionErrorPresentation} style={styles.routeAlert}>
        <Alert.Indicator iconProps={{ size: 17 }} />
        <Alert.Content><Alert.Title>{t('projectNotFound')}</Alert.Title></Alert.Content>
      </Alert>
      <View style={styles.routeActions}>
        <Button size="sm" variant="secondary" onPress={leaveProject} style={[styles.routeAction, styles.routeSecondaryAction]}><Button.Label style={styles.routeSecondaryActionLabel}>{t('projectsBack')}</Button.Label></Button>
      </View>
    </View></View></SafeAreaView>

  const projectName = project.name

  const selectFile = (path: string) => {
    selectedFileByUser.current = true
    setFilePath(path)
    touchRecentFile(project.id, path)
    if (!filePaneSplit) setCompactFilePane('editor')
  }

  const filesPanel = (
    <View style={styles.editorPane}>
      {filePaneVisibility.browser ? <View style={[styles.fileBrowser, filePaneSplit ? styles.fileBrowserWide : styles.fileBrowserCompact]}>
        <TextInput accessibilityLabel={t('searchFiles')} value={fileSearch} onChangeText={setFileSearch} placeholder={t('searchFiles')} placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} style={styles.fileSearch} />
        <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={styles.fileListScroll} contentContainerStyle={styles.fileList}>
          {!fileSearch && recentFiles.length > 0 && <Text style={styles.fileSection}>{t('recent')}</Text>}
          {!fileSearch && recentFiles.map((item) => <FileRow key={`recent-${item.path}`} path={item.path} active={item.path === filePath} recent onPress={() => selectFile(item.path)} />)}
          <Text style={styles.fileSection}>{fileSearch ? t(filteredFiles.length === 1 ? 'matchesSingular' : 'matches', { count: filteredFiles.length }) : t('files').toUpperCase()}</Text>
          {filteredFiles.map((item) => <FileRow key={item.path} path={item.path} active={item.path === filePath} onPress={() => selectFile(item.path)} />)}
          {filteredFiles.length === 0 && <View accessible accessibilityLiveRegion="polite" accessibilityLabel={fileSearch ? t('noMatchingFiles') : `${t('noFileSelected')}. ${t('projectHasNoFiles')}`} style={styles.noFiles}>
            <Text style={styles.noFilesTitle}>{fileSearch ? t('noMatchingFiles') : t('noFileSelected')}</Text>
            {!fileSearch ? <Text style={styles.noFilesDescription}>{t('projectHasNoFiles')}</Text> : null}
          </View>}
        </ScrollView>
      </View> : null}
      {filePaneVisibility.editor ? <View style={styles.editorBody}>
        <View style={[styles.activeFileBar, !filePaneSplit && styles.activeFileBarCompact]}>
          {!filePaneSplit ? <Button size="sm" variant="ghost" accessibilityLabel={`${t('back')}: ${t('files')}`} onPress={() => setCompactFilePane('browser')} style={styles.fileBackButton}>
            <AppIcon icon={ArrowLeft} color={colors.accent} size={17} />
            <Button.Label style={styles.fileBackText}>{t('files')}</Button.Label>
          </Button> : null}
          <Text numberOfLines={1} style={styles.activeFileText}>{filePath || t('noFileSelected')}</Text>
        </View>
        <EditorDraftNotice projectId={project.id} path={filePath} />
        {filePath && !file ? <View style={styles.editorEmpty}>
          {fileError ? <><Text style={styles.editorEmptyDescription}>{fileError}</Text><Button size="sm" onPress={() => setFileRetry((value) => value + 1)}><Button.Label>{t('retry')}</Button.Label></Button></> : <Spinner color={colors.accent} />}
        </View> : null}
        {editorContentState === 'file' && file
          ? <CodeEditor value={file.content} path={file.path} onChange={async (value) => updateFile(project.id, file.path, value)} dom={{ scrollEnabled: true, bounces: false, useExpoDOMWebView: true, unstable_useExpoModulesBridge: false, style: styles.codeEditor }} />
          : !filePath ? <View accessible accessibilityRole="text" accessibilityLabel={`${t('noFileSelected')}. ${projectFilePaths(project).length === 0 ? t('projectHasNoFiles') : t('selectFileToEdit')}`} style={styles.editorEmpty}>
            <AppIcon icon={FileCode2} color={colors.muted} size={24} />
            <Text style={styles.editorEmptyText}>{t('noFileSelected')}</Text>
            <Text style={styles.editorEmptyDescription}>{projectFilePaths(project).length === 0 ? t('projectHasNoFiles') : t('selectFileToEdit')}</Text>
          </View> : null}
      </View> : null}
    </View>
  )

  const unresolvedDraft = drafts.find((draft) => draft.projectId === project.id && draft.status !== 'pending')
  const agentPanel = <View style={{ flex: 1 }}>
    {unresolvedDraft ? <Button size="sm" variant="secondary" onPress={() => { selectFile(unresolvedDraft.path); setFilesMounted(true); setSurface('files') }}><Button.Label numberOfLines={1}>{t('resolveFileDraft', { path: unresolvedDraft.path })}</Button.Label></Button> : null}
    <AgentPanel key={sessionId} projectId={project.id} initialSessionId={sessionId} sessionSummaries={sessions} sessionSummariesRefreshing={sessionSummariesRefreshing} sessionSummaryStatus={sessionSummaryStatus} events={runtime.events} liveEvents={runtime.liveTranscriptEvents} promptInsertion={promptInsertion?.sessionId === sessionId ? promptInsertion : undefined} onPromptInserted={() => setPromptInsertion(undefined)} onRun={async (options) => {
      const { prompt, sessionId, signal } = options
      if (signal?.aborted) throw signal.reason
      const summary = sessions.find((item) => item.sessionId === sessionId)
      if (!options.resume && sessionId && shouldInitializeSessionTitle(summary, t('newSession'))) {
        const title = firstPromptSessionTitle(prompt)
        if (title) {
          await runtime.request('session.delete', { projectId: project.id, sessionId })
          try {
            await runtime.request('session.create', { projectId: project.id, sessionId, title })
          } catch (cause) {
            await runtime.request('session.create', { projectId: project.id, sessionId, title: summary.title }).catch(() => undefined)
            throw cause
          }
          setSessions((current) => current.map((item) => item.sessionId === sessionId ? { ...item, title, updatedAt: Date.now() } : item))
        }
      }
      if (signal?.aborted) throw signal.reason
      const result = await runtime.runAgent(project, options)
      await refreshFiles(project.id)
      await refreshSessions()
      return { sessionId: result.sessionId, taskId: result.taskId }
    }} onSessionChange={(nextSessionId) => {
      if (!nextSessionId || nextSessionId === sessionId) return
      setSessionId(nextSessionId)
      void refreshSessions()
    }} onRunningChange={setAgentRunning} sessionDetailsOpen={sessionDetailsOpen} onSessionDetailsOpenChange={setSessionDetailsOpen} /></View>

  const selectedSession = sessionSummaryStatus === 'ready' ? sessions.find((session) => session.sessionId === sessionId) : undefined
  const sessionRunning = agentRunning || sessionLifecycleState === 'running' || (sessionLifecycleState === undefined && selectedSession?.state === 'running')
  const status = sessionRunning ? localizedSessionState('running', t)
    : sessionSummaryStatus === 'loading' ? undefined
      : sessionSummaryStatus === 'failed' ? t('stateFailed')
        : localizedSessionState(selectedSession?.state ?? 'idle', t)
  const turnCount = selectedSession?.turnCount ?? 0
  const statusMeta = sessionSummaryStatus === 'ready' ? t(turnCount === 1 ? 'turnCountSingular' : 'turnCount', { count: turnCount }) : ''
  const previewVisible = previewPresentation !== 'hidden'
  const navigationSurface: ProjectSessionSurface = previewVisible ? 'preview' : surface

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safe, styles.navigationSafe]}>
      {previewPresentation !== 'full' ? <ProjectSessionNavigation
        title={selectedSession?.title ?? projectName}
        onOpenDetails={() => { Keyboard.dismiss(); setSessionDetailsOpen(true) }}
        status={status}
        statusMeta={statusMeta}
        statusActive={sessionRunning || (sessionSummaryStatus === 'ready' && selectedSession?.state === 'completed')}
        activeSurface={navigationSurface}
        onSurfaceChange={(nextSurface) => {
          if (nextSurface === 'preview') {
            if (supportsEmbeddedPreview) {
              setSurface('agent')
              setPreviewPresentation('split')
            }
            void previewRef.current?.open()
            return
          }
          if (previewVisible) closePreview()
          if (nextSurface === 'files') {
            setFilesMounted(true)
            if (!filePaneSplit) setCompactFilePane('browser')
          }
          setSurface(nextSurface)
        }}
        onPreviewRun={() => { void previewRef.current?.run() }}
        previewAvailable={Boolean(runtime.info)}
        previewBusy={previewBusy}
        backLabel={surface === 'agent' && !previewVisible ? t('back') : `${t('back')}: ${t('agent')}`}
        onBack={() => { if (previewVisible) closePreview(); else if (surface === 'agent') leaveProject(); else setSurface('agent') }}
      /> : null}
      {previewPresentation !== 'full' && sessionSummaryStatus === 'failed' ? <View style={styles.sessionSummaryFailure}>
        <Alert {...actionErrorPresentation}>
          <Alert.Indicator iconProps={{ size: 17 }} />
          <Alert.Content><Alert.Description style={styles.sessionSummaryError}>{t('sessionsLoadFailed')}</Alert.Description></Alert.Content>
        </Alert>
        <Button size="sm" variant="secondary" accessibilityLabel={t('retry')} accessibilityState={{ disabled: !runtime.info }} isDisabled={!runtime.info} onPress={() => { void refreshSessions() }} style={styles.sessionSummaryRetry}><Button.Label>{t('retry')}</Button.Label></Button>
      </View> : null}
      <View style={[styles.body, (surface !== 'agent' || previewVisible) && { paddingBottom: safeAreaInsets.bottom }]}>
        <View style={[styles.active, previewPresentation === 'full' && styles.activeHidden]}>
          <View style={[styles.surfacePanel, surface !== 'agent' && styles.activeHidden]}>{agentPanel}</View>
          {filesMounted ? <View style={[styles.surfacePanel, surface !== 'files' && styles.activeHidden]}>{filesPanel}</View> : null}
        </View>
        <PreviewPanel
          ref={previewRef}
          key={project.id}
          project={project}
          sessionId={sessionId}
          autoOpen={autoOpenPreview}
          onBusyChange={setPreviewBusy}
          presentation={previewPresentation === 'hidden' ? 'overlay' : previewPresentation}
          onPresentationRequested={requestPreviewPresentation}
          onFixWithAgent={(text) => {
            closePreview()
            setSurface('agent')
            if (text) setPromptInsertion({ id: createMobileSessionId(), sessionId, text })
          }}
        />
      </View>
    </SafeAreaView>
  )
}

function FileRow({ path, active, recent = false, onPress }: { path: string; active: boolean; recent?: boolean; onPress(): void }) {
  const styles = useWorkspaceStyles()
  const colors = useAppColors()
  const parts = path.split('/')
  const name = parts.pop() ?? path
  const folder = parts.join('/')
  return <Button size="sm" variant={active ? 'secondary' : 'ghost'} accessibilityLabel={path} accessibilityState={{ selected: active }} onPress={onPress} style={[styles.fileRow, active && styles.fileRowActive]}>
    <AppIcon icon={recent ? History : FileCode2} color={colors.blue} size={13} />
    <View style={styles.fileLabel}><Text numberOfLines={1} style={[styles.fileName, active && styles.fileNameActive]}>{name}</Text>{folder ? <Text numberOfLines={1} style={styles.fileFolder}>{folder}</Text> : null}</View>
  </Button>
}

function useWorkspaceStyles() { const colors = useAppColors(); return useMemo(() => createStyles(colors), [colors]) }
function createStyles(colors: ThemeColors) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  navigationSafe: { backgroundColor: colors.panel },
  routeState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 30 },
  routeFailure: { width: '100%', maxWidth: 440, alignItems: 'flex-start', gap: 12 },
  routeCard: { width: '100%', maxWidth: 440, gap: 12, padding: 18, borderWidth: 1, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.panel },
  routeStateText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  routeAlert: { width: '100%' },
  routeActions: { width: '100%', flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  routeAction: { minHeight: controlSize.regular, minWidth: 96, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  routeSecondaryAction: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised },
  routeSecondaryActionLabel: { color: colors.text, fontSize: typeScale.button, fontWeight: '800', textAlign: 'center' },
  sessionSummaryFailure: { paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.canvas },
  sessionSummaryError: { color: colors.danger, fontSize: 11, lineHeight: 17 },
  sessionSummaryRetry: { alignSelf: 'flex-start', minHeight: controlSize.regular },
  body: { flex: 1, flexDirection: 'row', backgroundColor: colors.canvas },
  active: { flex: 1 },
  surfacePanel: { flex: 1 },
  activeHidden: { display: 'none' },
  editorPane: { flex: 1, flexDirection: 'row', backgroundColor: colors.panel },
  fileBrowser: { backgroundColor: colors.canvas, borderRightColor: colors.border, borderRightWidth: 1 },
  fileBrowserWide: { width: 190 },
  fileBrowserCompact: { flex: 1, borderRightWidth: 0 },
  fileSearch: { height: Platform.OS === 'ios' ? controlSize.regular + 2 : controlSize.regular, margin: 8, marginBottom: 4, paddingHorizontal: 9, borderWidth: 1, borderColor: colors.border, borderRadius: 6, color: colors.text, fontSize: 11 },
  fileListScroll: { flex: 1 },
  fileList: { paddingBottom: 12 },
  fileSection: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1, paddingHorizontal: 10, paddingTop: 9, paddingBottom: 4 },
  fileRow: { minHeight: controlSize.prominent, paddingHorizontal: 9, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 7, borderLeftWidth: 2, borderLeftColor: 'transparent' },
  fileRowActive: { backgroundColor: colors.panel, borderLeftColor: colors.accent },
  fileLabel: { flex: 1 },
  fileName: { color: colors.muted, fontSize: 11, fontFamily: 'monospace' },
  fileNameActive: { color: colors.text },
  fileFolder: { color: colors.muted, fontSize: 9, fontFamily: 'monospace', marginTop: 1 },
  noFiles: { gap: 3, padding: 10 },
  noFilesTitle: { color: colors.text, fontSize: 11, lineHeight: 16, fontWeight: '800' },
  noFilesDescription: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  editorBody: { flex: 1, minWidth: 0 },
  codeEditor: { flex: 1, backgroundColor: colors.panel },
  editorEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, backgroundColor: colors.panel },
  editorEmptyText: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '800', textAlign: 'center' },
  editorEmptyDescription: { maxWidth: 280, color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  activeFileBar: { height: 37, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, backgroundColor: colors.canvas, borderBottomColor: colors.border, borderBottomWidth: 1 },
  activeFileBarCompact: { height: 45, gap: 6, paddingHorizontal: 6 },
  activeFileText: { flex: 1, minWidth: 0, color: colors.text, fontSize: 11, fontFamily: 'monospace' },
  fileBackButton: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7 },
  fileBackText: { color: colors.accent, fontSize: 11, fontWeight: '900' },
}) }
