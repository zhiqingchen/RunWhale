export const RUNWHALE_SHARE_ORIGIN = 'https://share.runwhale.dev' as const

export interface GitHubCommitReference {
  owner: string
  repo: string
  commit: string
}

const COMMIT_SHA = /^[0-9a-f]{40}$/i
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPOSITORY = /^[A-Za-z0-9._-]{1,100}$/

export function parseGitHubCommitReference(value: string): GitHubCommitReference {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('Share link is not a valid URL') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error('Share link must use plain HTTPS without credentials, a port, query, or fragment')
  }
  const segments = decodedPathSegments(url)
  let owner: string
  let repo: string
  let commit: string
  if (url.hostname.toLowerCase() === 'share.runwhale.dev' && segments[0] === 'g' && segments.length === 4) {
    ;[, owner, repo, commit] = segments as [string, string, string, string]
  } else if (url.hostname.toLowerCase() === 'github.com' && segments[2] === 'commit' && segments.length === 4) {
    ;[owner, repo, , commit] = segments as [string, string, string, string]
  } else {
    throw new Error('Only RunWhale share links and GitHub commit URLs are supported')
  }
  return validatedGitHubCommitReference({ owner, repo: repo.replace(/\.git$/i, ''), commit })
}

export function validatedGitHubCommitReference(reference: GitHubCommitReference): GitHubCommitReference {
  const owner = reference.owner.trim()
  const repo = reference.repo.trim().replace(/\.git$/i, '')
  const commit = reference.commit.trim().toLowerCase()
  if (!OWNER.test(owner) || !REPOSITORY.test(repo) || repo === '.' || repo === '..') {
    throw new Error('GitHub repository owner or name is invalid')
  }
  if (!COMMIT_SHA.test(commit)) throw new Error('GitHub commit must be a full 40-character SHA')
  return { owner, repo, commit }
}

export function runWhaleShareUrl(reference: GitHubCommitReference): string {
  const value = validatedGitHubCommitReference(reference)
  return `${RUNWHALE_SHARE_ORIGIN}/g/${encodeURIComponent(value.owner)}/${encodeURIComponent(value.repo)}/${value.commit}`
}

export function githubCommitUrl(reference: GitHubCommitReference): string {
  const value = validatedGitHubCommitReference(reference)
  return `https://github.com/${encodeURIComponent(value.owner)}/${encodeURIComponent(value.repo)}/commit/${value.commit}`
}

export function githubRepositoryHttpsUrl(reference: Pick<GitHubCommitReference, 'owner' | 'repo'>): string {
  const value = validatedGitHubCommitReference({ ...reference, commit: '0'.repeat(40) })
  return `https://github.com/${encodeURIComponent(value.owner)}/${encodeURIComponent(value.repo)}.git`
}

export function githubRepositorySshUrl(reference: Pick<GitHubCommitReference, 'owner' | 'repo'>): string {
  const value = validatedGitHubCommitReference({ ...reference, commit: '0'.repeat(40) })
  return `ssh://git@github.com/${encodeURIComponent(value.owner)}/${encodeURIComponent(value.repo)}.git`
}

function decodedPathSegments(url: URL): string[] {
  if (url.pathname.endsWith('/')) throw new Error('Share link path is invalid')
  return url.pathname.replace(/^\/+/, '').split('/').map((segment) => {
    let decoded: string
    try { decoded = decodeURIComponent(segment) } catch { throw new Error('Share link contains invalid percent encoding') }
    if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || /[\0-\x1f\x7f]/.test(decoded)) {
      throw new Error('Share link path is unsafe')
    }
    return decoded
  })
}
