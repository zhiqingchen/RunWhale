import { router } from 'expo-router'
import { StyleSheet } from 'react-native'
import { Button } from 'heroui-native/button'
import { Plus } from '@/components/icons'
import { AppIcon } from '@/components/AppIcon'
import { useI18n } from '@/i18n'
import { controlSize, typeScale, useAppColors } from '@/theme/tokens'

export function NewProjectButton({ compact = false, disabled = false }: { compact?: boolean; disabled?: boolean }) {
  const { t } = useI18n()
  const colors = useAppColors()
  return <Button size={compact ? 'md' : 'lg'} variant="outline" isDisabled={disabled} onPress={() => router.push('/new')} style={[styles.button, compact ? styles.compact : styles.prominent, { borderColor: colors.accent, backgroundColor: colors.panel }]}>
    <AppIcon icon={Plus} color={colors.accent} size={compact ? 16 : 18} strokeWidth={2.4} /><Button.Label style={[styles.labelText, { color: colors.accent }]}>{t('createProject')}</Button.Label>
  </Button>
}

const styles = StyleSheet.create({
  button: { height: 'auto', paddingVertical: 0, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  compact: { flex: 1, minHeight: controlSize.regular, borderRadius: 12 },
  prominent: { minHeight: controlSize.prominent, borderRadius: 18 },
  labelText: { fontSize: typeScale.button, fontWeight: '900' },
})
