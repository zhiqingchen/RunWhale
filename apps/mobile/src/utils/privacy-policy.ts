import { Alert, Linking } from 'react-native'

export const PRIVACY_POLICY_URL = 'https://runwhale.dev/privacy'
export const SUPPORT_URL = 'https://runwhale.dev/support'
export const SUPPORT_EMAIL = 'runwhale@runwhale.dev'

export async function openPrivacyPolicy(errorMessage: string) {
  try { await Linking.openURL(PRIVACY_POLICY_URL) }
  catch { Alert.alert(errorMessage) }
}
