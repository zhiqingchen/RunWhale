import { useEffect, useRef, useState } from 'react'
import * as Clipboard from 'expo-clipboard'
import { ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { Alert } from 'heroui-native/alert'
import { Spinner } from 'heroui-native/spinner'
import { AppIcon } from '@/components/AppIcon'
import { useAppColors } from '@/theme/tokens'
import { PendingButton } from '@/components/PendingButton'
import { Check, Copy } from '@/components/icons'
import { actionErrorPresentation } from '@/utils/action-progress'
import { codeCopyFeedbackReducer, initialCodeCopyFeedbackState, transcriptInteractionContract, type CodeCopyFeedbackEvent, type CodeCopyFeedbackState } from '@/utils/transcript-feedback'

export function TranscriptCodeBlock({ code, language, copyLabel, copiedLabel, copyFailedLabel }: {
  code: string
  language: string
  copyLabel: string
  copiedLabel: string
  copyFailedLabel: string
}) {
  const colors = useAppColors()
  const light = useColorScheme() !== 'dark'
  const { copyState, copy } = useClipboardCopyFeedback(code)
  const lines = code.replace(/\n$/, '').split('\n')
  const copyBusy = copyState === 'copying'
  const copyActionLabel = copyState === 'copied' ? copiedLabel : copyLabel
  return <View style={[styles.code, light && styles.codeLight]}>
    <View style={[styles.codeHeader, light && styles.codeHeaderLight]}><Text numberOfLines={1} style={[styles.codeLanguage, light && styles.codeLanguageLight]}>{language || 'text'}</Text><PendingButton isIconOnly size="sm" variant="ghost" accessibilityRole="button" accessibilityLabel={copyActionLabel} isPending={copyBusy} onPress={() => { void copy() }} style={styles.codeActionButton}>{({ isPending }) => isPending ? <Spinner size="sm" color={colors.accent} /> : <AppIcon icon={copyState === 'copied' ? Check : Copy} color="#6AA5FF" size={16} />}</PendingButton></View>
    {copyState === 'failed' ? <Alert {...actionErrorPresentation} style={styles.codeCopyError}>
      <Alert.Indicator iconProps={{ size: 17 }} />
      <Alert.Content><Alert.Description>{copyFailedLabel}</Alert.Description></Alert.Content>
    </Alert> : null}
    <ScrollView horizontal={language !== 'json'} scrollEnabled={language !== 'json'} contentContainerStyle={[styles.codeScroller, language === 'diff' && styles.diffScroller]}>
      <View style={styles.codeContent}>{lines.map((line, index) => <View key={index} style={[styles.codeLine, language === 'diff' && line.startsWith('+') && styles.diffAdded, language === 'diff' && line.startsWith('+') && light && styles.diffAddedLight, language === 'diff' && line.startsWith('-') && styles.diffRemoved, language === 'diff' && line.startsWith('-') && light && styles.diffRemovedLight]}><Text style={[styles.lineNumber, light && styles.lineNumberLight]}>{String(index + 1).padStart(2, ' ')}</Text><HighlightedLine line={line} language={language} light={light} /></View>)}</View>
    </ScrollView>
  </View>
}

export function useClipboardCopyFeedback(text: string): { copyState: CodeCopyFeedbackState; copy(): Promise<void> } {
  const [copyState, setCopyState] = useState(initialCodeCopyFeedbackState)
  const copyStateRef = useRef(initialCodeCopyFeedbackState)
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(true)
  const transitionCopyFeedback = (event: CodeCopyFeedbackEvent): boolean => {
    const current = copyStateRef.current
    const next = codeCopyFeedbackReducer(current, event)
    if (next === current) return false
    copyStateRef.current = next
    setCopyState(next)
    return true
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (copyResetTimer.current !== undefined) clearTimeout(copyResetTimer.current)
    }
  }, [])
  const copy = async () => {
    if (!transitionCopyFeedback('start')) return
    if (copyResetTimer.current !== undefined) {
      clearTimeout(copyResetTimer.current)
      copyResetTimer.current = undefined
    }
    try {
      await Clipboard.setStringAsync(text)
      if (!mounted.current) return
      transitionCopyFeedback('succeed')
      copyResetTimer.current = setTimeout(() => {
        copyResetTimer.current = undefined
        if (mounted.current) transitionCopyFeedback('reset')
      }, 1_500)
    } catch {
      if (mounted.current) transitionCopyFeedback('fail')
    }
  }
  return { copyState, copy }
}

function HighlightedLine({ line, language, light }: { line: string; language: string; light: boolean }) {
  if (language === 'diff') return <Text selectable style={[styles.codeText, light && styles.codeTextLight, line.startsWith('+') && styles.diffAddedText, line.startsWith('+') && light && styles.diffAddedTextLight, line.startsWith('-') && styles.diffRemovedText, line.startsWith('-') && light && styles.diffRemovedTextLight, line.startsWith('@@') && styles.diffHunk, line.startsWith('@@') && light && styles.diffHunkLight]}>{line}</Text>
  const tokens = line.split(/(\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|import|from|export|default|async|await|if|else|for|while|new|class|interface|type|extends|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b)/g)
  return <Text selectable style={[styles.codeText, language === 'json' && styles.wrappedText, light && styles.codeTextLight]}>{tokens.map((token, index) => {
    const style = token.startsWith('//') ? styles.tokenComment
      : /^['"`]/.test(token) ? light ? styles.tokenStringLight : styles.tokenString
        : /^(?:const|let|var|function|return|import|from|export|default|async|await|if|else|for|while|new|class|interface|type|extends|true|false|null|undefined)$/.test(token) ? light ? styles.tokenKeywordLight : styles.tokenKeyword
          : /^\d/.test(token) ? light ? styles.tokenNumberLight : styles.tokenNumber : undefined
    return <Text key={index} style={style}>{token}</Text>
  })}</Text>
}

const styles = StyleSheet.create({
  code: { borderRadius: 9, overflow: 'hidden', backgroundColor: '#0D131E', borderWidth: 1, borderColor: '#243247' },
  codeLight: { backgroundColor: '#F7F9FC', borderColor: '#D8E0EC' },
  codeHeader: { minHeight: transcriptInteractionContract.codeCopyMinimumSize, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, backgroundColor: '#141D2B' },
  codeHeaderLight: { backgroundColor: '#E9EEF6' },
  codeActionButton: { width: transcriptInteractionContract.codeCopyMinimumSize, height: transcriptInteractionContract.codeCopyMinimumSize, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center' },
  codeLanguage: { minWidth: 0, flex: 1, color: '#7F93AD', fontSize: 10, fontWeight: '800' },
  codeLanguageLight: { color: '#52627A' },
  codeCopyError: { margin: 8 },
  codeScroller: { flexGrow: 1, paddingVertical: 8 },
  diffScroller: { paddingVertical: 0 },
  codeContent: { flexGrow: 1 },
  codeLine: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 20, paddingRight: 14 },
  lineNumber: { width: 39, color: '#52627A', textAlign: 'right', paddingRight: 10, fontFamily: 'monospace', fontSize: 11, lineHeight: 18 },
  lineNumberLight: { color: '#8A98AA' },
  codeText: { color: '#D8E6F5', fontFamily: 'monospace', fontSize: 11, lineHeight: 18 },
  codeTextLight: { color: '#192536' },
  wrappedText: { flex: 1, minWidth: 0 },
  tokenComment: { color: '#71829A' },
  tokenString: { color: '#9BE18C' },
  tokenKeyword: { color: '#B89CFF' },
  tokenNumber: { color: '#FFC46B' },
  tokenStringLight: { color: '#23753C' },
  tokenKeywordLight: { color: '#7353B5' },
  tokenNumberLight: { color: '#966111' },
  diffAdded: { backgroundColor: '#143224' },
  diffAddedLight: { backgroundColor: '#EAF7EF' },
  diffRemoved: { backgroundColor: '#3A1D25' },
  diffRemovedLight: { backgroundColor: '#FFF0F2' },
  diffAddedText: { color: '#6ED99A' },
  diffAddedTextLight: { color: '#18743F' },
  diffRemovedText: { color: '#FF8D9A' },
  diffRemovedTextLight: { color: '#B52D48' },
  diffHunk: { color: '#7BB6FF' },
  diffHunkLight: { color: '#356CB3' },
})
