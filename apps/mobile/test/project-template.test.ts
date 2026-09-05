import { describe, expect, it } from 'vitest'
import { createProjectDraft, projectTemplateFiles } from '../src/state/project-data'
import { projectPreviewConfiguration } from '../src/utils/project-preview'

describe('project templates', () => {
  it('creates a runnable Web project selected for Web Preview', () => {
    const files = projectTemplateFiles('web-project', 'Web Project', 'web')
    const manifest = JSON.parse(files.find((file) => file.path === 'runwhale.json')!.content) as Record<string, unknown>
    const packageJson = JSON.parse(files.find((file) => file.path === 'package.json')!.content) as Record<string, unknown>
    expect(manifest).toMatchObject({ entry: { web: 'src/main.tsx' }, preview: { target: 'web' } })
    expect(packageJson).toMatchObject({ scripts: { start: 'vite', build: 'vite build' }, devDependencies: { vite: '8.2.2' } })
    expect(files.map((file) => file.path)).toEqual(expect.arrayContaining(['index.html', 'src/main.tsx', 'README.md']))
    expect(files.find((file) => file.path === 'index.html')?.content).toContain('src="/src/main.tsx"')
    const entry = files.find((file) => file.path === 'src/main.tsx')?.content
    expect(entry).toContain('Hello RunWhale')
    expect(entry).toContain("color: '#ffffff'")
    expect(entry).not.toContain('Start building')
    expect(files.find((file) => file.path === 'README.md')?.content).toContain('npm install\nnpm start')
    expect(projectPreviewConfiguration({ id: 'web-project', name: 'Web Project', description: '', updatedAt: 1, files }, 'android')).toEqual({ target: 'web', platform: 'web' })
  })

  it('creates a runnable Expo project selected for Native Preview', () => {
    const files = projectTemplateFiles('expo-project', 'Expo Project', 'expo')
    const manifest = JSON.parse(files.find((file) => file.path === 'runwhale.json')!.content) as Record<string, unknown>
    const packageJson = JSON.parse(files.find((file) => file.path === 'package.json')!.content) as Record<string, unknown>
    const appJson = JSON.parse(files.find((file) => file.path === 'app.json')!.content) as Record<string, unknown>
    expect(manifest).toMatchObject({
      entry: { android: 'index.tsx', ios: 'index.tsx' },
      preview: { target: 'native' },
    })
    expect(packageJson).toMatchObject({ main: 'index.tsx', scripts: { start: 'expo start', android: 'expo start --android', ios: 'expo start --ios' }, dependencies: { '@shopify/react-native-skia': '2.6.2', expo: '57.0.19', 'expo-haptics': '57.0.2', 'react-native': '0.86.3' } })
    expect(appJson).toEqual({ expo: { name: 'Expo Project', slug: 'expo-project', platforms: ['ios', 'android'], plugins: [['expo-sensors', { motionPermission: 'Allow this RunWhale preview to use motion sensors.' }]], android: { blockedPermissions: ['android.permission.ACTIVITY_RECOGNITION'] } } })
    const entry = files.find((file) => file.path === 'index.tsx')?.content
    expect(entry).toContain('Hello RunWhale')
    expect(entry).toContain("color: '#ffffff'")
    expect(entry).toContain("AppRegistry.registerComponent('main'")
    expect(entry).not.toContain('Scrollable row')
    expect(files.find((file) => file.path === 'README.md')?.content).toContain('npm install\nnpm start')
    expect(projectPreviewConfiguration({ id: 'expo-project', name: 'Expo Project', description: '', updatedAt: 1, files }, 'ios')).toEqual({ target: 'native', platform: 'ios' })
  })

  it('records template provenance only on projects created from a template', () => {
    expect(createProjectDraft('Web Project', 'web', 'web-project').template).toBe('web')
    expect(createProjectDraft('Expo Project', 'expo', 'expo-project').template).toBe('expo')
  })
})
