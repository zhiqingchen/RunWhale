import { Image } from 'expo-image'
import { useState } from 'react'
import { Text, View, type StyleProp, type ImageStyle } from 'react-native'
import type { StudioProject } from '@/state/project-data'
import { useAppColors } from '@/theme/tokens'

export function ProjectIcon({ project, size = 36, borderRadius = size * 0.24, style }: { project: Pick<StudioProject, 'id' | 'name' | 'icon'>; size?: number; borderRadius?: number; style?: StyleProp<ImageStyle> }) {
  const colors = useAppColors()
  const [failedVersion, setFailedVersion] = useState<string>()
  const version = project.icon ? `${project.icon.uri}:${project.icon.version}` : undefined
  const shape = { width: size, height: size, borderRadius, flexShrink: 0 as const }
  if (project.icon && failedVersion !== version) return <Image
    testID={`project-icon-${project.id}`}
    source={{ uri: project.icon.uri, cacheKey: version }} recyclingKey={version}
    contentFit="cover" style={[shape, style]} onError={() => setFailedVersion(version)}
  />
  return <View style={[shape, { backgroundColor: colors.accentDeep, alignItems: 'center', justifyContent: 'center' }, style]}>
    <Text style={{ color: colors.accent, fontSize: size * 0.46, fontWeight: '700' }}>{Array.from(project.name.trim())[0]?.toUpperCase() ?? '?'}</Text>
  </View>
}
