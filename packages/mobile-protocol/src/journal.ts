import {
  DEFAULT_PROTOCOL_LIMITS,
  MOBILE_HOST_PROTOCOL_VERSION,
  type HostEvent,
  type HostEventName,
} from './types.js'
import { encodedBytes } from './codec.js'

export class EventJournal {
  private events: HostEvent[] = []
  private bytes = 0
  private sequence = 0

  constructor(
    private readonly limits: { maxEvents: number; maxQueuedBytes: number } = DEFAULT_PROTOCOL_LIMITS,
  ) {}

  get lastSequence(): number {
    return this.sequence
  }

  append<T>(name: HostEventName, data: T, timestamp = Date.now()): HostEvent<T> {
    const event: HostEvent<T> = {
      v: MOBILE_HOST_PROTOCOL_VERSION,
      type: 'event',
      sequence: ++this.sequence,
      timestamp,
      name,
      data,
    }
    const size = encodedBytes(event)
    if (size > this.limits.maxQueuedBytes) {
      throw new RangeError(`event exceeds journal byte limit: ${size}`)
    }
    this.events.push(event)
    this.bytes += size
    while (this.events.length > this.limits.maxEvents || this.bytes > this.limits.maxQueuedBytes) {
      const removed = this.events.shift()
      if (removed) this.bytes -= encodedBytes(removed)
    }
    return event
  }

  after(sequence: number): HostEvent[] {
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new RangeError('sequence must be a non-negative integer')
    return this.events.filter(event => event.sequence > sequence)
  }

  hasGapAfter(sequence: number): boolean {
    const first = this.events[0]
    return first !== undefined && sequence < first.sequence - 1
  }

  clear(): void {
    this.events = []
    this.bytes = 0
  }
}
