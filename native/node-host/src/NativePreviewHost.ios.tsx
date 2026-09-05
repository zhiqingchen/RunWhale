import { requireNativeViewManager } from 'expo-modules-core'
import type { ViewProps } from 'react-native'

export const NativePreviewHost = requireNativeViewManager<ViewProps>('RunWhaleNodeHost', 'NativePreviewHostView')
