import { type ReactNode, useMemo } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { SlideInDown, SlideOutDown } from 'react-native-reanimated'
import { Button } from 'heroui-native/button'
import { Dialog } from 'heroui-native/dialog'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AppIcon } from './AppIcon'
import { ArrowLeft, Check, Copy } from './icons'
import { PendingButton } from './PendingButton'
import { TranscriptCodeBlock, useClipboardCopyFeedback } from './TranscriptCodeBlock'
import { formatTranscriptJson } from '@/utils/transcript-feedback'
import { toolActivityDialogContract as contract, toolActivityDialogHeight } from './tool-activity-dialog-contract'
import { useI18n } from '@/i18n'
import { type ThemeColors, useAppColors } from '@/theme/tokens'

interface SheetProps {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  titleNumberOfLines?: number
  disableFullWindowOverlay?: boolean
  onBack?(): void
  action?: ReactNode
  testID?: string
  expanded?: boolean
  minimumHeight?: number
}

export function TranscriptDetailsSheet({ open, onOpenChange, title, titleNumberOfLines = 1, disableFullWindowOverlay, onBack, action, testID, expanded, minimumHeight = 0, children }: SheetProps & { children: ReactNode }) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const usableHeight = Math.max(0, height - insets.top - insets.bottom)
  const sheetHeight = expanded ? Math.round(usableHeight * 0.85) : Math.min(usableHeight, Math.max(minimumHeight, toolActivityDialogHeight(usableHeight)))
  return <Dialog isOpen={open} onOpenChange={onOpenChange}>
    <Dialog.Portal disableFullWindowOverlay={disableFullWindowOverlay} unstable_accessibilityContainerViewIsModal style={styles.portal}>
      <Dialog.Overlay isCloseOnPress style={styles.overlay} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents="box-none" style={styles.container}>
        <Dialog.Content testID={testID} isSwipeable={false} animation={{ entering: SlideInDown.duration(220), exiting: SlideOutDown.duration(160) }} style={[styles.content, { height: sheetHeight, paddingBottom: insets.bottom }]}>
          <View style={styles.header}>
            {onBack ? <Button isIconOnly size="sm" variant="ghost" accessibilityLabel={t('back')} onPress={onBack} testID={testID ? `${testID}-back` : undefined} style={styles.control}><AppIcon icon={ArrowLeft} color={colors.blue} size={18} /></Button> : null}
            <Dialog.Title numberOfLines={titleNumberOfLines} style={[styles.title, titleNumberOfLines > 1 && { paddingVertical: 12 }]}>{title}</Dialog.Title>
            {action}
            <Dialog.Close accessibilityLabel={t('close')} variant="ghost" style={styles.control} />
          </View>
          {children}
        </Dialog.Content>
      </KeyboardAvoidingView>
    </Dialog.Portal>
  </Dialog>
}

export function TranscriptTextDetails({ text, ...props }: SheetProps & { text: string }) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const { copyState, copy } = useClipboardCopyFeedback(text)
  const json = useMemo(() => formatTranscriptJson(text), [text])
  return <TranscriptDetailsSheet {...props} action={json === undefined ? <PendingButton isIconOnly size="sm" variant="ghost" accessibilityLabel={t(copyState === 'copied' ? 'copied' : 'copy')} isPending={copyState === 'copying'} onPress={() => { void copy() }} style={styles.control}><AppIcon icon={copyState === 'copied' ? Check : Copy} color={colors.blue} size={17} /></PendingButton> : undefined}>
    <ScrollView bounces={false} nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
      {copyState === 'failed' ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{t('codeCopyFailed')}</Text> : null}
      {json === undefined ? <Text selectable style={{ color: colors.text, fontSize: 13, lineHeight: 21 }}>{text}</Text> : <TranscriptCodeBlock code={json} language="json" copyLabel={t('copy')} copiedLabel={t('copied')} copyFailedLabel={t('codeCopyFailed')} />}
    </ScrollView>
  </TranscriptDetailsSheet>
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  portal: { position: 'absolute', inset: 0 },
  overlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(9, 14, 29, 0.46)' },
  container: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', overflow: 'hidden', borderTopLeftRadius: contract.cornerRadius, borderTopRightRadius: contract.cornerRadius, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, backgroundColor: colors.panel, padding: 0 },
  header: { minHeight: 58, paddingLeft: contract.headerPaddingLeft, paddingRight: contract.headerPaddingRight, flexDirection: 'row', alignItems: 'center', gap: contract.headerGap, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  title: { minWidth: 0, flex: 1, color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '800' },
  control: { width: contract.closeTargetSize, height: contract.closeTargetSize, padding: 0, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
}) }
