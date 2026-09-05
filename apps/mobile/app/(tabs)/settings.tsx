import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Bot, ChevronRight, Cpu, Database, KeyRound, PlugZap, SlidersHorizontal, type LucideIcon } from '@/components/icons'
import { Button } from 'heroui-native/button'
import { Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { topLevelPageTitleStyle, topLevelScreenLayout, typeScale, type ThemeColors, useAppColors } from '@/theme/tokens'
import { settingsControlColorsFor } from '@/theme/settings-control-colors'
import { useRuntime } from '@/state/runtime'
import { useI18n } from '@/i18n'
import { usePreferences } from '@/state/preferences'
import { AppIcon } from '@/components/AppIcon'
import { loadSshSettingsStorage, SSH_PRIVATE_CREDENTIAL_STORAGE_KEY, SSH_PUBLIC_METADATA_STORAGE_KEY, sshSettingsSummaryState, type SshPublicMetadataState, type SshSecureStorageState } from '@/utils/settings-feedback'
import { settingsAccessibilityContract } from '@/utils/settings-accessibility'
import { settingsDetailRoutes } from '@/utils/settings-routes'
import { runtimeSettingsSummaryState } from '@/utils/settings-runtime'
import { settingsUseStackedRows } from '@/utils/settings-layout'
import { deviceLayout } from '@/utils/device-layout'

export default function SettingsScreen() {
  const router = useRouter()
  const runtime = useRuntime()
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const { modelProvider, agentPreset } = usePreferences()
  const [sshStorage, setSshStorage] = useState<{ metadata: SshPublicMetadataState; secureStorage: SshSecureStorageState }>({
    metadata: { status: 'loading' },
    secureStorage: { status: 'loading' },
  })

  useFocusEffect(useCallback(() => {
    let active = true
    // The initial state covers the first load; later focus refreshes retain the
    // last resolved summary until the new storage result is available.
    void loadSshSettingsStorage(
      () => AsyncStorage.getItem(SSH_PUBLIC_METADATA_STORAGE_KEY),
      Platform.OS === 'web' ? undefined : () => SecureStore.getItemAsync(SSH_PRIVATE_CREDENTIAL_STORAGE_KEY),
    ).then((state) => {
      if (active) setSshStorage(state)
    })
    return () => { active = false }
  }, []))

  const sshStatus = localizedSshStorageState(sshStorage, t)
  const sshStatusFailed = sshSettingsSummaryState(sshStorage) === 'failed'

  return <SafeAreaView style={styles.safe} edges={['top']}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.pageHeader}><Text accessibilityRole="header" style={styles.pageTitle}>{t('settings')}</Text></View>
      <SectionTitle>{t('deepSeekHarness')}</SectionTitle>
      <View style={styles.settingsGroup}>
        <SettingsLink icon={SlidersHorizontal} label={t('general')} description={t('generalSettingsSummary')} onPress={() => router.push(settingsDetailRoutes.general)} />
        <SettingsLink icon={Database} label={t('models')} description={t('modelsSettingsSummary')} value={providerName(modelProvider)} onPress={() => router.push(settingsDetailRoutes.models)} />
        <SettingsLink icon={Bot} label={t('agentPresets')} description={t('agentPresetsSettingsSummary')} value={agentPreset === 'standard' ? t('standardPreset') : t('minimalPreset')} onPress={() => router.push(settingsDetailRoutes.presets)} />
        <SettingsLink icon={PlugZap} label={t('plugins')} description={t('pluginsSettingsSummary')} value={t('mobileProfile')} onPress={() => router.push(settingsDetailRoutes.plugins)} last />
      </View>
      <SectionTitle>{t('runWhale')}</SectionTitle>
      <View style={styles.settingsGroup}>
        <SettingsLink icon={Cpu} label={t('runtime')} description={t('runtimeSettingsSummary')} value={localizedRuntimeState(runtimeSettingsSummaryState(runtime.snapshot.state, Boolean(runtime.info), Boolean(runtime.lastError)), t)} onPress={() => router.push(settingsDetailRoutes.runtime)} />
        <SettingsLink icon={KeyRound} label={t('githubSshKey')} description={t('sshSettingsSummary')} value={sshStatus.value} valueDanger={sshStatusFailed} accessibilityHint={sshStatus.hint} onPress={() => router.push(settingsDetailRoutes.ssh)} last />
      </View>
    </ScrollView>
  </SafeAreaView>
}

function SettingsLink({ icon, label, description, value, valueDanger = false, accessibilityHint, onPress, last = false }: { icon: LucideIcon; label: string; description: string; value?: string; valueDanger?: boolean; accessibilityHint?: string; onPress(): void; last?: boolean }) {
  const styles = useSettingsStyles()
  const colors = useAppColors()
  const { fontScale } = useWindowDimensions()
  const stacked = settingsUseStackedRows(fontScale)
  return <Button
    variant="ghost"
    accessibilityRole={settingsAccessibilityContract.buttonRole}
    accessibilityLabel={[label, value, description].filter(Boolean).join(', ')}
    accessibilityHint={accessibilityHint}
    onPress={onPress}
    style={[styles.settingsLink, !last && styles.settingsDivider]}
  >
    <View style={styles.settingsIcon}>
      <AppIcon icon={icon} color={colors.accent} size={18} />
    </View>
    <View style={styles.settingsCopy}>
      <Text numberOfLines={stacked ? undefined : 2} style={styles.settingsLabel}>{label}</Text>
      <Text numberOfLines={stacked ? undefined : 2} style={styles.settingsDescription}>{description}</Text>
    </View>
    <View style={styles.settingsAccessory}>
      {value ? <Text numberOfLines={1} style={[styles.settingsValue, valueDanger && styles.settingsValueDanger]}>{value}</Text> : null}
      <AppIcon icon={ChevronRight} color={colors.muted} size={18} />
    </View>
  </Button>
}

function localizedSshStorageState(state: { metadata: SshPublicMetadataState; secureStorage: SshSecureStorageState }, t: ReturnType<typeof useI18n>['t']): { value: string; hint?: string } {
  const status = sshSettingsSummaryState(state)
  if (status === 'loading') return { value: t('loadingSshKey') }
  if (status === 'failed') return { value: t('stateFailed'), hint: t('sshKeyLoadFailed') }
  if (status === 'needs-attention') return { value: t('needsAttention'), hint: t('sshPrivateKeyMissing') }
  if (status === 'configured') return { value: t('enabled') }
  return { value: t('notConfigured') }
}

function SectionTitle({ children }: { children: string }) {
  const styles = useSettingsStyles()
  return <Text accessibilityRole="header" style={styles.section}>{children}</Text>
}

function providerName(provider: 'deepseek' | 'openai' | 'anthropic' | 'google'): string {
  if (provider === 'openai') return 'OpenAI'
  if (provider === 'anthropic') return 'Anthropic'
  if (provider === 'google') return 'Google'
  return 'DeepSeek'
}

function localizedRuntimeState(state: string, t: ReturnType<typeof useI18n>['t']): string {
  if (state === 'running') return t('stateRunning')
  if (state === 'failed') return t('stateFailed')
  if (state === 'stopped') return t('stateIdle')
  if (state === 'stopping') return t('stopping')
  return t('starting')
}

function useSettingsStyles() {
  const colors = useAppColors()
  return useMemo(() => createStyles(colors), [colors])
}

function createStyles(colors: ThemeColors) {
  const controlColors = settingsControlColorsFor(colors)
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { width: '100%', maxWidth: deviceLayout.readableContentMaximumWidth, alignSelf: 'center', paddingHorizontal: 18, paddingTop: topLevelScreenLayout.topPadding, paddingBottom: 34, gap: 9 },
  pageHeader: { minHeight: topLevelScreenLayout.headerMinHeight },
  pageTitle: { color: colors.text, ...topLevelPageTitleStyle },
  section: { color: controlColors.choiceForeground, fontSize: typeScale.micro, letterSpacing: 1, fontWeight: '900', marginTop: 9, marginBottom: 2 },
  settingsGroup: { overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel },
  settingsLink: { height: 'auto', minHeight: 64, width: '100%', paddingLeft: 8, paddingRight: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 10 },
  settingsDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  settingsIcon: { width: 34, height: 34, flexShrink: 0, borderRadius: 10, backgroundColor: colors.accentDeep, alignItems: 'center', justifyContent: 'center' },
  settingsCopy: { flex: 1, minWidth: 0, gap: 2 },
  settingsLabel: { minWidth: 0, flexShrink: 1, color: colors.text, fontSize: typeScale.body, lineHeight: 18, fontWeight: '700' },
  settingsDescription: { minWidth: 0, color: colors.muted, fontSize: typeScale.caption, lineHeight: 15 },
  settingsAccessory: { maxWidth: '44%', flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  settingsValue: { minWidth: 0, flexShrink: 1, overflow: 'hidden', borderRadius: 7, backgroundColor: colors.raised, color: colors.muted, fontSize: typeScale.micro, lineHeight: 14, fontWeight: '700', textAlign: 'right', paddingHorizontal: 6, paddingVertical: 2 },
  settingsValueDanger: { color: colors.danger },
  })
}
