import {
  DEFAULT_PROTOCOL_LIMITS,
  MOBILE_HOST_PROTOCOL_VERSION,
  type ClientEnvelope,
  type HostEnvelope,
} from './types.js'

const encoder = new TextEncoder()

export class ProtocolDecodeError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_REQUEST' | 'PAYLOAD_TOO_LARGE' = 'INVALID_REQUEST',
  ) {
    super(message)
    this.name = 'ProtocolDecodeError'
  }
}

export function encodedBytes(value: unknown): number {
  return encoder.encode(typeof value === 'string' ? value : JSON.stringify(value)).byteLength
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseWire(input: string | unknown, maxBytes: number): Record<string, unknown> {
  if (encodedBytes(input) > maxBytes) {
    throw new ProtocolDecodeError(`protocol payload exceeds ${maxBytes} bytes`, 'PAYLOAD_TOO_LARGE')
  }
  let value: unknown
  try {
    value = typeof input === 'string' ? JSON.parse(input) : input
  } catch {
    throw new ProtocolDecodeError('protocol payload is not valid JSON')
  }
  if (!isRecord(value)) throw new ProtocolDecodeError('protocol envelope must be an object')
  if (value.v !== MOBILE_HOST_PROTOCOL_VERSION) {
    throw new ProtocolDecodeError(`unsupported protocol version: ${String(value.v)}`)
  }
  return value
}

export function decodeClientEnvelope(
  input: string | unknown,
  maxBytes = DEFAULT_PROTOCOL_LIMITS.maxPayloadBytes,
): ClientEnvelope {
  const value = parseWire(input, maxBytes)
  if (value.type !== 'request' && value.type !== 'cancel') {
    throw new ProtocolDecodeError('client envelope type must be request or cancel')
  }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new ProtocolDecodeError('client envelope id must be a non-empty string')
  }
  if (value.type === 'cancel') {
    if (typeof value.requestId !== 'string' || value.requestId.length === 0) {
      throw new ProtocolDecodeError('cancel requestId must be a non-empty string')
    }
    return {
      v: MOBILE_HOST_PROTOCOL_VERSION,
      type: 'cancel',
      id: value.id,
      requestId: value.requestId,
      ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
    }
  }
  if (typeof value.method !== 'string' || !isRecord(value.params)) {
    throw new ProtocolDecodeError('request method and params are required')
  }
  if (value.timeoutMs !== undefined && (!Number.isSafeInteger(value.timeoutMs) || Number(value.timeoutMs) <= 0)) {
    throw new ProtocolDecodeError('timeoutMs must be a positive safe integer')
  }
  return {
    v: MOBILE_HOST_PROTOCOL_VERSION,
    type: 'request',
    id: value.id,
    method: value.method as ClientEnvelope & never,
    params: value.params as never,
    ...(typeof value.timeoutMs === 'number' ? { timeoutMs: value.timeoutMs } : {}),
  } as ClientEnvelope
}

export function decodeHostEnvelope(
  input: string | unknown,
  maxBytes = DEFAULT_PROTOCOL_LIMITS.maxPayloadBytes,
): HostEnvelope {
  const value = parseWire(input, maxBytes)
  if (value.type === 'event') {
    if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) <= 0) {
      throw new ProtocolDecodeError('event sequence must be a positive safe integer')
    }
    if (typeof value.name !== 'string' || typeof value.timestamp !== 'number') {
      throw new ProtocolDecodeError('event name and timestamp are required')
    }
    return value as unknown as HostEnvelope
  }
  if (value.type !== 'response' || typeof value.requestId !== 'string' || typeof value.ok !== 'boolean') {
    throw new ProtocolDecodeError('invalid response envelope')
  }
  if (value.ok === false && !isRecord(value.error)) {
    throw new ProtocolDecodeError('failed response must include an error')
  }
  return value as unknown as HostEnvelope
}
