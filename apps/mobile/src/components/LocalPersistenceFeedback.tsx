import { useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Alert } from 'heroui-native/alert'
import { Button } from 'heroui-native/button'
import { Spinner } from 'heroui-native/spinner'
import { useI18n } from '@/i18n'
import { usePreferences } from '@/state/preferences'
import { useProjects } from '@/state/projects'
import { controlSize, radius, typeScale, type ThemeColors, useAppColors } from '@/theme/tokens'
import { actionErrorPresentation, runExclusiveAction } from '@/utils/action-progress'
import { localPersistenceErrors, retryLocalPersistence } from '@/utils/local-persistence'
import { PendingButton } from './PendingButton'

export function LocalPersistenceFeedback() {
  const { t, persistenceError: languageError, retryPersistence: retryLanguage } = useI18n()
  const { persistenceError: preferenceError, retryPersistence: retryPreferences } = usePreferences()
  const { persistenceError: projectError, retryPersistence: retryProjects } = useProjects()
  const colors = useAppColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => createStyles(colors), [colors])
  const [retrying, setRetrying] = useState(false)
  const retryInFlight = useRef(false)
  const sources = [
    { error: projectError, retry: retryProjects },
    { error: preferenceError, retry: retryPreferences },
    { error: languageError, retry: retryLanguage },
  ]
  const messages = localPersistenceErrors(sources, t('localPersistenceUnknownError'))

  if (messages.length === 0) return null

  const retry = () => {
    void runExclusiveAction(retryInFlight, async () => {
      setRetrying(true)
      try {
        await retryLocalPersistence(sources)
      } finally {
        setRetrying(false)
      }
    }).catch(() => undefined)
  }

  return <View pointerEvents="box-none" style={[styles.portal, { bottom: insets.bottom + 72 }]}>
    <View style={styles.card}>
      <Alert {...actionErrorPresentation} testID="local-persistence-error" style={styles.alert}>
        <Alert.Indicator iconProps={{ size: 17 }} />
        <Alert.Content>
          <Alert.Title style={styles.title}>{t('localPersistenceFailedTitle')}</Alert.Title>
          <Alert.Description style={styles.description}>{t('localPersistenceFailedBody', { message: messages.join(' · ') })}</Alert.Description>
        </Alert.Content>
      </Alert>
      <PendingButton
        size="sm"
        variant="primary"
        isPending={retrying}
        isDisabled={messages.length === 0}
        onPress={retry}
        style={styles.retry}
      >
        {({ isPending }) => <>
          {isPending ? <Spinner color="#FFFFFF" size="sm" /> : null}
          <Button.Label style={styles.retryLabel}>{t('retry')}</Button.Label>
        </>}
      </PendingButton>
    </View>
  </View>
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  portal: { position: 'absolute', left: 12, right: 12, zIndex: 2_000, elevation: 2_000, alignItems: 'center' },
  card: { width: '100%', maxWidth: 520, padding: 10, gap: 8, borderRadius: radius.large, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.panel },
  alert: { width: '100%' },
  title: { color: colors.text, fontSize: typeScale.body, fontWeight: '900' },
  description: { color: colors.danger, fontSize: typeScale.label, lineHeight: 18 },
  retry: { minHeight: controlSize.regular, alignSelf: 'flex-end', borderRadius: radius.small, backgroundColor: colors.accent, paddingHorizontal: 18 },
  retryLabel: { color: '#FFFFFF', fontSize: typeScale.button, fontWeight: '800' },
}) }
