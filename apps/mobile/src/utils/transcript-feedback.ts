export type CodeCopyFeedbackState = 'idle' | 'copying' | 'copied' | 'failed'

export type CodeCopyFeedbackEvent = 'start' | 'succeed' | 'fail' | 'reset'

export const initialCodeCopyFeedbackState: CodeCopyFeedbackState = 'idle'

export interface AssistantMessageBlock {
  kind: 'text' | 'reasoning'
  text: string
}

export const transcriptInteractionContract = {
  loadEarlierMinimumHeight: 44,
  branchMinimumSize: 44,
  disclosureMinimumHeight: 44,
  codeCopyMinimumSize: 44,
  assistantCopyMinimumSize: 44,
} as const

export const transcriptLayoutContract = {
  listPadding: 8,
  listGap: 7,
  messageCardPadding: 9,
  messageCardGap: 6,
  messageCardRadius: 11,
  messageHeaderHeight: 44,
  messageHeaderMarginTop: -8,
  messageHeaderMarginBottom: -6,
  toolCardPadding: 8,
} as const

export interface TranscriptBranchInFlight {
  throughSequence?: number
}

export function transcriptBranchActionState(inFlight: TranscriptBranchInFlight | undefined, throughSequence: number | undefined, available: boolean): { busy: boolean; available: boolean } {
  return {
    busy: Boolean(inFlight) && inFlight?.throughSequence === throughSequence,
    available: available && !inFlight,
  }
}

export function codeCopyFeedbackReducer(state: CodeCopyFeedbackState, event: CodeCopyFeedbackEvent): CodeCopyFeedbackState {
  if (event === 'start') return state === 'copying' ? state : 'copying'
  if (event === 'succeed') return state === 'copying' ? 'copied' : state
  if (event === 'fail') return state === 'copying' ? 'failed' : state
  return state === 'copied' ? 'idle' : state
}

export function assistantMessageCopyText(blocks: readonly AssistantMessageBlock[]): string {
  const answer = blocks.flatMap((block) => block.kind === 'text' ? [block.text] : []).join('')
  return answer.trim() ? answer : ''
}

export function formatTranscriptJson(text: string): string | undefined {
  if (!/^[\s]*[\[{]/.test(text)) return undefined
  try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return undefined }
}
