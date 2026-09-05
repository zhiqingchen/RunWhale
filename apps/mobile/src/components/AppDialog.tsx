import { KeyboardAvoidingView, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useMemo, type ReactNode } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Alert } from 'heroui-native/alert'
import { Button } from 'heroui-native/button'
import { Dialog } from 'heroui-native/dialog'
import { Spinner } from 'heroui-native/spinner'
import { useAppColors, type ThemeColors } from '@/theme/tokens'
import { actionErrorPresentation } from '@/utils/action-progress'
import { appDialogActionVariant, appDialogMaximumHeight, appDialogVisualContract, type AppDialogActionTone } from './app-dialog-contract'
import { PendingButton } from './PendingButton'

export interface AppDialogAction {
  label: string
  tone: AppDialogActionTone
  onPress(): void
  disabled?: boolean
  loading?: boolean
  testID?: string
}

export function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  actions,
  children,
  error,
  compact = false,
  dismissible = true,
  testID,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  description?: string
  closeLabel: string
  actions: readonly AppDialogAction[]
  children?: ReactNode
  error?: string
  compact?: boolean
  dismissible?: boolean
  testID?: string
}) {
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const insets = useSafeAreaInsets()
  const { height: viewportHeight } = useWindowDimensions()
  const maximumHeight = appDialogMaximumHeight(viewportHeight, insets.top, insets.bottom)
  const contentIdentity = `${title}\0${description ?? ''}\0${actions.map((action) => `${action.tone}:${action.label}`).join('|')}`
  return <Dialog isOpen={open} onOpenChange={(next) => { if (dismissible || next) onOpenChange(next) }}>
    <Dialog.Portal unstable_accessibilityContainerViewIsModal style={[styles.portal, { paddingTop: insets.top + appDialogVisualContract.viewportVerticalPadding, paddingBottom: insets.bottom + appDialogVisualContract.viewportVerticalPadding }]}>
      <Dialog.Overlay variant="blur" isCloseOnPress={dismissible} style={styles.overlay} />
      <KeyboardAvoidingView behavior="padding" pointerEvents="box-none" style={styles.keyboardAvoiding}>
        <Dialog.Content key={contentIdentity} testID={testID} isSwipeable={dismissible} style={[styles.content, { maxHeight: maximumHeight }]}>
          <View style={[styles.contentBody, compact && styles.compactSpacing]}>
            <ScrollView
              bounces={false}
              contentContainerStyle={[styles.scrollContent, compact && styles.compactSpacing]}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator
              style={styles.scroll}
            >
              <View style={[styles.headingRow, compact && styles.compactHeading]}>
                <View style={styles.headingCopy}>
                  <Dialog.Title style={styles.title}>{title}</Dialog.Title>
                  {description ? <Dialog.Description style={styles.description}>{description}</Dialog.Description> : null}
                </View>
                {dismissible ? <Dialog.Close accessibilityLabel={closeLabel} variant="ghost" style={[styles.closeButton, compact && styles.compactClose]} /> : null}
              </View>
              {children}
              {error ? <Alert {...actionErrorPresentation} style={styles.errorAlert}>
                <Alert.Indicator iconProps={{ size: 17 }} />
                <Alert.Content><Alert.Description style={styles.error}>{error}</Alert.Description></Alert.Content>
              </Alert> : null}
            </ScrollView>
            <View style={styles.actions}>
              {actions.map((action) => <PendingButton
                key={`${action.tone}:${action.label}`}
                testID={action.testID}
                size="sm"
                variant={appDialogActionVariant(action.tone)}
                isPending={action.loading}
                isDisabled={action.disabled}
                onPress={action.onPress}
                style={[styles.actionButton, action.tone === 'primary' ? styles.primaryAction : action.tone === 'danger' ? styles.dangerAction : styles.cancelAction, action.disabled && styles.disabledAction]}
              >
                {({ isPending }) => <View style={styles.actionContent}>
                  {isPending ? <View pointerEvents="none" style={styles.actionIndicator}><Spinner color={action.tone === 'cancel' ? colors.text : '#FFFFFF'} size="sm" /></View> : null}
                  <Button.Label style={[styles.actionLabel, action.tone === 'cancel' ? styles.cancelActionLabel : styles.strongActionLabel]}>{action.label}</Button.Label>
                </View>}
              </PendingButton>)}
            </View>
          </View>
        </Dialog.Content>
      </KeyboardAvoidingView>
    </Dialog.Portal>
  </Dialog>
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  portal: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' },
  overlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(9, 14, 29, 0.38)' },
  keyboardAvoiding: { flex: 1, width: '100%', alignItems: 'stretch', justifyContent: 'center', paddingHorizontal: appDialogVisualContract.viewportHorizontalPadding },
  content: { width: '100%', maxWidth: appDialogVisualContract.maxWidth, alignSelf: 'center', overflow: 'hidden', borderRadius: appDialogVisualContract.cornerRadius, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, padding: 0 },
  contentBody: { flexShrink: 1, padding: appDialogVisualContract.contentPadding, gap: appDialogVisualContract.contentGap },
  scroll: { flexShrink: 1 },
  scrollContent: { gap: appDialogVisualContract.contentGap },
  compactSpacing: { gap: 12 },
  compactHeading: { alignItems: 'center' },
  compactClose: { marginVertical: -6, marginRight: -6 },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: appDialogVisualContract.headingGap },
  headingCopy: { minWidth: 0, flex: 1, gap: 6 },
  closeButton: { width: appDialogVisualContract.closeTargetSize, height: appDialogVisualContract.closeTargetSize, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: appDialogVisualContract.titleSize, lineHeight: appDialogVisualContract.titleLineHeight, fontWeight: '900' },
  description: { color: colors.muted, fontSize: appDialogVisualContract.descriptionSize, lineHeight: appDialogVisualContract.descriptionLineHeight },
  errorAlert: { width: '100%' },
  error: { color: colors.danger, fontSize: 11, lineHeight: 17 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: appDialogVisualContract.actionGap },
  actionButton: { height: 'auto', minHeight: appDialogVisualContract.actionMinimumHeight, minWidth: appDialogVisualContract.actionMinimumWidth, flexGrow: 1, flexBasis: appDialogVisualContract.actionMinimumWidth, borderRadius: 10, paddingHorizontal: appDialogVisualContract.actionHorizontalPadding, paddingVertical: appDialogVisualContract.actionVerticalPadding, alignItems: 'center', justifyContent: 'center' },
  actionContent: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  actionIndicator: { position: 'absolute', left: 0, top: 0, bottom: 0, justifyContent: 'center' },
  actionLabel: { width: '100%', lineHeight: appDialogVisualContract.actionLabelLineHeight, includeFontPadding: false, textAlign: 'center', textAlignVertical: 'center' },
  primaryAction: { backgroundColor: colors.accent },
  dangerAction: { backgroundColor: colors.danger },
  cancelAction: { backgroundColor: colors.raised },
  disabledAction: { opacity: 0.45 },
  cancelActionLabel: { color: colors.text, fontWeight: '800' },
  strongActionLabel: { color: '#FFFFFF', fontWeight: '900' },
}) }
