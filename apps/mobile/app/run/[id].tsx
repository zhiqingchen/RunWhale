import { Image } from 'expo-image'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Button } from 'heroui-native/button'
import { Spinner } from 'heroui-native/spinner'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Linking, Platform, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { AppIcon } from '@/components/AppIcon'
import { ArrowLeft, Pencil, Play } from '@/components/icons'
import { PendingButton } from '@/components/PendingButton'
import { PreviewPanel, type PreviewPanelHandle } from '@/components/PreviewPanel'
import { ProjectLoadFailure } from '@/components/ProjectLoadFailure'
import { useI18n } from '@/i18n'
import { useProjects } from '@/state/projects'
import { type ThemeColors, useAppColors } from '@/theme/tokens'
import { projectIdFromLaunchUrl, type ProjectShortcutAppearance } from '@/utils/project-shortcut'
import { loadProjectShortcut } from '@/utils/project-shortcut-storage'

export default function ProjectRunScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <ProjectRun key={id} id={id} />
}

function ProjectRun({ id }: { id: string }) {
  const { projects, loadStatus, retryLoad } = useProjects()
  const project = projects.find((item) => item.id === id)
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const previewRef = useRef<PreviewPanelHandle>(null)
  const [busy, setBusy] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [appearance, setAppearance] = useState<ProjectShortcutAppearance>()
  const [sessionId] = useState(() => `shortcut-${Date.now().toString(36)}`)

  useEffect(() => {
    let active = true
    if (Platform.OS !== 'web' && project) void loadProjectShortcut(id).then((saved) => { if (active) setAppearance(saved) }).catch(() => { /* Appearance never blocks launching the project. */ })
    return () => { active = false }
  }, [id, project?.id])

  useFocusEffect(useCallback(() => {
    // Reopening the same shortcut must also work after Preview was minimized.
    void previewRef.current?.open()
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (projectIdFromLaunchUrl(url) === id) void previewRef.current?.open()
    })
    return () => subscription.remove()
  }, [id]))

  const edit = (repairPrompt?: string) => router.replace({ pathname: '/workspace/[id]', params: { id, ...(repairPrompt ? { repairPrompt } : {}) } })
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><Button variant="ghost" style={styles.textButton} onPress={() => router.replace('/(tabs)/workspace')}><AppIcon icon={ArrowLeft} color={colors.accent} size={18} /><Button.Label style={styles.linkLabel}>{t('workspace')}</Button.Label></Button></View>
    <View style={styles.center}>
      {loadStatus === 'failed' ? <ProjectLoadFailure retrying={retrying} disabled={retrying} onRetry={() => { setRetrying(true); void retryLoad().catch(() => undefined).finally(() => setRetrying(false)) }} /> : loadStatus === 'loading' ? <Spinner color={colors.accent} /> : !project ? <>
        <Text style={styles.title}>{t('projectNotFound')}</Text><Text style={styles.body}>{t('shortcutMissingProject')}</Text>
      </> : <>
        <Image source={appearance?.iconUri ? { uri: appearance.iconUri } : require('../../assets/images/runwhale-icon.png')} style={styles.icon} contentFit="cover" />
        <Text style={styles.title}>{appearance?.name ?? project.name}</Text>
        <Text style={styles.body}>{t(busy ? 'openingPreview' : 'shortcutRunReady')}</Text>
        <PendingButton isPending={busy} onPress={() => { void previewRef.current?.open() }} style={styles.openButton}>
          {({ isPending }) => <>{isPending ? <Spinner color="#FFFFFF" size="sm" /> : <AppIcon icon={Play} color="#FFFFFF" size={18} />}<Button.Label style={styles.primaryLabel}>{t(isPending ? 'openingPreview' : 'openActivePreview')}</Button.Label></>}
        </PendingButton>
        <Button variant="ghost" style={styles.textButton} isDisabled={busy} onPress={() => edit()}><AppIcon icon={Pencil} color={colors.accent} size={15} /><Button.Label style={styles.linkLabel}>{t('shortcutEditProject')}</Button.Label></Button>
      </>}
    </View>
    {project && loadStatus === 'ready' ? <PreviewPanel ref={previewRef} project={project} sessionId={sessionId} autoOpen onBusyChange={setBusy} onFixWithAgent={edit} /> : null}
  </SafeAreaView>
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  header: { alignItems: 'flex-start', paddingHorizontal: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 28, width: '100%', maxWidth: 460, alignSelf: 'center' },
  icon: { width: 88, height: 88, borderRadius: 22, borderCurve: 'continuous', backgroundColor: colors.panel },
  title: { color: colors.text, fontSize: 24, fontWeight: '700', textAlign: 'center' },
  body: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  primaryLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  linkLabel: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  textButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 12, gap: 8, borderRadius: 12 },
  openButton: { backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', minHeight: 50, marginTop: 10, borderRadius: 15, gap: 8 },
}) }
