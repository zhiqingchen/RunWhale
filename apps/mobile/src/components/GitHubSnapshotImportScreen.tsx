import type { GitHubCommitReference, ProjectCloneProgress } from '@runwhale/mobile-protocol'
import { githubCommitUrl } from '@runwhale/mobile-protocol'
import { router } from 'expo-router'
import { Button } from 'heroui-native/button'
import { Spinner } from 'heroui-native/spinner'
import { useMemo, useState } from 'react'
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { AppIcon } from '@/components/AppIcon'
import { CircleCheck, CircleX, ExternalLink, FolderGit2, ShieldAlert } from '@/components/icons'
import { PendingButton } from '@/components/PendingButton'
import { useI18n } from '@/i18n'
import { useProjects } from '@/state/projects'
import { useRuntime } from '@/state/runtime'
import { controlSize, radius, typeScale, type ThemeColors, useAppColors } from '@/theme/tokens'
import { cloneProgressMessageKey, cloneProgressPercent } from '@/utils/clone-progress'

interface Props {
  initialReference?: GitHubCommitReference
  initialError?: string
}

export function GitHubSnapshotImportScreen({ initialReference, initialError }: Props) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const runtime = useRuntime()
  const { addProject, loadStatus } = useProjects()
  const reference = initialReference
  const [error, setError] = useState(initialError)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<ProjectCloneProgress | undefined>()

  const submitImport = async () => {
    if (!reference || importing || loadStatus !== 'ready') return
    setImporting(true)
    setError(undefined)
    try {
      const project = await runtime.importGithubSnapshot(reference, setProgress)
      await addProject(project)
      router.replace({ pathname: '/workspace/[id]', params: { id: project.id } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setImporting(false)
    }
  }

  const progressLabel = progress ? t(cloneProgressMessageKey(progress.phase)) : importing ? t('clonePreparingRepository') : undefined
  const percent = progress ? cloneProgressPercent(progress) : undefined

  return <SafeAreaView style={styles.safe} edges={['bottom']}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {!reference ? <View accessibilityRole="alert" style={[styles.noticeCard, styles.errorCard]}>
        <View style={[styles.noticeIcon, styles.errorIcon]}><AppIcon icon={CircleX} color={colors.danger} size={20} /></View>
        <View style={styles.noticeCopy}><Text style={styles.noticeTitle}>{t('githubShareInvalid')}</Text><Text style={styles.noticeBody}>{error ?? t('githubShareInvalid')}</Text></View>
      </View> : null}
      {reference ? <>
        <View style={[styles.noticeCard, styles.reviewCard]}>
          <View style={[styles.noticeIcon, styles.reviewIcon]}><AppIcon icon={ShieldAlert} color={colors.warning} size={21} /></View>
          <View style={styles.noticeCopy}>
            <Text style={styles.noticeTitle}>{t('githubImportReviewTitle')}</Text>
            <Text style={styles.noticeBody}>{t('githubImportExternalCodeWarning')}</Text>
          </View>
        </View>
        <View style={styles.repositoryCard}>
          <View style={styles.repositoryHeader}>
            <View style={styles.repositoryIcon}><AppIcon icon={FolderGit2} color={colors.accent} size={22} /></View>
            <View style={styles.repositoryCopy}>
              <Text style={styles.eyebrow}>{t('githubRepository')}</Text>
              <Text selectable style={styles.repository}>{reference.owner}/{reference.repo}</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <Text style={styles.eyebrow}>{t('githubCommit')}</Text>
          <Text selectable style={styles.commit}>{reference.commit}</Text>
        </View>
        <View style={[styles.noticeCard, styles.safetyCard]}>
          <View style={[styles.noticeIcon, styles.safetyIcon]}><AppIcon icon={CircleCheck} color={colors.accent} size={20} /></View>
          <View style={styles.noticeCopy}><Text style={styles.noticeTitle}>{t('githubImportSafetyTitle')}</Text><Text style={styles.noticeBody}>{t('githubImportSafetyBody')}</Text></View>
        </View>
        {progressLabel ? <View style={styles.progress}><Text style={styles.progressText}>{progressLabel}</Text>{percent === undefined ? <Spinner color={colors.accent} size="sm" /> : <Text style={styles.progressPercent}>{percent}%</Text>}</View> : null}
        {error ? <View accessibilityRole="alert" style={[styles.noticeCard, styles.errorCard]}>
          <View style={[styles.noticeIcon, styles.errorIcon]}><AppIcon icon={CircleX} color={colors.danger} size={20} /></View>
          <View style={styles.noticeCopy}><Text style={styles.noticeTitle}>{t('githubImportFailed')}</Text><Text style={[styles.noticeBody, styles.errorText]}>{error}</Text></View>
        </View> : null}
        <View style={styles.actionsCard}>
          <PendingButton variant="primary" isPending={importing} isDisabled={loadStatus !== 'ready'} onPress={() => { void submitImport() }} style={styles.primaryButton}>
            {({ isPending }) => <View style={styles.buttonContent}>{isPending ? <Spinner color="#FFFFFF" size="sm" /> : null}<Button.Label style={styles.primaryLabel}>{isPending ? t('githubImporting') : t('githubImportConfirm')}</Button.Label></View>}
          </PendingButton>
          <Button variant="secondary" isDisabled={importing} onPress={() => { void Linking.openURL(githubCommitUrl(reference)) }} style={styles.secondaryButton}>
            <AppIcon icon={ExternalLink} color={colors.accent} size={16} /><Button.Label style={styles.secondaryLabel}>{t('openGithub')}</Button.Label>
          </Button>
          <View style={styles.footerActions}>
            <Button size="sm" variant="ghost" isDisabled={importing} onPress={() => { void Linking.openURL(`https://github.com/contact/report-abuse?report=${encodeURIComponent(`${reference.owner}/${reference.repo}`)}`) }} style={styles.footerButton}><Button.Label style={styles.footerLabel}>{t('reportOnGithub')}</Button.Label></Button>
          </View>
        </View>
      </> : null}
    </ScrollView>
  </SafeAreaView>
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 28, gap: 12 },
  noticeCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderWidth: 1, borderRadius: radius.medium, padding: 14 },
  reviewCard: { borderColor: `${colors.warning}38`, backgroundColor: `${colors.warning}0C` },
  safetyCard: { borderColor: colors.border, backgroundColor: colors.panel },
  errorCard: { borderColor: `${colors.danger}45`, backgroundColor: `${colors.danger}0D` },
  noticeIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  reviewIcon: { backgroundColor: `${colors.warning}16` },
  safetyIcon: { backgroundColor: colors.accentDeep },
  errorIcon: { backgroundColor: `${colors.danger}15` },
  noticeCopy: { flex: 1, minWidth: 0, gap: 3 },
  noticeTitle: { color: colors.text, fontSize: typeScale.heading, lineHeight: 20, fontWeight: '900' },
  noticeBody: { color: colors.muted, fontSize: typeScale.label, lineHeight: 18 },
  errorText: { color: colors.danger },
  repositoryCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.large, backgroundColor: colors.panel, padding: 16, gap: 12 },
  repositoryHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  repositoryIcon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentDeep },
  repositoryCopy: { flex: 1, minWidth: 0, gap: 3 },
  eyebrow: { color: colors.muted, fontSize: typeScale.micro, lineHeight: 14, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase' },
  repository: { color: colors.text, fontSize: typeScale.title, lineHeight: 23, fontWeight: '900' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  commit: { color: colors.text, fontSize: typeScale.caption, lineHeight: 18, fontFamily: 'monospace' },
  progress: { minHeight: 44, paddingHorizontal: 14, borderRadius: radius.medium, backgroundColor: colors.accentDeep, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  progressText: { flex: 1, color: colors.text, fontSize: typeScale.label, fontWeight: '800' },
  progressPercent: { color: colors.accent, fontSize: typeScale.label, fontWeight: '900' },
  actionsCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.large, backgroundColor: colors.panel, padding: 12, gap: 8 },
  primaryButton: { height: 'auto', minHeight: controlSize.prominent, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  buttonContent: { minHeight: controlSize.prominent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryLabel: { color: '#FFFFFF', fontSize: typeScale.button, fontWeight: '900' },
  secondaryButton: { height: 'auto', minHeight: controlSize.regular, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  secondaryLabel: { color: colors.text, fontSize: typeScale.button, fontWeight: '800' },
  footerActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: 2 },
  footerButton: { minHeight: controlSize.compact, borderRadius: 10, paddingHorizontal: 7 },
  footerLabel: { color: colors.muted, fontSize: typeScale.caption, fontWeight: '700' },
}) }
