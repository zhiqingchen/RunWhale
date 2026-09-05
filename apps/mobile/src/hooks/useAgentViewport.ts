import { type AgentTranscriptHandle, type TranscriptRow } from '@/components/AgentTranscript'
import { AGENT_QUESTION_KEYBOARD_REVEAL_DELAY_MS, agentKeyboardOverlap, agentQuestionKeyboardRevealOffset } from '@/utils/agent-keyboard'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, Keyboard, Platform, ScrollView, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function useAgentViewport(sessionId: string | undefined) {
  const safeAreaInsets = useSafeAreaInsets()
  const { height: windowHeight, width: windowWidth } = useWindowDimensions()
  const feedRef = useRef<FlatList<TranscriptRow>>(null)
  const transcriptRef = useRef<AgentTranscriptHandle>(null)
  const composerShortcutsRef = useRef<ScrollView>(null)
  const scrollOffset = useRef(0)
  const [transcriptAtBottom, setTranscriptAtBottom] = useState(true)
  const keyboardTransitionOffset = useRef<number | undefined>(undefined)
  const [questionInputFocused, setQuestionInputFocused] = useState(false)
  const [keyboardVisible, setKeyboardVisible] = useState(() => Platform.OS === 'web' ? false : Keyboard.isVisible())
  const [keyboardScreenY, setKeyboardScreenY] = useState<number | undefined>(() => Platform.OS === 'web' || typeof Keyboard.metrics !== 'function' ? undefined : Keyboard.metrics()?.screenY)
  const keyboardOverlap = keyboardScreenY === undefined ? 0 : agentKeyboardOverlap(windowHeight, keyboardScreenY)
  useEffect(() => { scrollOffset.current = 0; setTranscriptAtBottom(true) }, [sessionId])
  const rememberTranscriptPosition = useCallback(() => {
    keyboardTransitionOffset.current = scrollOffset.current
  }, [])
  const restoreTranscriptPosition = useCallback(() => {
    const offset = keyboardTransitionOffset.current
    if (offset === undefined) return
    requestAnimationFrame(() => {
      feedRef.current?.scrollToOffset({ offset, animated: false })
      scrollOffset.current = offset
      keyboardTransitionOffset.current = undefined
    })
  }, [])
  useEffect(() => {
    if (!keyboardVisible || !questionInputFocused) return
    const timer = setTimeout(() => feedRef.current?.scrollToOffset({ offset: agentQuestionKeyboardRevealOffset(scrollOffset.current, Platform.OS), animated: true }), AGENT_QUESTION_KEYBOARD_REVEAL_DELAY_MS)
    return () => clearTimeout(timer)
  }, [keyboardVisible, questionInputFocused])
  useEffect(() => {
    const subscriptions = Platform.OS === 'ios'
      ? [
          Keyboard.addListener('keyboardWillShow', (event) => {
            Keyboard.scheduleLayoutAnimation(event)
            setKeyboardVisible(true)
            setKeyboardScreenY(event.endCoordinates.screenY)
          }),
          Keyboard.addListener('keyboardWillHide', (event) => {
            Keyboard.scheduleLayoutAnimation(event)
            setKeyboardVisible(false)
            setKeyboardScreenY(undefined)
          }),
          Keyboard.addListener('keyboardDidShow', restoreTranscriptPosition),
          Keyboard.addListener('keyboardDidHide', restoreTranscriptPosition),
        ]
      : [
          Keyboard.addListener('keyboardDidShow', (event) => {
            setKeyboardVisible(true)
            setKeyboardScreenY(event.endCoordinates.screenY)
            restoreTranscriptPosition()
          }),
          Keyboard.addListener('keyboardDidHide', () => {
            setKeyboardVisible(false)
            setKeyboardScreenY(undefined)
            restoreTranscriptPosition()
          }),
        ]
    return () => subscriptions.forEach((subscription) => subscription.remove())
  }, [restoreTranscriptPosition])
  return { safeAreaInsets, windowHeight, windowWidth, feedRef, transcriptRef, composerShortcutsRef, scrollOffset, transcriptAtBottom, setTranscriptAtBottom, questionInputFocused, setQuestionInputFocused, keyboardVisible, keyboardOverlap, rememberTranscriptPosition }
}
