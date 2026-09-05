import { AppIcon } from '@/components/AppIcon'
import { X } from '@/components/icons'
import { useI18n } from '@/i18n'
import { type ThemeColors, useAppColors } from '@/theme/tokens'
import { useMemo } from 'react'
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native'
import { Button } from 'heroui-native/button'

export function ImageLightbox({ uri, name, onClose }: { uri?: string; name: string; onClose(): void }) {
  const { t } = useI18n()
  const colors = useAppColors()
  const styles = useMemo(() => createStyles(colors), [colors])
  if (!uri) return null
  return <Modal visible transparent animationType="fade" presentationStyle="overFullScreen" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.root}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('close')} onPress={onClose} style={StyleSheet.absoluteFill} />
      <Image accessibilityLabel={name} source={{ uri }} resizeMode="contain" style={styles.image} />
      <Button isIconOnly size="sm" variant="ghost" accessibilityLabel={t('close')} onPress={onClose} style={styles.close}>
        <AppIcon icon={X} color={colors.text} size={20} />
      </Button>
    </View>
  </Modal>
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 54, backgroundColor: 'rgba(6, 10, 20, 0.94)' },
  image: { width: '100%', height: '100%' },
  close: { position: 'absolute', top: 48, right: 18, width: 44, height: 44, paddingHorizontal: 0, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.panel },
}) }
