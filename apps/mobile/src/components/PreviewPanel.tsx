import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useReducer, useRef, useState } from 'react'
import { Columns2, Maximize2, X } from '@/components/icons'
import type { PreviewEndpoint } from '@runwhale/mobile-protocol'
import { Animated, BackHandler, Easing, Keyboard, PanResponder, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { FullWindowOverlay } from 'react-native-screens'
import { useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button } from 'heroui-native/button'
import { Portal } from 'heroui-native/portal'
import { Spinner } from 'heroui-native/spinner'
import { PreviewErrorDialog } from '@/components/PreviewErrorDialog'
import { type ThemeColors, useAppColors } from '@/theme/tokens'
import { useProjects, type StudioProject } from '@/state/projects'
import { useRuntime } from '@/state/runtime'
import { useI18n } from '@/i18n'
import { AppIcon } from '@/components/AppIcon'
import { NativePreviewHost, NodeHost } from '@runwhale/node-host'
import { usePreviewAgentControl } from '@/hooks/use-preview-agent-control'
import { usePreviewTesting } from '@/hooks/use-preview-testing'
import { webPreviewTestingScript } from '@runwhale/mobile-protocol'
import {
  initialPreviewLifecycleState,
  previewLifecycleReducer,
  selectedActivePreview,
  webPreviewPageUrl,
} from '@/utils/preview-lifecycle'
import { projectPreviewConfiguration } from '@/utils/project-preview'
import { resolvePreviewLaunch } from '@/utils/preview-open'
import { NativePreviewLaunchCancelled } from '@/utils/native-preview-launch'
import { studioPreviewOpened } from '#extensions'
import { latestAgentPreviewPublication } from '@/utils/preview-publication'
import { previewDeviceReport } from '@/utils/preview-feedback'
import {
  clampWebPreviewControlPosition,
  type WebPreviewControlInsets,
  type WebPreviewControlPosition,
  webPreviewControlInitialPosition,
  webPreviewOverlayControlContract,
  webPreviewOverlayPresentation,
} from '@/utils/web-preview-overlay'

export interface PreviewPanelHandle {
  open(): Promise<void>
  run(): Promise<void>
  minimize(): void
}

export type PreviewPanelPresentation = 'overlay' | 'split' | 'full'

let previewLaunchSequence = 0

function nextPreviewLaunchRequestId(): string {
  previewLaunchSequence += 1
  return `preview-${Date.now().toString(36)}-${previewLaunchSequence.toString(36)}`
}

function PreviewAgentDot({ active, color }: { active: boolean; color: string }) {
  const opacity = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (!active) return
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.4, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true, isInteraction: false }),
      Animated.timing(opacity, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true, isInteraction: false }),
    ]))
    pulse.start()
    return () => { pulse.stop(); opacity.setValue(1) }
  }, [active, opacity])
  return <Animated.View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: color, opacity }} />
}

function DraggablePreviewClose({
  agentLabel,
  insets,
  label,
  onPress,
  styles,
  visible,
}: {
  agentLabel: string
  insets: WebPreviewControlInsets
  label: string
  onPress(): void
  styles: ReturnType<typeof createStyles>
  visible: boolean
}) {
  const colors = useAppColors()
  const viewport = useWindowDimensions()
  const [controlWidth, setControlWidth] = useState<number>(webPreviewOverlayControlContract.closeWidth)
  const initialPosition = webPreviewControlInitialPosition(viewport, insets, controlWidth)
  const position = useRef(new Animated.ValueXY(initialPosition)).current
  const currentPosition = useRef(initialPosition)
  const dragStart = useRef(initialPosition)
  const wasVisible = useRef(false)
  const viewportRef = useRef({ viewport, insets, controlWidth })
  viewportRef.current = { viewport, insets, controlWidth }

  const setPosition = useCallback((next: WebPreviewControlPosition) => {
    currentPosition.current = next
    position.setValue(next)
  }, [position])

  useEffect(() => {
    const next = visible && !wasVisible.current
      ? webPreviewControlInitialPosition(viewport, insets, controlWidth)
      : clampWebPreviewControlPosition(currentPosition.current, viewport, insets, controlWidth)
    wasVisible.current = visible
    setPosition(next)
  }, [controlWidth, insets.bottom, insets.left, insets.right, insets.top, setPosition, viewport.height, viewport.width, visible])

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.hypot(gesture.dx, gesture.dy) >= 6,
    onMoveShouldSetPanResponderCapture: (_event, gesture) => Math.hypot(gesture.dx, gesture.dy) >= 6,
    onPanResponderGrant: () => { dragStart.current = currentPosition.current },
    onPanResponderMove: (_event, gesture) => {
      const bounds = viewportRef.current
      setPosition(clampWebPreviewControlPosition({
        x: dragStart.current.x + gesture.dx,
        y: dragStart.current.y + gesture.dy,
      }, bounds.viewport, bounds.insets, bounds.controlWidth))
    },
  })).current

  return (
    <Animated.View {...panResponder.panHandlers} onLayout={(event) => {
      const width = event.nativeEvent.layout.width
      if (width === controlWidth) return
      setPosition({ x: currentPosition.current.x + controlWidth - width, y: currentPosition.current.y })
      setControlWidth(width)
    }} style={[styles.closeControlPosition, position.getLayout()]}>
      {agentLabel ? <View style={styles.agentStatus} testID="preview-agent-status">
        <PreviewAgentDot active={visible} color={colors.accent} />
        <Text numberOfLines={1} style={styles.agentStatusText}>{agentLabel}</Text>
        <View style={styles.controlDivider} />
      </View> : null}
      <Button
        isIconOnly
        size="sm"
        variant="secondary"
        feedbackVariant={webPreviewOverlayControlContract.feedbackVariant}
        animation={{ highlight: { backgroundColor: { value: '#000000' }, opacity: { value: [0, 0.08] } } }}
        testID="web-preview-minimize"
        accessibilityLabel={label}
        accessibilityRole="button"
        hitSlop={8}
        onPress={onPress}
        style={styles.closeControl}
      >
        <AppIcon icon={X} color="#262626" size={14} />
      </Button>
    </Animated.View>
  )
}

export const PreviewPanel = forwardRef<PreviewPanelHandle, {
  project: StudioProject
  sessionId: string
  autoOpen?: boolean
  agentRunning?: boolean
  onBusyChange?(busy: boolean): void
  presentation?: PreviewPanelPresentation
  onPresentationRequested?(presentation: PreviewPanelPresentation | 'hidden'): void
  onFixWithAgent(prompt: string): void
}>(function PreviewPanel({ project, sessionId, autoOpen = false, agentRunning = false, onBusyChange, presentation = 'overlay', onPresentationRequested, onFixWithAgent }, ref) {
  const runtime = useRuntime()
  const { loadFile, flushFiles } = useProjects()
  const { t } = useI18n()
  const { agentLabel, setAgentControl } = usePreviewAgentControl(project.id, sessionId, agentRunning, t('previewAgentOperating'))
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const safeAreaInsets = useSafeAreaInsets()
  const runtimePlatform = Platform.OS === 'web' ? 'web' : Platform.OS === 'ios' ? 'ios' : 'android'
  const previewConfiguration = useMemo(() => projectPreviewConfiguration(project, runtimePlatform), [project, runtimePlatform])
  useEffect(() => { void loadFile(project.id, 'runwhale.json').catch(() => undefined) }, [loadFile, project.id, project.files])
  const configuredTarget = 'target' in previewConfiguration ? previewConfiguration.target : undefined
  const [state, dispatch] = useReducer(previewLifecycleReducer, undefined, () => initialPreviewLifecycleState(configuredTarget ?? 'web'))
  const operationInFlight = useRef(false)
  const launchGeneration = useRef(0)
  const pendingLaunchRequest = useRef<string | undefined>(undefined)
  const handledAutoOpen = useRef(false)
  const publishedAgentPreview = useRef<PreviewEndpoint | undefined>(undefined)
  const [reportedError, setReportedError] = useState<string>()
  const handledAgentPublicationSequence = useRef(runtime.events.reduce((latest, event) => Math.max(latest, event.sequence), 0))
  const active = selectedActivePreview(state)
  const [focused, setFocused] = useState(false)
  const agentControlRef = useRef(setAgentControl)
  agentControlRef.current = setAgentControl
  useFocusEffect(useCallback(() => {
    setFocused(true)
    return () => {
      setFocused(false)
      agentControlRef.current(false)
      launchGeneration.current += 1
      operationInFlight.current = false
      const requestId = pendingLaunchRequest.current
      pendingLaunchRequest.current = undefined
      if (requestId) runtime.cancelPreviewLaunch(requestId)
      dispatch({ type: 'launch-cancelled' })
    }
  }, [runtime.cancelPreviewLaunch]))
  const webViewRef = useRef<WebView>(null)
  const webCaptureRef = useRef<View>(null)
  const closePreview = useCallback(async () => {
    const generation = ++launchGeneration.current
    operationInFlight.current = false
    const requestId = pendingLaunchRequest.current
    pendingLaunchRequest.current = undefined
    if (requestId) runtime.cancelPreviewLaunch(requestId)
    Keyboard.dismiss()
    if (active?.target === 'native') {
      if (!NodeHost.closeNativePreview) throw new Error('Update the RunWhale native host to enable closing Preview.')
      if (!await NodeHost.closeNativePreview(project.id, active.bundleUrl)) throw new Error('Preview changed before it could close. Inspect the current revision.')
    } else if (active?.target === 'web') {
      webViewRef.current?.injectJavaScript("if (window.__runwhalePreviewTest) window.__runwhalePreviewTest(null, {kind:'close'}); true;")
    }
    if (launchGeneration.current !== generation) throw new Error('Preview changed while closing. Inspect the current revision.')
    setAgentControl(false)
    dispatch({ type: 'preview-closed' })
    onPresentationRequested?.('hidden')
  }, [active, project.id, runtime.cancelPreviewLaunch, onPresentationRequested, setAgentControl])
  const receiveTestMessage = usePreviewTesting({ projectId: project.id, enabled: focused, active, webVisible: state.webVisible, events: runtime.events, request: runtime.request, webView: webViewRef, webCaptureView: webCaptureRef, closePreview, onAgentInteraction: () => setAgentControl(true) })
  const activeNativeBundleUrl = active?.target === 'native' ? active.bundleUrl : undefined
  const deviceReport = previewDeviceReport(state, publishedAgentPreview.current)
  const reportKey = deviceReport ? `${deviceReport.sessionId}:${deviceReport.revision}:${deviceReport.status}` : undefined
  const agentNotified = Boolean(reportKey && reportedError === reportKey)

  useEffect(() => {
    if (!deviceReport || !runtime.info) return
    let current = true
    void runtime.request('preview.report', deviceReport).then((result) => {
      if (current && deviceReport.status === 'failed' && result.notified) setReportedError(reportKey)
    }).catch(() => { /* Keep the manual repair action available if delivery is unavailable. */ })
    return () => { current = false }
  }, [reportKey, runtime.info, runtime.request])

  useEffect(() => {
    if (configuredTarget) dispatch({ type: 'configure-target', target: configuredTarget })
  }, [configuredTarget])

  useEffect(() => {
    onBusyChange?.(Boolean(state.operation))
  }, [onBusyChange, state.operation])

  useEffect(() => () => {
    launchGeneration.current += 1
    operationInFlight.current = false
    const requestId = pendingLaunchRequest.current
    pendingLaunchRequest.current = undefined
    if (requestId) runtime.cancelPreviewLaunch(requestId)
  }, [project.id, runtime.cancelPreviewLaunch])

  const fail = useCallback((cause: unknown, bundleUrl?: string) => {
    agentControlRef.current(false)
    if (cause instanceof NativePreviewLaunchCancelled) {
      dispatch({ type: 'launch-cancelled' })
      return
    }
    const message = cause instanceof Error ? cause.message : String(cause)
    dispatch({
      type: 'content-failed',
      ...(bundleUrl ? { bundleUrl } : {}),
      message,
    })
  }, [])

  const launch = useCallback(async (mode: 'open' | 'run') => {
    Keyboard.dismiss()
    onPresentationRequested?.(presentation === 'overlay' ? 'overlay' : presentation)
    if (operationInFlight.current) return
    setAgentControl(false)
    publishedAgentPreview.current = undefined
    operationInFlight.current = true
    const generation = launchGeneration.current + 1
    launchGeneration.current = generation
    const requestId = nextPreviewLaunchRequestId()
    pendingLaunchRequest.current = requestId
    const isCurrent = () => launchGeneration.current === generation
    dispatch({ type: mode === 'run' ? 'run-started' : 'open-requested' })
    let bundleUrl: string | undefined
    let bundlePublished = false
    try {
      await flushFiles(project.id)
      const manifest = await loadFile(project.id, 'runwhale.json')
      const configuration = projectPreviewConfiguration({ ...project, files: [manifest] }, runtimePlatform)
      if ('error' in configuration) throw new Error(configuration.error)
      const runTarget = configuration.target
      const runPlatform = configuration.platform
      dispatch({ type: 'configure-target', target: runTarget })
      const resolution = await resolvePreviewLaunch(
        mode,
        () => runtime.openPreview(project.id, runPlatform, requestId),
      )
      if (!isCurrent()) return
      const result = resolution.status === 'ready'
        ? resolution.endpoint
        : await (async () => {
            if (mode === 'open') dispatch({ type: 'run-started' })
            return runtime.runPreview(project, runPlatform, requestId)
          })()
      if (!isCurrent()) return
      bundleUrl = result.bundleUrl
      if (result.requestedBySessionId === sessionId) publishedAgentPreview.current = result
      if (runTarget === 'web') {
        dispatch({ type: 'bundle-ready', target: runTarget, bundleUrl, revision: result.revision, pageUrl: webPreviewPageUrl(bundleUrl) })
        // Reopening the retained WebView does not emit another onLoad event.
        if (active?.target === 'web' && active.bundleUrl === bundleUrl && active.opened) dispatch({ type: 'content-opened', bundleUrl })
        bundlePublished = true
      } else {
        dispatch({ type: 'bundle-ready', target: runTarget, bundleUrl, revision: result.revision })
        bundlePublished = true
        if (!isCurrent()) return
        await runtime.openNativePreview(bundleUrl, requestId, project.id)
        if (!isCurrent()) return
        dispatch({ type: 'content-opened', bundleUrl })
      }
    } catch (cause) {
      if (isCurrent()) fail(cause, bundlePublished ? bundleUrl : undefined)
    } finally {
      if (pendingLaunchRequest.current === requestId) pendingLaunchRequest.current = undefined
      if (isCurrent()) operationInFlight.current = false
    }
  }, [active, fail, flushFiles, loadFile, runtimePlatform, onPresentationRequested, presentation, project, runtime.openNativePreview, runtime.openPreview, runtime.runPreview, sessionId, setAgentControl])

  const run = useCallback(() => launch('run'), [launch])
  const openCachedOrRun = useCallback(() => launch('open'), [launch])

  const openOrRun = useCallback(async () => {
    if (operationInFlight.current) return
    await openCachedOrRun()
  }, [openCachedOrRun])

  useEffect(() => {
    if (!focused || !autoOpen || handledAutoOpen.current || !runtime.info) return
    handledAutoOpen.current = true
    void openOrRun()
  }, [autoOpen, focused, openOrRun, runtime.info])

  useEffect(() => {
    if (!focused || operationInFlight.current || state.operation || 'error' in previewConfiguration) return
    const publication = latestAgentPreviewPublication(runtime.events, project.id, sessionId, handledAgentPublicationSequence.current)
    if (!publication) return
    if (publication.endpoint.platform !== previewConfiguration.platform) return
    handledAgentPublicationSequence.current = publication.sequence
    if (publication.endpoint.revision <= (active?.revision ?? 0)) return

    setAgentControl(true)
    publishedAgentPreview.current = publication.endpoint
    onPresentationRequested?.(presentation === 'overlay' ? 'overlay' : presentation)
    operationInFlight.current = true
    const generation = launchGeneration.current + 1
    launchGeneration.current = generation
    const requestId = nextPreviewLaunchRequestId()
    pendingLaunchRequest.current = requestId
    const isCurrent = () => launchGeneration.current === generation
    const runTarget = previewConfiguration.target
    const bundleUrl = publication.endpoint.bundleUrl
    dispatch({ type: 'run-started' })
    void (async () => {
      try {
        if (runTarget === 'web') {
          dispatch({ type: 'bundle-ready', target: runTarget, bundleUrl, revision: publication.endpoint.revision, pageUrl: webPreviewPageUrl(bundleUrl) })
          return
        }
        dispatch({ type: 'bundle-ready', target: runTarget, bundleUrl, revision: publication.endpoint.revision })
        await runtime.openNativePreview(bundleUrl, requestId, project.id)
        if (isCurrent()) dispatch({ type: 'content-opened', bundleUrl })
      } catch (cause) {
        if (isCurrent()) fail(cause, bundleUrl)
      } finally {
        if (pendingLaunchRequest.current === requestId) pendingLaunchRequest.current = undefined
        if (isCurrent()) operationInFlight.current = false
      }
    })()
  }, [active?.revision, fail, focused, onPresentationRequested, presentation, previewConfiguration, project.id, runtime.events, runtime.openNativePreview, sessionId, setAgentControl, state.operation])

  useEffect(() => {
    const subscription = NodeHost.addListener('onNativePreviewAction', (event) => {
      if (event.action === 'close' || event.action === 'failure') setAgentControl(false)
      if (event.action === 'reload') void run()
      const message = event.action === 'failure' ? event.message : undefined
      if (message && activeNativeBundleUrl) fail(new Error(message), activeNativeBundleUrl)
    })
    return () => subscription.remove()
  }, [activeNativeBundleUrl, fail, run, setAgentControl])

  const webActive = state.active?.target === 'web' && state.active.pageUrl ? state.active : undefined
  const webSource = useMemo(() => webActive ? { uri: webActive.pageUrl! } : undefined, [webActive?.pageUrl])
  const webOverlay = webPreviewOverlayPresentation(Boolean(webActive && webSource), state.webVisible)
  const minimizeWeb = useCallback(() => {
    Keyboard.dismiss()
    setAgentControl(false)
    dispatch({ type: 'minimize-web' })
  }, [setAgentControl])

  useImperativeHandle(ref, () => ({ open: openOrRun, run, minimize: minimizeWeb }), [minimizeWeb, openOrRun, run])

  useEffect(() => {
    if (Platform.OS !== 'android' || !webOverlay.visible) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      minimizeWeb()
      return true
    })
    return () => subscription.remove()
  }, [minimizeWeb, webOverlay.visible])

  const webViewContent = webActive && webSource ? <View ref={webCaptureRef} collapsable={false} style={styles.webView}><WebView
    ref={webViewRef}
    injectedJavaScriptBeforeContentLoaded={webPreviewTestingScript}
    injectedJavaScript={webPreviewTestingScript}
    onMessage={(event) => receiveTestMessage(event.nativeEvent.data)}
    key={webActive.bundleUrl}
    source={webSource}
    style={styles.webView}
    originWhitelist={['http://127.0.0.1:*']}
    allowsBackForwardNavigationGestures={false}
    allowsLinkPreview={false}
    automaticallyAdjustContentInsets={false}
    contentInset={{ top: 0, right: 0, bottom: 0, left: 0 }}
    contentInsetAdjustmentBehavior="never"
    setSupportMultipleWindows={false}
    startInLoadingState
    renderLoading={() => <View accessible accessibilityLabel={t('openingPreview')} accessibilityLiveRegion="polite" accessibilityRole="progressbar" style={styles.webLoading}><Spinner color={colors.accent} size="lg" /></View>}
    onLoad={() => { dispatch({ type: 'content-opened', bundleUrl: webActive.bundleUrl }); studioPreviewOpened('web') }}
    onError={(event) => fail(new Error(event.nativeEvent.description || 'Web Preview failed to load'), webActive.bundleUrl)}
  /></View> : <View accessible accessibilityLabel={t('openingPreview')} accessibilityLiveRegion="polite" accessibilityRole="progressbar" style={styles.webLoading}><Spinner color={colors.accent} size="lg" /></View>

  const webOverlayContent = presentation === 'overlay' && webOverlay.mounted && webActive && webSource ? (
    <View
      accessibilityElementsHidden={webOverlay.accessibilityElementsHidden}
      accessibilityViewIsModal={webOverlay.visible}
      importantForAccessibility={webOverlay.importantForAccessibility}
      pointerEvents={webOverlay.pointerEvents}
      style={[styles.webOverlay, !webOverlay.visible && styles.webOverlayHidden]}
      testID="web-preview-overlay"
    >
      {webViewContent}
      <DraggablePreviewClose
        agentLabel={agentLabel}
        insets={safeAreaInsets}
        label={t('minimizePreview')}
        onPress={minimizeWeb}
        styles={styles}
        visible={webOverlay.visible}
      />
    </View>
  ) : null

  const embeddedContent = presentation === 'overlay' ? null : <View style={[styles.embeddedPanel, presentation === 'split' && styles.embeddedPanelSplit]} testID="embedded-preview-panel">
    <View style={styles.embeddedToolbar}>
      <Text numberOfLines={1} style={styles.embeddedTitle}>{t('preview')}</Text>
      <View style={styles.embeddedActions}>
        {agentLabel ? <View style={styles.embeddedAgentStatus}><PreviewAgentDot active={focused} color={colors.accent} /><Text style={styles.agentStatusText}>{agentLabel}</Text></View> : null}
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          testID="preview-size-toggle"
          accessibilityLabel={presentation === 'split' ? t('expandPreview') : t('splitPreview')}
          onPress={() => onPresentationRequested?.(presentation === 'split' ? 'full' : 'split')}
          style={styles.embeddedAction}
        >
          <AppIcon icon={presentation === 'split' ? Maximize2 : Columns2} color={colors.accent} size={17} />
        </Button>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          accessibilityLabel={t('minimizePreview')}
          onPress={() => {
            minimizeWeb()
            onPresentationRequested?.('hidden')
          }}
          style={styles.embeddedAction}
        >
          <AppIcon icon={X} color={colors.accent} size={18} />
        </Button>
      </View>
    </View>
    <View style={styles.embeddedBody}>
      {configuredTarget === 'native' ? <NativePreviewHost style={styles.nativePreviewHost} /> : webViewContent}
    </View>
  </View>

  return <>
    {embeddedContent}
    <Portal name={`web-preview-${project.id}`}>
      {Platform.OS === 'ios' && webOverlayContent
        ? <FullWindowOverlay unstable_accessibilityContainerViewIsModal={webOverlay.visible}>{webOverlayContent}</FullWindowOverlay>
        : webOverlayContent}
    </Portal>
    <PreviewErrorDialog
      error={state.error}
      agentNotified={agentNotified}
      onClose={() => dispatch({ type: 'dismiss-error' })}
      onRepair={(prompt) => {
        minimizeWeb()
        onFixWithAgent(prompt)
      }}
    />
  </>
})

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  webOverlay: { position: 'absolute', inset: 0, zIndex: 1_000, elevation: 1_000, backgroundColor: colors.canvas },
  webOverlayHidden: { opacity: 0 },
  webView: { flex: 1, backgroundColor: colors.canvas },
  webLoading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  embeddedPanel: { flex: 1, minWidth: 0, backgroundColor: colors.canvas },
  embeddedPanelSplit: { borderLeftWidth: 1, borderLeftColor: colors.border },
  embeddedToolbar: { height: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.panel },
  embeddedTitle: { flex: 1, minWidth: 0, paddingHorizontal: 4, color: colors.text, fontSize: 12, fontWeight: '900' },
  embeddedActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  embeddedAction: { width: 38, height: 38, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center' },
  embeddedBody: { flex: 1, minHeight: 0, backgroundColor: colors.canvas },
  nativePreviewHost: { flex: 1, backgroundColor: colors.canvas },
  closeControlPosition: {
    position: 'absolute',
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    height: webPreviewOverlayControlContract.closeSize,
    borderRadius: 15,
    backgroundColor: 'rgba(250, 250, 250, 0.94)',
    borderWidth: 0.5,
    borderColor: '#d4d4d4',
  },
  agentStatus: { flexDirection: 'row', alignItems: 'center', paddingLeft: 10, gap: 6 },
  embeddedAgentStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, height: 30, borderRadius: 15, backgroundColor: '#fafafa' },
  agentStatusText: { maxWidth: 160, color: '#525252', fontSize: 11, fontWeight: '500' },
  controlDivider: { width: 0.5, height: 14, backgroundColor: '#d4d4d4', marginLeft: 4 },
  closeControl: {
    width: webPreviewOverlayControlContract.closeWidth,
    aspectRatio: webPreviewOverlayControlContract.closeWidth / webPreviewOverlayControlContract.closeSize,
    height: webPreviewOverlayControlContract.closeSize,
    minHeight: 0,
    borderRadius: 15,
    paddingHorizontal: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 0,
    elevation: 0,
    shadowOpacity: 0,
  },
}) }
