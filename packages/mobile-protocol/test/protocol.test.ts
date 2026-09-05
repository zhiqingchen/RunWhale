import { describe, expect, it } from 'vitest'
import {
  EventJournal,
  isMobilePermissionMode,
  MOBILE_HOST_PROTOCOL_VERSION,
  MOBILE_PERMISSION_MODES,
  ProtocolDecodeError,
  decodeClientEnvelope,
} from '../src/index.js'

describe('protocol codec', () => {
  it('keeps protocol v1 as the compatibility sentinel', () => {
    expect(MOBILE_HOST_PROTOCOL_VERSION).toBe(1)
  })

  it('exposes the complete persisted mobile permission mode set', () => {
    expect(MOBILE_PERMISSION_MODES).toEqual(['review', 'read-only', 'danger-full-access'])
    expect(isMobilePermissionMode('danger-full-access')).toBe(true)
    expect(isMobilePermissionMode('full-access')).toBe(false)
  })

  it('rejects oversized and version-mismatched messages', () => {
    expect(() => decodeClientEnvelope('{"v":2}', 100)).toThrow(ProtocolDecodeError)
    expect(() => decodeClientEnvelope('x'.repeat(101), 100)).toThrow(/exceeds/)
  })

  it('rebuilds a cancellation envelope', () => {
    expect(decodeClientEnvelope({
      v: 1,
      type: 'cancel',
      id: 'c1',
      requestId: 'r1',
      ignored: 'value',
    })).toEqual({ v: 1, type: 'cancel', id: 'c1', requestId: 'r1' })
  })
})

describe('event journal', () => {
  it('keeps monotonic sequences while evicting old events', () => {
    const journal = new EventJournal({ maxEvents: 2, maxQueuedBytes: 10_000 })
    journal.append('host.state', { state: 'starting' }, 1)
    journal.append('host.state', { state: 'running' }, 2)
    const third = journal.append('preview.ready', { port: 1 }, 3)
    expect(third.sequence).toBe(3)
    expect(journal.after(0).map(event => event.sequence)).toEqual([2, 3])
    expect(journal.hasGapAfter(0)).toBe(true)
  })
})
