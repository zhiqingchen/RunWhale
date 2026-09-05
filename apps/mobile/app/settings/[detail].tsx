import { Redirect, useLocalSearchParams } from 'expo-router'
import { SettingsDetailScreen } from '@/screens/settings/SettingsDetailScreen'
import { isSettingsDetail, settingsHomeRoute } from '@/utils/settings-routes'

export default function SettingsDetailRoute() {
  const params = useLocalSearchParams<{ detail?: string | string[] }>()
  const detail = Array.isArray(params.detail) ? params.detail[0] : params.detail
  if (!isSettingsDetail(detail)) return <Redirect href={settingsHomeRoute} />
  return <SettingsDetailScreen detail={detail} />
}
