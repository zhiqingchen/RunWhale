import { describe, expect, it } from 'vitest'
import appConfig from '../app.json'

describe('iPad support', () => {
  it('ships as a universal iPhone and iPad app in every orientation', () => {
    expect(appConfig.expo.ios.supportsTablet).toBe(true)
    expect(appConfig.expo.orientation).toBe('default')
  })
})
