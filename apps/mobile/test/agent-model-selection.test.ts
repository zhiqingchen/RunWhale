import { describe, expect, it } from 'vitest'
import { agentModelSelectorContract, agentModelSelectorWidth, isMobileModelProvider } from '../src/utils/agent-model-selection'

describe('two-level Agent model selection', () => {
  it('keeps the combined trigger compact on narrow and wide screens', () => {
    expect(agentModelSelectorWidth(390)).toBe(164)
    expect(agentModelSelectorWidth(240)).toBe(101)
    expect(agentModelSelectorWidth(180)).toBe(agentModelSelectorContract.minimumWidth)
    expect(agentModelSelectorWidth(60)).toBe(60)
    expect(agentModelSelectorWidth(800)).toBe(agentModelSelectorContract.maximumWidth)
  })

  it('recognizes supported model providers', () => {
    expect(isMobileModelProvider('openai')).toBe(true)
    expect(isMobileModelProvider('unknown')).toBe(false)
  })
})
