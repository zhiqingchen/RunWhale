import * as Clipboard from 'expo-clipboard'
import { Image } from 'expo-image'
import { router, useLocalSearchParams } from 'expo-router'
import { Button } from 'heroui-native/button'
import { Spinner } from 'heroui-native/spinner'
import { useEffect, useMemo, useRef, useState } from 'react'
import { KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { NodeHost } from '@runwhale/node-host'
import { AppIcon } from '@/components/AppIcon'
import { ArrowDownToLine, Check, Copy, ExternalLink, File, Image as ImageIcon, Play, Smartphone } from '@/components/icons'
import { PendingButton } from '@/components/PendingButton'
import { ProjectLoadFailure } from '@/components/ProjectLoadFailure'
import { useI18n } from '@/i18n'
import { useProjects } from '@/state/projects'
import { useRuntime } from '@/state/runtime'
import { type ThemeColors, useAppColors } from '@/theme/tokens'
import { projectPreviewConfiguration } from '@/utils/project-preview'
import { isShortcutNameValid, PROJECT_SHORTCUT_NAME_LIMIT, projectLaunchUrl, type ProjectShortcutAppearance } from '@/utils/project-shortcut'
import { loadProjectShortcut, prepareShortcutIcon, saveProjectShortcut } from '@/utils/project-shortcut-storage'

export default function ProjectShortcutScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  return <ShortcutSetup key={projectId} projectId={projectId} />
}

function ShortcutSetup({ projectId }: { projectId: string }) {
  const { projects, loadStatus, retryLoad, loadFile, flushFiles } = useProjects()
  const project = projects.find((item) => item.id === projectId)
  const runtime = useRuntime()
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const [appearance, setAppearance] = useState<ProjectShortcutAppearance>({ name: '' })
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [copied, setCopied] = useState(false)
  const guard = useRef(false)
  const mounted = useRef(true)
  const pendingPreview = useRef<string | undefined>(undefined)
  const isIOS = Platform.OS === 'ios'
  const supported = Platform.OS === 'android' && NodeHost.supportsProjectShortcuts?.() === true
  const valid = isShortcutNameValid(appearance.name)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (pendingPreview.current) runtime.cancelPreviewLaunch(pendingPreview.current)
    }
  }, [runtime.cancelPreviewLaunch])

  const hydrate = async () => {
    if (!project) return
    setError(undefined)
    try {
      const saved = Platform.OS === 'web' ? undefined : await loadProjectShortcut(projectId)
      if (!mounted.current) return
      setAppearance(saved ?? { name: project.name.slice(0, PROJECT_SHORTCUT_NAME_LIMIT) })
      setLoaded(true)
    } catch (cause) { setError(t('shortcutActionFailed', { message: cause instanceof Error ? cause.message : String(cause) })) }
  }
  useEffect(() => { void hydrate() }, [project?.id])

  const perform = async (action: string, operation: () => Promise<void>) => {
    if (guard.current) return
    guard.current = true
    setBusy(action)
    setError(undefined)
    setNotice(undefined)
    try { await operation() }
    catch (cause) { if (mounted.current) setError(t('shortcutActionFailed', { message: cause instanceof Error ? cause.message : String(cause) })) }
    finally { guard.current = false; if (mounted.current) setBusy(undefined) }
  }

  const persist = async () => {
    const saved = await saveProjectShortcut(projectId, appearance)
    if (mounted.current) setAppearance(saved)
    return saved
  }

  const prepareLaunch = async () => {
    if (!project) return
    await flushFiles(projectId)
    const manifest = await loadFile(projectId, 'runwhale.json')
    const configuration = projectPreviewConfiguration({ ...project, files: [manifest] }, isIOS ? 'ios' : 'android')
    if ('error' in configuration) throw new Error(configuration.error)
    const requestId = `shortcut-${Date.now().toString(36)}`
    if (!mounted.current) return
    pendingPreview.current = requestId
    try {
      const cached = await runtime.openPreview(projectId, configuration.platform, requestId)
      if (mounted.current && cached.status !== 'ready') await runtime.runPreview(project, configuration.platform, requestId)
    } finally { pendingPreview.current = undefined }
  }

  const chooseIcon = (source: 'photos' | 'file') => perform(source, async () => {
    let uri: string | undefined
    if (source === 'photos') {
      const picker = await import('expo-image-picker')
      const result = await picker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 })
      if (!result.canceled) uri = result.assets[0]?.uri
    } else {
      const picker = await import('expo-document-picker')
      const result = await picker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true, multiple: false })
      if (!result.canceled) uri = result.assets[0]?.uri
    }
    if (uri) {
      const iconUri = await prepareShortcutIcon(uri)
      if (mounted.current) setAppearance((current) => ({ ...current, iconUri }))
    }
  })

  const pin = () => perform('pin', async () => {
    await prepareLaunch()
    if (!mounted.current) return
    const saved = await persist()
    if (!mounted.current) return
    const result = await NodeHost.pinProjectShortcut?.(projectId, saved.name, saved.iconUri)
    if (result === 'unsupported' || !result) throw new Error(t('shortcutUnsupported'))
    setNotice(t(result === 'updated' ? 'shortcutUpdated' : 'shortcutRequested'))
  })

  const copyLink = () => perform('copy', async () => {
    await prepareLaunch()
    if (!mounted.current) return
    await persist()
    if (!mounted.current) return
    await Clipboard.setStringAsync(projectLaunchUrl(projectId))
    setCopied(true)
  })

  const exportIcon = () => perform('export', async () => {
    const sharing = await import('expo-sharing')
    if (!await sharing.isAvailableAsync()) throw new Error(t('shortcutSharingUnavailable'))
    const saved = await persist()
    if (!mounted.current) return
    const { Directory, File, Paths } = await import('expo-file-system')
    const directory = new Directory(Paths.cache, `shortcut-icon-${projectId}-${Date.now()}`)
    directory.create()
    const file = new File(directory, 'App icon.png')
    try {
      await new File(saved.iconUri).copy(file)
      await sharing.shareAsync(file.uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: t('shortcutExportIcon') })
    } finally { directory.delete() }
  })

  const testLaunch = () => perform('launch', async () => {
    await persist()
    if (!mounted.current) return
    router.push({ pathname: '/run/[id]', params: { id: projectId } })
  })

  if (loadStatus === 'failed') return <SafeAreaView style={styles.safe}><View style={styles.content}><ProjectLoadFailure retrying={Boolean(busy)} disabled={Boolean(busy)} onRetry={() => { void perform('load', retryLoad) }} testID="shortcut-project-load-error" /></View></SafeAreaView>
  if (loadStatus === 'loading') return <View style={styles.center}><Spinner color={colors.accent} /></View>
  if (!project) return <View style={styles.center}><Text style={styles.title}>{t('projectNotFound')}</Text><Button onPress={() => router.replace('/(tabs)/workspace')}><Button.Label>{t('projectsBack')}</Button.Label></Button></View>

  const disabled = Boolean(busy) || !loaded || !valid || Platform.OS === 'web'
  return <SafeAreaView style={styles.safe} edges={['bottom']}>
    <KeyboardAvoidingView behavior={isIOS ? 'padding' : undefined} style={styles.safe}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text style={styles.lead}>{t('shortcutDescription')}</Text>
        <View style={styles.previewCard}>
          <View style={styles.previewBadge}><AppIcon icon={Smartphone} color={colors.accent} size={14} /><Text style={styles.eyebrow}>{t('shortcutPreviewLabel')}</Text></View>
          <Image source={appearance.iconUri ? { uri: appearance.iconUri } : require('../../assets/images/runwhale-icon.png')} style={styles.icon} contentFit="cover" accessibilityLabel={t('shortcutIcon')} />
          <Text numberOfLines={2} style={styles.previewName}>{appearance.name.trim() || project.name}</Text>
          <Text style={styles.previewCaption}>{t('shortcutPreviewCaption')}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>{t('shortcutName')}</Text>
          <TextInput testID="shortcut-name" accessibilityLabel={t('shortcutName')} style={styles.input} value={appearance.name} placeholder={project.name} placeholderTextColor={colors.muted} maxLength={PROJECT_SHORTCUT_NAME_LIMIT} editable={loaded && !busy && Platform.OS !== 'web'} onChangeText={(name) => { setAppearance((current) => ({ ...current, name })); setNotice(undefined) }} returnKeyType="done" />
          <View style={styles.iconHeader}><Text style={styles.label}>{t('shortcutIcon')}</Text>{appearance.iconUri ? <Button size="sm" variant="ghost" isDisabled={Boolean(busy)} onPress={() => setAppearance((current) => ({ name: current.name }))}><Button.Label>{t('reset')}</Button.Label></Button> : null}</View>
          <View style={styles.row}>
            <PendingButton variant="secondary" style={[styles.secondaryButton, styles.flexButton]} isPending={busy === 'photos'} isDisabled={!loaded || Boolean(busy) || Platform.OS === 'web'} onPress={() => { void chooseIcon('photos') }}>{busy === 'photos' ? <Spinner color={colors.accent} size="sm" /> : <AppIcon icon={ImageIcon} color={colors.accent} size={17} />}<Button.Label style={styles.secondaryLabel}>{t('photos')}</Button.Label></PendingButton>
            <PendingButton variant="secondary" style={[styles.secondaryButton, styles.flexButton]} isPending={busy === 'file'} isDisabled={!loaded || Boolean(busy) || Platform.OS === 'web'} onPress={() => { void chooseIcon('file') }}>{busy === 'file' ? <Spinner color={colors.accent} size="sm" /> : <AppIcon icon={File} color={colors.accent} size={17} />}<Button.Label style={styles.secondaryLabel}>{t('file')}</Button.Label></PendingButton>
          </View>
          <Text style={styles.body}>{t('shortcutIconHint')}</Text>
        </View>

        {isIOS ? <View style={styles.card}>
          <Text style={styles.title}>{t('shortcutIOSHeading')}</Text>
          <Step number="1" title={t('shortcutStepLink')} body={t('shortcutStepLinkBody')} styles={styles}>
            <PendingButton isPending={busy === 'copy'} style={styles.primaryButton} isDisabled={disabled || !runtime.info} onPress={() => { void copyLink() }} testID="shortcut-copy-link">{busy === 'copy' ? <Spinner color="#FFFFFF" size="sm" /> : <AppIcon icon={copied ? Check : Copy} color="#FFFFFF" size={17} />}<Button.Label style={styles.primaryLabel}>{t(busy === 'copy' ? 'shortcutPreparing' : copied ? 'copied' : 'copyLink')}</Button.Label></PendingButton>
          </Step>
          <Step number="2" title={t('shortcutStepCreate')} body={t('shortcutStepCreateBody')} styles={styles}>
            <Button variant="secondary" style={styles.secondaryButton} isDisabled={Boolean(busy)} onPress={() => { void perform('shortcuts', () => Linking.openURL('shortcuts://create-shortcut')) }}><AppIcon icon={ExternalLink} color={colors.accent} size={17} /><Button.Label style={styles.secondaryLabel}>{t('shortcutOpenShortcuts')}</Button.Label></Button>
          </Step>
          <Step number="3" title={t('shortcutStepHome')} body={t('shortcutStepHomeBody')} styles={styles}>
            <PendingButton variant="secondary" style={styles.secondaryButton} isPending={busy === 'export'} isDisabled={disabled} onPress={() => { void exportIcon() }}>{busy === 'export' ? <Spinner color={colors.accent} size="sm" /> : <AppIcon icon={ArrowDownToLine} color={colors.accent} size={17} />}<Button.Label style={styles.secondaryLabel}>{t('shortcutExportIcon')}</Button.Label></PendingButton>
          </Step>
        </View> : supported ? <PendingButton testID="shortcut-pin" isPending={busy === 'pin'} isDisabled={disabled || !runtime.info} onPress={() => { void pin() }} style={styles.primaryButton}>
          {({ isPending }) => <>{isPending ? <Spinner size="sm" color="#FFFFFF" /> : <AppIcon icon={Smartphone} color="#FFFFFF" size={19} />}<Button.Label style={styles.primaryLabel}>{t(isPending ? 'shortcutPreparing' : 'addToHomeScreen')}</Button.Label></>}
        </PendingButton> : <View style={styles.card}><Text style={styles.body}>{t(Platform.OS === 'web' ? 'shortcutDeviceOnly' : 'shortcutUnsupported')}</Text></View>}

        {error ? <View accessibilityRole="alert" style={styles.errorCard}><Text style={styles.error}>{error}</Text>{!loaded ? <Button variant="secondary" onPress={() => { void hydrate() }}><Button.Label>{t('retry')}</Button.Label></Button> : null}</View> : null}
        {notice ? <View accessibilityLiveRegion="polite" style={styles.notice}><AppIcon icon={Check} color={colors.accent} size={18} /><Text style={styles.noticeText}>{notice}</Text></View> : null}
        {Platform.OS !== 'web' ? <Button variant="ghost" style={styles.secondaryButton} isDisabled={disabled || !runtime.info} onPress={() => { void testLaunch() }}><AppIcon icon={Play} color={colors.accent} size={16} /><Button.Label style={styles.secondaryLabel}>{t('shortcutTestLaunch')}</Button.Label></Button> : null}
        <Text style={styles.footnote}>{t('shortcutRuntimeNote')}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>
}

function Step({ number, title, body, styles, children }: { number: string; title: string; body: string; styles: ReturnType<typeof createStyles>; children: React.ReactNode }) {
  return <View style={styles.step}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>{number}</Text></View><View style={styles.stepCopy}><Text style={styles.label}>{title}</Text><Text style={styles.body}>{body}</Text>{children}</View></View>
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 20, paddingBottom: 32, gap: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 18, backgroundColor: colors.canvas },
  lead: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  previewCard: { alignItems: 'center', padding: 24, gap: 10, borderRadius: 24, backgroundColor: colors.accentDeep, borderWidth: 1, borderColor: colors.border },
  previewBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  eyebrow: { fontSize: 11, fontWeight: '700', color: colors.accent },
  icon: { width: 96, height: 96, borderRadius: 23, borderCurve: 'continuous', backgroundColor: colors.panel },
  previewName: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center', maxWidth: 240 },
  previewCaption: { color: colors.muted, fontSize: 12 },
  card: { padding: 18, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, gap: 12 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  label: { color: colors.text, fontSize: 13, fontWeight: '700' },
  input: { color: colors.text, fontSize: 16, minHeight: 48, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.canvas },
  iconHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  row: { flexDirection: 'row', gap: 10 },
  flexButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 44, gap: 8 },
  body: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  primaryLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  secondaryLabel: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  secondaryButton: { backgroundColor: colors.accentDeep, borderRadius: 12, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryButton: { backgroundColor: colors.accent, minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 16, gap: 10 },
  step: { flexDirection: 'row', gap: 12, paddingTop: 8 },
  stepNumber: { width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentDeep },
  stepNumberText: { color: colors.accent, fontSize: 12, fontWeight: '800' },
  stepCopy: { flex: 1, gap: 9, paddingBottom: 8 },
  errorCard: { padding: 14, borderRadius: 14, backgroundColor: colors.panel, gap: 10 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  notice: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', padding: 14, borderRadius: 14, backgroundColor: colors.accentDeep },
  noticeText: { flex: 1, color: colors.accent, fontSize: 13, lineHeight: 19 },
  footnote: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center', paddingHorizontal: 12 },
}) }
