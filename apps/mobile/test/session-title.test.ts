import { describe, expect, it } from 'vitest'
import { firstPromptSessionTitle, shouldInitializeSessionTitle } from '../src/utils/session-actions'

describe('session title', () => {
  it('uses the same five-word and 40-byte fallback limits as DeepSeek Harness', () => {
    expect(firstPromptSessionTitle('Build a polished drawing app with layers')).toBe('Build a polished drawing app')
    expect(firstPromptSessionTitle('请帮我实现一个可以拖动和缩放的画布')).toBe('请帮我实现一个可以拖动和缩')
  })

  it('only replaces an empty placeholder session', () => {
    const session = { sessionId: 'session-1', projectId: 'project-1', title: 'New session', updatedAt: 1, state: 'idle', turnCount: 0, eventCount: 0, preview: '' } as const
    expect(shouldInitializeSessionTitle(session, 'New session')).toBe(true)
    expect(shouldInitializeSessionTitle({ ...session, eventCount: 1 }, 'New session')).toBe(false)
    expect(shouldInitializeSessionTitle({ ...session, title: 'Pinned title' }, 'New session')).toBe(false)
  })
})
