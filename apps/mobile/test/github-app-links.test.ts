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

  it('integrates expo-camera for developer Preview without an in-app scanner route', () => {
    expect(appConfig.expo.plugins).toContainEqual([
      'expo-camera',
      expect.objectContaining({
        cameraPermission: 'RunWhale uses the camera to take photos for Agent attachments and to test camera features in projects you run in Preview.',
      }),
    ])
  })

  it('enables foreground audio and video without declaring background media capabilities', () => {
    expect(appConfig.expo.plugins).toContainEqual([
      'expo-audio',
      {
        microphonePermission: 'RunWhale uses the microphone to test audio recording in projects you run in Preview, such as a voice recorder.',
        recordAudioAndroid: true,
        enableBackgroundRecording: false,
        enableBackgroundPlayback: false,
      },
    ])
    expect(appConfig.expo.plugins).toContainEqual([
      'expo-video',
      {
        supportsBackgroundPlayback: false,
        supportsPictureInPicture: false,
      },
    ])
  })

  it('limits location to foreground use and omits contacts access', () => {
    expect(appConfig.expo.plugins).toContainEqual([
      'expo-location',
      expect.objectContaining({
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
      }),
    ])
    expect(appConfig.expo.plugins.some((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-contacts')).toBe(false)
    expect(appConfig.expo.android.blockedPermissions).toEqual(expect.arrayContaining([
      'android.permission.READ_CONTACTS',
      'android.permission.WRITE_CONTACTS',
    ]))
  })
})
