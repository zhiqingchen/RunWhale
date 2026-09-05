import { Tabs } from 'expo-router'
import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FolderTree, Home, Settings } from '@/components/icons'
import { useAppColors } from '@/theme/tokens'
import { useI18n } from '@/i18n'
import { AppIcon } from '@/components/AppIcon'

export default function TabLayout() {
  const { t } = useI18n()
  const colors = useAppColors()
  const insets = useSafeAreaInsets()

  if (Platform.OS !== 'web') {
    return (
      <NativeTabs
        backgroundColor={colors.panel}
        iconColor={{ default: colors.muted, selected: colors.accent }}
        indicatorColor={colors.accentDeep}
        labelStyle={{ default: { color: colors.muted }, selected: { color: colors.accent } }}
        labelVisibilityMode="labeled"
        sidebarAdaptable
        tintColor={colors.accent}
      >
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon
            sf={{ default: 'house', selected: 'house.fill' }}
            md={{ default: 'home', selected: 'home_filled' }}
          />
          <NativeTabs.Trigger.Label>{t('home')}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="workspace">
          <NativeTabs.Trigger.Icon
            sf={{ default: 'folder', selected: 'folder.fill' }}
            md={{ default: 'folder', selected: 'folder_open' }}
          />
          <NativeTabs.Trigger.Label>{t('workspace')}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="settings">
          <NativeTabs.Trigger.Icon
            sf={{ default: 'gearshape', selected: 'gearshape.fill' }}
            md="settings"
          />
          <NativeTabs.Trigger.Label>{t('settings')}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    )
  }

  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.accent,
      tabBarInactiveTintColor: colors.muted,
      tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      tabBarItemStyle: { minHeight: 52 },
      tabBarStyle: { height: 62 + insets.bottom, paddingTop: 7, paddingBottom: Math.max(insets.bottom, 7), borderTopColor: colors.border, backgroundColor: colors.panel },
    }}>
      <Tabs.Screen name="index" options={{ title: t('home'), tabBarIcon: ({ color }) => <AppIcon icon={Home} color={color} size={20} /> }} />
      <Tabs.Screen name="workspace" options={{ title: t('workspace'), tabBarIcon: ({ color }) => <AppIcon icon={FolderTree} color={color} size={20} /> }} />
      <Tabs.Screen name="settings" options={{ title: t('settings'), tabBarIcon: ({ color }) => <AppIcon icon={Settings} color={color} size={20} /> }} />
    </Tabs>
  )
}
