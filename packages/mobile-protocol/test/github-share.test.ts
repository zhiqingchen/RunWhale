import { describe, expect, it } from 'vitest'
import { githubCommitUrl, parseGitHubCommitReference, runWhaleShareUrl } from '../src/github-share.js'

const commit = 'A'.repeat(40)

describe('GitHub share references', () => {
  it('accepts canonical RunWhale and GitHub commit links', () => {
    const expected = { owner: 'openai', repo: 'openai-node', commit: commit.toLowerCase() }
    expect(parseGitHubCommitReference(`https://share.runwhale.dev/g/openai/openai-node/${commit}`)).toEqual(expected)
    expect(parseGitHubCommitReference(`https://github.com/openai/openai-node/commit/${commit}`)).toEqual(expected)
    expect(runWhaleShareUrl(expected)).toBe(`https://share.runwhale.dev/g/openai/openai-node/${commit.toLowerCase()}`)
    expect(githubCommitUrl(expected)).toBe(`https://github.com/openai/openai-node/commit/${commit.toLowerCase()}`)
  })

  it('rejects forged domains, partial SHAs, and ambiguous URL decorations', () => {
    expect(() => parseGitHubCommitReference(`https://share.runwhale.dev.evil.test/g/a/b/${commit}`)).toThrow(/Only RunWhale/)
    expect(() => parseGitHubCommitReference('https://github.com/a/b/commit/deadbeef')).toThrow(/40-character/)
    expect(() => parseGitHubCommitReference(`https://share.runwhale.dev/g/a/b/${commit}?next=evil`)).toThrow(/query/)
    expect(() => parseGitHubCommitReference(`https://share.runwhale.dev/g/a/b/${commit}/`)).toThrow(/path/)
  })
})
