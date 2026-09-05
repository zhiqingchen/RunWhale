import { AppDialog } from '@/components/AppDialog'
import { AppIcon } from '@/components/AppIcon'
import { PendingButton } from '@/components/PendingButton'
import { ProviderLogo } from '@/components/ProviderLogo'
import { ChevronDown, CircleCheck, Plus } from '@/components/icons'
import { useI18n } from '@/i18n'
import { MOBILE_MODEL_OPTIONS, usePreferences } from '@/state/preferences'
import { useRuntime } from '@/state/runtime'
import { settingsControlColorsFor } from '@/theme/settings-control-colors'
import { useAppColors } from '@/theme/tokens'
import { actionErrorPresentation } from '@/utils/action-progress'
import { CredentialActivationError, CredentialRemovalError, isProviderCredentialInputValid, removeCredential, saveCredential } from '@/utils/credential-actions'
import { normalizedModelProfile } from '@/utils/model-settings'
import { settingsAccessibilityContract, settingsChoiceAccessibility, settingsRadioAccessibilityState } from '@/utils/settings-accessibility'
import { credentialDraftPersistenceReducer, credentialEditPresentation, credentialLookupPresentation, credentialProviderChangeRequiresDraftDiscard, credentialSaveAnnouncementPending, loadCredentialPresence, type CredentialLookupState } from '@/utils/settings-credential'
import { settingsDestructiveActionContract } from '@/utils/settings-feedback'
import { settingsProviderColumnCount } from '@/utils/settings-layout'
import type { MobileModelDefinition, MobileModelProvider, MobileModelProviderProfile } from '@runwhale/mobile-protocol'
import * as SecureStore from 'expo-secure-store'
import { Alert } from 'heroui-native/alert'
import { Button } from 'heroui-native/button'
import { Spinner } from 'heroui-native/spinner'
import { useEffect, useReducer, useRef, useState } from 'react'
import { AccessibilityInfo, Keyboard, Platform, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { useSettingsStyles } from './settings-styles'

type CredentialAction = 'saving' | 'removing'

type CredentialError = 'credentialSaveFailed' | 'credentialActivationFailed' | 'credentialRemoveFailed' | 'credentialDeactivationFailed'

type ModelDraft = { id: string; name: string; contextWindow: string; maxTokens: string }

export function ModelSettings({ onInputBlur, onInputFocus }: { onInputBlur(input: TextInput | null): void; onInputFocus(input: TextInput | null): void }) {
  const [key, setKey] = useState('')
  const [credentialAction, setCredentialAction] = useState<CredentialAction>()
  const [credentialError, setCredentialError] = useState<CredentialError>()
  const [credentialLookup, setCredentialLookup] = useState<{ provider?: MobileModelProvider; state: CredentialLookupState }>({ state: 'loading' })
  const [credentialLookupAttempt, setCredentialLookupAttempt] = useState(0)
  const [credentialRemovalProvider, setCredentialRemovalProvider] = useState<MobileModelProvider>()
  const [pendingModelProvider, setPendingModelProvider] = useState<MobileModelProvider>()
  const [currentDraftPersisted, updateDraftPersistence] = useReducer(credentialDraftPersistenceReducer, false)
  const [credentialSaveAnnouncementToken, setCredentialSaveAnnouncementToken] = useState(0)
  const [customModelSettingsOpen, setCustomModelSettingsOpen] = useState(false)
  const [modelSelectionOpen, setModelSelectionOpen] = useState(false)
  const [baseURLDraft, setBaseURLDraft] = useState('')
  const [modelDrafts, setModelDrafts] = useState<ModelDraft[]>([])
  const [modelSettingsSaved, setModelSettingsSaved] = useState(false)
  const credentialActionRef = useRef<CredentialAction | undefined>(undefined)
  const announcedCredentialSaveTokenRef = useRef(0)
  const modelSettingsProviderRef = useRef<MobileModelProvider | undefined>(undefined)
  const keyInputRef = useRef<TextInput>(null)
  const baseURLInputRef = useRef<TextInput>(null)
  const runtime = useRuntime()
  const { t } = useI18n()
  const colors = useAppColors()
  const controlColors = settingsControlColorsFor(colors)
  const styles = useSettingsStyles()
  const { fontScale, width: viewportWidth } = useWindowDimensions()
  const providerColumns = settingsProviderColumnCount(viewportWidth, fontScale)
  const { modelProvider, model, modelProfiles, setModelProvider, setModel, setModelProfile } = usePreferences()
  const modelProfile = modelProfiles[modelProvider]
  const secureStoreAvailable = Platform.OS !== 'web'
  const lookupPresentation = credentialLookupPresentation(credentialLookup.provider === modelProvider ? credentialLookup.state : 'loading')
  const credentialMutationReady = lookupPresentation.mutationReady
  const saved = lookupPresentation.saved
  const editPresentation = credentialEditPresentation({
    saved,
    draft: key,
    saving: credentialAction === 'saving',
    draftAlreadySaved: currentDraftPersisted,
    saveFailed: credentialError === 'credentialSaveFailed',
  })
  const keyIsValid = isProviderCredentialInputValid(key)
  const credentialUnavailableMessage = lookupPresentation.showUnavailable
    ? t('credentialSecureStorageRequired')
    : lookupPresentation.showFailure ? t('credentialLoadFailed') : undefined

  useEffect(() => {
    setCredentialError(undefined)
    setCredentialRemovalProvider(undefined)
    setPendingModelProvider(undefined)
    updateDraftPersistence('context-reset')
    setKey('')
    if (!secureStoreAvailable) {
      setCredentialLookup({ provider: modelProvider, state: 'unavailable' })
      return undefined
    }
    let cancelled = false
    setCredentialLookup({ provider: modelProvider, state: 'loading' })
    void loadCredentialPresence(() => SecureStore.getItemAsync(`${modelProvider}.api-key`))
      .then((state) => { if (!cancelled) setCredentialLookup({ provider: modelProvider, state }) })
    return () => { cancelled = true }
  }, [credentialLookupAttempt, modelProvider, secureStoreAvailable])

  useEffect(() => {
    setBaseURLDraft(modelProfile.baseURL ?? '')
    setModelDrafts(modelProfile.models.map(modelDraft))
    if (modelSettingsProviderRef.current !== modelProvider) {
      setCustomModelSettingsOpen(false)
      setModelSettingsSaved(false)
    }
    modelSettingsProviderRef.current = modelProvider
  }, [modelProfile, modelProvider])

  useEffect(() => {
    if (!credentialSaveAnnouncementPending(credentialSaveAnnouncementToken, announcedCredentialSaveTokenRef.current)) return
    announcedCredentialSaveTokenRef.current = credentialSaveAnnouncementToken
    AccessibilityInfo.announceForAccessibility(t('credentialSavedAnnouncement'))
  }, [credentialSaveAnnouncementToken, t])

  const retryCredentialLookup = () => {
    setCredentialLookup({ provider: modelProvider, state: 'loading' })
    setCredentialLookupAttempt((current) => current + 1)
  }

  const requestModelProviderChange = (provider: MobileModelProvider) => {
    if (credentialActionRef.current || provider === modelProvider) return
    Keyboard.dismiss()
    if (credentialProviderChangeRequiresDraftDiscard(modelProvider, provider, key, currentDraftPersisted)) {
      setPendingModelProvider(provider)
      return
    }
    setModelProvider(provider)
  }

  const save = async () => {
    if (!credentialMutationReady || !keyIsValid || credentialActionRef.current) return
    credentialActionRef.current = 'saving'
    setCredentialAction('saving')
    setCredentialError(undefined)
    updateDraftPersistence('save-started')
    try {
      await saveCredential({
        value: key,
        persist: async (value) => SecureStore.setItemAsync(`${modelProvider}.api-key`, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
        activate: async (value) => { await runtime.request('credential.set', { provider: modelProvider, value }) },
      })
      setKey('')
      setCredentialLookup({ provider: modelProvider, state: 'loaded-present' })
      updateDraftPersistence('save-succeeded')
      setCredentialSaveAnnouncementToken((current) => current + 1)
    } catch (cause) {
      if (cause instanceof CredentialActivationError) {
        setCredentialLookup({ provider: modelProvider, state: 'loaded-present' })
        updateDraftPersistence('save-activation-failed')
        setCredentialError('credentialActivationFailed')
      } else {
        updateDraftPersistence('save-persistence-failed')
        setCredentialError('credentialSaveFailed')
      }
    } finally {
      credentialActionRef.current = undefined
      setCredentialAction(undefined)
    }
  }

  const remove = async (provider: MobileModelProvider) => {
    if (!credentialMutationReady || provider !== modelProvider || credentialActionRef.current) return
    credentialActionRef.current = 'removing'
    setCredentialAction('removing')
    setCredentialError(undefined)
    try {
      await removeCredential({
        deactivate: async () => { await runtime.request('credential.delete', { provider }) },
        remove: async () => SecureStore.deleteItemAsync(`${provider}.api-key`),
      })
      setCredentialLookup({ provider, state: 'loaded-absent' })
      updateDraftPersistence('durable-removal-succeeded')
      setCredentialRemovalProvider(undefined)
    } catch (cause) {
      if (cause instanceof CredentialRemovalError && !cause.durableRemovalFailed) {
        setCredentialLookup({ provider, state: 'loaded-absent' })
        updateDraftPersistence('durable-removal-succeeded')
        setCredentialError('credentialDeactivationFailed')
        setCredentialRemovalProvider(undefined)
      } else {
        updateDraftPersistence('durable-removal-failed')
        setCredentialError('credentialRemoveFailed')
      }
    } finally {
      credentialActionRef.current = undefined
      setCredentialAction(undefined)
    }
  }

  const modelOptions = Array.from(new Set([model, ...modelProfile.models.map((entry) => entry.id)]))
  const modelSettingsValidation = validateModelDrafts(baseURLDraft, modelDrafts)
  const modelSettingsDirty = JSON.stringify({ baseURL: baseURLDraft, models: modelDrafts }) !== JSON.stringify({
    baseURL: modelProfile.baseURL ?? '',
    models: modelProfile.models.map(modelDraft),
  })
  const updateModelDraft = (index: number, change: Partial<ModelDraft>) => {
    setModelSettingsSaved(false)
    setModelDrafts((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...change } : entry))
  }
  const applyModelSettings = () => {
    if (!modelSettingsValidation.profile) return
    setModelProfile(modelProvider, modelSettingsValidation.profile)
    setModelSettingsSaved(true)
    Keyboard.dismiss()
  }
  return <>
  <View style={styles.modelCard}>
    <Text style={styles.cardLabel}>{t('provider')}</Text>
    <View style={styles.providerGrid}>
      {(['deepseek', 'openai', 'anthropic', 'google'] as const).map((provider) => {
        const selected = modelProvider === provider
        return <Button
          key={provider}
          size="sm"
          variant={selected ? 'primary' : 'outline'}
          {...settingsChoiceAccessibility(t('provider'), providerName(provider))}
          accessibilityRole={settingsAccessibilityContract.radioRole}
          accessibilityState={settingsRadioAccessibilityState(selected, { disabled: Boolean(credentialAction) })}
          isDisabled={Boolean(credentialAction)}
          onPress={() => requestModelProviderChange(provider)}
          style={[styles.providerButton, providerColumns === 1 && styles.providerButtonSingleColumn, selected && styles.providerButtonActive]}
        >
          <ProviderLogo provider={provider} color={selected ? controlColors.primaryForeground : controlColors.choiceForeground} size={17} />
          <Button.Label numberOfLines={providerColumns === 1 ? undefined : 1} style={[styles.providerText, selected && styles.providerTextActive]}>{providerName(provider)}</Button.Label>
        </Button>
      })}
    </View>
    <Text style={styles.cardLabel}>{t('providerApiKey', { provider: providerName(modelProvider) })}</Text>
    <TextInput
      ref={keyInputRef}
      accessibilityLabel={t('providerApiKey', { provider: providerName(modelProvider) })}
      accessibilityHint={credentialUnavailableMessage}
      accessibilityState={{ disabled: !credentialMutationReady || Boolean(credentialAction) }}
      value={key}
      onChangeText={(value) => {
        setKey(value)
        setCredentialError(undefined)
        updateDraftPersistence('draft-edited')
      }}
      onSubmitEditing={() => { void save() }}
      onFocus={() => onInputFocus(keyInputRef.current)}
      onBlur={() => onInputBlur(keyInputRef.current)}
      editable={credentialMutationReady && !credentialAction}
      secureTextEntry
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="done"
      placeholder={saved ? t('keySaved') : 'sk-…'}
      placeholderTextColor={controlColors.choiceForeground}
      style={styles.textInput}
    />
    {lookupPresentation.showLoading ? <View accessible accessibilityRole="progressbar" accessibilityLabel={t('loadingCredential')} accessibilityLiveRegion="polite" style={styles.loadingRow}>
      <Spinner size="sm" color={colors.accent} />
      <Text style={styles.loadingText}>{t('loadingCredential')}</Text>
    </View> : null}
    {lookupPresentation.showFailure ? <>
      <Alert {...actionErrorPresentation} style={styles.feedbackAlert}>
        <Alert.Indicator iconProps={{ size: 17 }} />
        <Alert.Content><Alert.Description style={styles.feedbackText}>{t('credentialLoadFailed')}</Alert.Description></Alert.Content>
      </Alert>
      <Button size="sm" variant="secondary" accessibilityRole={settingsAccessibilityContract.buttonRole} onPress={retryCredentialLookup} style={[styles.credentialRetryButton, styles.secondaryButton]}>
        <Button.Label style={styles.secondaryButtonText}>{t('retry')}</Button.Label>
      </Button>
    </> : null}
    {lookupPresentation.showUnavailable ? <Alert accessibilityRole="alert" accessibilityLiveRegion="polite" status="warning" style={styles.feedbackAlert}>
      <Alert.Indicator iconProps={{ size: 17 }} />
      <Alert.Content><Alert.Description style={styles.feedbackText}>{t('credentialSecureStorageRequired')}</Alert.Description></Alert.Content>
    </Alert> : null}
    {editPresentation.showSaved ? <View
      accessible
      accessibilityLabel={t('credentialSavedAnnouncement')}
      style={styles.savedRow}
    >
      <AppIcon icon={CircleCheck} color={controlColors.successForeground} size={16} />
      <Text style={styles.savedText}>{t('keySaved')}</Text>
    </View> : null}
    {editPresentation.replacementFeedback ? <Alert accessibilityRole="alert" accessibilityLiveRegion="polite" status="warning" style={styles.feedbackAlert}>
      <Alert.Indicator iconProps={{ size: 17 }} />
      <Alert.Content><Alert.Description style={styles.feedbackText}>{t(editPresentation.replacementFeedback === 'saving' ? 'savingReplacementKey' : 'replacementKeyNotSaved')}</Alert.Description></Alert.Content>
    </Alert> : null}
    {credentialError && !credentialRemovalProvider ? <Alert {...actionErrorPresentation} style={styles.feedbackAlert}>
      <Alert.Indicator iconProps={{ size: 17 }} />
      <Alert.Content><Alert.Description style={styles.feedbackText}>{t(credentialError)}</Alert.Description></Alert.Content>
    </Alert> : null}
    <PendingButton
      variant="primary"
      accessibilityRole={settingsAccessibilityContract.buttonRole}
      accessibilityHint={credentialUnavailableMessage}
      isPending={credentialAction === 'saving'}
      isDisabled={!credentialMutationReady || !keyIsValid || Boolean(credentialAction && credentialAction !== 'saving')}
      onPress={() => { void save() }}
      style={[styles.primaryButton, (!credentialMutationReady || !keyIsValid) && styles.primaryButtonDisabled]}
    >{({ isPending }) => <View style={styles.pendingActionContent}>
      {isPending ? <Spinner color={controlColors.primaryForeground} size="sm" /> : null}
      <Button.Label style={styles.primaryButtonText}>{t(isPending ? 'saving' : 'saveSecurely')}</Button.Label>
    </View>}</PendingButton>
    {saved ? <Button
      variant="danger-soft"
      accessibilityRole={settingsAccessibilityContract.buttonRole}
      accessibilityState={{ disabled: !credentialMutationReady || Boolean(credentialAction) }}
      isDisabled={!credentialMutationReady || Boolean(credentialAction)}
      onPress={() => {
        Keyboard.dismiss()
        if (credentialError === 'credentialRemoveFailed') setCredentialError(undefined)
        updateDraftPersistence('removal-opened')
        setCredentialRemovalProvider(modelProvider)
      }}
      style={styles.dangerButton}
    ><Button.Label style={styles.dangerButtonText}>{t('removeKey')}</Button.Label></Button> : null}
    <Button
      variant="ghost"
      accessibilityRole={settingsAccessibilityContract.buttonRole}
      accessibilityState={{ expanded: customModelSettingsOpen }}
      onPress={() => {
        Keyboard.dismiss()
        setCustomModelSettingsOpen((open) => !open)
      }}
      style={styles.customSettingsDisclosure}
    >
      <View pointerEvents="none" style={styles.customSettingsDisclosureContent}>
        <View style={[styles.customSettingsChevron, customModelSettingsOpen && styles.customSettingsChevronOpen]}>
          <AppIcon icon={ChevronDown} color={colors.muted} size={16} />
        </View>
        <View style={styles.modelSettingsTitleGroup}>
          <Button.Label style={styles.customSettingsDisclosureLabel}>{t('customModelSettings')}</Button.Label>
          <Text style={styles.modelSettingsDescription}>{t('customModelSettingsDescription')}</Text>
        </View>
      </View>
    </Button>
    {customModelSettingsOpen ? <View style={styles.customSettingsBody}>
      <View style={styles.customSettingsToolbar}>
        <Button
          size="sm"
          variant="ghost"
          accessibilityRole={settingsAccessibilityContract.buttonRole}
          onPress={() => {
            setBaseURLDraft('')
            setModelDrafts(MOBILE_MODEL_OPTIONS[modelProvider].map((id) => modelDraft({ id })))
            setModelSettingsSaved(false)
          }}
          style={styles.compactButton}
        ><Button.Label style={styles.compactButtonText}>{t('reset')}</Button.Label></Button>
      </View>
      <Text style={styles.cardLabel}>{t('model')}</Text>
      <Button
        variant="ghost"
        accessibilityRole={settingsAccessibilityContract.buttonRole}
        accessibilityLabel={`${t('model')}: ${model}`}
        accessibilityState={{ expanded: modelSelectionOpen }}
        onPress={() => { Keyboard.dismiss(); setModelSelectionOpen(true) }}
        style={styles.selector}
      >
        <Button.Label numberOfLines={2} style={styles.selectorText}>{model}</Button.Label>
        <AppIcon icon={ChevronDown} color={colors.muted} size={15} />
      </Button>
      <Text style={styles.fieldLabel}>{t('baseUrl')}</Text>
      <TextInput
        ref={baseURLInputRef}
        accessibilityLabel={t('baseUrl')}
        value={baseURLDraft}
        onChangeText={(value) => { setBaseURLDraft(value); setModelSettingsSaved(false) }}
        onFocus={() => onInputFocus(baseURLInputRef.current)}
        onBlur={() => onInputBlur(baseURLInputRef.current)}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder={t('baseUrlDefault')}
        placeholderTextColor={controlColors.choiceForeground}
        style={styles.textInput}
      />
      <View style={styles.modelCatalogHeader}>
        <Text style={styles.fieldLabel}>{t('modelCatalog')}</Text>
        <Text style={styles.modelCount}>{modelDrafts.length}</Text>
      </View>
      <View style={styles.modelEditorList}>
        {modelDrafts.map((entry, index) => <View key={`model-${index}`} style={styles.modelEditorRow}>
          <View style={styles.modelEditorHeader}>
            <Text style={styles.modelEditorTitle}>{entry.name.trim() || entry.id.trim() || t('newModel')}</Text>
            <Button
              size="sm"
              variant="danger-soft"
              accessibilityRole={settingsAccessibilityContract.buttonRole}
              accessibilityLabel={`${t('remove')} ${entry.id || t('newModel')}`}
              isDisabled={modelDrafts.length === 1}
              onPress={() => { setModelDrafts((current) => current.filter((_, entryIndex) => entryIndex !== index)); setModelSettingsSaved(false) }}
              style={styles.compactButton}
            ><Button.Label style={styles.dangerButtonText}>{t('remove')}</Button.Label></Button>
          </View>
          <TextInput
            accessibilityLabel={t('modelId')}
            value={entry.id}
            onChangeText={(value) => updateModelDraft(index, { id: value })}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('modelId')}
            placeholderTextColor={controlColors.choiceForeground}
            style={styles.textInput}
          />
          <TextInput
            accessibilityLabel={t('modelDisplayNameOptional')}
            value={entry.name}
            onChangeText={(value) => updateModelDraft(index, { name: value })}
            autoCapitalize="words"
            autoCorrect={false}
            placeholder={t('modelDisplayNameOptional')}
            placeholderTextColor={controlColors.choiceForeground}
            style={styles.textInput}
          />
          <View style={styles.modelCapacityRow}>
            <TextInput
              accessibilityLabel={t('contextWindowOptional')}
              value={entry.contextWindow}
              onChangeText={(value) => updateModelDraft(index, { contextWindow: value })}
              keyboardType="number-pad"
              placeholder={t('contextWindowOptional')}
              placeholderTextColor={controlColors.choiceForeground}
              style={[styles.textInput, styles.modelCapacityInput]}
            />
            <TextInput
              accessibilityLabel={t('maxOutputTokensOptional')}
              value={entry.maxTokens}
              onChangeText={(value) => updateModelDraft(index, { maxTokens: value })}
              keyboardType="number-pad"
              placeholder={t('maxOutputTokensOptional')}
              placeholderTextColor={controlColors.choiceForeground}
              style={[styles.textInput, styles.modelCapacityInput]}
            />
          </View>
        </View>)}
      </View>
      <Button
        size="sm"
        variant="outline"
        accessibilityRole={settingsAccessibilityContract.buttonRole}
        isDisabled={modelDrafts.length >= 100}
        onPress={() => { setModelDrafts((current) => [...current, modelDraft({ id: '' })]); setModelSettingsSaved(false) }}
        style={styles.addModelButton}
      ><View pointerEvents="none" style={styles.addModelButtonContent}>
        <AppIcon icon={Plus} color={colors.text} size={16} strokeWidth={2.2} />
        <Button.Label style={styles.addModelButtonText}>{t('addModel')}</Button.Label>
      </View></Button>
      {modelSettingsValidation.error ? <Alert accessibilityRole="alert" status="warning" style={styles.feedbackAlert}>
        <Alert.Indicator iconProps={{ size: 17 }} />
        <Alert.Content><Alert.Description style={styles.feedbackText}>{t(modelSettingsValidation.error)}</Alert.Description></Alert.Content>
      </Alert> : null}
      {modelSettingsSaved ? <View accessible accessibilityLiveRegion="polite" style={styles.savedRow}>
        <AppIcon icon={CircleCheck} color={controlColors.successForeground} size={16} />
        <Text style={styles.savedText}>{t('modelSettingsSaved')}</Text>
      </View> : null}
      <Button
        variant="primary"
        accessibilityRole={settingsAccessibilityContract.buttonRole}
        isDisabled={!modelSettingsDirty || Boolean(modelSettingsValidation.error)}
        onPress={applyModelSettings}
        style={[styles.primaryButton, (!modelSettingsDirty || Boolean(modelSettingsValidation.error)) && styles.primaryButtonDisabled]}
      ><Button.Label style={styles.primaryButtonText}>{t('applyModelSettings')}</Button.Label></Button>
    </View> : null}
  </View>
  <AppDialog
    open={modelSelectionOpen}
    onOpenChange={setModelSelectionOpen}
    title={t('model')}
    description={providerName(modelProvider)}
    closeLabel={t('cancel')}
    actions={[{ label: t('cancel'), tone: 'cancel', onPress: () => setModelSelectionOpen(false) }]}
    testID="settings-model-selection-dialog"
  >
    <View style={styles.modelOptionList}>
      {modelOptions.map((option) => {
        const selected = option === model
        return <Button
          key={option}
          variant="outline"
          accessibilityRole={settingsAccessibilityContract.radioRole}
          accessibilityState={settingsRadioAccessibilityState(selected)}
          onPress={() => { setModel(option); setModelSelectionOpen(false) }}
          style={[styles.modelOption, selected && styles.modelOptionSelected]}
        ><View pointerEvents="none" style={styles.modelOptionContent}><Button.Label style={[styles.modelOptionLabel, selected && styles.modelOptionLabelSelected]}>{option}</Button.Label></View></Button>
      })}
    </View>
  </AppDialog>
  <AppDialog
    open={Boolean(pendingModelProvider)}
    onOpenChange={(open) => { if (!open) setPendingModelProvider(undefined) }}
    title={t('discardApiKeyDraftConfirmationTitle')}
    description={t('discardApiKeyDraftConfirmationBody', {
      currentProvider: providerName(modelProvider),
      nextProvider: providerName(pendingModelProvider ?? modelProvider),
    })}
    closeLabel={t('cancel')}
    actions={[
      { label: t('cancel'), tone: 'cancel', onPress: () => setPendingModelProvider(undefined) },
      { label: t('discardAndSwitch'), tone: 'danger', onPress: () => {
        if (pendingModelProvider) setModelProvider(pendingModelProvider)
        setPendingModelProvider(undefined)
      } },
    ]}
    testID="settings-api-key-draft-discard-dialog"
  />
  <AppDialog
    open={Boolean(credentialRemovalProvider)}
    onOpenChange={(open) => {
      if (!open && credentialAction !== 'removing') {
        updateDraftPersistence('removal-cancelled')
        setCredentialRemovalProvider(undefined)
      }
    }}
    title={t('removeApiKeyConfirmationTitle', { provider: providerName(credentialRemovalProvider ?? modelProvider) })}
    description={t('removeApiKeyConfirmationBody')}
    closeLabel={t('cancel')}
    dismissible={credentialAction !== 'removing'}
    error={credentialRemovalProvider && credentialError === 'credentialRemoveFailed' ? t(credentialError) : undefined}
    actions={[
      { label: t('cancel'), tone: 'cancel', disabled: credentialAction === 'removing', onPress: () => { updateDraftPersistence('removal-cancelled'); setCredentialRemovalProvider(undefined) } },
      { label: t('removeKey'), tone: settingsDestructiveActionContract.apiKeyRemoval.tone, loading: credentialAction === 'removing', testID: settingsDestructiveActionContract.apiKeyRemoval.actionTestID, onPress: () => { if (credentialRemovalProvider) void remove(credentialRemovalProvider) } },
    ]}
    testID={settingsDestructiveActionContract.apiKeyRemoval.dialogTestID}
  />
  </>
}

function providerName(provider: MobileModelProvider): string {
  if (provider === 'openai') return 'OpenAI'
  if (provider === 'anthropic') return 'Anthropic'
  if (provider === 'google') return 'Google'
  return 'DeepSeek'
}

function modelDraft(model: MobileModelDefinition): ModelDraft {
  return {
    id: model.id,
    name: model.name ?? '',
    contextWindow: model.contextWindow === undefined ? '' : String(model.contextWindow),
    maxTokens: model.maxTokens === undefined ? '' : String(model.maxTokens),
  }
}

type ModelSettingsError = 'invalidBaseUrl' | 'modelIdRequired' | 'duplicateModelId' | 'invalidModelCapacity'

function validateModelDrafts(baseURL: string, models: readonly ModelDraft[]): { profile?: MobileModelProviderProfile; error?: ModelSettingsError } {
  const trimmedURL = baseURL.trim()
  if (trimmedURL) {
    try {
      const parsed = new URL(trimmedURL)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { error: 'invalidBaseUrl' }
    } catch { return { error: 'invalidBaseUrl' } }
  }
  const ids = models.map((entry) => entry.id.trim())
  if (ids.some((id) => !id)) return { error: 'modelIdRequired' }
  if (new Set(ids).size !== ids.length) return { error: 'duplicateModelId' }
  if (models.some((entry) => !validOptionalPositiveInteger(entry.contextWindow) || !validOptionalPositiveInteger(entry.maxTokens))) return { error: 'invalidModelCapacity' }
  try {
    return { profile: normalizedModelProfile({ baseURL: trimmedURL, models }) }
  } catch {
    return { error: 'invalidModelCapacity' }
  }
}

function validOptionalPositiveInteger(value: string): boolean {
  if (!value.trim()) return true
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0
}
