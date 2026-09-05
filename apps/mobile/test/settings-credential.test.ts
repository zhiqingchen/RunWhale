import { describe, expect, it } from 'vitest'
import { credentialDraftPersistenceReducer, credentialEditPresentation, credentialEditStatus, credentialLookupPresentation, credentialProviderChangeRequiresDraftDiscard, credentialSaveAnnouncementPending, loadCredentialPresence } from '../src/utils/settings-credential'

describe('Settings credential lookup', () => {
  it('keeps credential mutation blocked while loading and after failure', () => {
    expect(credentialLookupPresentation('loading')).toEqual({
      saved: false,
      mutationReady: false,
      showLoading: true,
      showFailure: false,
      showUnavailable: false,
    })
    expect(credentialLookupPresentation('failed')).toEqual({
      saved: false,
      mutationReady: false,
      showLoading: false,
      showFailure: true,
      showUnavailable: false,
    })
  })

  it('distinguishes permanently unavailable storage from a retryable read failure', () => {
    expect(credentialLookupPresentation('unavailable')).toEqual({
      saved: false,
      mutationReady: false,
      showLoading: false,
      showFailure: false,
      showUnavailable: true,
    })
  })

  it('distinguishes saved and absent credentials without retaining their value', async () => {
    await expect(loadCredentialPresence(async () => 'credential-material')).resolves.toBe('loaded-present')
    await expect(loadCredentialPresence(async () => null)).resolves.toBe('loaded-absent')
    expect(credentialLookupPresentation('loaded-present')).toMatchObject({ saved: true, mutationReady: true })
    expect(credentialLookupPresentation('loaded-absent')).toMatchObject({ saved: false, mutationReady: true })
  })

  it('keeps storage failures distinct from an absent credential', async () => {
    await expect(loadCredentialPresence(async () => { throw new Error('storage unavailable') })).resolves.toBe('failed')
  })

  it('does not claim a replacement draft has already been saved', () => {
    expect(credentialEditStatus(false, '', false)).toBe('none')
    expect(credentialEditStatus(false, 'new-key', false)).toBe('none')
    expect(credentialEditStatus(true, '', false)).toBe('saved')
    expect(credentialEditStatus(true, 'valid-replacement', false)).toBe('replacement-pending')
    expect(credentialEditStatus(true, 'short', false)).toBe('replacement-pending')
    expect(credentialEditStatus(true, 'valid-replacement', true)).toBe('replacement-saving')
    expect(credentialEditStatus(true, 'persisted-but-not-activated', false, true)).toBe('saved')
    expect(credentialEditStatus(true, 'persisted-but-retrying', true, true)).toBe('replacement-saving')
  })

  it('preserves durable replacement state across removal and retry transitions', () => {
    let persisted = credentialDraftPersistenceReducer(false, 'save-activation-failed')
    expect(persisted).toBe(true)
    persisted = credentialDraftPersistenceReducer(persisted, 'removal-opened')
    persisted = credentialDraftPersistenceReducer(persisted, 'removal-cancelled')
    expect(persisted).toBe(true)
    persisted = credentialDraftPersistenceReducer(persisted, 'durable-removal-failed')
    expect(persisted).toBe(true)
    persisted = credentialDraftPersistenceReducer(persisted, 'save-started')
    expect(credentialEditStatus(true, 'persisted-draft', true, persisted)).toBe('replacement-saving')
    persisted = credentialDraftPersistenceReducer(persisted, 'save-persistence-failed')
    expect(persisted).toBe(true)
    persisted = credentialDraftPersistenceReducer(persisted, 'draft-edited')
    expect(persisted).toBe(false)
    persisted = credentialDraftPersistenceReducer(true, 'durable-removal-succeeded')
    expect(persisted).toBe(false)
    expect(credentialDraftPersistenceReducer(true, 'save-succeeded')).toBe(false)
    expect(credentialDraftPersistenceReducer(true, 'context-reset')).toBe(false)
  })

  it('shows only the highest-priority save feedback', () => {
    expect(credentialEditPresentation({ saved: true, draft: 'replacement', saving: false, saveFailed: true })).toMatchObject({
      status: 'replacement-pending',
      replacementFeedback: undefined,
    })
  })

  it('consumes each successful-save announcement exactly once', () => {
    expect(credentialSaveAnnouncementPending(0, 0)).toBe(false)
    expect(credentialSaveAnnouncementPending(1, 0)).toBe(true)
    expect(credentialSaveAnnouncementPending(1, 1)).toBe(false)
    expect(credentialSaveAnnouncementPending(2, 1)).toBe(true)
  })

  it('requires confirmation only when changing provider would discard an unsaved credential draft', () => {
    expect(credentialProviderChangeRequiresDraftDiscard('deepseek', 'openai', 'new-api-key')).toBe(true)
    expect(credentialProviderChangeRequiresDraftDiscard('deepseek', 'deepseek', 'new-api-key')).toBe(false)
    expect(credentialProviderChangeRequiresDraftDiscard('deepseek', 'openai', '   ')).toBe(false)
    expect(credentialProviderChangeRequiresDraftDiscard('deepseek', 'openai', 'persisted-key', true)).toBe(false)
  })
})
