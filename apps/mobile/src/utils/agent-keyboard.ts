import { agentPanelInteractionContract } from './agent-panel-layout'

export const AGENT_COMPOSER_BASE_PADDING = agentPanelInteractionContract.composerBaseBottomPadding
export const AGENT_QUESTION_KEYBOARD_CLEARANCE = 72
export const AGENT_IOS_QUESTION_KEYBOARD_CLEARANCE = agentPanelInteractionContract.minimumTouchTarget * 4
export const AGENT_QUESTION_KEYBOARD_REVEAL_DELTA = 72
export const AGENT_IOS_QUESTION_KEYBOARD_REVEAL_DELTA = 200
export const AGENT_QUESTION_KEYBOARD_REVEAL_DELAY_MS = 600

export function agentKeyboardDismissMode(platform: string): 'interactive' | 'on-drag' {
  return platform === 'ios' ? 'interactive' : 'on-drag'
}

export function agentKeyboardOverlap(windowHeight: number, keyboardScreenY: number): number {
  return Math.max(0, windowHeight - keyboardScreenY)
}

export function agentComposerBottomPadding(safeAreaBottom: number, keyboardVisible: boolean): number {
  return AGENT_COMPOSER_BASE_PADDING + (keyboardVisible ? 0 : Math.max(0, safeAreaBottom))
}

export function agentQuestionKeyboardClearance(platform: string): number {
  return platform === 'ios' ? AGENT_IOS_QUESTION_KEYBOARD_CLEARANCE : AGENT_QUESTION_KEYBOARD_CLEARANCE
}

export function agentQuestionKeyboardRevealOffset(platform: string): number {
  // The question footer is measured from the inverted list's fixed bottom edge.
  return platform === 'ios' ? AGENT_IOS_QUESTION_KEYBOARD_REVEAL_DELTA : AGENT_QUESTION_KEYBOARD_REVEAL_DELTA
}
