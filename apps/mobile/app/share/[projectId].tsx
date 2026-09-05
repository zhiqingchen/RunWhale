import type { GitShareInspection, GitSharePublication } from '@runwhale/mobile-protocol'
import * as Clipboard from 'expo-clipboard'
import { useLocalSearchParams } from 'expo-router'
import { Button } from 'heroui-native/button'
import { Spinner } from 'heroui-native/spinner'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Linking, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { SafeAreaView } from 'react-native-safe-area-context'
import { AppIcon } from '@/components/AppIcon'
import { CircleCheck, Copy, ExternalLink, GitBranch, RefreshCw, Share2, ShieldAlert } from '@/components/icons'
import { PendingButton } from '@/components/PendingButton'
import { useI18n } from '@/i18n'
import { useProjects } from '@/state/projects'
import { useRuntime } from '@/state/runtime'
import { controlSize, radius, typeScale, type ThemeColors, useAppColors } from '@/theme/tokens'
import { runExclusiveAction } from '@/utils/action-progress'

export default function ProjectShareScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const runtime = useRuntime()
  const { projects } = useProjects()
  const project = projects.find((item) => item.id === projectId)
  const [inspection, setInspection] = useState<GitShareInspection>()
  const [publication, setPublication] = useState<GitSharePublication>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const publishGuard = useRef(false)
  const copyReset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const inspect = async () => {
    setLoading(true)
    setError(undefined)
    try { setInspection(await runtime.request('git.share.inspect', { projectId })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }

  useEffect(() => { void inspect() }, [projectId])
  useEffect(() => () => { if (copyReset.current) clearTimeout(copyReset.current) }, [])

  const publish = async () => {
    await runExclusiveAction(publishGuard, async () => {
      setPublishing(true)
      setError(undefined)
      try { setPublication(await runtime.request('git.share.publish', { projectId })) }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
      finally { setPublishing(false) }
    })
  }

  const copyShareLink = async () => {
    if (!publication) return
    await Clipboard.setStringAsync(publication.shareUrl)
    setLinkCopied(true)
    if (copyReset.current) clearTimeout(copyReset.current)
    copyReset.current = setTimeout(() => setLinkCopied(false), 1600)
  }

  if (!project) return <SafeAreaView style={styles.safe}><View style={styles.center}><Text style={styles.title}>{t('projectNotFound')}</Text></View></SafeAreaView>

  const blockers = inspection?.blockers.filter((blocker) => blocker.code !== 'REMOTE_SHA_MISMATCH') ?? []
  const pushRequired = inspection?.blockers.some((blocker) => blocker.code === 'REMOTE_SHA_MISMATCH') ?? false
  const ready = Boolean(inspection?.canPublish)
  const actionLabel = !ready
    ? t('shareResolveIssues')
    : inspection?.shareable ? t('createShareLink') : t('pushAndCreateShareLink')

  return <SafeAreaView style={styles.safe} edges={['bottom']}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.lead}>{t('shareProjectDescription')}</Text>

      {loading ? <View accessibilityRole="progressbar" accessibilityLiveRegion="polite" style={styles.loadingCard}>
        <View style={styles.loadingIcon}><Spinner color={colors.accent} size="sm" /></View>
        <View style={styles.loadingCopy}><Text style={styles.cardTitle}>{t('checkingShareReadiness')}</Text><Text style={styles.cardBody}>{project.name}</Text></View>
      </View> : null}

      {inspection && !publication ? <>
        <View style={styles.repositoryCard}>
          <View style={styles.repositoryHeader}>
            <View style={styles.repositoryIcon}><AppIcon icon={GitBranch} color={colors.accent} size={22} /></View>
            <View style={styles.repositoryCopy}>
              <Text style={styles.eyebrow}>{inspection.remote ? `${inspection.remote.owner}/${inspection.remote.repo}` : t('missingGithubRemote')}</Text>
              <Text numberOfLines={1} style={styles.repository}>{project.name}</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.details}>
            <View style={styles.branchDetail}><Text style={styles.eyebrow}>{t('githubBranch')}</Text><Text numberOfLines={1} style={styles.detailValue}>{inspection.branch ?? '—'}</Text></View>
            <View style={styles.detailDivider} />
            <View style={styles.commitDetail}><Text style={styles.eyebrow}>{t('githubCommit')}</Text><Text selectable numberOfLines={1} style={styles.commit}>{inspection.head?.slice(0, 12) ?? '—'}</Text></View>
          </View>
        </View>

        {blockers.length > 0 ? <View style={styles.issuesCard}>
          <Text style={styles.sectionTitle}>{t('shareBeforeSharing')}</Text>
          {blockers.map((blocker) => <View key={blocker.code} style={styles.issueRow}>
            <View style={styles.issueIcon}><AppIcon icon={ShieldAlert} color={colors.warning} size={17} /></View>
            <View style={styles.issueCopy}>
              <Text style={styles.issueTitle}>{blocker.message}</Text>
              {blocker.paths?.length ? <View style={styles.paths}><Text numberOfLines={3} style={styles.pathText}>{blocker.paths.slice(0, 6).join('  ·  ')}</Text></View> : null}
            </View>
          </View>)}
        </View> : null}

        {pushRequired ? <View style={styles.pushCard}>
          <View style={styles.pushIcon}><AppIcon icon={GitBranch} color={colors.accent} size={18} /></View>
          <View style={styles.noticeCopy}><Text style={styles.cardTitle}>{t('sharePushRequired')}</Text><Text style={styles.cardBody}>{t('sharePushRequiredDescription')}</Text></View>
        </View> : null}

        <View style={styles.actionsCard}>
          <PendingButton variant="primary" isPending={publishing} isDisabled={!ready} onPress={() => { void publish() }} style={[styles.primaryButton, !ready && styles.disabledButton]}>
            {({ isPending }) => <View style={styles.buttonContent}>{isPending ? <Spinner color="#FFFFFF" size="sm" /> : <AppIcon icon={Share2} color="#FFFFFF" size={17} />}<Button.Label style={styles.primaryLabel}>{actionLabel}</Button.Label></View>}
          </PendingButton>
          <Button variant="secondary" isDisabled={publishing || loading} onPress={() => { void inspect() }} style={styles.secondaryButton}>
            <AppIcon icon={RefreshCw} color={colors.accent} size={16} /><Button.Label style={styles.secondaryLabel}>{t('checkAgain')}</Button.Label>
          </Button>
          <View style={styles.safetyNote}><AppIcon icon={CircleCheck} color={colors.muted} size={14} /><Text style={styles.safetyText}>{t('sharePushNotice')}</Text></View>
        </View>
      </> : null}

      {publication ? <View style={styles.resultCard}>
        <View style={styles.successHeader}><View style={styles.successIcon}><AppIcon icon={CircleCheck} color={colors.accent} size={24} /></View><View style={styles.successCopy}><Text style={styles.resultTitle}>{t('shareReady')}</Text><Text style={styles.cardBody}>{publication.owner}/{publication.repo} · {publication.commit.slice(0, 12)}</Text></View></View>
        <View style={styles.qr}><QRCode value={publication.shareUrl} size={214} quietZone={10} /></View>
        <View style={styles.linkCard}><Text selectable numberOfLines={2} style={styles.shareUrl}>{publication.shareUrl}</Text></View>
        <View style={styles.actionRow}>
          <Button variant="secondary" onPress={() => { void copyShareLink() }} style={styles.action}><AppIcon icon={linkCopied ? CircleCheck : Copy} color={colors.accent} size={17} /><Button.Label style={styles.secondaryLabel}>{linkCopied ? t('copied') : t('copyLink')}</Button.Label></Button>
          <Button variant="primary" onPress={() => { void Share.share({ message: publication.shareUrl, url: publication.shareUrl }) }} style={styles.shareAction}><AppIcon icon={Share2} color="#FFFFFF" size={17} /><Button.Label style={styles.primaryLabel}>{t('systemShare')}</Button.Label></Button>
        </View>
        <Button variant="ghost" onPress={() => { void Linking.openURL(publication.githubUrl) }} style={styles.githubAction}><AppIcon icon={ExternalLink} color={colors.accent} size={16} /><Button.Label style={styles.secondaryLabel}>{t('openGithub')}</Button.Label></Button>
        <View style={styles.safetyNote}><AppIcon icon={CircleCheck} color={colors.muted} size={14} /><Text style={styles.safetyText}>{t('sharePrivacyNotice')}</Text></View>
      </View> : null}

      {error ? <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.errorCard}>
        <View style={styles.errorIcon}><AppIcon icon={ShieldAlert} color={colors.danger} size={18} /></View>
        <View style={styles.noticeCopy}><Text style={styles.cardTitle}>{t('shareFailed')}</Text><Text style={styles.errorText}>{error}</Text></View>
      </View> : null}
    </ScrollView>
  </SafeAreaView>
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 32, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: colors.text, fontSize: typeScale.display, fontWeight: '900' },
  lead: { color: colors.muted, fontSize: typeScale.body, lineHeight: 20, textAlign: 'center', paddingHorizontal: 18, marginBottom: 2 },
  loadingCard: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius.large, backgroundColor: colors.panel, padding: 16 },
  loadingIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.accentDeep },
  loadingCopy: { flex: 1, gap: 3 },
  repositoryCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.large, backgroundColor: colors.panel, padding: 16, gap: 14 },
  repositoryHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  repositoryIcon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentDeep },
  repositoryCopy: { flex: 1, minWidth: 0, gap: 3 },
  repository: { color: colors.text, fontSize: typeScale.title, lineHeight: 23, fontWeight: '900' },
  eyebrow: { color: colors.muted, fontSize: typeScale.micro, lineHeight: 14, fontWeight: '900', letterSpacing: 0.65, textTransform: 'uppercase' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  details: { minHeight: 40, flexDirection: 'row', alignItems: 'stretch' },
  branchDetail: { width: 108, paddingRight: 12, gap: 3 },
  commitDetail: { flex: 1, minWidth: 0, paddingLeft: 14, gap: 3 },
  detailDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  detailValue: { color: colors.text, fontSize: typeScale.label, lineHeight: 18, fontWeight: '800' },
  commit: { color: colors.text, fontSize: typeScale.label, lineHeight: 18, fontFamily: 'monospace', fontWeight: '700' },
  issuesCard: { borderWidth: 1, borderColor: `${colors.warning}30`, borderRadius: radius.large, backgroundColor: `${colors.warning}08`, padding: 14, gap: 11 },
  sectionTitle: { color: colors.text, fontSize: typeScale.heading, lineHeight: 20, fontWeight: '900' },
  issueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  issueIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.warning}14` },
  issueCopy: { flex: 1, minWidth: 0, paddingTop: 4, gap: 7 },
  issueTitle: { color: colors.text, fontSize: typeScale.label, lineHeight: 18, fontWeight: '800' },
  paths: { alignSelf: 'stretch', borderRadius: radius.small, backgroundColor: `${colors.warning}0C`, paddingHorizontal: 9, paddingVertical: 7 },
  pathText: { color: colors.warning, fontSize: typeScale.caption, lineHeight: 16, fontFamily: 'monospace' },
  pushCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, borderWidth: 1, borderColor: `${colors.accent}2B`, borderRadius: radius.medium, backgroundColor: colors.accentDeep, padding: 14 },
  pushIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel },
  noticeCopy: { flex: 1, minWidth: 0, gap: 3 },
  cardTitle: { color: colors.text, fontSize: typeScale.heading, lineHeight: 20, fontWeight: '900' },
  cardBody: { color: colors.muted, fontSize: typeScale.label, lineHeight: 18 },
  actionsCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.large, backgroundColor: colors.panel, padding: 12, gap: 8 },
  primaryButton: { height: 'auto', minHeight: controlSize.prominent, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  disabledButton: { opacity: 0.44 },
  buttonContent: { minHeight: controlSize.prominent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryLabel: { color: '#FFFFFF', fontSize: typeScale.button, fontWeight: '900' },
  secondaryButton: { height: 'auto', minHeight: controlSize.regular, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  secondaryLabel: { color: colors.text, fontSize: typeScale.button, fontWeight: '800' },
  safetyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingHorizontal: 5, paddingTop: 4 },
  safetyText: { flex: 1, color: colors.muted, fontSize: typeScale.caption, lineHeight: 16 },
  resultCard: { alignItems: 'stretch', borderWidth: 1, borderColor: colors.border, borderRadius: radius.large, padding: 14, backgroundColor: colors.panel, gap: 13 },
  successHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  successIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentDeep },
  successCopy: { flex: 1, minWidth: 0, gap: 2 },
  resultTitle: { color: colors.text, fontSize: typeScale.title, lineHeight: 23, fontWeight: '900' },
  qr: { alignSelf: 'center', padding: 9, backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  linkCard: { borderRadius: radius.medium, backgroundColor: colors.raised, paddingHorizontal: 13, paddingVertical: 10 },
  shareUrl: { color: colors.text, fontSize: typeScale.caption, lineHeight: 17, textAlign: 'center' },
  actionRow: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, height: 'auto', minHeight: controlSize.regular, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  shareAction: { flex: 1, height: 'auto', minHeight: controlSize.regular, borderRadius: 13, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  githubAction: { height: 'auto', minHeight: controlSize.regular, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  errorCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, borderWidth: 1, borderColor: `${colors.danger}38`, borderRadius: radius.medium, backgroundColor: `${colors.danger}0C`, padding: 14 },
  errorIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.danger}13` },
  errorText: { color: colors.danger, fontSize: typeScale.label, lineHeight: 18 },
}) }
