import { ProjectLoadFailure } from '@/components/ProjectLoadFailure'
import { router } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Bot, Code2, GitBranch, Smartphone } from '@/components/icons'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Alert } from 'heroui-native/alert'
import { Button } from 'heroui-native/button'
import { Spinner } from 'heroui-native/spinner'
import { AppDialog } from '@/components/AppDialog'
import { createProjectDraft, useProjects, type ProjectTemplate } from '@/state/projects'
import { useRuntime } from '@/state/runtime'
import { controlSize, radius, typeScale, type ThemeColors, useAppColors } from '@/theme/tokens'
import { useI18n } from '@/i18n'
import { AppIcon } from '@/components/AppIcon'
import { PendingButton } from '@/components/PendingButton'
import { runExclusiveAction } from '@/utils/action-progress'
import { createMobileSessionId } from '@/utils/session-id'
import { useFocusedInputScroll } from '@/hooks/useFocusedInputScroll'
import { completeNewProjectSubmission, idleNewProjectSubmissionUiState, newProjectAvailability, newProjectSubmissionKey, newProjectSubmissionUiReducer, prepareNewProjectSubmission, type PreparedNewProjectSubmission } from '@/utils/new-project-flow'
import { cloneProgressMessageKey, cloneProgressPercent } from '@/utils/clone-progress'
import type { ProjectCloneProgress } from '@runwhale/mobile-protocol'
import { deviceLayout } from '@/utils/device-layout'
import { beginStudioOperation } from '#extensions'

export default function NewProjectScreen() {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const [name, setName] = useState('')
  const [repositoryUrl, setRepositoryUrl] = useState('')
  const [template, setTemplate] = useState<ProjectTemplate>('expo')
  const [submissionUi, dispatchSubmissionUi] = useReducer(newProjectSubmissionUiReducer, idleNewProjectSubmissionUiState)
  const submitting = submissionUi.submitting
  const submitInFlight = useRef(false)
  const pendingSubmission = useRef<PreparedNewProjectSubmission | undefined>(undefined)
  const completedDestination = useRef<{ projectId: string; sessionId: string } | undefined>(undefined)
  const [error, setError] = useState<string>()
  const [cloneProgress, setCloneProgress] = useState<ProjectCloneProgress | null | undefined>(undefined)
  const [retryingProjectLoad, setRetryingProjectLoad] = useState(false)
  const projectLoadRetryInFlight = useRef(false)
  const { scrollRef, onScroll, rememberFocusedInput, forgetFocusedInput } = useFocusedInputScroll()
  const nameInputRef = useRef<TextInput>(null)
  const repositoryInputRef = useRef<TextInput>(null)
  const { loadStatus: projectLoadStatus, retryLoad: retryProjectLoad, addProject } = useProjects()
  const runtime = useRuntime()
  const availability = newProjectAvailability(projectLoadStatus, Boolean(runtime.info), submitting)
  const cloneProgressLabel = cloneProgress
    ? t(cloneProgressMessageKey(cloneProgress.phase))
    : cloneProgress === null ? t('clonePreparingRepository') : undefined
  const clonePercent = cloneProgress ? cloneProgressPercent(cloneProgress) : undefined

  usePreventRemove(submitting, () => dispatchSubmissionUi({ type: 'remove-attempted' }))

  useEffect(() => {
    if (submitting || !completedDestination.current) return
    const destination = completedDestination.current
    completedDestination.current = undefined
    router.replace({ pathname: '/workspace/[id]', params: { id: destination.projectId, sessionId: destination.sessionId } })
  }, [submitting])

  const submit = async () => {
    if (!availability.submissionAvailable) return
    await runExclusiveAction(submitInFlight, async () => {
      dispatchSubmissionUi({ type: 'start' })
      setError(undefined)
      setCloneProgress(undefined)
      const finishOperation = beginStudioOperation('project_create', repositoryUrl.trim() ? 'repository' : template)
      try {
        const repository = repositoryUrl.trim()
        const projectName = name.trim() || t('untitledProject')
        const key = newProjectSubmissionKey(repository, name.trim(), template)
        const submission = await prepareNewProjectSubmission({
          current: pendingSubmission.current,
          key,
          initialized: Boolean(repository),
          createProject: async () => {
            if (!repository) return createProjectDraft(projectName, template)
            setCloneProgress(null)
            try {
              return await runtime.cloneProject(repository, name.trim() || undefined, setCloneProgress)
            } finally {
              setCloneProgress(undefined)
            }
          },
          createSessionId: createMobileSessionId,
        })
        pendingSubmission.current = submission
        const createdSession = await completeNewProjectSubmission({
          submission,
          title: t('newSession'),
          initializeProject: runtime.initializeProject,
          createSession: (input) => runtime.request('session.create', input),
          readSession: (input) => runtime.request('session.read', input),
          commitProject: addProject,
        })
        pendingSubmission.current = undefined
        completedDestination.current = { projectId: submission.project.id, sessionId: createdSession.sessionId }
        finishOperation('success')
      } catch (cause) {
        finishOperation('failure')
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setCloneProgress(undefined)
        dispatchSubmissionUi({ type: 'settle' })
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
  return <>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        ref={scrollRef}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentContainerStyle={styles.form}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        {projectLoadStatus === 'loading' && !retryingProjectLoad ? <View accessible accessibilityRole="progressbar" accessibilityLabel={`${t('newProjectTitle')} · ${t('starting')}`} accessibilityLiveRegion="polite" style={styles.projectLoadState}>
          <Spinner color={colors.accent} size="sm" />
          <Text style={styles.projectLoadText}>{t('newProjectTitle')} · {t('starting')}</Text>
        </View> : null}
        {projectLoadStatus === 'failed' || retryingProjectLoad ? <ProjectLoadFailure
          retrying={retryingProjectLoad}
          disabled={projectLoadStatus !== 'failed'}
          onRetry={() => { void retryProjects() }}
          testID="new-project-load-error"
        /> : null}
        <Text style={styles.label}>{t('projectName')}</Text>
        <TextInput ref={nameInputRef} accessibilityLabel={t('projectName')} accessibilityState={{ disabled: availability.controlsDisabled }} editable={!availability.controlsDisabled} value={name} onChangeText={setName} onFocus={() => rememberFocusedInput(nameInputRef.current)} onBlur={() => forgetFocusedInput(nameInputRef.current)} placeholder={t('appNamePlaceholder')} placeholderTextColor={colors.muted} style={styles.input} />
        {!repositoryUrl.trim() && <>
          <Text style={styles.label}>{t('projectTemplate')}</Text>
          <View style={styles.templates}>
            <Button size="lg" variant={template === 'expo' ? 'primary' : 'secondary'} accessibilityRole="radio" accessibilityState={{ disabled: availability.controlsDisabled, checked: template === 'expo' }} isDisabled={availability.controlsDisabled} onPress={() => setTemplate('expo')} style={[styles.template, template === 'expo' && styles.templateActive]}>
              <View style={styles.templateHeader}>
                <AppIcon icon={Smartphone} color={template === 'expo' ? '#FFFFFF' : colors.accent} size={20} />
                <Text style={[styles.templateTitle, template === 'expo' && styles.templateTitleActive]}>{t('expoTemplate')}</Text>
              </View>
              <Text style={[styles.templateDescription, template === 'expo' && styles.templateDescriptionActive]}>{t('expoTemplateDescription')}</Text>
            </Button>
            <Button size="lg" variant={template === 'web' ? 'primary' : 'secondary'} accessibilityRole="radio" accessibilityState={{ disabled: availability.controlsDisabled, checked: template === 'web' }} isDisabled={availability.controlsDisabled} onPress={() => setTemplate('web')} style={[styles.template, template === 'web' && styles.templateActive]}>
              <View style={styles.templateHeader}>
                <AppIcon icon={Code2} color={template === 'web' ? '#FFFFFF' : colors.blue} size={20} />
                <Text style={[styles.templateTitle, template === 'web' && styles.templateTitleActive]}>{t('webTemplate')}</Text>
              </View>
              <Text style={[styles.templateDescription, template === 'web' && styles.templateDescriptionActive]}>{t('webTemplateDescription')}</Text>
            </Button>
          </View>
        </>}
        <Text style={styles.label}>{t('githubRepositoryOptional')}</Text>
        <TextInput ref={repositoryInputRef} accessibilityLabel={t('githubRepositoryOptional')} accessibilityState={{ disabled: availability.controlsDisabled }} editable={!availability.controlsDisabled} value={repositoryUrl} onChangeText={setRepositoryUrl} onFocus={() => rememberFocusedInput(repositoryInputRef.current)} onBlur={() => forgetFocusedInput(repositoryInputRef.current)} placeholder={t('githubRepositoryPlaceholder')} placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.input} />
        <View style={styles.note}><Text style={styles.noteText}>{repositoryUrl.trim() ? t('repositoryPreviewNote') : t('projectTemplateNote')}</Text></View>
        {cloneProgressLabel ? <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={cloneProgressLabel}
          accessibilityLiveRegion="polite"
          accessibilityValue={clonePercent === undefined
            ? { text: cloneProgressLabel }
            : { min: 0, max: 100, now: clonePercent, text: `${cloneProgressLabel} · ${clonePercent}%` }}
          style={styles.cloneProgress}
          testID="new-project-clone-progress"
        >
          <View style={styles.cloneProgressHeader}>
            <Text style={styles.cloneProgressLabel}>{cloneProgressLabel}</Text>
            {clonePercent === undefined ? <Spinner color={colors.accent} size="sm" /> : <Text style={styles.cloneProgressPercent}>{clonePercent}%</Text>}
          </View>
          <View style={styles.cloneProgressTrack}>
            <View style={[styles.cloneProgressFill, { width: `${clonePercent ?? 0}%` }]} />
          </View>
          {cloneProgress?.total !== undefined && cloneProgress.total > 0
            ? <Text style={styles.cloneProgressCount}>{t('cloneProgressCount', { loaded: cloneProgress.loaded, total: cloneProgress.total })}</Text>
            : null}
        </View> : null}
        {Boolean(error) && <Alert accessibilityRole="alert" accessibilityLiveRegion="assertive" status="danger" style={styles.errorAlert}>
          <Alert.Indicator iconProps={{ size: 17 }} />
          <Alert.Content><Alert.Description style={styles.error}>{error}</Alert.Description></Alert.Content>
        </Alert>}
        <PendingButton size="lg" variant="primary" isPending={submitting} isDisabled={!availability.submissionAvailable} style={[styles.button, (!availability.submissionAvailable || submitting) && styles.buttonDisabled]} onPress={() => { void submit() }}>
          {({ isPending }) => <>
            {isPending ? <Spinner color="#FFFFFF" size="sm" /> : <AppIcon icon={repositoryUrl.trim() ? GitBranch : Bot} color="#FFFFFF" size={18} />}
            <Button.Label style={styles.buttonText}>{cloneProgressLabel ? t('loadingRepository') : t('createAndOpenAgent')}</Button.Label>
          </>}
        </PendingButton>
      </ScrollView>
    </KeyboardAvoidingView>
    <AppDialog
      open={submissionUi.dismissalNoticeOpen}
      onOpenChange={(open) => { if (!open) dispatchSubmissionUi({ type: 'dismiss-notice' }) }}
      title={t('projectCreationInProgressTitle')}
      description={t('projectCreationInProgressBody')}
      closeLabel={t('continueWaiting')}
      actions={[{ label: t('continueWaiting'), tone: 'primary', onPress: () => dispatchSubmissionUi({ type: 'dismiss-notice' }) }]}
      testID="new-project-dismissal-blocked-dialog"
    />
  </>
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  form: { width: '100%', maxWidth: deviceLayout.readableContentMaximumWidth, alignSelf: 'center', padding: 18, paddingBottom: 96, gap: 9 },
  projectLoadState: { minHeight: 96, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderRadius: radius.large, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel },
  projectLoadText: { color: colors.muted, fontSize: typeScale.label, fontWeight: '700' },
  label: { color: colors.muted, fontSize: typeScale.micro, letterSpacing: 1.1, fontWeight: '800', marginTop: 9 },
  input: { minHeight: controlSize.prominent, color: colors.text, backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: radius.medium, paddingHorizontal: 13, paddingVertical: 10, fontSize: typeScale.body },
  templates: { flexDirection: 'row', gap: 9 },
  template: { flex: 1, height: 'auto', minHeight: 92, padding: 12, alignItems: 'flex-start', justifyContent: 'flex-start', flexDirection: 'column', gap: 9, borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium, backgroundColor: colors.panel },
  templateActive: { borderColor: colors.accent, backgroundColor: colors.accent },
  templateHeader: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  templateTitle: { color: colors.text, fontSize: typeScale.body, fontWeight: '900' },
  templateTitleActive: { color: '#FFFFFF' },
  templateDescription: { color: colors.muted, fontSize: typeScale.caption, lineHeight: 16 },
  templateDescriptionActive: { color: '#E6FFF8' },
  note: { padding: 12, borderRadius: radius.small, backgroundColor: colors.accentDeep },
  noteText: { color: colors.accent, fontSize: typeScale.caption, lineHeight: 17 },
  cloneProgress: { padding: 12, gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.medium, backgroundColor: colors.panel },
  cloneProgressHeader: { minHeight: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  cloneProgressLabel: { flex: 1, color: colors.text, fontSize: typeScale.label, fontWeight: '800' },
  cloneProgressPercent: { color: colors.accent, fontSize: typeScale.label, fontWeight: '900', fontVariant: ['tabular-nums'] },
  cloneProgressTrack: { height: 7, overflow: 'hidden', borderRadius: 4, backgroundColor: colors.border },
  cloneProgressFill: { height: '100%', borderRadius: 4, backgroundColor: colors.accent },
  cloneProgressCount: { color: colors.muted, fontSize: typeScale.micro, fontVariant: ['tabular-nums'] },
  errorAlert: { width: '100%' },
  error: { color: colors.danger, fontSize: typeScale.label, lineHeight: 18 },
  button: { height: 'auto', minHeight: controlSize.prominent, backgroundColor: colors.accent, borderRadius: radius.medium, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 7 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#FFFFFF', fontSize: typeScale.button, fontWeight: '900' },
}) }
