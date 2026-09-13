import { Button } from 'heroui-native/button'
import { AppIcon } from '@/components/AppIcon'
import { ArrowLeft } from '@/components/icons'
import { useI18n } from '@/i18n'
import { useAppColors } from '@/theme/tokens'

export function PageBackButton({ onPress, label }: { onPress(): void; label?: string }) {
  const { t } = useI18n()
  const colors = useAppColors()
  return <Button
    isIconOnly
    size="sm"
    variant="ghost"
    accessibilityRole="button"
    accessibilityLabel={label ?? t('back')}
    onPress={onPress}
    style={{ width: 44, height: 44, paddingHorizontal: 0, alignItems: 'center', justifyContent: 'center' }}
  ><AppIcon icon={ArrowLeft} color={colors.accent} size={21} /></Button>
}
