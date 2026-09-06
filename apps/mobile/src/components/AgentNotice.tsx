import { AppIcon } from '@/components/AppIcon'
import { CircleX, PlugZap } from '@/components/icons'
import { useAppColors } from '@/theme/tokens'
import { StyleSheet, Text, View } from 'react-native'

export function AgentNotice({ message, connection = false }: { message: string; connection?: boolean }) {
  const colors = useAppColors()
  const tone = connection ? colors.muted : colors.danger
  return <View accessibilityRole="alert" accessibilityLiveRegion={connection ? 'polite' : 'assertive'} style={[styles.card, { backgroundColor: colors.panel, borderColor: colors.border }]}>
    <View style={styles.icon}><AppIcon icon={connection ? PlugZap : CircleX} color={tone} size={17} /></View>
    <Text selectable style={[styles.message, { color: tone }]}>{message}</Text>
  </View>
}

const styles = StyleSheet.create({
  card: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderRadius: 12 },
  icon: { paddingTop: 1, flexShrink: 0 },
  message: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18 },
})
