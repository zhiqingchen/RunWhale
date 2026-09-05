import { AppDialog } from '@/components/AppDialog'
import { AppIcon } from '@/components/AppIcon'
import { PendingButton } from '@/components/PendingButton'
import { ArrowLeft, Bot, Cpu, Database, KeyRound, PlugZap, SlidersHorizontal, type LucideIcon } from '@/components/icons'
import { useI18n } from '@/i18n'
import { usePreferences } from '@/state/preferences'
import { useRuntime } from '@/state/runtime'
import { useAppColors } from '@/theme/tokens'
import { actionErrorPresentation, runExclusiveAction } from '@/utils/action-progress'
import { focusedInputScrollOffset } from '@/utils/keyboard-scroll'
import { permissionModeChangeRequiresConfirmation, permissionModeDescriptionKeys } from '@/utils/permission-mode'
import { settingsAccessibilityContract, settingsChoiceAccessibility, settingsRadioAccessibilityState } from '@/utils/settings-accessibility'
import { settingsUseStackedRows } from '@/utils/settings-layout'
import { returnToSettingsHome, type SettingsDetail } from '@/utils/settings-routes'
import { loadRuntimeEnvironment, runtimeSettingsPresentation, shouldLoadRuntimeEnvironment, type RuntimeEnvironmentLoadState } from '@/utils/settings-runtime'
import type { MobilePermissionMode } from '@runwhale/mobile-protocol'
import { useFocusEffect, useRouter } from 'expo-router'
import { Alert } from 'heroui-native/alert'
import { Button } from 'heroui-native/button'
import { Card } from 'heroui-native/card'
import { Spinner } from 'heroui-native/spinner'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, UIManager, View, findNodeHandle, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ModelSettings } from './ModelSettings'
import { SshSettings } from './SshSettings'
import { createStyles, useSettingsStyles } from './settings-styles'

export function SettingsDetailScreen({ detail }: { detail: SettingsDetail }) {
  const router = useRouter()
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const handleBack = useCallback(() => returnToSettingsHome(router), [router])
  const scrollRef = useRef<ScrollView>(null)
  const focusedInputRef = useRef<TextInput | null>(null)
  const scrollOffsetRef = useRef(0)
  const { height: viewportHeight, width: viewportWidth } = useWindowDimensions()

  const revealFocusedInput = useCallback(() => {
    const input = focusedInputRef.current
    const scroll = scrollRef.current
    if (!input || !scroll) return
    const scrollHandle = findNodeHandle(scroll)
    if (scrollHandle === null) return
    UIManager.measure(scrollHandle, (_x, _y, _width, _height, _pageX, scrollPageY) => {
      input.measure((_inputX, _inputY, _inputWidth, _inputHeight, _inputPageX, inputPageY) => {
        scroll.scrollTo({ y: focusedInputScrollOffset(scrollOffsetRef.current, inputPageY, scrollPageY), animated: true })
      })
    })
  }, [])

  useEffect(() => {
    if (Platform.OS !== 'android') return
    const subscription = Keyboard.addListener('keyboardDidShow', revealFocusedInput)
    return () => subscription.remove()
  }, [revealFocusedInput])

  useEffect(() => {
    if (Platform.OS !== 'android') return
    const timeout = setTimeout(() => { if (Keyboard.isVisible()) revealFocusedInput() }, 250)
    return () => clearTimeout(timeout)
  }, [revealFocusedInput, viewportHeight, viewportWidth])

  const rememberFocusedInput = useCallback((input: TextInput | null) => { focusedInputRef.current = input }, [])
  const forgetFocusedInput = useCallback((input: TextInput | null) => {
    if (focusedInputRef.current === input) focusedInputRef.current = null
  }, [])

  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'android') return undefined
    const subscription = BackHandler.addEventListener('hardwareBackPress', handleBack)
    return () => subscription.remove()
  }, [handleBack]))

  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <View style={styles.detailHeader}>
      <Button isIconOnly size="sm" variant="ghost" accessibilityRole={settingsAccessibilityContract.buttonRole} accessibilityLabel={t('back')} onPress={handleBack} style={styles.backButton}>
        <AppIcon icon={ArrowLeft} color={colors.accent} size={21} />
      </Button>
      <Text accessibilityRole="header" numberOfLines={2} style={styles.detailTitle}>{detailTitle(detail, t)}</Text>
      <View style={styles.headerSpacer} />
    </View>
    <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.detailContent}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        onScroll={(event) => { scrollOffsetRef.current = event.nativeEvent.contentOffset.y }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <SettingsDetailIntroduction detail={detail} />
        {detail === 'models' ? <ModelSettings onInputBlur={forgetFocusedInput} onInputFocus={rememberFocusedInput} /> : null}
        {detail === 'runtime' ? <RuntimeSettings /> : null}
        {detail === 'general' ? <GeneralSettings /> : null}
        {detail === 'presets' ? <PresetSettings /> : null}
        {detail === 'plugins' ? <PluginSettings /> : null}
        {detail === 'ssh' ? <SshSettings /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>
}

function SettingsDetailIntroduction({ detail }: { detail: SettingsDetail }) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useSettingsStyles()
  return <View style={styles.detailIntroduction}>
    <View style={styles.detailIntroductionIcon}>
      <AppIcon icon={detailIcon(detail)} color={colors.accent} size={21} />
    </View>
    <Text style={styles.detailIntroductionText}>{detailDescription(detail, t)}</Text>
  </View>
}

function RuntimeSettings() {
  const [environment, setEnvironment] = useState<RuntimeEnvironmentLoadState>({ status: 'loading' })
  const [retryingTarget, setRetryingTarget] = useState<'environment' | 'runtime'>()
  const retryGuardRef = useRef(false)
  const runtime = useRuntime()
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useSettingsStyles()

  useEffect(() => {
    if (!runtime.info) {
      setEnvironment({ status: 'loading' })
      return undefined
    }
    const publishedNpmVersion = runtime.info.npmVersion
    if (!shouldLoadRuntimeEnvironment(publishedNpmVersion)) {
      setEnvironment({ status: 'ready', npmVersion: publishedNpmVersion })
      return undefined
    }
    let active = true
    setEnvironment({ status: 'loading' })
    void loadRuntimeEnvironment(() => runtime.request('host.environment', {}))
      .then((state) => { if (active) setEnvironment(state) })
    return () => { active = false }
  }, [runtime.info, runtime.request])

  const presentation = runtimeSettingsPresentation(environment, Boolean(runtime.lastError), runtime.info?.npmVersion)
  const displayedFailure = presentation.failure ?? retryingTarget
  const retry = () => {
    const target = presentation.retryTarget
    if (!target) return
    void runExclusiveAction(retryGuardRef, async () => {
      setRetryingTarget(target)
      try {
        if (target === 'runtime') {
          await runtime.retryRuntime()
          return
        }
        setEnvironment({ status: 'loading' })
        setEnvironment(await loadRuntimeEnvironment(() => runtime.request('host.environment', {})))
      } finally {
        setRetryingTarget(undefined)
      }
    })
  }

  return <Card style={styles.detailCard}><Card.Body style={styles.detailCardBody}>
    <Row label="Node.js" value={runtime.info?.nodeVersion ?? t('starting')} />
    <Row label="npm" value={presentation.npmVersion ?? t(presentation.npmStatus === 'failed' ? 'stateFailed' : 'starting')} />
    <Row label="Expo SDK" value="57.0.19" />
    <Row label="React Native" value="0.86.3" last />
    {displayedFailure ? <>
      <Alert {...actionErrorPresentation} style={styles.feedbackAlert}>
        <Alert.Indicator iconProps={{ size: 17 }} />
        <Alert.Content>
          <Alert.Title style={styles.feedbackTitle}>{t('runtimeDetailsUnavailableTitle')}</Alert.Title>
          <Alert.Description style={styles.feedbackText}>{t(displayedFailure === 'runtime' ? 'runtimeReportedFailure' : 'runtimeEnvironmentLoadFailed')}</Alert.Description>
        </Alert.Content>
      </Alert>
      <PendingButton size="sm" variant="secondary" accessibilityRole={settingsAccessibilityContract.buttonRole} isPending={Boolean(retryingTarget)} onPress={retry} style={[styles.runtimeRetryButton, styles.secondaryButton]}>
        {({ isPending }) => <View style={styles.pendingActionContent}>
          {isPending ? <Spinner color={colors.accent} size="sm" /> : null}
          <Button.Label style={styles.secondaryButtonText}>{t('retry')}</Button.Label>
        </View>}
      </PendingButton>
    </> : null}
  </Card.Body></Card>
}

function GeneralSettings() {
  const [pendingPermissionMode, setPendingPermissionMode] = useState<MobilePermissionMode>()
  const { language, setLanguage, t } = useI18n()
  const { busyMessageMode, setBusyMessageMode, appearance, setAppearance, permissionMode, setPermissionMode } = usePreferences()
  const styles = useSettingsStyles()
  const changePermissionMode = (next: MobilePermissionMode) => {
    if (!permissionModeChangeRequiresConfirmation(permissionMode, next)) { setPermissionMode(next); return }
    setPendingPermissionMode(next)
  }

  return <>
    <View style={styles.settingsGroup}>
      <ChoiceRow label={t('permissionMode')} value={permissionMode} options={[
        { key: 'review', label: t('reviewWrites'), description: t(permissionModeDescriptionKeys.review) },
        { key: 'read-only', label: t('readOnly'), description: t(permissionModeDescriptionKeys['read-only']) },
        { key: 'danger-full-access', label: t('fullAccess'), description: t(permissionModeDescriptionKeys['danger-full-access']) },
      ]} onChange={(value) => changePermissionMode(value as MobilePermissionMode)} />
      <ChoiceRow label={t('language')} value={language} options={[{ key: 'zh-CN', label: t('simplifiedChinese') }, { key: 'en', label: t('english') }]} onChange={(value) => setLanguage(value as 'zh-CN' | 'en')} />
      <ChoiceRow label={t('appearance')} value={appearance} options={[{ key: 'system', label: t('followSystem') }, { key: 'light', label: t('light') }, { key: 'dark', label: t('dark') }]} onChange={(value) => setAppearance(value as 'system' | 'light' | 'dark')} />
      <ChoiceRow label={t('enterWhileBusy')} value={busyMessageMode} options={[
        { key: 'followup', label: t('followup'), description: t('busyFollowupDescription') },
        { key: 'steer', label: t('steer'), description: t('busySteerDescription') },
      ]} onChange={(value) => setBusyMessageMode(value as 'followup' | 'steer')} last />
    </View>
    <AppDialog
      open={Boolean(pendingPermissionMode)}
      onOpenChange={(open) => { if (!open) setPendingPermissionMode(undefined) }}
      title={t('fullAccessConfirmationTitle')}
      description={t('fullAccessConfirmationBody')}
      closeLabel={t('cancel')}
      actions={[
        { label: t('cancel'), tone: 'cancel', onPress: () => setPendingPermissionMode(undefined) },
        { label: t('enableFullAccess'), tone: 'danger', onPress: () => { if (pendingPermissionMode) setPermissionMode(pendingPermissionMode); setPendingPermissionMode(undefined) } },
      ]}
      testID="settings-full-access-dialog"
    />
  </>
}

function PresetSettings() {
  const { t } = useI18n()
  const { agentPreset, setAgentPreset } = usePreferences()
  const styles = useSettingsStyles()
  return <View style={styles.settingsGroup}>
    <ChoiceRow label={t('defaultAgent')} value={agentPreset} options={[
      { key: 'standard', label: t('standardPreset'), description: t('standardPresetDescription') },
      { key: 'minimal', label: t('minimalPreset'), description: t('minimalPresetDescription') },
    ]} onChange={(value) => setAgentPreset(value as 'standard' | 'minimal')} last />
  </View>
}

function PluginSettings() {
  const { t } = useI18n()
  const styles = useSettingsStyles()
  return <View style={styles.infoCard}>
    <Text accessibilityRole="header" style={styles.infoTitle}>{t('mobileProfile')}</Text>
    <Text style={styles.infoBody}>{t('pluginDescription')}</Text>
  </View>
}

function ChoiceRow({ label, value, options, onChange, last = false }: { label: string; value: string; options: readonly { key: string; label: string; description?: string }[]; onChange(value: string): void; last?: boolean }) {
  const styles = useSettingsStyles()
  const selectedDescription = options.find((option) => option.key === value)?.description
  return <View style={[styles.choiceRow, !last && styles.settingsDivider]}>
    <Text style={styles.choiceLabel}>{label}</Text>
    <View style={styles.choiceOptions}>{options.map((option) => {
      const selected = option.key === value
      return <Button
        key={option.key}
        size="sm"
        variant={selected ? 'secondary' : 'outline'}
        {...settingsChoiceAccessibility(label, option.label, option.description)}
        accessibilityRole={settingsAccessibilityContract.radioRole}
        accessibilityState={settingsRadioAccessibilityState(selected)}
        onPress={() => onChange(option.key)}
        style={[styles.choiceButton, selected && styles.choiceButtonActive]}
      ><Button.Label style={[styles.choiceText, selected && styles.choiceTextActive]}>{option.label}</Button.Label></Button>
    })}</View>
    {selectedDescription ? <Text accessibilityLiveRegion="polite" style={styles.choiceDescription}>{selectedDescription}</Text> : null}
  </View>
}

function Row({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  const styles = useSettingsStyles()
  const { fontScale } = useWindowDimensions()
  const stacked = settingsUseStackedRows(fontScale)
  return <View accessible accessibilityLabel={`${label}, ${value}`} style={[styles.row, stacked && styles.rowStacked, !last && styles.settingsDivider]}>
    <Text style={[styles.rowLabel, stacked && styles.rowLabelStacked]}>{label}</Text>
    <Text style={[styles.rowValue, stacked && styles.rowValueStacked]}>{value}</Text>
  </View>
}

function detailTitle(detail: SettingsDetail, t: ReturnType<typeof useI18n>['t']): string {
  if (detail === 'models') return t('models')
  if (detail === 'runtime') return t('runtime')
  if (detail === 'ssh') return t('githubSshKey')
  if (detail === 'presets') return t('agentPresets')
  if (detail === 'plugins') return t('plugins')
  return t('general')
}

function detailIcon(detail: SettingsDetail): LucideIcon {
  if (detail === 'models') return Database
  if (detail === 'runtime') return Cpu
  if (detail === 'ssh') return KeyRound
  if (detail === 'presets') return Bot
  if (detail === 'plugins') return PlugZap
  return SlidersHorizontal
}

function detailDescription(detail: SettingsDetail, t: ReturnType<typeof useI18n>['t']): string {
  if (detail === 'models') return t('modelsSettingsDescription')
  if (detail === 'runtime') return t('runtimeSettingsDescription')
  if (detail === 'ssh') return t('sshSettingsDescription')
  if (detail === 'presets') return t('agentPresetsSettingsDescription')
  if (detail === 'plugins') return t('pluginsSettingsDescription')
  return t('generalSettingsDescription')
}
