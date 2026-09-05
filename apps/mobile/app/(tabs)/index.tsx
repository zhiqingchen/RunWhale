import { ProjectLoadFailure } from '@/components/ProjectLoadFailure'
import { router, useFocusEffect } from 'expo-router'
import { Button } from 'heroui-native/button'
import { Spinner } from 'heroui-native/spinner'
import { ChevronRight, History, Play } from '@/components/icons'
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useCallback, useMemo, useRef, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { AgentSessionSummary, HostSnapshot } from '@runwhale/mobile-protocol'
import { controlSize, topLevelPageTitleStyle, topLevelScreenLayout, typeScale, type ThemeColors, useAppColors } from '@/theme/tokens'
import { useI18n } from '@/i18n'
import { AppIcon } from '@/components/AppIcon'
import { useProjects } from '@/state/projects'
import { useRuntime } from '@/state/runtime'
import { runExclusiveAction } from '@/utils/action-progress'
import { homeActivePreviewProjectId, homeContinueWorkViewModel, isCurrentHomeContinueRequest, selectLatestHomeProject } from '@/utils/home-continue-work'
import { NewProjectButton } from '@/components/NewProjectButton'
import { deviceLayout } from '@/utils/device-layout'

interface HomeContinueLoadState {
  projectId?: string
  sessions?: AgentSessionSummary[]
  snapshot?: HostSnapshot
  activePreviewProjectId?: string
  loading: boolean
  sessionFailed: boolean
}

export default function HomeScreen() {
  const { language, t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const runtime = useRuntime()
  const { projects, loadStatus: projectLoadStatus, retryLoad: retryProjectLoad } = useProjects()
  const latestProject = useMemo(() => selectLatestHomeProject(projects), [projects])
  const currentProjectId = useRef<string | undefined>(undefined)
  const refreshRevision = useRef(0)
  const projectRetryInFlight = useRef(false)
  const [retryingProjects, setRetryingProjects] = useState(false)
  const [continueLoad, setContinueLoad] = useState<HomeContinueLoadState>({ loading: false, sessionFailed: false })
  const runtimeReady = Boolean(runtime.info)

  currentProjectId.current = projectLoadStatus === 'ready' ? latestProject?.id : undefined

  useFocusEffect(useCallback(() => {
    const revision = ++refreshRevision.current
    const projectId = projectLoadStatus === 'ready' ? latestProject?.id : undefined
    const invalidate = () => {
      if (refreshRevision.current === revision) refreshRevision.current += 1
    }

    if (!projectId) {
      setContinueLoad({ loading: false, sessionFailed: false })
      return invalidate
    }

    setContinueLoad({ projectId, loading: true, sessionFailed: false })

    if (!runtime.info) {
      setContinueLoad({ projectId, loading: !runtime.lastError, sessionFailed: Boolean(runtime.lastError) })
      return invalidate
    }

    const request = { projectId, revision }
    void Promise.allSettled([
      runtime.request('session.list', { projectId }),
      runtime.request('host.snapshot', { afterSequence: Number.MAX_SAFE_INTEGER }),
      runtime.request('preview.logs', { projectId, afterSequence: 0 }),
    ]).then(([sessionsResult, snapshotResult, previewEventsResult]) => {
      if (!isCurrentHomeContinueRequest(request, currentProjectId.current, refreshRevision.current)) return
      const snapshot = snapshotResult.status === 'fulfilled' ? snapshotResult.value.snapshot : undefined
      const activePreviewProjectId = snapshot && previewEventsResult.status === 'fulfilled'
        ? homeActivePreviewProjectId(snapshot, previewEventsResult.value.events)
        : undefined
      setContinueLoad({
        projectId,
        sessions: sessionsResult.status === 'fulfilled' ? sessionsResult.value : undefined,
        snapshot,
        activePreviewProjectId,
        loading: false,
        sessionFailed: sessionsResult.status === 'rejected',
      })
    })

    return invalidate
  }, [latestProject?.id, projectLoadStatus, runtime.info, runtime.lastError, runtime.request]))

  const continueModel = useMemo(() => projectLoadStatus === 'ready'
    ? homeContinueWorkViewModel(
        projects,
        continueLoad.projectId === latestProject?.id ? continueLoad.sessions : undefined,
        continueLoad.projectId === latestProject?.id ? continueLoad.snapshot : undefined,
        continueLoad.projectId === latestProject?.id ? continueLoad.activePreviewProjectId : undefined,
      )
    : undefined, [continueLoad.activePreviewProjectId, continueLoad.projectId, continueLoad.sessions, continueLoad.snapshot, latestProject?.id, projectLoadStatus, projects])
  const continueRefreshing = Boolean(continueModel && (continueLoad.projectId !== continueModel.project.id || continueLoad.loading))
  const sessionUnavailable = Boolean(continueModel && continueLoad.projectId === continueModel.project.id && continueLoad.sessionFailed)

  const retryProjects = () => {
    void runExclusiveAction(projectRetryInFlight, async () => {
      setRetryingProjects(true)
      try {
        await retryProjectLoad()
      } finally {
        setRetryingProjects(false)
      }
    })
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerCopy}><Text style={styles.brand}>RunWhale</Text></View>
          <View style={styles.runtimeBadge}><View style={[styles.runtimeDot, !runtimeReady && styles.runtimeDotIdle]} /><Text style={styles.runtimeText}>{runtimeReady ? t('ready') : t('starting')}</Text></View>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroCopy}>
            <Text style={styles.welcome}>{t('welcomeBack')}</Text>
            <Text style={styles.heroTitle}>{t('heroTitle')}</Text>
          </View>
          <Image source={require('../../assets/images/runwhale-adaptive-foreground.png')} style={styles.whale} resizeMode="contain" />
        </View>

        <NewProjectButton />

        {projectLoadStatus === 'failed' || retryingProjects ? <View style={styles.continueSection}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{t('continueWorking')}</Text>
          <ProjectLoadFailure
            retrying={retryingProjects}
            disabled={projectLoadStatus !== 'failed'}
            onRetry={retryProjects}
            testID="home-project-load-error"
          />
        </View> : null}

        {continueModel ? <View style={styles.continueSection}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{t('continueWorking')}</Text>
          <View accessible={false} style={styles.continueCard}>
            <Button
              variant="ghost"
              feedbackVariant="scale-highlight"
              accessibilityLabel={continueModel.session ? `${continueModel.project.name} · ${continueModel.session.title}` : continueModel.project.name}
              accessibilityHint={t('openProjectHint')}
              accessibilityState={{ busy: continueRefreshing }}
              onPress={() => router.push(continueModel.target)}
              style={styles.continueMain}
            >
              <View style={styles.continueBody}>
                <View style={styles.projectLine}>
                  <View style={styles.projectIdentity}>
                    <View style={styles.projectIcon}><AppIcon icon={History} color={colors.accent} size={17} /></View>
                    <Text numberOfLines={1} style={styles.projectName}>{continueModel.project.name}</Text>
                  </View>
                  {continueRefreshing ? <Spinner color={colors.accent} size="sm" /> : continueModel.status ? <View style={[
                    styles.statusBadge,
                    continueModel.status.tone === 'active' && styles.statusBadgeActive,
                    continueModel.status.tone === 'warning' && styles.statusBadgeWarning,
                    continueModel.status.tone === 'danger' && styles.statusBadgeDanger,
                  ]}>
                    <View style={[
                      styles.statusDot,
                      continueModel.status.tone === 'active' && styles.statusDotActive,
                      continueModel.status.tone === 'warning' && styles.statusDotWarning,
                      continueModel.status.tone === 'danger' && styles.statusDotDanger,
                    ]} />
                    <Text style={[
                      styles.statusText,
                      continueModel.status.tone === 'active' && styles.statusTextActive,
                      continueModel.status.tone === 'warning' && styles.statusTextWarning,
                      continueModel.status.tone === 'danger' && styles.statusTextDanger,
                    ]}>{t(continueModel.status.labelKey)}</Text>
                  </View> : null}
                </View>
                <View style={styles.sessionHeading}>
                  <Text numberOfLines={2} style={styles.sessionTitle}>{continueModel.session?.title ?? (continueRefreshing ? t('loadingSessions') : sessionUnavailable ? t('continueWorkingSessionLoadFailed') : t('noSessions'))}</Text>
                  <AppIcon icon={ChevronRight} color={colors.muted} size={18} />
                </View>
                {continueModel.session ? <Text numberOfLines={2} style={styles.sessionPreview}>{continueModel.session.preview.trim() || t('sessionNoMessages')}</Text>
                  : !continueRefreshing ? <Text numberOfLines={2} style={styles.sessionPreview}>{sessionUnavailable ? t('continueWorkingSessionUnavailable') : t('continueWorkingNoSession')}</Text> : null}
                <View style={styles.sessionMeta}>
                  {continueModel.session ? <Text style={styles.sessionMetaText}>{t(continueModel.session.turnCount === 1 ? 'turnCountSingular' : 'turnCount', { count: continueModel.session.turnCount })}</Text> : null}
                  <Text style={styles.sessionMetaText}>{t('updatedAt', { date: formatHomeDate(continueModel.session?.updatedAt ?? continueModel.project.updatedAt, language) })}</Text>
                </View>
              </View>
            </Button>
            {continueModel.previewActive && continueModel.previewTarget ? <View style={styles.previewFooter}>
              <View accessible accessibilityLabel={t('previewActive')} style={styles.previewBadge}><View style={styles.previewDot} /><Text style={styles.previewBadgeText}>{t('previewActive')}</Text></View>
              <Button size="sm" variant="secondary" accessibilityLabel={`${t('openActivePreview')} · ${continueModel.project.name}`} onPress={() => router.push(continueModel.previewTarget!)} style={styles.previewButton}>
                <View style={styles.previewButtonSurface}><AppIcon icon={Play} color={colors.accent} size={13} /><Button.Label style={styles.previewButtonText}>{t('openActivePreview')}</Button.Label></View>
              </Button>
            </View> : null}
          </View>
        </View> : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function formatHomeDate(timestamp: number, language: 'zh-CN' | 'en'): string {
  return new Intl.DateTimeFormat(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { width: '100%', maxWidth: deviceLayout.readableContentMaximumWidth, alignSelf: 'center', paddingHorizontal: 18, paddingTop: topLevelScreenLayout.topPadding, paddingBottom: 34, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'flex-start', minHeight: topLevelScreenLayout.headerMinHeight },
  headerCopy: { flex: 1 },
  brand: { color: colors.text, ...topLevelPageTitleStyle },
  runtimeBadge: { marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  runtimeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#24B967' },
  runtimeDotIdle: { backgroundColor: colors.muted },
  runtimeText: { color: colors.muted, fontSize: typeScale.micro, fontWeight: '800' },
  hero: { minHeight: 192, overflow: 'hidden', borderRadius: 22, backgroundColor: colors.raised, flexDirection: 'row', alignItems: 'center', padding: 18, shadowColor: '#526BFF', shadowOpacity: 0.1, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 2 },
  heroCopy: { width: '57%', zIndex: 2 },
  welcome: { color: colors.muted, fontSize: typeScale.label, marginBottom: 7 },
  heroTitle: { color: colors.text, fontSize: typeScale.display, lineHeight: 27, fontWeight: '900', letterSpacing: -0.65 },
  whale: { position: 'absolute', width: 184, height: 184, right: -21, bottom: -14 },
  continueSection: { gap: 8, marginTop: 2 },
  sectionTitle: { color: colors.muted, fontSize: typeScale.label, fontWeight: '900', letterSpacing: 0.2 },
  continueCard: { overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, shadowColor: '#162048', shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  continueMain: { minHeight: 142, paddingHorizontal: 0, paddingVertical: 0, borderRadius: 17, alignItems: 'stretch', justifyContent: 'center' },
  continueBody: { padding: 14, gap: 8 },
  projectLine: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 9 },
  projectIdentity: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  projectIcon: { width: 28, height: 28, flexShrink: 0, borderRadius: 9, backgroundColor: colors.accentDeep, alignItems: 'center', justifyContent: 'center' },
  projectName: { minWidth: 0, flex: 1, color: colors.muted, fontSize: typeScale.caption, fontWeight: '900', letterSpacing: 0.4 },
  statusBadge: { minHeight: 28, flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.canvas, paddingHorizontal: 8 },
  statusBadgeActive: { borderColor: colors.accent, backgroundColor: colors.accentDeep },
  statusBadgeWarning: { borderColor: colors.warning },
  statusBadgeDanger: { borderColor: colors.danger },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.muted },
  statusDotActive: { backgroundColor: colors.accent },
  statusDotWarning: { backgroundColor: colors.warning },
  statusDotDanger: { backgroundColor: colors.danger },
  statusText: { color: colors.muted, fontSize: typeScale.micro, fontWeight: '900' },
  statusTextActive: { color: colors.accent },
  statusTextWarning: { color: colors.warning },
  statusTextDanger: { color: colors.danger },
  sessionHeading: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sessionTitle: { minWidth: 0, flex: 1, color: colors.text, fontSize: typeScale.heading, lineHeight: 20, fontWeight: '900' },
  sessionPreview: { minHeight: 36, color: colors.muted, fontSize: typeScale.label, lineHeight: 18 },
  sessionMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  sessionMetaText: { color: colors.muted, fontSize: typeScale.micro, fontWeight: '700' },
  previewFooter: { minHeight: 52, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: 13, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  previewBadge: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  previewDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  previewBadgeText: { minWidth: 0, flexShrink: 1, color: colors.accent, fontSize: typeScale.caption, fontWeight: '900' },
  previewButton: { minHeight: controlSize.regular, flexShrink: 0, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center' },
  previewButtonSurface: { height: 32, borderRadius: 9, backgroundColor: colors.accentDeep, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10 },
  previewButtonText: { color: colors.accent, fontSize: typeScale.caption, fontWeight: '900' },
}) }
