import { useCallback, useEffect, useRef } from 'react'
import { findNodeHandle, Keyboard, Platform, ScrollView, TextInput, UIManager, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { focusedInputScrollOffset } from '@/utils/keyboard-scroll'

export function useFocusedInputScroll() {
  const scrollRef = useRef<ScrollView>(null)
  const focusedInputRef = useRef<TextInput | null>(null)
  const scrollOffsetRef = useRef(0)
  const { height, width } = useWindowDimensions()

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
  }, [revealFocusedInput, height, width])

  const rememberFocusedInput = useCallback((input: TextInput | null) => { focusedInputRef.current = input }, [])
  const forgetFocusedInput = useCallback((input: TextInput | null) => {
    if (focusedInputRef.current === input) focusedInputRef.current = null
  }, [])
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = event.nativeEvent.contentOffset.y
  }, [])

  return { scrollRef, onScroll, rememberFocusedInput, forgetFocusedInput }
}
