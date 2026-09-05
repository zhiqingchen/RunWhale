export type CredentialLookupState = 'loading' | 'loaded-present' | 'loaded-absent' | 'failed' | 'unavailable'

export interface CredentialLookupPresentation {
  saved: boolean
  mutationReady: boolean
  showLoading: boolean
  showFailure: boolean
  showUnavailable: boolean
}

export type CredentialEditStatus = 'none' | 'saved' | 'replacement-pending' | 'replacement-saving'

export interface CredentialEditPresentation {
  status: CredentialEditStatus
  showSaved: boolean
  replacementFeedback?: 'pending' | 'saving'
}

export type CredentialDraftPersistenceEvent =
  | 'context-reset'
  | 'draft-edited'
  | 'save-started'
  | 'save-succeeded'
  | 'save-persistence-failed'
  | 'save-activation-failed'
  | 'removal-opened'
  | 'removal-cancelled'
  | 'durable-removal-succeeded'
  | 'durable-removal-failed'

export function credentialLookupPresentation(state: CredentialLookupState): CredentialLookupPresentation {
  return {
    saved: state === 'loaded-present',
    mutationReady: state === 'loaded-present' || state === 'loaded-absent',
    showLoading: state === 'loading',
    showFailure: state === 'failed',
    showUnavailable: state === 'unavailable',
  }
}

export function credentialEditStatus(saved: boolean, draft: string, saving: boolean, draftAlreadySaved = false): CredentialEditStatus {
  if (!saved) return 'none'
  if (draft.length === 0) return 'saved'
  if (saving) return 'replacement-saving'
  return draftAlreadySaved ? 'saved' : 'replacement-pending'
}

export function credentialEditPresentation({
  saved,
  draft,
  saving,
  draftAlreadySaved = false,
  saveFailed = false,
}: {
  saved: boolean
  draft: string
  saving: boolean
  draftAlreadySaved?: boolean
  saveFailed?: boolean
}): CredentialEditPresentation {
  const status = credentialEditStatus(saved, draft, saving, draftAlreadySaved)
  const replacementFeedback = !saveFailed && status === 'replacement-pending'
    ? 'pending'
    : status === 'replacement-saving' ? 'saving' : undefined
  return {
    status,
    showSaved: status === 'saved',
    replacementFeedback,
  }
}

export function credentialDraftPersistenceReducer(current: boolean, event: CredentialDraftPersistenceEvent): boolean {
  if (event === 'save-activation-failed') return true
  if (event === 'context-reset' || event === 'draft-edited' || event === 'save-succeeded' || event === 'durable-removal-succeeded') return false
  return current
}

export function credentialSaveAnnouncementPending(completionToken: number, lastAnnouncedToken: number): boolean {
  return completionToken > 0 && completionToken !== lastAnnouncedToken
}

export function credentialProviderChangeRequiresDraftDiscard(
  currentProvider: string,
  nextProvider: string,
  draft: string,
  draftAlreadySaved = false,
): boolean {
  return currentProvider !== nextProvider && draft.trim().length > 0 && !draftAlreadySaved
}

export async function loadCredentialPresence(read: () => Promise<string | null>): Promise<Exclude<CredentialLookupState, 'loading'>> {
  try {
    return await read() ? 'loaded-present' : 'loaded-absent'
  } catch {
    return 'failed'
  }
}
