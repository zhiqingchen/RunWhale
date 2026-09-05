import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Button } from 'heroui-native/button'
import { TranscriptDetailsSheet } from './TranscriptDetailsSheet'
import { Spinner } from 'heroui-native/spinner'
import { AppIcon } from '@/components/AppIcon'
import { TranscriptCodeBlock } from '@/components/TranscriptCodeBlock'
import { ChevronRight, CircleCheck, CircleX, Square } from '@/components/icons'
import { useI18n } from '@/i18n'
import { type ThemeColors, useAppColors } from '@/theme/tokens'
import type { ToolActivityGroup, ToolActivityItem, ToolActivityState } from '@/utils/tool-activity'
import { toolActivityDialogContract, toolActivityDialogSelectionReducer, type ToolActivityDialogSelection } from './tool-activity-dialog-contract'

export function ToolActivityDialog({
  open,
  onOpenChange,
  activity,
  initialItemId,
  testID,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  activity?: ToolActivityGroup
  initialItemId?: string
  testID?: string
}) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const items = activity?.items ?? []
  const activityId = activity?.id
  const initialSelectedItemId = initialItemId && items.some((item) => item.id === initialItemId) ? initialItemId : undefined
  const [selection, setSelection] = useState<ToolActivityDialogSelection>({})
  const selectedItemId = items.length === 1 ? items[0]?.id : selection.activityId === activityId ? selection.itemId : initialSelectedItemId
  const selectedItem = selectedItemId ? items.find((item) => item.id === selectedItemId) : undefined
  const countLabel = t(items.length === 1 ? 'toolActivityCountSingular' : 'toolActivityCount', { count: items.length })

  useEffect(() => {
    setSelection((current) => toolActivityDialogSelectionReducer(current, {
      type: 'sync',
      open,
      ...(activityId ? { activityId } : {}),
      ...(initialSelectedItemId ? { initialItemId: initialSelectedItemId } : {}),
    }))
  }, [activityId, initialSelectedItemId, open])

  const title = selectedItem ? displayToolName(selectedItem, t('unknownTool')) : `${t('toolActivity')} · ${countLabel}`

  return <TranscriptDetailsSheet open={open} onOpenChange={onOpenChange} title={title} testID={testID}
    onBack={selectedItem && items.length > 1 ? () => { if (activityId) setSelection(current => toolActivityDialogSelectionReducer(current, { type: 'back', activityId })) } : undefined}>
          {selectedItem
            ? <ToolDetail
                item={selectedItem}
                noOutputLabel={t('noOutput')}
                inputLabel={t('toolInput')}
                outputLabel={t('toolOutput')}
                errorLabel={t('toolError')}
                metadataLabel={t('toolMetadata')}
                copyLabel={t('copy')}
                copiedLabel={t('copied')}
                copyFailedLabel={t('codeCopyFailed')}
                statusLabel={toolActivityStatusLabel(selectedItem.state, t)}
                colors={colors}
                styles={styles}
                testID={testID ? `${testID}-detail` : undefined}
              />
            : <ScrollView
                testID={testID ? `${testID}-list` : undefined}
                bounces={false}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
                style={styles.scroll}
                contentContainerStyle={styles.list}
              >
                {items.length === 0 ? <Text style={styles.empty}>{t('noOutput')}</Text> : items.map((item) => {
                  const name = displayToolName(item, t('unknownTool'))
                  const statusLabel = toolActivityStatusLabel(item.state, t)
                  const summary = item.state === 'failed' ? conciseValue(item.error) : item.target
                  return <Button
                    key={item.id}
                    size="sm"
                    variant="ghost"
                    accessibilityLabel={[name, statusLabel, summary].filter(Boolean).join(', ')}
                    accessibilityHint={t('details')}
                    onPress={() => { if (activityId) setSelection((current) => toolActivityDialogSelectionReducer(current, { type: 'select', activityId, itemId: item.id })) }}
                    testID={testID ? `${testID}-item-${item.id}` : undefined}
                    style={[styles.toolRow, item.state === 'running' && styles.runningToolRow, item.state === 'failed' && styles.failedToolRow]}
                  >
                    <ToolStatusMark state={item.state} colors={colors} styles={styles} />
                    <View style={styles.toolCopy}>
                      <View style={styles.toolTitleRow}>
                        <Text numberOfLines={1} style={styles.toolName}>{name}</Text>
                      </View>
                      {summary ? <Text numberOfLines={2} style={[styles.toolSummary, item.state === 'failed' && styles.dangerText]}>{summary}</Text> : null}
                    </View>
                    <AppIcon icon={ChevronRight} color={colors.muted} size={16} />
                  </Button>
                })}
              </ScrollView>}
  </TranscriptDetailsSheet>
}

function ToolDetail({ item, noOutputLabel, inputLabel, outputLabel, errorLabel, metadataLabel, copyLabel, copiedLabel, copyFailedLabel, statusLabel, colors, styles, testID }: {
  item: ToolActivityItem
  noOutputLabel: string
  inputLabel: string
  outputLabel: string
  errorLabel: string
  metadataLabel: string
  copyLabel: string
  copiedLabel: string
  copyFailedLabel: string
  statusLabel: string
  colors: ThemeColors
  styles: ReturnType<typeof createStyles>
  testID?: string
}) {
  return <ScrollView
    testID={testID}
    bounces={false}
    nestedScrollEnabled
    keyboardShouldPersistTaps="handled"
    showsVerticalScrollIndicator
    style={styles.scroll}
    contentContainerStyle={styles.detail}
  >
    <View accessible accessibilityLabel={statusLabel} style={[styles.detailOverview, item.state === 'failed' && styles.failedOverview]}>
      <ToolStatusMark state={item.state} colors={colors} styles={styles} />
      <View style={styles.detailOverviewCopy}>
        {item.state === 'failed' && conciseValue(item.error)
          ? <Text selectable style={[styles.detailTarget, styles.dangerText]}>{conciseValue(item.error)}</Text>
          : item.target ? <Text selectable style={styles.detailTarget}>{item.target}</Text> : null}
      </View>
    </View>
    {item.input !== undefined ? <DetailSection title={inputLabel} value={item.input} fallback={noOutputLabel} toolName={item.name} copyLabel={copyLabel} copiedLabel={copiedLabel} copyFailedLabel={copyFailedLabel} styles={styles} /> : null}
    <DetailSection title={outputLabel} value={item.output} fallback={noOutputLabel} toolName={item.name} copyLabel={copyLabel} copiedLabel={copiedLabel} copyFailedLabel={copyFailedLabel} styles={styles} />
    {item.error !== undefined ? <DetailSection title={errorLabel} value={item.error} fallback={noOutputLabel} toolName={item.name} copyLabel={copyLabel} copiedLabel={copiedLabel} copyFailedLabel={copyFailedLabel} danger styles={styles} /> : null}
    {item.meta !== undefined ? <DetailSection title={metadataLabel} value={item.meta} fallback={noOutputLabel} toolName={item.name} copyLabel={copyLabel} copiedLabel={copiedLabel} copyFailedLabel={copyFailedLabel} styles={styles} /> : null}
  </ScrollView>
}

function DetailSection({ title, value, fallback, toolName, copyLabel, copiedLabel, copyFailedLabel, danger = false, styles }: {
  title: string
  value: unknown
  fallback: string
  toolName: string
  copyLabel: string
  copiedLabel: string
  copyFailedLabel: string
  danger?: boolean
  styles: ReturnType<typeof createStyles>
}) {
  const code = formatDetailValue(value, fallback)
  return <View style={styles.section}>
    <Text style={[styles.sectionTitle, danger && styles.dangerText]}>{title}</Text>
    <TranscriptCodeBlock code={code} language={detailLanguage(toolName, code, value)} copyLabel={copyLabel} copiedLabel={copiedLabel} copyFailedLabel={copyFailedLabel} />
  </View>
}

function ToolStatusMark({ state, colors, styles }: { state: ToolActivityState; colors: ThemeColors; styles: ReturnType<typeof createStyles> }) {
  if (state === 'running') return <View pointerEvents="none" style={styles.statusMark}><Spinner color={colors.blue} size="sm" /></View>
  const icon = state === 'succeeded' ? CircleCheck : state === 'failed' ? CircleX : Square
  const color = state === 'succeeded' ? colors.accent : state === 'failed' ? colors.danger : colors.muted
  return <View pointerEvents="none" style={styles.statusMark}><AppIcon icon={icon} color={color} size={17} /></View>
}

function toolActivityStatusLabel(state: ToolActivityState, t: ReturnType<typeof useI18n>['t']): string {
  if (state === 'running') return t('stateRunning')
  if (state === 'failed') return t('stateFailed')
  if (state === 'stopped') return t('stateStopped')
  return t('stateCompleted')
}

function displayToolName(item: ToolActivityItem, fallback: string): string {
  return item.name.trim() || fallback
}

function conciseValue(value: unknown): string | undefined {
  if (typeof value === 'string') return conciseText(value)
  if (value instanceof Error) return conciseText(value.message) ?? value.name
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = conciseValue(item)
      if (candidate) return candidate
    }
    return undefined
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const key of ['message', 'text', 'error', 'reason', 'content']) {
      const candidate = conciseValue(record[key])
      if (candidate) return candidate
    }
  }
  if (value === undefined || value === null) return undefined
  try {
    const serialized = JSON.stringify(value)
    return conciseText(serialized === undefined ? String(value) : serialized)
  } catch {
    return conciseText(String(value))
  }
}

function conciseText(value: string): string | undefined {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) return undefined
  return normalized.length > 240 ? `${normalized.slice(0, 239)}…` : normalized
}

function formatDetailValue(value: unknown, fallback: string): string {
  if (value === undefined) return fallback
  if (typeof value === 'string') return value || fallback
  if (value instanceof Error) return value.stack || value.message || value.name
  try {
    const serialized = JSON.stringify(value, null, 2)
    return serialized === undefined ? String(value) : serialized
  } catch {
    return String(value)
  }
}

function detailLanguage(toolName: string, code: string, value: unknown): string {
  if (toolName === 'git_diff' || code.startsWith('diff --git')) return 'diff'
  if (typeof value !== 'string') return 'json'
  const trimmed = code.trimStart()
  return trimmed.startsWith('{') || trimmed.startsWith('[') ? 'json' : 'text'
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  scroll: { flex: 1 },
  list: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 16, gap: 4 },
  empty: { color: colors.muted, paddingVertical: 24, textAlign: 'center', fontSize: 11 },
  toolRow: { width: '100%', minHeight: toolActivityDialogContract.toolRowMinimumHeight, height: 'auto', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 11, flexDirection: 'row', alignItems: 'center', gap: 10 },
  runningToolRow: { backgroundColor: colors.accentDeep },
  failedToolRow: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.danger },
  statusMark: { width: 20, minHeight: 20, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  toolCopy: { flex: 1, minWidth: 0, gap: 2 },
  toolTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  toolName: { minWidth: 0, flex: 1, color: colors.text, fontSize: 12, lineHeight: 18, fontWeight: '800' },
  toolSummary: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  dangerText: { color: colors.danger },
  detail: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 18, gap: 14 },
  detailOverview: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.raised },
  failedOverview: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.danger },
  detailOverviewCopy: { flex: 1, minWidth: 0, gap: 2 },
  detailTarget: { color: colors.muted, fontSize: 10, lineHeight: 16 },
  section: { gap: 6 },
  sectionTitle: { color: colors.text, paddingHorizontal: 2, fontSize: 10, lineHeight: 15, letterSpacing: 0.5, fontWeight: '900', textTransform: 'uppercase' },
}) }
