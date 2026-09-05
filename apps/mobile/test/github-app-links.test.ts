import { describe, expect, it } from 'vitest'
import appConfig from '../app.json'

describe('GitHub share native link configuration', () => {
  it('claims only the RunWhale share path on iOS and Android', () => {
    expect(appConfig.expo.ios.entitlements['com.apple.developer.associated-domains']).toContain('applinks:share.runwhale.dev')
    expect(appConfig.expo.android.intentFilters).toContainEqual({
      action: 'VIEW',
      autoVerify: true,
      data: [{ scheme: 'https', host: 'share.runwhale.dev', pathPrefix: '/g/' }],
      category: ['BROWSABLE', 'DEFAULT'],
    })
  })

  it('integrates expo-camera for developer Native Preview without an in-app scanner route', () => {
    expect(appConfig.expo.plugins).toContainEqual([
      'expo-camera',
      expect.objectContaining({
        cameraPermission: 'Allow RunWhale previews and attachments to use the camera.',
      }),
    ])
  })

  it('fully enables audio and video capabilities for Native Preview', () => {
    expect(appConfig.expo.plugins).toContainEqual([
      'expo-audio',
      {
        microphonePermission: 'Allow RunWhale previews to record audio.',
        recordAudioAndroid: true,
        enableBackgroundRecording: true,
        enableBackgroundPlayback: true,
      },
    ])
    expect(appConfig.expo.plugins).toContainEqual([
      'expo-video',
      {
        supportsBackgroundPlayback: true,
        supportsPictureInPicture: true,
      },
    ])
  })
})
