import { AppDialog } from '@/components/AppDialog'
import { PendingButton } from '@/components/PendingButton'
import { useI18n } from '@/i18n'
import { useRuntime } from '@/state/runtime'
import { settingsControlColorsFor } from '@/theme/settings-control-colors'
import { useAppColors } from '@/theme/tokens'
import { actionErrorPresentation, runExclusiveAction } from '@/utils/action-progress'
import { settingsAccessibilityContract } from '@/utils/settings-accessibility'
import { SSH_PRIVATE_CREDENTIAL_STORAGE_KEY, SSH_PUBLIC_METADATA_STORAGE_KEY, createSshOperationGate, isSshPrivateCredentialMissing, isSshSecureStorageRetryable, loadSshSettingsStorage, settingsDestructiveActionContract, sshCopyPresentation, sshOperationAvailability, sshUnavailableFeedbackPresentation, type SshCopyState, type SshPublicMetadataState, type SshSecureStorageState } from '@/utils/settings-feedback'
import { generateAndPersistSshCredential } from '@/utils/settings-ssh-persistence'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Clipboard from 'expo-clipboard'
import * as SecureStore from 'expo-secure-store'
import { Alert } from 'heroui-native/alert'
import { Button } from 'heroui-native/button'
import { Card } from 'heroui-native/card'
import { Spinner } from 'heroui-native/spinner'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, Text, View } from 'react-native'
import { useSettingsStyles } from './settings-styles'

type SshError = 'sshKeyGenerationFailed'

export function SshSettings() {
  const [sshStorage, setSshStorage] = useState<{ metadata: SshPublicMetadataState; secureStorage: SshSecureStorageState }>({
    metadata: { status: 'loading' },
    secureStorage: { status: 'loading' },
  })
  const [sshSettingsRetrying, setSshSettingsRetrying] = useState(false)
  const [sshBusy, setSshBusy] = useState(false)
  const [sshCopyState, setSshCopyState] = useState<SshCopyState>('idle')
  const [sshError, setSshError] = useState<SshError>()
  const [sshRotationConfirmationOpen, setSshRotationConfirmationOpen] = useState(false)
  const sshSettingsRetryGuardRef = useRef(false)
  const sshOperationGateRef = useRef(createSshOperationGate())
  const sshOperationGate = sshOperationGateRef.current
  const runtime = useRuntime()
  const { t } = useI18n()
  const colors = useAppColors()
  const controlColors = settingsControlColorsFor(colors)
  const styles = useSettingsStyles()
  const { metadata: sshMetadata, secureStorage: sshSecureStorage } = sshStorage
  const sshAvailability = sshOperationAvailability(sshSecureStorage, Boolean(runtime.info))
  const sshUnavailableFeedback = sshUnavailableFeedbackPresentation(sshAvailability)
  const sshUnavailableMessage = sshUnavailableFeedback ? t(sshUnavailableFeedback.messageKey) : undefined
  const privateCredentialMissing = isSshPrivateCredentialMissing(sshMetadata, sshSecureStorage)
  const copyPresentation = sshCopyPresentation(sshCopyState)
  const copyActionDisabled = copyPresentation.accessibilityState.disabled || privateCredentialMissing || sshBusy
  const rotateActionDisabled = !sshAvailability.available || sshBusy || copyPresentation.accessibilityState.busy

  const readSshSettingsStorage = useCallback(() => loadSshSettingsStorage(
    () => AsyncStorage.getItem(SSH_PUBLIC_METADATA_STORAGE_KEY),
    Platform.OS === 'web' ? undefined : () => SecureStore.getItemAsync(SSH_PRIVATE_CREDENTIAL_STORAGE_KEY),
  ), [])

  useEffect(() => {
    let active = true
    void readSshSettingsStorage().then((state) => { if (active) setSshStorage(state) })
    return () => { active = false }
  }, [readSshSettingsStorage])

  useEffect(() => {
    if (sshCopyState !== 'copied') return undefined
    const timer = setTimeout(() => setSshCopyState('idle'), 1_500)
    return () => clearTimeout(timer)
  }, [sshCopyState])

  const generateSshKey = async () => {
    if (!sshAvailability.available || sshBusy || sshMetadata.status === 'loading' || sshMetadata.status === 'failed') return
    if (!sshOperationGate.tryStart('credential-mutation')) return
    setSshBusy(true)
    setSshCopyState('idle')
    setSshError(undefined)
    try {
      const generated = await generateAndPersistSshCredential({
        generate: async () => runtime.request('ssh.generate', {}),
        readPrivateCredential: async () => SecureStore.getItemAsync(SSH_PRIVATE_CREDENTIAL_STORAGE_KEY),
        writePrivateCredential: async (value) => SecureStore.setItemAsync(SSH_PRIVATE_CREDENTIAL_STORAGE_KEY, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
        deletePrivateCredential: async () => SecureStore.deleteItemAsync(SSH_PRIVATE_CREDENTIAL_STORAGE_KEY),
        readPublicMetadata: async () => AsyncStorage.getItem(SSH_PUBLIC_METADATA_STORAGE_KEY),
        writePublicMetadata: async (value) => AsyncStorage.setItem(SSH_PUBLIC_METADATA_STORAGE_KEY, value),
        deletePublicMetadata: async () => AsyncStorage.removeItem(SSH_PUBLIC_METADATA_STORAGE_KEY),
        restoreRuntimeCredential: async (value) => {
          if (value === null) {
            await runtime.request('ssh.credential.delete', {})
            return
          }
          await runtime.request('ssh.credential.set', { privateKey: value })
        },
      })
      setSshStorage({
        metadata: { status: 'configured', publicKey: generated.publicKey, fingerprint: generated.fingerprint },
        secureStorage: { status: 'available', credentialPresent: true },
      })
      setSshRotationConfirmationOpen(false)
    } catch {
      setSshError('sshKeyGenerationFailed')
    } finally {
      sshOperationGate.finish('credential-mutation')
      setSshBusy(false)
    }
  }

  const copySshPublicKey = async () => {
    if (sshMetadata.status !== 'configured' || privateCredentialMissing || sshBusy) return
    if (!sshOperationGate.tryStart('public-key-copy')) return
    setSshCopyState('copying')
    setSshError(undefined)
    try {
      await Clipboard.setStringAsync(sshMetadata.publicKey)
      setSshCopyState('copied')
    } catch {
      setSshCopyState('failed')
    } finally {
      sshOperationGate.finish('public-key-copy')
    }
  }

  const retrySshSettings = () => {
    void runExclusiveAction(sshSettingsRetryGuardRef, async () => {
      setSshSettingsRetrying(true)
      try {
        setSshStorage(await readSshSettingsStorage())
      } finally {
        setSshSettingsRetrying(false)
      }
    })
  }

  const retryButton = <PendingButton
    variant="secondary"
    accessibilityRole={settingsAccessibilityContract.buttonRole}
    isPending={sshSettingsRetrying}
    onPress={retrySshSettings}
    style={[styles.sshRetryButton, styles.secondaryButton]}
  >
    {({ isPending }) => <View style={styles.pendingActionContent}>
      {isPending ? <Spinner color={colors.accent} size="sm" /> : null}
      <Button.Label style={styles.secondaryButtonText}>{t('retry')}</Button.Label>
    </View>}
  </PendingButton>

  return <>
  <Card style={styles.detailCard}><Card.Body style={styles.detailCardBody}>
    {sshMetadata.status === 'loading' ? <View accessible accessibilityRole="progressbar" accessibilityLabel={t('loadingSshKey')} accessibilityLiveRegion="polite" style={styles.loadingRow}>
      <Spinner size="sm" color={colors.accent} />
      <Text style={styles.loadingText}>{t('loadingSshKey')}</Text>
    </View> : null}
    {sshMetadata.status === 'configured' ? <>
      <View style={styles.sshField}>
        <Text style={styles.cardLabel}>{t('sshFingerprintLabel')}</Text>
        <Text selectable style={styles.sshFingerprint}>{sshMetadata.fingerprint}</Text>
      </View>
      <View style={styles.sshField}>
        <Text style={styles.cardLabel}>{t('sshPublicKeyLabel')}</Text>
        <Text selectable style={styles.sshPublicKey}>{sshMetadata.publicKey}</Text>
      </View>
    </> : null}
    {sshMetadata.status === 'unconfigured' ? <Text style={styles.unconfiguredText}>{t('notConfigured')}</Text> : null}
    {privateCredentialMissing ? <Alert accessibilityRole="alert" accessibilityLiveRegion="polite" status="warning" style={styles.feedbackAlert}>
      <Alert.Indicator iconProps={{ size: 17 }} />
      <Alert.Content><Alert.Description style={styles.feedbackText}>{t('sshPrivateKeyMissing')}</Alert.Description></Alert.Content>
    </Alert> : null}
    {(sshMetadata.status === 'configured' || sshMetadata.status === 'unconfigured') && sshUnavailableFeedback && sshUnavailableMessage ? <Alert {...sshUnavailableFeedback.alert} style={styles.feedbackAlert}>
      <Alert.Indicator iconProps={{ size: 17 }} />
      <Alert.Content><Alert.Description style={styles.feedbackText}>{sshUnavailableMessage}</Alert.Description></Alert.Content>
    </Alert> : null}
    {(sshMetadata.status === 'configured' || sshMetadata.status === 'unconfigured') && isSshSecureStorageRetryable(sshSecureStorage) ? retryButton : null}
    {sshMetadata.status === 'configured' ? <>
      <View style={styles.sshActions}>
        <PendingButton size="sm" accessibilityRole={settingsAccessibilityContract.buttonRole} accessibilityHint={privateCredentialMissing ? t('sshPrivateKeyMissing') : undefined} isPending={copyPresentation.showSpinner} isDisabled={copyActionDisabled && !copyPresentation.showSpinner} onPress={() => { void copySshPublicKey() }} style={[styles.primaryButton, styles.sshActionButton, styles.sshPrimaryActionButton]}>
          {({ isPending }) => <View style={styles.pendingActionContent}>
            {isPending ? <Spinner color={controlColors.primaryForeground} size="sm" /> : null}
            <Button.Label style={[styles.primaryButtonText, styles.sshActionLabel]}>{copyPresentation.showSuccess ? t('copied') : t('copyPublicKey')}</Button.Label>
          </View>}
        </PendingButton>
        <Button
          size="sm"
          variant="secondary"
          background={null}
          accessibilityRole={settingsAccessibilityContract.buttonRole}
          accessibilityHint={sshUnavailableMessage}
          accessibilityState={rotateActionDisabled ? { disabled: true } : undefined}
          isDisabled={rotateActionDisabled}
          onPress={() => {
            if (sshOperationGate.isActive()) return
            setSshCopyState('idle')
            setSshError(undefined)
            setSshRotationConfirmationOpen(true)
          }}
          style={[styles.secondaryButton, styles.sshActionButton]}
        ><Button.Label style={[styles.secondaryButtonText, styles.sshActionLabel]}>{t('rotateKey')}</Button.Label></Button>
      </View>
      {copyPresentation.showSuccess ? <Alert accessibilityRole="alert" accessibilityLiveRegion="polite" status="success" style={styles.feedbackAlert}>
        <Alert.Indicator iconProps={{ size: 17 }} />
        <Alert.Content><Alert.Description style={styles.feedbackText}>{t('copied')}</Alert.Description></Alert.Content>
      </Alert> : null}
      {copyPresentation.showFailure ? <Alert {...actionErrorPresentation} style={styles.feedbackAlert}>
        <Alert.Indicator iconProps={{ size: 17 }} />
        <Alert.Content><Alert.Description style={styles.feedbackText}>{t('sshKeyCopyFailed')}</Alert.Description></Alert.Content>
      </Alert> : null}
    </> : null}
    {sshMetadata.status === 'unconfigured' ? <PendingButton
      accessibilityRole={settingsAccessibilityContract.buttonRole}
      accessibilityHint={sshUnavailableMessage}
      isPending={sshBusy}
      isDisabled={!sshAvailability.available}
      onPress={() => { void generateSshKey() }}
      style={[styles.primaryButton, !sshAvailability.available && styles.primaryButtonDisabled]}
    >{({ isPending }) => <View style={styles.pendingActionContent}>
      {isPending ? <Spinner color={controlColors.primaryForeground} size="sm" /> : null}
      <Button.Label style={styles.primaryButtonText}>{isPending ? t('working') : t('generateKey')}</Button.Label>
    </View>}</PendingButton> : null}
    {sshMetadata.status === 'failed' ? <>
      <Alert accessibilityRole="alert" accessibilityLiveRegion="assertive" status="danger" style={styles.feedbackAlert}>
        <Alert.Indicator iconProps={{ size: 17 }} />
        <Alert.Content><Alert.Description style={styles.feedbackText}>{t('sshKeyLoadFailed')}</Alert.Description></Alert.Content>
      </Alert>
      {retryButton}
    </> : null}
    {sshError && !sshRotationConfirmationOpen ? <Alert accessibilityRole="alert" accessibilityLiveRegion="assertive" status="danger" style={styles.feedbackAlert}>
      <Alert.Indicator iconProps={{ size: 17 }} />
      <Alert.Content><Alert.Description style={styles.feedbackText}>{t(sshError)}</Alert.Description></Alert.Content>
    </Alert> : null}
  </Card.Body></Card>
  <AppDialog
    open={sshRotationConfirmationOpen}
    onOpenChange={(open) => { if (!sshBusy && !sshOperationGate.isActive()) setSshRotationConfirmationOpen(open) }}
    title={t('rotateSshKeyConfirmationTitle')}
    description={t('rotateSshKeyConfirmationBody')}
    closeLabel={t('cancel')}
    dismissible={!sshBusy}
    error={sshError === 'sshKeyGenerationFailed' ? t(sshError) : undefined}
    actions={[
      { label: t('cancel'), tone: 'cancel', disabled: sshBusy, onPress: () => { if (!sshOperationGate.isActive()) setSshRotationConfirmationOpen(false) } },
      { label: t('rotateKey'), tone: settingsDestructiveActionContract.sshKeyRotation.tone, loading: sshBusy, testID: settingsDestructiveActionContract.sshKeyRotation.actionTestID, onPress: () => { void generateSshKey() } },
    ]}
    testID={settingsDestructiveActionContract.sshKeyRotation.dialogTestID}
  />
  </>
}
