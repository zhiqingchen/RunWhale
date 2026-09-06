import { describe, expect, it } from 'vitest'
import { isShortcutNameValid, projectIdFromLaunchUrl, projectLaunchUrl } from '../src/utils/project-shortcut'

describe('project Home Screen links', () => {
  it('uses a stable project identity with no runtime endpoint or session', () => {
    const link = projectLaunchUrl('daily-notes')
    expect(link).toBe('runwhale://run/daily-notes')
    expect(projectIdFromLaunchUrl(link)).toBe('daily-notes')
  })

  it.each(['../other', 'a/b', '', 'x', 'notes?token=secret', 'notes#preview', 'a'.repeat(64)])('rejects invalid project identity %s', (id) => {
    expect(() => projectLaunchUrl(id)).toThrow('Invalid project identifier')
  })

  it.each(['runwhale://workspace/daily-notes', 'https://run/daily-notes', 'runwhale://run/daily-notes/other', 'runwhale://user@run/daily-notes', 'runwhale://run/%2e%2e', 'invalid'])('does not relaunch for unrelated links %s', (url) => {
    expect(projectIdFromLaunchUrl(url)).toBeUndefined()
  })
})

describe('shortcut names', () => {
  it('accepts trimmed names and localized names', () => {
    expect(isShortcutNameValid('  Daily notes  ')).toBe(true)
    expect(isShortcutNameValid('我的记账本')).toBe(true)
  })

  it.each(['   ', 'App\nname', 'a'.repeat(41)])('rejects unusable labels', (name) => {
    expect(isShortcutNameValid(name)).toBe(false)
  })
})
