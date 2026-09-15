import { onboardingEnabled } from '#extensions'
import { Redirect } from 'expo-router'
import { OnboardingScreen } from '@/screens/OnboardingScreen'

export default function OnboardingRoute() {
  return onboardingEnabled ? <OnboardingScreen /> : <Redirect href="/(tabs)" />
}
