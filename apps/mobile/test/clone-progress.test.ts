import { describe, expect, it } from 'vitest'
import type { HostEvent } from '@runwhale/mobile-protocol'
import { cloneProgressMessageKey, cloneProgressPercent, projectCloneProgressFromEvent } from '../src/utils/clone-progress'

function event(data: unknown, name: HostEvent['name'] = 'project.clone-progress'): HostEvent {
  return { v: 1, type: 'event', sequence: 1, timestamp: 1, name, data }
}

describe('clone progress presentation', () => {
  it('accepts only well-formed clone progress events', () => {
    expect(projectCloneProgressFromEvent(event({ requestId: 'clone-1', phase: 'receiving', loaded: 3, total: 10 }))).toEqual({
      requestId: 'clone-1',
      phase: 'receiving',
      loaded: 3,
      total: 10,
    })
    expect(projectCloneProgressFromEvent(event({ requestId: '', phase: 'receiving', loaded: 3, total: 10 }))).toBeUndefined()
    expect(projectCloneProgressFromEvent(event({ requestId: 'clone-1', phase: 'unknown', loaded: 3, total: 10 }))).toBeUndefined()
    expect(projectCloneProgressFromEvent(event({ requestId: 'clone-1', phase: 'receiving', loaded: -1 }))).toBeUndefined()
    expect(projectCloneProgressFromEvent(event({ requestId: 'clone-1', phase: 'receiving', loaded: 1, total: Number.NaN }))).toBeUndefined()
    expect(projectCloneProgressFromEvent(event({}, 'project.changed'))).toBeUndefined()
  })

  it('derives phase-local percentages without inventing indeterminate totals', () => {
    expect(cloneProgressPercent({ requestId: 'clone-1', phase: 'receiving', loaded: 1, total: 3 })).toBe(33)
    expect(cloneProgressPercent({ requestId: 'clone-1', phase: 'receiving', loaded: 12, total: 10 })).toBe(100)
    expect(cloneProgressPercent({ requestId: 'clone-1', phase: 'receiving', loaded: 0, total: 0 })).toBeUndefined()
    expect(cloneProgressPercent({ requestId: 'clone-1', phase: 'preparing', loaded: 0 })).toBeUndefined()
  })

  it('maps each runtime phase to localized product copy', () => {
    expect(cloneProgressMessageKey('preparing')).toBe('clonePreparingRepository')
    expect(cloneProgressMessageKey('receiving')).toBe('cloneReceivingObjects')
    expect(cloneProgressMessageKey('resolving')).toBe('cloneResolvingDeltas')
    expect(cloneProgressMessageKey('checkout')).toBe('cloneWritingFiles')
    expect(cloneProgressMessageKey('validating')).toBe('cloneValidatingProject')
  })
})
