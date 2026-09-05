import { describe, expect, it } from 'vitest'
import { isHumanAgentMessage, lastHumanUserPrompt } from '../src/utils/agent-message'

function message(text: string, source?: Record<string, unknown>) {
  return { content: [{ type: 'text', text }], ...(source ? { source } : {}) }
}

describe('agent message classification', () => {
  it('uses typed sources instead of interpreting human message text', () => {
    expect(isHumanAgentMessage(message('<system-reminder>literal user text</system-reminder>', { kind: 'user' }))).toBe(true)
    expect(isHumanAgentMessage(message('catalog without a legacy prefix', { kind: 'skill-catalog' }))).toBe(false)
  })

  it('keeps the legacy prefix fallback for records without source metadata', () => {
    expect(isHumanAgentMessage(message('ordinary legacy prompt'))).toBe(true)
    expect(isHumanAgentMessage(message('  <system-reminder>internal</system-reminder>'))).toBe(false)
  })

  it('retries the latest human prompt instead of a later injected reminder', () => {
    const events = [
      { type: 'user/message', data: message('Fix the project', { kind: 'user' }) },
      { type: 'user/message', data: message('Current runtime context. Internal.', { kind: 'plugin', plugin: 'runtime' }) },
      { type: 'user/message', data: message('<system-reminder>skills</system-reminder>', { kind: 'skill-catalog' }) },
    ]
    expect(lastHumanUserPrompt(events)).toBe('Fix the project')
  })

  it('supports nested portable message payloads', () => {
    const events = [{ type: 'user/message', data: { message: message('Continue', { kind: 'user' }) } }]
    expect(lastHumanUserPrompt(events)).toBe('Continue')
  })
})
