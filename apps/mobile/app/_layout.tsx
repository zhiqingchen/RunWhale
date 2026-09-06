import * as SplashScreen from 'expo-splash-screen'
import { router, Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { Alert } from 'heroui-native/alert'
import { HeroUINativeProvider } from 'heroui-native/provider'
import { Button } from 'heroui-native/button'
import { Spinner } from 'heroui-native/spinner'
import { useCallback, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AppDialog } from '@/components/AppDialog'
import { AppIcon } from '@/components/AppIcon'
import { X } from '@/components/icons'
import { LocalPersistenceFeedback } from '@/components/LocalPersistenceFeedback'
import { PendingButton } from '@/components/PendingButton'
import { ProjectProvider } from '@/state/projects'
import { RuntimeProvider, useRuntime } from '@/state/runtime'
import { controlSize, type ThemeColors, useAppColors } from '@/theme/tokens'
import { I18nProvider, useI18n } from '@/i18n'
import { PreferencesProvider } from '@/state/preferences'
import { runExclusiveAction } from '@/utils/action-progress'
import { runtimeStartupScreen } from '@/utils/runtime-startup'
import '../global.css'

SplashScreen.setOptions({ duration: 220, fade: true })
void SplashScreen.preventAutoHideAsync().catch(() => undefined)

export default function RootLayout() {
  const onRootLayout = useCallback(() => { void SplashScreen.hideAsync().catch(() => undefined) }, [])
  return (
    <GestureHandlerRootView onLayout={onRootLayout} style={{ flex: 1 }}><SafeAreaProvider><HeroUINativeProvider><I18nProvider><PreferencesProvider><RuntimeProvider><RuntimeProjectProvider>
      {/* Project state stays mounted while the runtime boundary presents recovery UI. */}
      <RuntimeStartupBoundary><AppNavigator /></RuntimeStartupBoundary>
      <LocalPersistenceFeedback />
    </RuntimeProjectProvider></RuntimeProvider></PreferencesProvider></I18nProvider></HeroUINativeProvider></SafeAreaProvider></GestureHandlerRootView>
  )
}

function RuntimeProjectProvider({ children }: PropsWithChildren) {
  const runtime = useRuntime()
  const nativeFiles = useMemo(() => ({
    listProjects: () => runtime.request('project.list', {}),
    createProject: (id: string, name: string) => runtime.request('project.create', { id, name }),
    listFiles: async (projectId: string) => (await runtime.request('project.files', { projectId })).paths,
    readFile: (projectId: string, path: string) => runtime.request('project.read', { projectId, path }),
    writeFile: (projectId: string, path: string, content: string, expectedVersion?: string) => runtime.request('project.write', { projectId, path, content, ...(expectedVersion ? { expectedVersion } : {}) }),
  }), [runtime.request])
  return <ProjectProvider nativeFiles={nativeFiles} runtimeReady={Boolean(runtime.info)} events={runtime.events} registerFileFlush={runtime.registerFileFlush}>{children}</ProjectProvider>
}

function RuntimeStartupBoundary({ children }: PropsWithChildren) {
  const runtime = useRuntime()
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStartupStyles(colors), [colors])
  const [retrying, setRetrying] = useState(false)
  const retryGuardRef = useRef(false)

  const startupScreen = runtimeStartupScreen({
    isWeb: Platform.OS === 'web',
    nativeState: runtime.snapshot.state,
    hasHostInfo: Boolean(runtime.info),
    hostError: runtime.lastError,
  })
  if (startupScreen === 'content') {
    return <View style={styles.app}>
      {children}
      <AppDialog
        open={Boolean(runtime.credentialSyncWarning)}
        onOpenChange={(open) => { if (!open) runtime.dismissCredentialSyncWarning() }}
        title={t('credentialSyncWarningTitle')}
        description={t('credentialSyncWarning')}
        closeLabel={t('dismiss')}
        actions={[{ label: t('dismiss'), tone: 'primary', onPress: runtime.dismissCredentialSyncWarning }]}
        testID="runtime-credential-sync-warning"
      />
    </View>
  }
  const retry = () => {
    void runExclusiveAction(retryGuardRef, async () => {
      setRetrying(true)
      try {
        await runtime.retryRuntime()
      } finally {
        setRetrying(false)
      }
    })
  }
  return <View style={styles.screen}>
    <View style={styles.card}>
      <Alert accessibilityRole="alert" accessibilityLiveRegion="assertive" status="danger" style={styles.alert}>
        <Alert.Indicator iconProps={{ size: 17 }} />
        <Alert.Content>
          <Alert.Title style={styles.title}>{t('runtimeStartupFailedTitle')}</Alert.Title>
          <Alert.Description style={styles.body}>{runtime.snapshot.lastError ?? runtime.lastError ?? t('runtimeStartupFailedBody')}</Alert.Description>
        </Alert.Content>
      </Alert>
      <PendingButton size="sm" variant="primary" isPending={retrying} onPress={retry} style={styles.retry}>
        {({ isPending }) => <View style={styles.retryContent}>
          {isPending ? <Spinner color="#FFFFFF" size="sm" /> : null}
          <Button.Label style={styles.retryText}>{t('retry')}</Button.Label>
        </View>}
      </PendingButton>
    </View>
  </View>
}

function AppNavigator() {
  const { t } = useI18n()
  const colors = useAppColors()
  const modalHeaderLeft = () => <Pressable
    accessibilityRole="button"
    accessibilityLabel={t('close')}
    hitSlop={6}
    onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/workspace') }}
    style={({ pressed }) => ({
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.raised,
      opacity: pressed ? 0.62 : 1,
    })}
  ><AppIcon icon={X} color={colors.text} size={16} /></Pressable>
  return <>
      <StatusBar hidden={false} style={colors.canvas === '#090E1D' ? 'light' : 'dark'} />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: colors.canvas },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.canvas },
        headerShadowVisible: false,
      }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="settings/[detail]" options={{ headerShown: false, presentation: 'card' }} />
        <Stack.Screen name="new" options={{ title: t('newProjectTitle'), presentation: 'modal' }} />
        <Stack.Screen name="g/[owner]/[repo]/[sha]" options={{ title: t('githubImportHeaderTitle'), presentation: 'modal', headerLeft: modalHeaderLeft }} />
        <Stack.Screen name="share/[projectId]" options={{ title: t('shareProject'), presentation: 'modal', headerLeft: modalHeaderLeft }} />
        <Stack.Screen name="shortcut/[projectId]" options={{ title: t('addToHomeScreen'), presentation: 'modal', headerLeft: modalHeaderLeft }} />
        <Stack.Screen name="run/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="workspace/[id]/index" options={{ headerShown: false }} />
      </Stack>
    </>
}

function createStartupStyles(colors: ThemeColors) { return StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.canvas },
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.canvas },
  card: { width: '100%', maxWidth: 440, borderWidth: 1, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.panel, padding: 22, gap: 12 },
  alert: { width: '100%' },
  title: { color: colors.text, fontSize: 18, fontWeight: '900' },
  body: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  retry: { height: controlSize.prominent, alignSelf: 'flex-start', borderRadius: 8, backgroundColor: colors.accent, paddingHorizontal: 18 },
  retryContent: { height: controlSize.prominent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  retryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
}) }
