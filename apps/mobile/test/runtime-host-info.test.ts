import { describe, expect, it } from 'vitest'
import { parseRuntimeHostInfo } from '../src/utils/runtime-host-info'

const host = {
  port: 41_001,
  token: 'ephemeral-token',
  origin: 'http://127.0.0.1:41001',
  websocketUrl: 'ws://127.0.0.1:41001/events',
  nodeVersion: '24.19.0',
}

describe('runtime host metadata', () => {
  it('preserves the npm version published by the runtime', () => {
    expect(parseRuntimeHostInfo(JSON.stringify({ ...host, npmVersion: '11.17.0' }))).toEqual({ ...host, npmVersion: '11.17.0' })
  })

  it('accepts host metadata from a runtime that predates npm version publication', () => {
    expect(parseRuntimeHostInfo(JSON.stringify(host))).toEqual(host)
  })

  it('falls back when an optional published npm version is malformed', () => {
    expect(parseRuntimeHostInfo(JSON.stringify({ ...host, npmVersion: '' }))).toEqual(host)
    expect(parseRuntimeHostInfo(JSON.stringify({ ...host, npmVersion: 11 }))).toEqual(host)
  })
})
