import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Circle, CircleCheck, CircleDot } from '@/components/icons'
import { AppDialog } from '@/components/AppDialog'
import { AppIcon } from '@/components/AppIcon'
import { useI18n } from '@/i18n'
import { type ThemeColors, useAppColors } from '@/theme/tokens'
import type { AgentTodoItem } from '@/utils/agent-todo'

export function AgentTodoDialog({ open, todos, onOpenChange }: {
  open: boolean
  todos: readonly AgentTodoItem[]
  onOpenChange(open: boolean): void
}) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  const completed = todos.filter((todo) => todo.status === 'completed').length

  return <AppDialog
    open={open}
    onOpenChange={onOpenChange}
    title={t('todo')}
    description={t('todoProgress', { completed, total: todos.length })}
    closeLabel={t('close')}
    actions={[{ label: t('close'), tone: 'cancel', onPress: () => onOpenChange(false) }]}
    testID="agent-todo-dialog"
  >
    <View style={styles.list}>{todos.map((todo, index) => {
      const completedItem = todo.status === 'completed'
      const icon = completedItem ? CircleCheck : todo.status === 'in_progress' ? CircleDot : Circle
      const color = completedItem ? colors.accent : todo.status === 'in_progress' ? colors.blue : colors.muted
      return <View key={`${todo.content}:${index}`} style={styles.row}>
        <View style={styles.icon}><AppIcon icon={icon} color={color} size={17} /></View>
        <Text style={[styles.content, completedItem && styles.completed]}>{todo.content}</Text>
      </View>
    })}</View>
  </AppDialog>
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  list: { gap: 9 },
  row: { minHeight: 24, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  icon: { width: 18, height: 22, alignItems: 'center', justifyContent: 'center' },
  content: { minWidth: 0, flex: 1, color: colors.text, fontSize: 12, lineHeight: 20 },
  completed: { color: colors.muted, textDecorationLine: 'line-through' },
}) }
