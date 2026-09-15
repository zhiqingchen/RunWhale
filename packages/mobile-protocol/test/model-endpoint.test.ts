import { describe, expect, it } from 'vitest'
import { parseMobileModelEndpoint } from '../src/model-endpoint.js'

describe('model endpoint transport', () => {
  it.each([
    'https://provider.example/v1',
    'http://127.0.0.1:8000/v1',
    'http://[::1]:8000/v1',
    'http://localhost:8000/v1',
  ])('accepts HTTPS and on-device development: %s', (url) => {
    expect(parseMobileModelEndpoint(url).href).toBe(url)
  })

  it.each([
    'http://provider.example/v1',
    'http://192.168.1.2:8000/v1',
    'http://localhost.provider.example/v1',
    'http://0.0.0.0:8000/v1',
    'file:///private/models',
    'https://fixture-secret@provider.example/v1',
    'https://provider.example/v1?key=fixture-secret',
    'https://provider.example/v1#fixture-secret',
    'fixture-secret',
  ])('rejects insecure or credential-bearing endpoints without echoing input: %s', (url) => {
    expect(() => parseMobileModelEndpoint(url)).toThrow(/Model endpoint/)
    try { parseMobileModelEndpoint(url) } catch (error) {
      expect(String(error)).not.toContain('fixture-secret')
      expect(String(error)).not.toContain(url)
    }
  })
})
