import AsyncStorage from '@react-native-async-storage/async-storage'
import { renderSlot } from '#extensions'
import { MOBILE_PROVIDERS } from '@runwhale/mobile-protocol'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { Button } from 'heroui-native/button'
import { Spinner } from 'heroui-native/spinner'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, BackHandler, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { AppIcon } from '@/components/AppIcon'
import { ArrowLeft, ChevronRight, KeyRound, ShieldCheck } from '@/components/icons'
import { ONBOARDING_STORAGE_KEY } from '@/components/FirstRunGuide'
import { OnboardingScene } from '@/components/OnboardingScene'
import type { OnboardingSubscriptionProps } from '@/extension-types'
import { useFocusedInputScroll } from '@/hooks/useFocusedInputScroll'
import { useI18n } from '@/i18n'
import { usePreferences } from '@/state/preferences'
import { useRuntime } from '@/state/runtime'
import { type ThemeColors, useAppColors } from '@/theme/tokens'
import { ModelSettings, type ModelCredentialState } from './settings/ModelSettings'

const slides = [
  { label: 'onboardingIntroLabel', title: 'onboardingBuildTitle', body: 'onboardingBuildBody' },
  { label: 'onboardingPreviewLabel', title: 'onboardingPreviewTitle', body: 'onboardingPreviewBody' },
  { label: 'onboardingIterateLabel', title: 'onboardingIterateTitle', body: 'onboardingIterateBody' },
] as const

export function OnboardingScreen() {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const router = useRouter()
  const { replay } = useLocalSearchParams<{ replay?: string }>()
  const { width: windowWidth, height } = useWindowDimensions()
  const [width, setWidth] = useState(windowWidth)
  const [page, setPage] = useState(0)
  const [keyVisited, setKeyVisited] = useState(false)
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const [needsKey, setNeedsKey] = useState(true)
  const [credentialChecked, setCredentialChecked] = useState(false)
  const [credential, setCredential] = useState<ModelCredentialState>({ configured: false, busy: true, saving: false, hasDraft: false })
  const [finishing, setFinishing] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const finishInFlight = useRef(false)
  const pager = useRef<ScrollView>(null)
  const scrollX = useRef(new Animated.Value(0)).current
  const { modelProvider, preferencesReady } = usePreferences()
  const runtime = useRuntime()
  const { scrollRef, onScroll, rememberFocusedInput, forgetFocusedInput } = useFocusedInputScroll()
  const showKey = needsKey && !MOBILE_PROVIDERS[modelProvider].managed
  const subscription = renderSlot('onboarding.subscription', {
    active: page === slides.length,
    onUseApiKey: showKey ? () => goTo(slides.length + 1) : undefined,
  } satisfies OnboardingSubscriptionProps)
  const keyIndex = slides.length + (subscription ? 1 : 0)
  const total = keyIndex + (showKey ? 1 : 0)
  const isKeyPage = showKey && page === keyIndex
  const busy = finishing || (isKeyPage && credential.saving)

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false))
    return () => { show.remove(); hide.remove() }
  }, [])

  useEffect(() => {
    if (credentialChecked || !preferencesReady || !runtime.info) return
    let active = true
    // Managed providers handle account setup through their existing extension.
    const read = MOBILE_PROVIDERS[modelProvider].managed
      ? Promise.resolve({ configured: true })
      : runtime.request('credential.status', { provider: modelProvider })
    void read.then((result) => {
      if (active) {
        // Replaying the guide also lets users revisit their saved key settings.
        setNeedsKey(!result.configured || (Boolean(replay) && !MOBILE_PROVIDERS[modelProvider].managed))
        setCredentialChecked(true)
      }
    }).catch(() => { if (active) setCredentialChecked(true) })
    return () => { active = false }
  }, [credentialChecked, preferencesReady, modelProvider, replay, runtime.info, runtime.request])

  const goTo = useCallback((next: number) => {
    Keyboard.dismiss()
    const target = Math.max(0, Math.min(total - 1, next))
    pager.current?.scrollTo({ x: target * width, animated: true })
  }, [total, width])

  useEffect(() => { if (isKeyPage) setKeyVisited(true) }, [isKeyPage])

  useEffect(() => {
    if (page >= total) {
      setPage(total - 1)
      goTo(total - 1)
    }
  }, [page, total, goTo])

  useEffect(() => {
    // Keep the same page when the device changes orientation.
    pager.current?.scrollTo({ x: page * width, animated: false })
    scrollX.setValue(page * width)
  }, [width, scrollX])

  const finish = useCallback(async (create: boolean) => {
    if (finishInFlight.current || (isKeyPage && credential.saving)) return
    finishInFlight.current = true
    setFinishing(true)
    setStorageError(false)
    Keyboard.dismiss()
    try {
      await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, 'completed')
      if (create) {
        router.dismissTo('/(tabs)')
        router.push('/new')
      }
      else if (replay && router.canGoBack()) router.back()
      else router.replace('/(tabs)')
    } catch {
      setStorageError(true)
    } finally {
      finishInFlight.current = false
      setFinishing(false)
    }
  }, [credential.saving, isKeyPage, replay, router])

  useFocusEffect(useCallback(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (busy) return true
      if (page > 0) goTo(page - 1)
      else void finish(false)
      return true
    })
    return () => back.remove()
  }, [busy, page, goTo, finish]))

  const last = page === total - 1
  const continueDisabled = busy || (isKeyPage && (credential.busy || !credential.configured || credential.hasDraft))
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']} testID="onboarding-screen">
    <View style={styles.header}>
      <View style={styles.brand}><Image source={require('../../assets/images/runwhale-adaptive-foreground.png')} style={styles.logo} /><Text style={styles.brandText}>RunWhale</Text></View>
      <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => { void finish(false) }} style={styles.skip} testID="onboarding-skip"><Button.Label style={styles.skipText}>{t('onboardingSkip')}</Button.Label></Button>
    </View>
    <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.body} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <Animated.ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          bounces={false}
          scrollEnabled={!busy && !isKeyPage}
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}
          onMomentumScrollEnd={(event) => {
            const next = Math.max(0, Math.min(total - 1, Math.round(event.nativeEvent.contentOffset.x / width)))
            setPage(next)
          }}
          testID="onboarding-carousel"
        >
          {Array.from({ length: total }, (_, index) => {
            const animated = {
              opacity: scrollX.interpolate({ inputRange: [(index - 1) * width, index * width, (index + 1) * width], outputRange: [0.25, 1, 0.25], extrapolate: 'clamp' }),
              transform: [
                { translateY: scrollX.interpolate({ inputRange: [(index - 1) * width, index * width, (index + 1) * width], outputRange: [24, 0, 24], extrapolate: 'clamp' }) },
                { scale: scrollX.interpolate({ inputRange: [(index - 1) * width, index * width, (index + 1) * width], outputRange: [0.95, 1, 0.95], extrapolate: 'clamp' }) },
              ],
            }
            const slide = slides[index]
            return <View key={index} style={{ width }} accessibilityElementsHidden={page !== index} importantForAccessibility={page !== index ? 'no-hide-descendants' : 'auto'}>
              {slide ? <ScrollView contentContainerStyle={styles.slideScroll} showsVerticalScrollIndicator={false}>
                <Animated.View style={[styles.slide, animated]}>
                  <View style={[styles.scene, height < 760 && styles.sceneCompact]}><View style={height < 760 ? styles.sceneScaled : undefined}><OnboardingScene page={index} active={page === index} /></View></View>
                  <View style={styles.copy}><Text style={styles.eyebrow}>{t(slide.label)}</Text><Text accessibilityRole="header" style={styles.title}>{t(slide.title)}</Text><Text style={styles.description}>{t(slide.body)}</Text></View>
                </Animated.View>
              </ScrollView> : subscription && index === slides.length ? <ScrollView contentContainerStyle={styles.slideScroll} showsVerticalScrollIndicator={false}>
                <Animated.View style={[styles.subscription, animated]}>{subscription}</Animated.View>
              </ScrollView> : <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={styles.keyScroll} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} showsVerticalScrollIndicator={false}>
                <Animated.View style={[styles.keyContent, animated]}>
                  {!keyboardVisible ? <View style={styles.keyHero}><View style={styles.keyIcon}><AppIcon icon={KeyRound} color={colors.accent} size={29} strokeWidth={1.7} /></View><Text style={styles.eyebrow}>{t('onboardingKeyLabel')}</Text><Text accessibilityRole="header" style={styles.keyTitle}>{t('onboardingKeyTitle')}</Text><Text style={styles.description}>{t('onboardingKeyBody')}</Text></View> : null}
                  {keyVisited ? <ModelSettings variant="onboarding" onInputBlur={forgetFocusedInput} onInputFocus={rememberFocusedInput} onCredentialStateChange={setCredential} /> : null}
                  <View style={styles.privacy}><AppIcon icon={ShieldCheck} color={colors.muted} size={16} /><Text style={styles.privacyText}>{t('onboardingKeyPrivacy')}</Text></View>
                </Animated.View>
              </ScrollView>}
            </View>
          })}
        </Animated.ScrollView>
      </View>
      {!isKeyPage || !keyboardVisible ? <View style={styles.footer}>
        {storageError ? <Text accessibilityRole="alert" style={styles.error}>{t('onboardingStorageError')}</Text> : null}
        <View style={styles.navigation}>
          <Button isIconOnly variant="ghost" size="sm" accessibilityLabel={t('onboardingBack')} isDisabled={busy || page === 0} onPress={() => goTo(page - 1)} style={[styles.back, page === 0 && styles.invisible]} testID="onboarding-back"><AppIcon icon={ArrowLeft} color={colors.text} size={20} /></Button>
          <View style={styles.pagination}>{Array.from({ length: total }, (_, index) => <Pressable key={index} accessibilityRole="button" accessibilityLabel={t('onboardingStep', { current: index + 1, total })} accessibilityState={{ selected: index === page, disabled: busy }} disabled={busy} onPress={() => goTo(index)} style={styles.pageTarget} testID={`onboarding-page-${index}`}><View style={[styles.pageDot, index === page && styles.pageDotActive]} /></Pressable>)}</View>
          <Text style={styles.pageNumber}>{String(page + 1).padStart(2, '0')}<Text style={styles.pageTotal}> / {String(total).padStart(2, '0')}</Text></Text>
        </View>
        {last ? <Button variant="primary" isDisabled={continueDisabled} onPress={() => { void finish(true) }} style={[styles.next, continueDisabled && styles.nextDisabled]} testID="onboarding-create">
          {finishing ? <Spinner color="#FFFFFF" size="sm" /> : null}
          <Button.Label style={styles.nextText}>{t('onboardingCreate')}</Button.Label>
          {!finishing ? <AppIcon icon={ChevronRight} color="#FFFFFF" size={18} /> : null}
        </Button> : <Text style={styles.swipeHint}>{t('onboardingSwipe')}</Text>}
        {isKeyPage ? <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => { void finish(true) }} style={styles.later} testID="onboarding-later"><Button.Label style={styles.laterText}>{t('onboardingLater')}</Button.Label></Button> : null}
      </View> : null}
    </KeyboardAvoidingView>
  </SafeAreaView>
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  body: { flex: 1 },
  header: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 23, paddingTop: 8, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { width: 29, height: 29 },
  brandText: { color: colors.text, fontSize: 17, fontWeight: '700', letterSpacing: -0.6 },
  skip: { paddingHorizontal: 10, height: 36 },
  skipText: { color: colors.muted, fontSize: 13, fontWeight: '500' },
  slideScroll: { flexGrow: 1, justifyContent: 'center', paddingBottom: 8 },
  slide: { width: '100%', maxWidth: 440, paddingHorizontal: 28, alignSelf: 'center', gap: 24 },
  subscription: { width: '100%', maxWidth: 440, paddingHorizontal: 24, alignSelf: 'center' },
  scene: { height: 342, justifyContent: 'center' },
  sceneCompact: { height: 278 },
  sceneScaled: { transform: [{ scale: 0.84 }] },
  copy: { gap: 13 },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '700', letterSpacing: 2.1 },
  title: { color: colors.text, fontSize: 38, lineHeight: 45, fontWeight: '800', letterSpacing: -1.6 },
  description: { color: colors.muted, fontSize: 15, lineHeight: 24, maxWidth: 360 },
  keyScroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 18 },
  keyContent: { width: '100%', maxWidth: 440, alignSelf: 'center', gap: 14 },
  keyHero: { gap: 10 },
  keyIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.accentDeep, alignItems: 'center', justifyContent: 'center' },
  keyTitle: { color: colors.text, fontSize: 32, lineHeight: 37, fontWeight: '800', letterSpacing: -1.2 },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingHorizontal: 3 },
  privacyText: { flex: 1, color: colors.muted, fontSize: 11, lineHeight: 17 },
  footer: { width: '100%', maxWidth: 496, alignSelf: 'center', paddingHorizontal: 24, paddingBottom: 12, paddingTop: 8, gap: 10 },
  navigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 30, marginBottom: 2 },
  back: { width: 32, height: 32 },
  invisible: { opacity: 0 },
  pagination: { flexDirection: 'row', alignItems: 'center' },
  pageTarget: { minWidth: 25, height: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  pageDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.border },
  pageDotActive: { width: 22, backgroundColor: colors.accent },
  pageNumber: { color: colors.text, fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pageTotal: { color: colors.muted },
  swipeHint: { color: colors.muted, fontSize: 11, lineHeight: 20, textAlign: 'center', paddingBottom: 5 },
  next: { height: 54, borderRadius: 17, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, boxShadow: `0px 6px 18px ${colors.accent}26` },
  nextDisabled: { opacity: 0.45 },
  nextText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  later: { height: 32, alignSelf: 'center' },
  laterText: { color: colors.muted, fontSize: 12 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
}) }
