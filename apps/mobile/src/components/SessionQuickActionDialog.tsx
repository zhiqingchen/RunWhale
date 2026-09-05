import { useMemo } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { SlideInDown, SlideOutDown } from 'react-native-reanimated'
import { Button } from 'heroui-native/button'
import { Dialog } from 'heroui-native/dialog'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CircleCheck } from '@/components/icons'
import type { LucideIcon } from '@/components/icons'
import { AppIcon } from '@/components/AppIcon'
import { type ThemeColors, useAppColors } from '@/theme/tokens'
import { sessionQuickActionDialogContentHeight, sessionQuickActionDialogContract, sessionQuickActionDialogHeight } from './session-quick-action-contract'

export interface SessionQuickActionOption {
  id: string
  label: string
  icon?: LucideIcon
  description?: string
  section?: string
  selected?: boolean
  disabled?: boolean
}

export function SessionQuickActionDialog({
  open,
  onOpenChange,
  title,
  closeLabel,
  options,
  emptyLabel,
  onSelect,
  fitContent = false,
  spacious = false,
  testID,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  closeLabel: string
  options: readonly SessionQuickActionOption[]
  emptyLabel: string
  onSelect(option: SessionQuickActionOption): void
  fitContent?: boolean
  spacious?: boolean
  testID?: string
}) {
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const height = fitContent
    ? sessionQuickActionDialogContentHeight(windowHeight - insets.top, options.length, insets.bottom)
    : sessionQuickActionDialogHeight(windowHeight - insets.top - insets.bottom)
  let previousSection: string | undefined

  return <Dialog isOpen={open} onOpenChange={onOpenChange}>
    <Dialog.Portal unstable_accessibilityContainerViewIsModal style={styles.portal}>
      <Dialog.Overlay isCloseOnPress style={styles.overlay} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents="box-none" style={styles.keyboardAvoiding}>
        <Dialog.Content
          testID={testID}
          isSwipeable={false}
          animation={{ entering: SlideInDown.duration(220), exiting: SlideOutDown.duration(160) }}
          style={[styles.content, { height, paddingBottom: insets.bottom }]}
        >
          <View style={styles.header}>
            <Dialog.Title style={styles.title}>{title}</Dialog.Title>
            <Dialog.Close accessibilityLabel={closeLabel} variant="ghost" style={styles.closeButton} />
          </View>
          <ScrollView
            testID={testID ? `${testID}-options` : undefined}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            style={styles.optionScroll}
            contentContainerStyle={[styles.options, spacious && styles.optionsSpacious]}
          >
            {options.length === 0 ? <Text style={styles.empty}>{emptyLabel}</Text> : options.map((option) => {
              const showSection = Boolean(option.section && option.section !== previousSection)
              previousSection = option.section
              return <View key={option.id}>
                {showSection ? <Text style={styles.section}>{option.section}</Text> : null}
                <Button
                  size="sm"
                  variant={option.selected ? 'secondary' : 'ghost'}
                  accessibilityLabel={option.label}
                  accessibilityHint={option.description}
                  accessibilityState={{ selected: option.selected, disabled: option.disabled }}
                  isDisabled={option.disabled}
                  onPress={() => onSelect(option)}
                  style={[styles.option, spacious && styles.optionSpacious, option.selected && styles.optionSelected]}
                >
                  {option.icon ? <View style={[styles.optionIcon, spacious && styles.optionIconSpacious]}><AppIcon icon={option.icon} color={colors.text} size={spacious ? 20 : 18} /></View> : null}
                  <View style={styles.optionCopy}>
                    <Button.Label numberOfLines={2} style={[styles.optionLabel, spacious && styles.optionLabelSpacious]}>{option.label}</Button.Label>
                    {option.description ? <Text numberOfLines={3} style={styles.optionDescription}>{option.description}</Text> : null}
                  </View>
                  {option.selected ? <AppIcon icon={CircleCheck} color={colors.accent} size={17} /> : null}
                </Button>
              </View>
            })}
          </ScrollView>
        </Dialog.Content>
      </KeyboardAvoidingView>
    </Dialog.Portal>
  </Dialog>
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  portal: { position: 'absolute', inset: 0 },
  overlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(9, 14, 29, 0.46)' },
  keyboardAvoiding: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', overflow: 'hidden', borderTopLeftRadius: sessionQuickActionDialogContract.cornerRadius, borderTopRightRadius: sessionQuickActionDialogContract.cornerRadius, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, backgroundColor: colors.panel, padding: 0 },
  header: { minHeight: sessionQuickActionDialogContract.headerMinimumHeight, paddingLeft: sessionQuickActionDialogContract.headerPaddingLeft, paddingRight: sessionQuickActionDialogContract.headerPaddingRight, flexDirection: 'row', alignItems: 'center', gap: sessionQuickActionDialogContract.headerGap, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  title: { minWidth: 0, flex: 1, color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '900' },
  closeButton: { width: sessionQuickActionDialogContract.closeTargetSize, height: sessionQuickActionDialogContract.closeTargetSize, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  optionScroll: { flex: 1 },
  options: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 16 },
  optionsSpacious: { paddingHorizontal: 18, paddingTop: sessionQuickActionDialogContract.spaciousContentPaddingTop, paddingBottom: sessionQuickActionDialogContract.spaciousContentPaddingBottom, gap: sessionQuickActionDialogContract.spaciousOptionGap },
  section: { color: colors.muted, fontSize: 9, lineHeight: 14, letterSpacing: 0.7, fontWeight: '900', paddingHorizontal: 9, paddingTop: 9, paddingBottom: 4 },
  option: { width: '100%', minHeight: sessionQuickActionDialogContract.optionMinimumHeight, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  optionSpacious: { minHeight: sessionQuickActionDialogContract.spaciousOptionMinimumHeight, paddingHorizontal: 12, paddingVertical: 10, gap: 12 },
  optionSelected: { backgroundColor: colors.accentDeep },
  optionIcon: { width: 34, height: 34, flexShrink: 0, borderRadius: 17, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  optionIconSpacious: { width: sessionQuickActionDialogContract.spaciousOptionIconSize, height: sessionQuickActionDialogContract.spaciousOptionIconSize, borderRadius: sessionQuickActionDialogContract.spaciousOptionIconSize / 2 },
  optionCopy: { flex: 1, minWidth: 0, gap: 2 },
  optionLabel: { color: colors.text, fontSize: 12, lineHeight: 18, fontWeight: '800' },
  optionLabelSpacious: { fontSize: 13, lineHeight: 20 },
  optionDescription: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  empty: { color: colors.muted, paddingVertical: 24, textAlign: 'center', fontSize: 11 },
}) }
