import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { AppIcon } from '@/components/AppIcon'
import { ArrowLeft, ArrowUpToLine, Check, Code2, Play, Plus, Pointer } from '@/components/icons'
import { useI18n } from '@/i18n'
import { type ThemeColors, useAppColors } from '@/theme/tokens'

export function OnboardingSwipeHint() {
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const progress = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const animation = Animated.loop(Animated.timing(progress, { toValue: 1, duration: 2800, easing: Easing.linear, useNativeDriver: true, isInteraction: false }))
    animation.start()
    return () => animation.stop()
  }, [progress])
  return <View style={styles.swipeHint} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <View style={styles.swipeTrack} />
    <View style={styles.swipeArrow}><AppIcon icon={ArrowLeft} color={colors.muted} size={12} strokeWidth={1.5} /></View>
    <Animated.View style={[styles.swipeFinger, {
      opacity: progress.interpolate({ inputRange: [0, 0.12, 0.2, 0.85, 1], outputRange: [0, 0, 1, 1, 0] }),
      transform: [{ translateX: progress.interpolate({ inputRange: [0, 0.25, 0.8, 1], outputRange: [25, 25, -25, -25] }) }],
    }]}><AppIcon icon={Pointer} color={colors.accent} size={22} strokeWidth={1.6} /></Animated.View>
  </View>
}

// Each visit starts a fresh demo. Leaving a page cancels its typing and reveal work.
function useTypedText(text: string, active: boolean, delay: number) {
  const [length, setLength] = useState(0)
  useEffect(() => {
    setLength(0)
    if (!active) return
    let interval: ReturnType<typeof setInterval> | undefined
    const timer = setTimeout(() => {
      let position = 0
      interval = setInterval(() => {
        position += 1
        setLength(position)
        if (position >= text.length) clearInterval(interval)
      }, 42)
    }, delay)
    return () => { clearTimeout(timer); clearInterval(interval) }
  }, [text, active, delay])
  return text.slice(0, length)
}

export function OnboardingScene({ page, active, expanded = false }: { page: number; active: boolean; expanded?: boolean }) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const prompt = t(page === 2 ? 'onboardingDemoEdit' : 'onboardingDemoPrompt')
  const response = t(page === 2 ? 'onboardingDemoUpdated' : 'onboardingDemoAgent')
  const typedPrompt = useTypedText(prompt, active, 300)
  const responseDelay = 600 + prompt.length * 42
  const typedResponse = useTypedText(response, active, responseDelay)
  const reveal = useRef(new Animated.Value(0)).current
  useEffect(() => {
    reveal.setValue(0)
    if (!active) return
    const animation = Animated.sequence([
      Animated.delay(page === 1 ? 250 : responseDelay + response.length * 42),
      Animated.spring(reveal, { toValue: 1, damping: 18, stiffness: 100, mass: 0.8, useNativeDriver: true }),
    ])
    animation.start()
    return () => animation.stop()
  }, [active, page, responseDelay, response.length, reveal])
  const appeared = { opacity: reveal, transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }

  const habits = (compact = false) => <View style={[styles.habits, compact && styles.habitsCompact]}>
    <View style={styles.habitsHeader}>
      <View><Text style={styles.tinyLabel}>{t('onboardingDemoWeek')}</Text><Text style={styles.appTitle}>{t('onboardingDemoApp')}</Text></View>
      <View style={styles.addButton}><AppIcon icon={Plus} color={colors.accent} size={18} /></View>
    </View>
    {(compact ? ['onboardingDemoTaskOne', 'onboardingDemoTaskTwo'] as const : ['onboardingDemoTaskOne', 'onboardingDemoTaskTwo', 'onboardingDemoTaskThree'] as const).map((key, index) => <View key={key} style={styles.habitRow}>
      <View style={[styles.checkbox, index < 2 && styles.checkboxDone]}>{index < 2 ? <AppIcon icon={Check} color="#FFFFFF" size={12} strokeWidth={3} /> : null}</View>
      <Text style={[styles.habitText, index < 2 && styles.habitDone]}>{t(key)}</Text>
    </View>)}
  </View>

  return <View style={[styles.stage, expanded && styles.stageExpanded]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <LinearGradient colors={page === 1 ? [colors.accentDeep, colors.raised] : [colors.raised, colors.accentDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.backdrop} />
    <View style={styles.orbit} /><View style={styles.orbitInner} />
    {page === 1 ? <>
      <View style={[styles.phone, expanded && styles.phoneExpanded]}>
        <View style={styles.phoneTop}><View style={styles.island} /></View>
        {habits()}
        <Animated.View style={[styles.progress, appeared]}>
          <View style={styles.progressHeading}><Text style={styles.tinyLabel}>{t('onboardingDemoWeek')}</Text><Text style={styles.progressNumber}>{t('onboardingDemoProgress')}</Text></View>
          <View style={styles.bars}>{[0.35, 0.62, 0.48, 0.82, 1, 0.22, 0.22].map((value, index) => <View key={index} style={styles.barTrack}><View style={[styles.bar, { height: `${value * 100}%`, opacity: index > 4 ? 0.2 : 1 }]} /></View>)}</View>
        </Animated.View>
        <View style={styles.homeIndicator} />
      </View>
      <Animated.View style={[styles.liveBadge, appeared]}><View style={styles.liveDot} /><Text style={styles.badgeText}>{t('preview')}</Text><AppIcon icon={Play} color={colors.accent} size={13} /></Animated.View>
    </> : <View style={[styles.composition, expanded && styles.compositionExpanded]}>
      <View style={styles.chat}>
        <View style={styles.chatHeader}><Image source={require('../../assets/images/runwhale-icon.png')} style={styles.avatar} /><Text style={styles.chatBrand}>RunWhale</Text><View style={styles.chatDots}><View style={styles.dot} /><View style={styles.dot} /><View style={styles.dot} /></View></View>
        <View style={styles.conversation}>
          <View style={styles.promptBubble}><Text style={styles.promptText}>{typedPrompt}{typedPrompt.length < prompt.length ? <Text style={styles.cursor}>▍</Text> : null}</Text></View>
          <View style={styles.reply}><View style={styles.replyMark}><AppIcon icon={Code2} color={colors.accent} size={16} /></View><Text style={styles.replyText}>{typedResponse || '···'}</Text></View>
          <Animated.View style={[styles.codeLines, appeared]}>{[83, 58, 72].map((width, index) => <View key={index} style={styles.codeRow}><Text style={styles.lineNumber}>{index + 1}</Text><View style={[styles.codeLine, { width: `${width}%`, backgroundColor: index === 1 ? colors.blue : colors.accent }]} /></View>)}</Animated.View>
        </View>
        <View style={styles.composer}><View style={styles.composerLine} /><View style={styles.send}><AppIcon icon={ArrowUpToLine} color="#FFFFFF" size={13} /></View></View>
      </View>
      <Animated.View style={[styles.resultCard, appeared]}>
        {page === 0 ? habits(true) : <View style={styles.progressResult}>
          <View style={styles.progressHeading}><Text style={styles.tinyLabel}>{t('onboardingDemoWeek')}</Text><View style={styles.successDot}><AppIcon icon={Check} color="#FFFFFF" size={11} /></View></View>
          <Text style={styles.resultTitle}>{t('onboardingDemoProgress')}</Text>
          <View style={styles.weekDots}>{[1, 1, 1, 1, 1, 0, 0].map((done, index) => <View key={index} style={[styles.weekDot, done === 1 && styles.weekDone]}>{done ? <AppIcon icon={Check} color="#FFFFFF" size={13} /> : null}</View>)}</View>
        </View>}
      </Animated.View>
    </View>}
  </View>
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  swipeHint: { width: 98, height: 30, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  swipeTrack: { width: 64, height: 1, backgroundColor: colors.border },
  swipeArrow: { position: 'absolute', left: 12, top: 9, opacity: 0.5 },
  swipeFinger: { position: 'absolute', width: 29, height: 29, borderRadius: 15, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' },
  stage: { width: '100%', maxWidth: 360, height: 342, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  stageExpanded: { height: '100%', minHeight: 342 },
  backdrop: { position: 'absolute', width: '94%', height: 282, borderRadius: 44, transform: [{ rotate: '-5deg' }] },
  orbit: { position: 'absolute', width: 286, height: 286, borderRadius: 143, borderWidth: 1, borderColor: `${colors.accent}20`, transform: [{ translateX: 16 }] },
  orbitInner: { position: 'absolute', width: 222, height: 222, borderRadius: 111, borderWidth: 1, borderColor: `${colors.accent}15`, transform: [{ translateX: 16 }] },
  composition: { width: '100%', height: 326, justifyContent: 'flex-start', paddingTop: 7 },
  compositionExpanded: { height: '100%', maxHeight: 460 },
  chat: { width: '87%', alignSelf: 'flex-start', borderRadius: 23, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, boxShadow: '0px 14px 38px rgba(30, 51, 110, 0.10)', overflow: 'hidden', transform: [{ rotate: '-3deg' }] },
  chatHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 16, height: 44, borderBottomWidth: 1, borderBottomColor: colors.border },
  avatar: { width: 24, height: 24 },
  chatBrand: { color: colors.text, fontWeight: '700', fontSize: 12 },
  chatDots: { marginLeft: 'auto', flexDirection: 'row', gap: 3 },
  dot: { width: 3, height: 3, backgroundColor: colors.muted, borderRadius: 2 },
  conversation: { padding: 15, gap: 15, minHeight: 155 },
  promptBubble: { backgroundColor: colors.accentDeep, borderRadius: 12, borderBottomRightRadius: 3, padding: 11, minHeight: 43, alignSelf: 'flex-end', maxWidth: '93%' },
  promptText: { color: colors.text, fontSize: 12, lineHeight: 19, fontWeight: '500' },
  cursor: { color: colors.accent },
  reply: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', minHeight: 36 },
  replyMark: { width: 25, height: 25, borderRadius: 8, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  replyText: { color: colors.text, fontSize: 12, lineHeight: 18, flex: 1, paddingTop: 2 },
  codeLines: { gap: 6, marginLeft: 34, paddingBottom: 9 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  lineNumber: { fontSize: 8, color: colors.muted },
  codeLine: { height: 4, borderRadius: 3, opacity: 0.32 },
  composer: { margin: 10, marginTop: 0, padding: 7, borderWidth: 1, borderColor: colors.border, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  composerLine: { width: '47%', height: 4, backgroundColor: colors.border, borderRadius: 3, marginLeft: 5 },
  send: { width: 23, height: 23, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  resultCard: { position: 'absolute', right: 0, bottom: 0, width: '72%', borderRadius: 19, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, boxShadow: '0px 12px 30px rgba(30, 51, 110, 0.12)', overflow: 'hidden', transform: [{ rotate: '3deg' }] },
  habits: { padding: 20, gap: 17 },
  habitsCompact: { padding: 16, gap: 12 },
  habitsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 5 },
  tinyLabel: { color: colors.muted, fontSize: 8, letterSpacing: 1.1, fontWeight: '700' },
  appTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 5, letterSpacing: -0.5 },
  addButton: { width: 28, height: 28, borderRadius: 10, backgroundColor: colors.accentDeep, alignItems: 'center', justifyContent: 'center' },
  habitRow: { flexDirection: 'row', gap: 9, alignItems: 'center' },
  checkbox: { width: 19, height: 19, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxDone: { borderColor: colors.accent, backgroundColor: colors.accent },
  habitText: { color: colors.text, fontSize: 11, flex: 1 },
  habitDone: { color: colors.muted },
  phone: { width: 239, height: 328, backgroundColor: colors.panel, borderRadius: 32, borderWidth: 5, borderColor: colors.text, boxShadow: '0px 18px 35px rgba(30, 51, 110, 0.14)', transform: [{ rotate: '5deg' }], overflow: 'hidden' },
  phoneExpanded: { height: '96%', minHeight: 328, maxHeight: 430 },
  phoneTop: { alignItems: 'center', height: 26, paddingTop: 7 },
  island: { width: 62, height: 13, borderRadius: 10, backgroundColor: colors.text },
  homeIndicator: { position: 'absolute', bottom: 8, width: 72, height: 3, backgroundColor: colors.text, alignSelf: 'center', borderRadius: 3, opacity: 0.7 },
  progress: { marginHorizontal: 18, padding: 13, gap: 10, borderRadius: 13, backgroundColor: colors.raised },
  progressHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  progressNumber: { fontSize: 9, color: colors.accent, fontWeight: '700' },
  bars: { height: 43, flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  barTrack: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', backgroundColor: colors.accent, borderRadius: 3 },
  liveBadge: { position: 'absolute', bottom: 39, left: 0, paddingHorizontal: 14, height: 38, borderRadius: 14, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 9, boxShadow: '0px 6px 20px rgba(30, 51, 110, 0.12)' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#27B990' },
  badgeText: { fontSize: 11, fontWeight: '600', color: colors.text },
  progressResult: { padding: 18, gap: 10 },
  resultTitle: { fontSize: 23, color: colors.text, fontWeight: '700', letterSpacing: -0.7 },
  successDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#27B990', alignItems: 'center', justifyContent: 'center' },
  weekDots: { flexDirection: 'row', gap: 6 },
  weekDot: { flex: 1, aspectRatio: 1, borderRadius: 8, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  weekDone: { backgroundColor: colors.accent },
}) }
