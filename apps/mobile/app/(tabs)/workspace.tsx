import { ProjectLoadFailure } from '@/components/ProjectLoadFailure'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router } from 'expo-router'
import { Alert } from 'heroui-native/alert'
import { Button } from 'heroui-native/button'
import { Spinner } from 'heroui-native/spinner'
import { ChevronDown, ChevronRight, CircleEllipsis, Code2, FolderGit2, FolderInput, Pencil, Play, Plus, Share2, Smartphone, Trash2 } from '@/components/icons'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { isGitHubImportedProject, projectFilePaths, useProjects } from '@/state/projects'
import { controlSize, topLevelPageTitleStyle, topLevelScreenLayout, typeScale, type ThemeColors, useAppColors } from '@/theme/tokens'
import { useI18n } from '@/i18n'
import { useRuntime } from '@/state/runtime'
import { AppIcon } from '@/components/AppIcon'
import type { AgentSessionSummary } from '@runwhale/mobile-protocol'
import { createMobileSessionId } from '@/utils/session-id'
import { WORKSPACE_COLLAPSED_SESSION_COUNT, workspaceProjectCardAccessibilityContract, workspaceProjectCardLayout, workspaceProjectCardWidth, workspaceProjectOpenActionState, workspaceVisibleSessions } from '@/utils/workspace-layout'
import { clearSessionCreationFailure, closedSessionActionState, createAndNavigateSession, isSessionDeleteAccessibilityAction, loadSessionSummaries, removeSessionSummary, sessionActionReducer, sessionCreationFailureMessage, setSessionCreationFailure, type SessionCreationFailures, type SessionSummaryLoadStatus } from '@/utils/session-actions'
import { AppDialog } from '@/components/AppDialog'
import { PendingButton } from '@/components/PendingButton'
import { NewProjectButton } from '@/components/NewProjectButton'
import { PreviewPanel, type PreviewPanelHandle } from '@/components/PreviewPanel'
import { closedProjectRenameState, isProjectRenameDraftValid, persistProjectRename, ProjectRenameValidationError, projectRenameReducer, projectRenameSelection } from '@/utils/project-rename'
import { actionErrorPresentation, runExclusiveAction } from '@/utils/action-progress'
import { clearAgentDraftsForProject } from '@/utils/agent-draft'
import { closedProjectActionState, omitProjectRecordEntry, performProjectDeletion, projectActionReducer } from '@/utils/project-actions'

export default function WorkspaceScreen() {
  const { projects, loadStatus: projectLoadStatus, retryLoad: retryProjectLoad, renameProject, removeProject } = useProjects()
  const { t } = useI18n()
  const colors = useAppColors()
  const { width } = useWindowDimensions()
  const styles = useMemo(() => createStyles(colors, workspaceProjectCardWidth(width)), [colors, width])
  const runtime = useRuntime()
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, AgentSessionSummary[]>>({})
  const [sessionLoadStatusByProject, setSessionLoadStatusByProject] = useState<Record<string, SessionSummaryLoadStatus>>({})
  const [expandedSessionsByProject, setExpandedSessionsByProject] = useState<Record<string, boolean>>({})
  const sessionRefreshes = useRef(new Map<string, symbol>())
  const [creatingSessionForProject, setCreatingSessionForProject] = useState<string>()
  const [sessionCreationFailures, setSessionCreationFailures] = useState<SessionCreationFailures>({})
  const sessionCreationInFlight = useRef(false)
  const [sessionActionState, dispatchSessionAction] = useReducer(sessionActionReducer, closedSessionActionState)
  const [deletingSessionId, setDeletingSessionId] = useState<string>()
  const sessionDeletionInFlight = useRef(false)
  const [sessionActionError, setSessionActionError] = useState<string>()
  const [projectRenameState, dispatchProjectRename] = useReducer(projectRenameReducer, closedProjectRenameState)
  const [renamingProject, setRenamingProject] = useState(false)
  const projectRenameInFlight = useRef(false)
  const projectRenameInput = useRef<TextInput>(null)
  const [projectActionState, dispatchProjectAction] = useReducer(projectActionReducer, closedProjectActionState)
  const [selectedProjectActionTarget, setSelectedProjectActionTarget] = useState<{ projectId: string; name: string }>()
  const projectDeletionInFlight = useRef(false)
  const [retryingProjectLoad, setRetryingProjectLoad] = useState(false)
  const projectLoadRetryInFlight = useRef(false)
  const previewRef = useRef<PreviewPanelHandle>(null)
  const [previewTarget, setPreviewTarget] = useState<{ projectId: string; sessionId: string }>()
  const [previewBusy, setPreviewBusy] = useState(false)
  const projectRenameTarget = projectRenameState.phase === 'editing' ? projectRenameState.target : undefined
  const deletingProject = projectActionState.phase === 'confirm-delete' && projectActionState.status === 'deleting'
  const previewProject = previewTarget ? projects.find((project) => project.id === previewTarget.projectId) : undefined

  useEffect(() => {
    if (!projectRenameTarget) return
    const frame = requestAnimationFrame(() => {
      projectRenameInput.current?.focus()
      projectRenameInput.current?.setNativeProps({ selection: projectRenameSelection(projectRenameTarget.name) })
    })
    return () => cancelAnimationFrame(frame)
  }, [projectRenameTarget])

  const refreshProjectSessions = useCallback(async (projectId: string) => {
    if (sessionRefreshes.current.has(projectId)) return
    if (!runtime.info) {
      setSessionLoadStatusByProject((current) => ({ ...current, [projectId]: runtime.lastError ? 'failed' : 'loading' }))
      return
    }
    const refreshToken = Symbol(projectId)
    sessionRefreshes.current.set(projectId, refreshToken)
    setSessionLoadStatusByProject((current) => ({ ...current, [projectId]: 'loading' }))
    try {
      const result = await loadSessionSummaries(() => runtime.request('session.list', { projectId }))
      if (sessionRefreshes.current.get(projectId) !== refreshToken) return
      if (result.status === 'loaded') setSessionsByProject((current) => ({ ...current, [projectId]: result.sessions }))
      setSessionLoadStatusByProject((current) => ({ ...current, [projectId]: result.status }))
    } finally {
      if (sessionRefreshes.current.get(projectId) === refreshToken) sessionRefreshes.current.delete(projectId)
    }
  }, [runtime.info, runtime.lastError, runtime.request])

  const refreshSessions = useCallback(async () => {
    await Promise.all(projects.map((project) => refreshProjectSessions(project.id)))
  }, [projects, refreshProjectSessions])

  useEffect(() => { void refreshSessions() }, [refreshSessions])

  const openSession = (projectId: string, sessionId: string) => {
    router.push({ pathname: '/workspace/[id]', params: { id: projectId, sessionId } })
  }

  const openProject = (projectId: string, sessions: readonly AgentSessionSummary[]) => {
    const latestSession = sessions[0]
    if (latestSession) openSession(projectId, latestSession.sessionId)
    else router.push({ pathname: '/workspace/[id]', params: { id: projectId } })
  }

  const openProjectPreview = (projectId: string, sessions: readonly AgentSessionSummary[]) => {
    if (previewTarget?.projectId === projectId) {
      void previewRef.current?.open()
      return
    }
    setPreviewTarget({ projectId, sessionId: sessions[0]?.sessionId ?? createMobileSessionId() })
  }

  const submitProjectRename = async () => {
    if (projectRenameState.phase !== 'editing' || renamingProject || !isProjectRenameDraftValid(projectRenameState.draft)) return
    await runExclusiveAction(projectRenameInFlight, async () => {
      setRenamingProject(true)
      try {
        await persistProjectRename({
          projectId: projectRenameState.target.projectId,
          draft: projectRenameState.draft,
          renameRuntime: (input) => runtime.request('project.rename', input),
          persistLocal: renameProject,
        })
        dispatchProjectRename({ type: 'dismiss' })
      } catch (cause) {
        const message = cause instanceof ProjectRenameValidationError
          ? cause.issue === 'empty' ? t('projectNameEmpty') : cause.issue === 'too-long' ? t('projectNameTooLong') : t('projectNameInvalid')
          : t('renameProjectFailed', { message: cause instanceof Error ? cause.message : String(cause) })
        dispatchProjectRename({ type: 'fail', error: message })
      } finally {
        setRenamingProject(false)
      }
    })
  }

  const clearProjectSessionState = useCallback((projectId: string) => {
    sessionRefreshes.current.delete(projectId)
    setSessionsByProject((current) => omitProjectRecordEntry(current, projectId))
    setSessionLoadStatusByProject((current) => omitProjectRecordEntry(current, projectId))
    setSessionCreationFailures((current) => omitProjectRecordEntry(current, projectId))
    setExpandedSessionsByProject((current) => omitProjectRecordEntry(current, projectId))
    setCreatingSessionForProject((current) => current === projectId ? undefined : current)
  }, [])

  const submitProjectDelete = async () => {
    if (projectActionState.phase !== 'confirm-delete' || projectActionState.status === 'deleting') return
    const target = projectActionState.target
    await runExclusiveAction(projectDeletionInFlight, async () => {
      dispatchProjectAction({ type: 'begin-delete' })
      try {
        await performProjectDeletion({
          projectId: target.projectId,
          deleteRuntime: async (projectId) => {
            await runtime.deleteProject(projectId)
            clearProjectSessionState(projectId)
          },
          removeLocal: removeProject,
          clearDrafts: (projectId) => clearAgentDraftsForProject(AsyncStorage, projectId),
        })
        dispatchProjectAction({ type: 'delete-succeeded' })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        dispatchProjectAction({
          type: 'delete-failed',
          error: message.startsWith('Project is busy.')
            ? t('deleteProjectBusy')
            : t('deleteProjectFailed', { message }),
        })
      }
    })
  }

  const createSession = async (projectId: string) => {
    if (!runtime.info || creatingSessionForProject) return
    await runExclusiveAction(sessionCreationInFlight, async () => {
      setCreatingSessionForProject(projectId)
      setSessionCreationFailures((current) => clearSessionCreationFailure(current, projectId))
      try {
        await createAndNavigateSession({
          projectId,
          title: t('newSession'),
          sessionId: createMobileSessionId(),
          createSession: (input) => runtime.request('session.create', input),
          navigate: (sessionId) => router.push({ pathname: '/workspace/[id]', params: { id: projectId, sessionId } }),
        })
        await refreshSessions()
      } catch (cause) {
        setSessionCreationFailures((current) => setSessionCreationFailure(
          current,
          projectId,
          t('newSessionFailed', { message: cause instanceof Error ? cause.message : String(cause) }),
        ))
      } finally {
        setCreatingSessionForProject(undefined)
      }
    })
  }

  const deleteSession = async (projectId: string, sessionId: string) => {
    if (deletingSessionId) return
    await runExclusiveAction(sessionDeletionInFlight, async () => {
      setDeletingSessionId(sessionId)
      setSessionActionError(undefined)
      try {
        const result = await runtime.request('session.delete', { projectId, sessionId })
        if (!result.deleted) throw new Error('Session no longer exists.')
        setSessionsByProject((current) => removeSessionSummary(current, projectId, sessionId))
        dispatchSessionAction({ type: 'dismiss' })
        await refreshSessions()
      } catch (cause) {
        setSessionActionError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setDeletingSessionId(undefined)
      }
    })
  }

  const retryProjects = async () => {
    if (projectLoadStatus !== 'failed') return
    await runExclusiveAction(projectLoadRetryInFlight, async () => {
      setRetryingProjectLoad(true)
      try {
        await retryProjectLoad()
      } finally {
        setRetryingProjectLoad(false)
      }
    })
  }

  return <SafeAreaView style={styles.safe} edges={['top']}>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{t('workspace')}</Text>
          <Text style={styles.subtitle}>{t('workspaceDescription')}</Text>
        </View>
        {projectLoadStatus === 'ready' ? <View style={styles.countBadge}><Text style={styles.count}>{t(projects.length === 1 ? 'projectCountSingular' : 'projectCount', { count: projects.length })}</Text></View> : null}
      </View>

      <View style={styles.actions}>
        <NewProjectButton compact disabled={projectLoadStatus !== 'ready'} />
      </View>

      <Text style={styles.sectionTitle}>{t('myProjects')}</Text>
      {projectLoadStatus === 'loading' && !retryingProjectLoad ? <View accessible accessibilityRole="progressbar" accessibilityLabel={`${t('workspace')} · ${t('starting')}`} accessibilityLiveRegion="polite" style={styles.projectLoadState}>
        <Spinner color={colors.accent} size="sm" />
        <Text style={styles.projectLoadText}>{t('workspace')} · {t('starting')}</Text>
      </View> : null}
      {projectLoadStatus === 'failed' || retryingProjectLoad ? <ProjectLoadFailure
        retrying={retryingProjectLoad}
        disabled={projectLoadStatus !== 'failed'}
        onRetry={() => { void retryProjects() }}
        testID="workspace-project-load-error"
      /> : null}
      {projectLoadStatus === 'ready' && projects.length > 0 ? <View style={styles.projectList}>
        {projects.map((project) => {
          const sessions = sessionsByProject[project.id] ?? []
          const sessionLoadStatus = sessionLoadStatusByProject[project.id] ?? 'loading'
          const sessionsExpanded = expandedSessionsByProject[project.id] ?? false
          const visibleSessions = workspaceVisibleSessions(sessions, sessionsExpanded)
          const projectOpenActionState = workspaceProjectOpenActionState(sessionLoadStatus)
          const creatingSession = creatingSessionForProject === project.id
          const sessionCreationError = sessionCreationFailureMessage(sessionCreationFailures, project.id)
          const projectActionTarget = { projectId: project.id, name: project.name }
          return <View
            key={project.id}
            accessible={workspaceProjectCardAccessibilityContract.containerAccessible}
            style={styles.projectCard}
          >
            <View style={styles.projectHeader}>
              <Button
                variant="ghost"
                feedbackVariant="scale-highlight"
                accessibilityLabel={isGitHubImportedProject(project) ? `${project.name} · ${t('githubImportedProject')}` : project.name}
                accessibilityHint={t('openProjectHint')}
                accessibilityState={projectOpenActionState}
                isDisabled={projectOpenActionState.disabled}
                onPress={() => openProject(project.id, sessions)}
                style={styles.projectOpenButton}
              >
                <View style={styles.projectCopy}>
                  <View style={styles.projectTitleRow}>
                    <Text numberOfLines={1} style={styles.projectName}>{project.name}</Text>
                    {isGitHubImportedProject(project) ? <View style={styles.githubBadge}><AppIcon icon={FolderGit2} color={colors.blue} size={14} /></View> : null}
                  </View>
                  <View style={styles.projectMetaRow}>
                    {project.template ? <AppIcon icon={project.template === 'web' ? Code2 : Smartphone} color={project.template === 'web' ? colors.blue : colors.accent} size={13} /> : null}
                    <Text numberOfLines={1} style={styles.projectMeta}>{t(projectFilePaths(project).length === 1 ? 'fileCountSingular' : 'fileCount', { count: projectFilePaths(project).length })} · {sessionLoadStatus === 'loaded' ? t(sessions.length === 1 ? 'sessionCountSingular' : 'sessionCount', { count: sessions.length }) : sessionLoadStatus === 'failed' ? t('stateFailed') : t('loadingSessions')}</Text>
                  </View>
                </View>
              </Button>
              <View style={styles.projectHeaderActions}>
                <PendingButton
                  isIconOnly
                  size="sm"
                  variant="secondary"
                  isPending={previewBusy && previewTarget?.projectId === project.id}
                  accessibilityLabel={`${t('run')} · ${project.name}`}
                  isDisabled={!runtime.info || previewBusy}
                  onPress={(event) => { event.stopPropagation(); openProjectPreview(project.id, sessions) }}
                  style={styles.projectActionButton}
                >
                  {({ isPending }) => isPending ? <Spinner color={colors.accent} size="sm" /> : <AppIcon icon={Play} color={runtime.info ? colors.accent : colors.muted} size={16} />}
                </PendingButton>
                <PendingButton isIconOnly size="sm" variant="secondary" accessibilityRole={workspaceProjectCardAccessibilityContract.newSessionRole} isPending={creatingSession} isDisabled={!runtime.info || Boolean(creatingSessionForProject && !creatingSession)} accessibilityLabel={`${t('newSession')} · ${project.name}`} onPress={(event) => { event.stopPropagation(); void createSession(project.id) }} style={[styles.projectActionButton, styles.projectActionDivider]}>
                  {({ isPending }) => isPending ? <Spinner color={colors.accent} size="sm" /> : <AppIcon icon={Plus} color={colors.accent} size={17} />}
                </PendingButton>
                <Button
                  isIconOnly
                  size="sm"
                  variant="secondary"
                  accessibilityRole={workspaceProjectCardAccessibilityContract.projectActionsRole}
                  accessibilityLabel={`${t('projectActions')} · ${project.name}`}
                  onPress={(event) => { event.stopPropagation(); setSelectedProjectActionTarget(projectActionTarget) }}
                  style={[styles.projectActionButton, styles.projectActionDivider, styles.projectActionMenuButton]}
                >
                  <AppIcon icon={CircleEllipsis} color={colors.accent} size={17} />
                </Button>
              </View>
            </View>
            {sessionCreationError ? <Alert {...actionErrorPresentation} testID={`workspace-new-session-error-${project.id}`} style={styles.errorAlert}>
              <Alert.Indicator iconProps={{ size: 17 }} />
              <Alert.Content><Alert.Description style={styles.error}>{sessionCreationError}</Alert.Description></Alert.Content>
            </Alert> : null}
            <View style={styles.sessionList}>
              {sessionLoadStatus === 'loading' ? <View accessible accessibilityRole="progressbar" accessibilityLabel={t('loadingSessions')} accessibilityLiveRegion="polite" style={styles.sessionLoading}>
                <Spinner color={colors.accent} size="sm" />
                <Text style={styles.sessionLoadingText}>{t('loadingSessions')}</Text>
              </View> : null}
              {sessionLoadStatus === 'failed' ? <View style={styles.sessionFailure}>
                <Alert {...actionErrorPresentation}>
                  <Alert.Indicator iconProps={{ size: 17 }} />
                  <Alert.Content><Alert.Description style={styles.error}>{t('sessionsLoadFailed')}</Alert.Description></Alert.Content>
                </Alert>
                <Button
                  size="sm"
                  variant="secondary"
                  accessibilityLabel={`${t('retry')} · ${project.name}`}
                  isDisabled={!runtime.info}
                  onPress={(event) => { event.stopPropagation(); void refreshProjectSessions(project.id) }}
                  style={styles.sessionRetry}
                ><Button.Label>{t('retry')}</Button.Label></Button>
              </View> : null}
              {sessionLoadStatus === 'loaded' && visibleSessions.map((session) => <Button
                key={session.sessionId}
                variant="ghost"
                feedbackVariant="scale-highlight"
                accessibilityLabel={`${project.name} · ${session.title}`}
                accessibilityHint={t('sessionActionsHint')}
                accessibilityActions={[{ name: 'delete', label: t('delete') }]}
                onAccessibilityAction={(event) => { if (isSessionDeleteAccessibilityAction(event.nativeEvent.actionName)) dispatchSessionAction({ type: 'open', target: { projectId: project.id, sessionId: session.sessionId, title: session.title } }) }}
                onLongPress={(event) => { event.stopPropagation(); dispatchSessionAction({ type: 'open', target: { projectId: project.id, sessionId: session.sessionId, title: session.title } }) }}
                onPress={(event) => { event.stopPropagation(); openSession(project.id, session.sessionId) }}
                style={styles.sessionRow}
              >
                <View style={styles.sessionMain}>
                  <View style={styles.sessionCopy}><Text numberOfLines={1} style={styles.sessionTitle}>{session.title}</Text><Text numberOfLines={1} style={styles.sessionMeta}>{t(session.turnCount === 1 ? 'turnCountSingular' : 'turnCount', { count: session.turnCount })} · {formatSessionDate(session.updatedAt)}</Text></View>
                  <AppIcon icon={ChevronRight} color={colors.muted} size={17} />
                </View>
              </Button>)}
              {sessionLoadStatus === 'loaded' && sessions.length > WORKSPACE_COLLAPSED_SESSION_COUNT ? <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: sessionsExpanded }}
                accessibilityLabel={sessionsExpanded ? t('collapseSessions') : t('showMoreSessions', { count: sessions.length - WORKSPACE_COLLAPSED_SESSION_COUNT })}
                onPress={(event) => {
                  event.stopPropagation()
                  setExpandedSessionsByProject((current) => ({ ...current, [project.id]: !sessionsExpanded }))
                }}
                style={({ pressed }) => [styles.sessionExpansionButton, pressed && styles.sessionExpansionButtonPressed]}
              >
                <View style={sessionsExpanded ? styles.sessionExpansionIconCollapsed : undefined}>
                  <AppIcon icon={ChevronDown} color={colors.accent} size={15} />
                </View>
                <Text style={styles.sessionExpansionLabel}>{sessionsExpanded ? t('collapseSessions') : t('showMoreSessions', { count: sessions.length - WORKSPACE_COLLAPSED_SESSION_COUNT })}</Text>
              </Pressable> : null}
              {sessionLoadStatus === 'loaded' && sessions.length === 0 ? <Text style={styles.noSessions}>{t('noSessions')}</Text> : null}
            </View>
          </View>
        })}
      </View> : projectLoadStatus === 'ready' ? <View style={styles.emptyCard}>
        <View style={styles.emptyIcon}><AppIcon icon={FolderInput} color={colors.accent} size={23} /></View>
        <Text style={styles.emptyTitle}>{t('workspaceEmpty')}</Text>
        <Text style={styles.emptyDescription}>{t('workspaceEmptyDescription')}</Text>
      </View> : null}

    </ScrollView>
    {previewProject && previewTarget ? <PreviewPanel
      ref={previewRef}
      key={previewProject.id}
      project={previewProject}
      sessionId={previewTarget.sessionId}
      autoOpen
      onBusyChange={setPreviewBusy}
      onFixWithAgent={(repairPrompt) => {
        const { projectId, sessionId } = previewTarget
        setPreviewTarget(undefined)
        router.push({ pathname: '/workspace/[id]', params: { id: projectId, sessionId, ...(repairPrompt ? { repairPrompt } : {}) } })
      }}
    /> : null}
    <AppDialog
      open={Boolean(selectedProjectActionTarget)}
      onOpenChange={(open) => { if (!open) setSelectedProjectActionTarget(undefined) }}
      title={t('projectActions')}
      description={selectedProjectActionTarget?.name}
      closeLabel={t('cancel')}
      actions={[]}
      testID="workspace-project-actions-dialog"
    >
      {selectedProjectActionTarget ? <View style={styles.projectActionList}>
        <Button
          variant="ghost"
          feedbackVariant="scale-highlight"
          accessibilityLabel={t('shareProject')}
          accessibilityHint={t('shareProjectDescription')}
          onPress={() => { const target = selectedProjectActionTarget; setSelectedProjectActionTarget(undefined); router.push({ pathname: '/share/[projectId]', params: { projectId: target.projectId } }) }}
          style={[styles.projectActionRow, styles.projectActionRowPrimary]}
        >
          <View style={styles.projectActionRowContent}>
            <View style={[styles.projectActionRowIcon, styles.projectActionRowPrimaryIcon]}><AppIcon icon={Share2} color={colors.accent} size={20} /></View>
            <View style={styles.projectActionRowCopy}><Button.Label style={styles.projectActionRowTitle}>{t('shareProject')}</Button.Label><Text numberOfLines={2} style={styles.projectActionRowDescription}>{t('shareProjectDescription')}</Text></View>
            <AppIcon icon={ChevronRight} color={colors.accent} size={18} />
          </View>
        </Button>
        <Button
          variant="ghost"
          feedbackVariant="scale-highlight"
          accessibilityLabel={t('rename')}
          accessibilityHint={t('renameProjectDescription')}
          onPress={() => { const target = selectedProjectActionTarget; setSelectedProjectActionTarget(undefined); dispatchProjectRename({ type: 'open', target }) }}
          style={styles.projectActionRow}
        >
          <View style={styles.projectActionRowContent}>
            <View style={styles.projectActionRowIcon}><AppIcon icon={Pencil} color={colors.text} size={19} /></View>
            <View style={styles.projectActionRowCopy}><Button.Label style={styles.projectActionRowTitle}>{t('rename')}</Button.Label><Text numberOfLines={2} style={styles.projectActionRowDescription}>{t('renameProjectDescription')}</Text></View>
            <AppIcon icon={ChevronRight} color={colors.muted} size={18} />
          </View>
        </Button>
        <View style={styles.projectActionSectionDivider} />
        <Button
          variant="ghost"
          feedbackVariant="scale-highlight"
          accessibilityLabel={t('delete')}
          accessibilityHint={t('deleteProjectActionDescription')}
          onPress={() => { const target = selectedProjectActionTarget; setSelectedProjectActionTarget(undefined); dispatchProjectAction({ type: 'request-delete', target }) }}
          style={[styles.projectActionRow, styles.projectActionRowDanger]}
        >
          <View style={styles.projectActionRowContent}>
            <View style={[styles.projectActionRowIcon, styles.projectActionRowDangerIcon]}><AppIcon icon={Trash2} color={colors.danger} size={19} /></View>
            <View style={styles.projectActionRowCopy}><Button.Label style={[styles.projectActionRowTitle, styles.projectActionRowDangerTitle]}>{t('delete')}</Button.Label><Text numberOfLines={2} style={styles.projectActionRowDescription}>{t('deleteProjectActionDescription')}</Text></View>
            <AppIcon icon={ChevronRight} color={colors.danger} size={18} />
          </View>
        </Button>
      </View> : null}
    </AppDialog>
    <AppDialog
      open={projectActionState.phase === 'confirm-delete'}
      onOpenChange={(open) => { if (!open) dispatchProjectAction({ type: 'dismiss' }) }}
      title={projectActionState.phase === 'confirm-delete' ? t('deleteProjectTitle', { name: projectActionState.target.name }) : t('projectActions')}
      description={projectActionState.phase === 'confirm-delete' ? t('deleteProjectConfirmation') : undefined}
      closeLabel={t('cancel')}
      dismissible={!deletingProject}
      error={projectActionState.phase === 'confirm-delete' ? projectActionState.error : undefined}
      actions={projectActionState.phase === 'confirm-delete' ? [
        { label: t('cancel'), tone: 'cancel', disabled: deletingProject, onPress: () => dispatchProjectAction({ type: 'dismiss' }) },
        { label: t('delete'), tone: 'danger', loading: deletingProject, onPress: () => { void submitProjectDelete() } },
      ] : []}
      testID="workspace-project-delete-dialog"
    />
    <AppDialog
      open={sessionActionState.phase !== 'closed'}
      onOpenChange={(open) => { if (!open) { dispatchSessionAction({ type: 'dismiss' }); setSessionActionError(undefined) } }}
      title={sessionActionState.phase === 'confirm-delete' ? t('deleteSessionTitle') : t('sessionActionsTitle')}
      description={sessionActionState.phase === 'closed' ? undefined : sessionActionState.phase === 'confirm-delete' ? t('deleteSessionConfirmation', { title: sessionActionState.target.title }) : t('sessionActionsDescription', { title: sessionActionState.target.title })}
      closeLabel={t('cancel')}
      dismissible={!deletingSessionId}
      error={sessionActionError}
      actions={sessionActionState.phase === 'confirm-delete' ? [
        { label: t('cancel'), tone: 'cancel', disabled: Boolean(deletingSessionId), onPress: () => dispatchSessionAction({ type: 'dismiss' }) },
        { label: t('delete'), tone: 'danger', loading: Boolean(deletingSessionId), onPress: () => { const target = sessionActionState.target; void deleteSession(target.projectId, target.sessionId) } },
      ] : sessionActionState.phase === 'actions' ? [
        { label: t('cancel'), tone: 'cancel', onPress: () => dispatchSessionAction({ type: 'dismiss' }) },
        { label: t('delete'), tone: 'danger', onPress: () => dispatchSessionAction({ type: 'request-delete' }) },
      ] : []}
      testID="workspace-session-dialog"
    />
    <AppDialog
      open={projectRenameState.phase === 'editing'}
      onOpenChange={(open) => { if (!open && !renamingProject) dispatchProjectRename({ type: 'dismiss' }) }}
      title={t('renameProject')}
      description={t('renameProjectDescription')}
      closeLabel={t('cancel')}
      dismissible={!renamingProject}
      error={projectRenameState.phase === 'editing' ? projectRenameState.error : undefined}
      actions={[
        { label: t('cancel'), tone: 'cancel', disabled: renamingProject, onPress: () => dispatchProjectRename({ type: 'dismiss' }) },
        { label: t('save'), tone: 'primary', disabled: projectRenameState.phase !== 'editing' || !isProjectRenameDraftValid(projectRenameState.draft), loading: renamingProject, onPress: () => { void submitProjectRename() } },
      ]}
      testID="workspace-project-rename-dialog"
    >
      {projectRenameState.phase === 'editing' && <TextInput
        ref={projectRenameInput}
        autoFocus
        selectTextOnFocus
        accessibilityLabel={t('projectNameInput')}
        value={projectRenameState.draft}
        onChangeText={(draft) => dispatchProjectRename({ type: 'change', draft })}
        onSubmitEditing={() => { void submitProjectRename() }}
        returnKeyType="done"
        editable={!renamingProject}
        maxLength={80}
        style={styles.renameInput}
      />}
    </AppDialog>
  </SafeAreaView>
}

function formatSessionDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp)
}

function createStyles(colors: ThemeColors, projectCardWidth: number) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: 18, paddingTop: topLevelScreenLayout.topPadding, paddingBottom: 34, gap: 12 },
  header: { minHeight: topLevelScreenLayout.headerMinHeight, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { color: colors.text, ...topLevelPageTitleStyle },
  subtitle: { color: colors.muted, fontSize: typeScale.caption, marginTop: 4 },
  countBadge: { marginTop: 6, borderRadius: 999, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 9, paddingVertical: 5 },
  count: { color: colors.muted, fontSize: typeScale.micro, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 10 },
  sectionTitle: { color: colors.muted, fontSize: typeScale.label, fontWeight: '800', marginTop: 6 },
  projectLoadState: { minHeight: 96, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel },
  projectLoadText: { color: colors.muted, fontSize: typeScale.label, fontWeight: '700' },
  projectList: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12 },
  projectCard: { width: projectCardWidth, padding: workspaceProjectCardLayout.cardPadding, gap: 10, borderRadius: 18, borderWidth: workspaceProjectCardLayout.cardBorderWidth, borderColor: colors.border, backgroundColor: colors.panel, alignItems: 'stretch', flexDirection: 'column', shadowColor: '#162048', shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  projectHeader: { minHeight: workspaceProjectCardLayout.minimumTouchTarget, flexDirection: 'row', alignItems: 'center', gap: workspaceProjectCardLayout.headerGap },
  projectOpenButton: { flex: 1, minWidth: 0, minHeight: workspaceProjectCardLayout.minimumTouchTarget, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 11, alignItems: 'stretch', justifyContent: 'center' },
  projectTitleRow: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  githubBadge: { width: 24, height: 24, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.raised },
  projectCopy: { flex: 1, minWidth: 0, gap: 4 },
  projectName: { color: colors.text, fontSize: typeScale.body, fontWeight: '800' },
  projectMetaRow: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
  projectMeta: { flexShrink: 1, color: colors.muted, fontSize: typeScale.caption },
  projectHeaderActions: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: workspaceProjectCardLayout.actionGap, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: colors.raised },
  projectActionButton: { width: workspaceProjectCardLayout.minimumTouchTarget, height: workspaceProjectCardLayout.minimumTouchTarget, minWidth: workspaceProjectCardLayout.minimumTouchTarget, paddingHorizontal: 0, borderRadius: 0, alignItems: 'center', justifyContent: 'center' },
  projectActionDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  projectActionMenuButton: { backgroundColor: colors.raised },
  sessionList: { overflow: 'hidden', borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.canvas },
  sessionRow: { minHeight: 52, paddingHorizontal: 0, borderRadius: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, alignItems: 'stretch' },
  sessionMain: { minHeight: 52, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sessionCopy: { flex: 1, gap: 3 },
  sessionTitle: { color: colors.text, fontSize: typeScale.label, fontWeight: '800' },
  sessionMeta: { color: colors.muted, fontSize: typeScale.micro },
  sessionExpansionButton: { minHeight: workspaceProjectCardLayout.minimumTouchTarget, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  sessionExpansionButtonPressed: { backgroundColor: colors.accentDeep },
  sessionExpansionIconCollapsed: { transform: [{ rotate: '180deg' }] },
  sessionExpansionLabel: { color: colors.accent, fontSize: typeScale.caption, fontWeight: '800', lineHeight: 18 },
  sessionLoading: { minHeight: 52, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  sessionLoadingText: { color: colors.muted, fontSize: typeScale.caption },
  sessionFailure: { padding: 10, gap: 8 },
  sessionRetry: { alignSelf: 'flex-start', minHeight: workspaceProjectCardLayout.minimumTouchTarget },
  noSessions: { color: colors.muted, fontSize: typeScale.caption, textAlign: 'center', padding: 16 },
  emptyCard: { minHeight: 170, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, padding: 22 },
  emptyIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.accentDeep, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { color: colors.text, fontSize: typeScale.heading, fontWeight: '800' },
  emptyDescription: { color: colors.muted, fontSize: typeScale.label, lineHeight: 18, textAlign: 'center', marginTop: 6 },
  errorAlert: { width: '100%' },
  error: { color: colors.danger, fontSize: typeScale.label, lineHeight: 18 },
  projectActionList: { gap: 8, paddingTop: 2 },
  projectActionRow: { width: '100%', height: 'auto', minHeight: 70, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, paddingHorizontal: 12, paddingVertical: 10, alignItems: 'stretch' },
  projectActionRowPrimary: { borderColor: `${colors.accent}2E`, backgroundColor: colors.accentDeep },
  projectActionRowDanger: { borderColor: `${colors.danger}26`, backgroundColor: `${colors.danger}08` },
  projectActionRowContent: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 11 },
  projectActionRowIcon: { width: 40, height: 40, flexShrink: 0, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raised },
  projectActionRowPrimaryIcon: { backgroundColor: colors.panel },
  projectActionRowDangerIcon: { backgroundColor: `${colors.danger}12` },
  projectActionRowCopy: { flex: 1, minWidth: 0, gap: 3 },
  projectActionRowTitle: { color: colors.text, fontSize: typeScale.body, lineHeight: 19, fontWeight: '900' },
  projectActionRowDangerTitle: { color: colors.danger },
  projectActionRowDescription: { color: colors.muted, fontSize: typeScale.caption, lineHeight: 16 },
  projectActionSectionDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 2 },
  renameInput: { minHeight: controlSize.regular, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.canvas, color: colors.text, paddingHorizontal: 12, fontSize: typeScale.body },
}) }
