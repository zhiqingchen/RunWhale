import * as fs from 'node:fs'
import { appendFile, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { join, posix, relative, sep } from 'node:path'
import {
  githubRepositoryHttpsUrl,
  githubRepositorySshUrl,
  validatedGitHubCommitReference,
  type GitHubCommitReference,
  type GitShareBlocker,
  type GitShareInspection,
  type ProjectClonePhase,
} from '@runwhale/mobile-protocol'
import * as git from 'isomorphic-git'
import type { FetchResult, GitAuth, GitHttpRequest, GitHttpResponse, HttpClient, MergeResult, PushResult } from 'isomorphic-git'
import nodeHttp from 'isomorphic-git/http/node'
import { findSecretLeaks } from './secrets.js'

const AUTHOR = { name: 'RunWhaleDev', email: 'runwhale@runwhale.dev' }
const MAX_DIFF_TEXT_BYTES = 32 * 1024
const MAX_REMOTE_BYTES = 120 * 1024 * 1024
const MAX_GIT_ENTRIES = 50_000
const MAX_GIT_BYTES = 100 * 1024 * 1024
const MAX_WORKTREE_ENTRIES = 5_000
const MAX_WORKTREE_BYTES = 100 * 1024 * 1024
const MAX_WORKTREE_FILE_BYTES = 10 * 1024 * 1024
const MAX_SNAPSHOT_DOWNLOAD_BYTES = 25 * 1024 * 1024
const MAX_SNAPSHOT_FILES = 500
const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024
const SENSITIVE_TEXT_SCAN_BYTES = 2 * 1024 * 1024

export interface GitTreeLimits {
  maxFiles: number
  maxBytes: number
  maxFileBytes: number
}

const DEFAULT_TREE_LIMITS: GitTreeLimits = {
  maxFiles: MAX_WORKTREE_ENTRIES,
  maxBytes: MAX_WORKTREE_BYTES,
  maxFileBytes: MAX_WORKTREE_FILE_BYTES,
}

const SNAPSHOT_TREE_LIMITS: GitTreeLimits = {
  maxFiles: MAX_SNAPSHOT_FILES,
  maxBytes: MAX_SNAPSHOT_BYTES,
  maxFileBytes: MAX_WORKTREE_FILE_BYTES,
}

export interface MobileGitStatusEntry {
  path: string
  head: number
  workdir: number
  stage: number
  state: 'unmodified' | 'untracked' | 'added' | 'modified' | 'deleted' | 'staged' | 'conflict'
}

export interface MobileGitDiffEntry {
  path: string
  state: MobileGitStatusEntry['state']
  before: string
  after: string
  truncated: boolean
}

export interface MobileGitLogEntry {
  oid: string
  message: string
  author: { name: string; email: string; timestamp: number }
}

export interface MobileGitRemote {
  name: string
  url: string
  transport: 'https' | 'ssh'
}

export interface MobileGitBranchState {
  current?: string
  local: string[]
  remote: Record<string, string[]>
}

export interface MobileGitHttpsCredential {
  username: string
  password: string
}

export interface MobileGitNetworkOptions {
  credential?: MobileGitHttpsCredential
  sshPrivateKey?: string
  signal?: AbortSignal
}

export interface MobileGitFetchResult {
  remote: string
  branch?: string
  oid?: string
  defaultBranch?: string
}

export interface MobileGitPullResult {
  remote: string
  branch: string
  oid?: string
  alreadyMerged: boolean
  fastForward: boolean
  mergeCommit: boolean
  conflicts: string[]
}

export interface MobileGitPushResult {
  remote: string
  branch: string
  ok: boolean
  error?: string
  refs: Record<string, { ok: boolean; error: string }>
}

export interface MobileGitRepositoryOptions {
  http?: HttpClient
}

export interface MobileGitCloneProgress {
  phase: ProjectClonePhase
  loaded: number
  total?: number
}

export interface MobileGitCloneOptions extends MobileGitRepositoryOptions, MobileGitNetworkOptions {
  onProgress?: (progress: MobileGitCloneProgress) => void
}

export interface MobileGitHubSnapshotOptions extends MobileGitCloneOptions {}

export interface MobileGitHubSnapshotResult {
  access: 'public' | 'ssh'
  remoteUrl: string
}

/** Pure-JS project-scoped Git repository; never invokes a process or native addon. */
export class MobileGitRepository {
  private readonly http: HttpClient

  constructor(readonly dir: string, options: MobileGitRepositoryOptions = {}) {
    this.http = options.http ?? nodeHttp
  }

  static async clone(dir: string, repositoryUrl: string, options: MobileGitCloneOptions = {}): Promise<MobileGitRepository> {
    const url = normalizeGitRepositoryUrl(repositoryUrl)
    const transport = await gitNetworkTransport(url, options.http ?? nodeHttp, options)
    options.onProgress?.({ phase: 'preparing', loaded: 0 })
    await git.clone({
      fs,
      http: boundedHttp(transport.http, options.signal),
      dir,
      url: transport.url,
      singleBranch: true,
      noTags: true,
      nonBlocking: true,
      batchSize: 50,
      ...(transport.onAuth ? { onAuth: transport.onAuth } : {}),
      onProgress({ phase, loaded, total }) {
        if (loaded > MAX_GIT_ENTRIES || total > MAX_GIT_ENTRIES) throw new Error(`Git repository exceeds the ${MAX_GIT_ENTRIES.toLocaleString('en-US')} object clone limit`)
        options.onProgress?.({ phase: cloneProgressPhase(phase), loaded, ...(total === undefined ? {} : { total }) })
      },
    })
    const repository = new MobileGitRepository(dir, options.http ? { http: options.http } : {})
    if (transport.url !== url) await git.addRemote({ fs, dir, remote: 'origin', url, force: true })
    await repository.sanitizeConfiguration()
    options.onProgress?.({ phase: 'validating', loaded: 0 })
    await validateMaterializedGitRepository(dir)
    await repository.validateRefTree('HEAD')
    await repository.log(1)
    await repository.audit('clone', { remote: url, outcome: 'success' })
    options.onProgress?.({ phase: 'validating', loaded: 1, total: 1 })
    return repository
  }

  /** Compatibility alias for projects imported before provider-neutral remotes. */
  static async cloneGitHub(dir: string, repositoryUrl: string): Promise<MobileGitRepository> {
    return MobileGitRepository.clone(dir, repositoryUrl)
  }

  static async importGitHubSnapshot(
    dir: string,
    reference: GitHubCommitReference,
    options: MobileGitHubSnapshotOptions = {},
  ): Promise<MobileGitHubSnapshotResult> {
    const selected = validatedGitHubCommitReference(reference)
    const publicUrl = githubRepositoryHttpsUrl(selected)
    let access: MobileGitHubSnapshotResult['access'] = 'public'
    let remoteUrl = publicUrl
    let transport: Awaited<ReturnType<typeof gitNetworkTransport>>
    const downloadBudget = { remaining: MAX_SNAPSHOT_DOWNLOAD_BYTES }
    try {
      transport = await gitNetworkTransport(publicUrl, options.http ?? nodeHttp, options)
      await git.listServerRefs({
        http: boundedHttp(transport.http, options.signal, MAX_SNAPSHOT_DOWNLOAD_BYTES, '25 MB', downloadBudget),
        url: transport.url,
        protocolVersion: 1,
        ...(transport.onAuth ? { onAuth: transport.onAuth } : {}),
      })
    } catch (publicError) {
      if (!options.sshPrivateKey) {
        throw new Error(`GitHub repository is private or unavailable, and this device has no GitHub SSH key: ${safeGitError(publicError)}`)
      }
      access = 'ssh'
      remoteUrl = githubRepositorySshUrl(selected)
      transport = await gitNetworkTransport(remoteUrl, options.http ?? nodeHttp, options)
      try {
        await git.listServerRefs({
          http: boundedHttp(transport.http, options.signal, MAX_SNAPSHOT_DOWNLOAD_BYTES, '25 MB', downloadBudget),
          url: transport.url,
          protocolVersion: 1,
          ...(transport.onAuth ? { onAuth: transport.onAuth } : {}),
        })
      } catch (sshError) {
        throw new Error(`GitHub SSH access was denied or the repository no longer exists: ${safeGitError(sshError)}`)
      }
    }

    options.onProgress?.({ phase: 'preparing', loaded: 0 })
    await git.init({ fs, dir, defaultBranch: 'runwhale-import' })
    await git.addRemote({ fs, dir, remote: 'origin', url: remoteUrl })
    let fetched: FetchResult
    try {
      fetched = await git.fetch({
        fs,
        http: boundedHttp(transport.http, options.signal, MAX_SNAPSHOT_DOWNLOAD_BYTES, '25 MB', downloadBudget),
        dir,
        remote: 'origin',
        url: transport.url,
        ref: 'runwhale-import',
        remoteRef: selected.commit,
        depth: 1,
        singleBranch: true,
        tags: false,
        ...(transport.onAuth ? { onAuth: transport.onAuth } : {}),
        onProgress({ phase, loaded, total }) {
          if (loaded > MAX_GIT_ENTRIES || total > MAX_GIT_ENTRIES) throw new Error(`Git repository exceeds the ${MAX_GIT_ENTRIES.toLocaleString('en-US')} object import limit`)
          options.onProgress?.({ phase: cloneProgressPhase(phase), loaded, ...(total === undefined ? {} : { total }) })
        },
      })
    } catch (error) {
      throw new Error(`GitHub commit does not exist or could not be fetched: ${safeGitError(error)}`)
    }
    if (fetched.fetchHead?.toLowerCase() !== selected.commit) throw new Error('GitHub returned a different commit than requested')
    await git.readCommit({ fs, dir, oid: selected.commit }).catch(() => { throw new Error('GitHub commit does not exist in the fetched snapshot') })
    await git.writeRef({ fs, dir, ref: 'refs/heads/runwhale-import', value: selected.commit, force: true })
    const repository = new MobileGitRepository(dir, options.http ? { http: options.http } : {})
    options.onProgress?.({ phase: 'validating', loaded: 0 })
    await repository.validateRefTree('refs/heads/runwhale-import', SNAPSHOT_TREE_LIMITS)
    const sensitivePaths = await inspectGitSnapshotSecurity(dir, 'refs/heads/runwhale-import')
    if (sensitivePaths.length > 0) throw new Error(`GitHub snapshot contains blocked credentials or unsafe files: ${sensitivePaths.join(', ')}`)
    await git.checkout({ fs, dir, ref: 'runwhale-import', force: false, nonBlocking: true, batchSize: 50 })
    await validateMaterializedGitRepository(dir, SNAPSHOT_TREE_LIMITS)
    await repository.sanitizeConfiguration()
    await repository.audit('snapshot.import', { remote: remoteUrl, commit: selected.commit, access, outcome: 'success' })
    options.onProgress?.({ phase: 'validating', loaded: 1, total: 1 })
    return { access, remoteUrl }
  }

  async ensureInitialized(message = 'Initialize RunWhale project'): Promise<boolean> {
    if (await exists(join(this.dir, '.git', 'HEAD'))) return false
    await mkdir(this.dir, { recursive: true })
    await git.init({ fs, dir: this.dir, defaultBranch: 'main' })
    await git.setConfig({ fs, dir: this.dir, path: 'user.name', value: AUTHOR.name })
    await git.setConfig({ fs, dir: this.dir, path: 'user.email', value: AUTHOR.email })
    await this.stage()
    await this.commit(message, false)
    await this.audit('init', { message, outcome: 'success' })
    return true
  }

  async status(includeUnmodified = false): Promise<MobileGitStatusEntry[]> {
    await this.requireRepository()
    const rows = await git.statusMatrix({ fs, dir: this.dir, filter: visiblePath })
    return rows.map(([path, head, workdir, stage]) => ({ path, head, workdir, stage, state: stateFor(head, workdir, stage) }))
      .filter((entry) => includeUnmodified || entry.state !== 'unmodified')
  }

  async conflicts(): Promise<string[]> {
    return (await this.status()).filter((entry) => entry.state === 'conflict').map((entry) => entry.path)
  }

  async diff(path?: string): Promise<MobileGitDiffEntry[]> {
    const selected = path ? normalizePath(path) : undefined
    const entries = (await this.status()).filter((entry) => !selected || entry.path === selected).slice(0, 20)
    const head = await git.resolveRef({ fs, dir: this.dir, ref: 'HEAD' }).catch(() => undefined)
    return Promise.all(entries.map(async (entry) => {
      const beforeBuffer = head ? await git.readBlob({ fs, dir: this.dir, oid: head, filepath: entry.path }).then((result) => result.blob).catch(() => new Uint8Array()) : new Uint8Array()
      const afterBuffer = await readFile(join(this.dir, entry.path)).catch(() => Buffer.alloc(0))
      const before = Buffer.from(beforeBuffer)
      const after = Buffer.from(afterBuffer)
      const truncated = before.byteLength > MAX_DIFF_TEXT_BYTES || after.byteLength > MAX_DIFF_TEXT_BYTES
      return {
        path: entry.path,
        state: entry.state,
        before: before.subarray(0, MAX_DIFF_TEXT_BYTES).toString('utf8'),
        after: after.subarray(0, MAX_DIFF_TEXT_BYTES).toString('utf8'),
        truncated,
      }
    }))
  }

  async stage(paths?: readonly string[]): Promise<string[]> {
    await this.requireRepository()
    const selected = paths?.map(normalizePath)
    const entries = await this.status(true)
    const changed = entries.filter((entry) => entry.state !== 'unmodified' && (!selected || selected.includes(entry.path)))
    for (const entry of changed) {
      if (entry.workdir === 0) await git.remove({ fs, dir: this.dir, filepath: entry.path })
      else await git.add({ fs, dir: this.dir, filepath: entry.path })
    }
    await this.audit('add', { paths: changed.map((entry) => entry.path), outcome: 'success' })
    return changed.map((entry) => entry.path)
  }

  async commit(message: string, stageAll = true): Promise<string | undefined> {
    await this.requireRepository()
    const normalizedMessage = message.trim().slice(0, 240)
    if (!normalizedMessage || /[\r\n\0]/.test(normalizedMessage)) throw new Error('Git commit message must be one non-empty line')
    if (stageAll) await this.stage()
    if (!(await this.hasStagedChanges())) return undefined
    const oid = await git.commit({ fs, dir: this.dir, message: normalizedMessage, author: AUTHOR })
    await this.audit('commit', { oid, message: normalizedMessage, outcome: 'success' })
    return oid
  }

  async log(depth = 20): Promise<MobileGitLogEntry[]> {
    await this.requireRepository()
    const commits = await git.log({ fs, dir: this.dir, depth: Math.max(1, Math.min(100, depth)) }).catch(() => [])
    return commits.map(({ oid, commit }) => ({
      oid,
      message: commit.message.trim(),
      author: { name: commit.author.name, email: commit.author.email, timestamp: commit.author.timestamp },
    }))
  }

  async branches(): Promise<MobileGitBranchState> {
    await this.requireRepository()
    const current = await git.currentBranch({ fs, dir: this.dir, fullname: false }) ?? undefined
    const local = (await git.listBranches({ fs, dir: this.dir })).sort()
    const remote: Record<string, string[]> = {}
    for (const item of await this.remotes()) remote[item.name] = (await git.listBranches({ fs, dir: this.dir, remote: item.name })).sort()
    return { ...(current ? { current } : {}), local, remote }
  }

  async createBranch(name: string, startPoint = 'HEAD', checkout = false): Promise<void> {
    const branch = normalizeRefName(name, 'branch')
    const object = startPoint === 'HEAD' ? 'HEAD' : normalizeRefName(startPoint, 'start point')
    await this.audited('branch', { branch, startPoint: object, checkout }, async () => {
      await this.requireRepository()
      if (checkout) await this.requireCleanWorktree('create and check out a branch')
      await this.validateRefTree(object)
      await git.branch({ fs, dir: this.dir, ref: branch, object, checkout, force: false })
    })
  }

  async checkout(name: string, remote = 'origin'): Promise<void> {
    const branch = normalizeRefName(name, 'branch')
    const selectedRemote = normalizeRemoteName(remote)
    await this.audited('checkout', { branch, remote: selectedRemote }, async () => {
      await this.requireRepository()
      await this.requireCleanWorktree('check out a branch')
      const local = await git.resolveRef({ fs, dir: this.dir, ref: `refs/heads/${branch}` }).then(() => true).catch(() => false)
      const target = local ? `refs/heads/${branch}` : `refs/remotes/${selectedRemote}/${branch}`
      await this.validateRefTree(target)
      await git.checkout({ fs, dir: this.dir, ref: branch, remote: selectedRemote, force: false, nonBlocking: true, batchSize: 50 })
      await validateMaterializedGitRepository(this.dir)
    })
  }

  async remotes(): Promise<MobileGitRemote[]> {
    await this.requireRepository()
    return Promise.all((await git.listRemotes({ fs, dir: this.dir })).map(async ({ remote, url }) => {
      const normalized = normalizeGitRepositoryUrl(url)
      return { name: normalizeRemoteName(remote), url: normalized, transport: gitTransport(normalized) }
    }))
  }

  async setRemote(name: string, repositoryUrl: string): Promise<MobileGitRemote> {
    const remote = normalizeRemoteName(name)
    const url = normalizeGitRepositoryUrl(repositoryUrl)
    return this.audited('remote.set', { remote, url }, async () => {
      await this.requireRepository()
      await git.addRemote({ fs, dir: this.dir, remote, url, force: true })
      return { name: remote, url, transport: gitTransport(url) }
    })
  }

  async fetch(remoteName = 'origin', branchName?: string, options: MobileGitNetworkOptions = {}): Promise<MobileGitFetchResult> {
    const remote = normalizeRemoteName(remoteName)
    const branch = branchName ? normalizeRefName(branchName, 'branch') : undefined
    const configured = await this.remote(remote)
    const transport = await gitNetworkTransport(configured.url, this.http, options)
    return this.audited('fetch', { remote, ...(branch ? { branch } : {}) }, async () => {
      const result = await git.fetch({
        fs,
        http: boundedHttp(transport.http, options.signal),
        dir: this.dir,
        remote,
        url: transport.url,
        ...(branch ? { ref: branch, singleBranch: true } : {}),
        tags: false,
        prune: true,
        ...(transport.onAuth ? { onAuth: transport.onAuth } : {}),
      })
      const target = branch ? `refs/remotes/${remote}/${branch}` : result.fetchHead ?? undefined
      if (target) await this.validateRefTree(target)
      await validateGitStorage(this.dir)
      return publicFetchResult(remote, branch, result)
    })
  }

  async pull(remoteName = 'origin', branchName?: string, options: MobileGitNetworkOptions = {}): Promise<MobileGitPullResult> {
    const remote = normalizeRemoteName(remoteName)
    const current = await git.currentBranch({ fs, dir: this.dir, fullname: false })
    if (!current) throw new Error('Git pull requires a checked-out local branch')
    const branch = branchName ? normalizeRefName(branchName, 'branch') : normalizeRefName(current, 'branch')
    await this.requireCleanWorktree('pull remote changes')
    await this.fetch(remote, branch, options)
    return this.audited('pull', { remote, branch }, async () => {
      const before = await git.resolveRef({ fs, dir: this.dir, ref: 'HEAD' })
      let result: MergeResult
      try {
        result = await git.merge({
          fs,
          dir: this.dir,
          ours: current,
          theirs: `remotes/${remote}/${branch}`,
          author: AUTHOR,
          committer: AUTHOR,
          abortOnConflict: false,
        })
        await validateMaterializedGitRepository(this.dir)
      } catch (error) {
        const conflicts = await this.conflicts().catch(() => [])
        if (conflicts.length > 0) return { remote, branch, alreadyMerged: false, fastForward: false, mergeCommit: false, conflicts }
        await this.restoreBranch(current, before)
        throw error
      }
      const conflicts = await this.conflicts()
      return {
        remote,
        branch,
        ...(result.oid ? { oid: result.oid } : {}),
        alreadyMerged: Boolean(result.alreadyMerged),
        fastForward: Boolean(result.fastForward),
        mergeCommit: Boolean(result.mergeCommit),
        conflicts,
      }
    })
  }

  async push(remoteName = 'origin', branchName?: string, options: MobileGitNetworkOptions = {}): Promise<MobileGitPushResult> {
    const remote = normalizeRemoteName(remoteName)
    const current = await git.currentBranch({ fs, dir: this.dir, fullname: false })
    const branch = branchName ? normalizeRefName(branchName, 'branch') : current ? normalizeRefName(current, 'branch') : undefined
    if (!branch) throw new Error('Git push requires a local branch')
    const configured = await this.remote(remote)
    let networkUrl = configured.url
    if (options.sshPrivateKey && new URL(configured.url).protocol === 'https:') {
      try { networkUrl = githubRepositorySshUrl(githubRemoteIdentity(configured.url)) } catch { /* non-GitHub HTTPS remotes keep their configured transport */ }
    }
    const transport = await gitNetworkTransport(networkUrl, this.http, options)
    await this.validateRefTree(`refs/heads/${branch}`)
    await validateMaterializedGitRepository(this.dir)
    return this.audited('push', { remote, branch }, async () => publicPushResult(remote, branch, await git.push({
      fs,
      http: boundedHttp(transport.http, options.signal),
      dir: this.dir,
      remote,
      url: transport.url,
      ref: branch,
      force: false,
      ...(transport.onAuth ? { onAuth: transport.onAuth } : {}),
    })))
  }

  async inspectShare(options: MobileGitNetworkOptions = {}): Promise<GitShareInspection> {
    await this.requireRepository()
    const [branch, head, changedPaths, remotes, sensitivePaths] = await Promise.all([
      git.currentBranch({ fs, dir: this.dir, fullname: false }).then((value) => value ?? undefined),
      git.resolveRef({ fs, dir: this.dir, ref: 'HEAD' }).catch(() => undefined),
      this.status().then((entries) => entries.map((entry) => entry.path)),
      this.remotes().catch(() => []),
      inspectGitSnapshotSecurity(this.dir, 'HEAD'),
    ])
    const blockers: GitShareBlocker[] = []
    if (!branch) blockers.push({ code: 'DETACHED_HEAD', message: 'Git sharing requires a checked-out local branch.' })
    if (changedPaths.length > 0) blockers.push({ code: 'DIRTY_WORKTREE', message: 'Commit or discard all workspace changes before sharing.', paths: changedPaths })
    if (sensitivePaths.length > 0) blockers.push({ code: 'SENSITIVE_CONTENT', message: 'The commit contains credentials or unsafe files.', paths: sensitivePaths })

    const configuredRemoteName = branch
      ? await git.getConfig({ fs, dir: this.dir, path: `branch.${branch}.remote` }).catch(() => undefined)
      : undefined
    const selectedRemote = remotes.find((item) => item.name === configuredRemoteName)
      ?? remotes.find((item) => item.name === 'origin')
      ?? (remotes.length === 1 ? remotes[0] : undefined)
    if (!selectedRemote) blockers.push({ code: 'MISSING_REMOTE', message: 'Configure a GitHub remote before sharing.' })

    let remote: GitShareInspection['remote']
    let remoteAccessible = false
    let remoteMatchesHead = false
    if (selectedRemote) {
      try {
        const identity = githubRemoteIdentity(selectedRemote.url)
        remote = { name: selectedRemote.name, url: selectedRemote.url, ...identity }
        if (branch) {
          const listBranch = async (url: string) => {
            const transport = await gitNetworkTransport(url, this.http, options)
            try {
              return await git.listServerRefs({
                http: boundedHttp(transport.http, options.signal),
                url: transport.url,
                protocolVersion: 1,
                prefix: `refs/heads/${branch}`,
                ...(transport.onAuth ? { onAuth: transport.onAuth } : {}),
              })
            } finally {
              transport.dispose?.()
            }
          }
          let refs
          try {
            refs = await listBranch(selectedRemote.url)
          } catch (httpsError) {
            if (!options.sshPrivateKey || new URL(selectedRemote.url).protocol !== 'https:') throw httpsError
            refs = await listBranch(githubRepositorySshUrl(identity))
          }
          remoteAccessible = true
          const remoteCommit = refs.find((item) => item.ref === `refs/heads/${branch}`)?.oid.toLowerCase()
          remote = { ...remote, ...(remoteCommit ? { commit: remoteCommit } : {}) }
          remoteMatchesHead = Boolean(head && remoteCommit === head.toLowerCase())
          if (!remoteMatchesHead) blockers.push({ code: 'REMOTE_SHA_MISMATCH', message: 'The remote branch does not yet point to local HEAD.' })
        }
      } catch (error) {
        const message = safeGitError(error)
        if (/GitHub remote/i.test(message)) blockers.push({ code: 'NON_GITHUB_REMOTE', message })
        else blockers.push({ code: 'REMOTE_UNREACHABLE', message: `GitHub remote is not accessible for push: ${message}` })
      }
    }
    const hardBlockers = blockers.filter((blocker) => blocker.code !== 'REMOTE_SHA_MISMATCH')
    const canPublish = Boolean(branch && head && remote && remoteAccessible && hardBlockers.length === 0)
    return {
      ...(branch ? { branch } : {}),
      ...(head ? { head: head.toLowerCase() } : {}),
      ...(remote ? { remote } : {}),
      worktreeClean: changedPaths.length === 0,
      changedPaths,
      remoteAccessible,
      remoteMatchesHead,
      canPublish,
      shareable: canPublish && remoteMatchesHead,
      blockers,
    }
  }

  async sanitizeConfiguration(): Promise<void> {
    await this.requireRepository()
    const current = await git.currentBranch({ fs, dir: this.dir, fullname: false }) ?? undefined
    const remotes = await git.listRemotes({ fs, dir: this.dir })
    const normalizedRemotes = remotes.map(({ remote, url }) => ({ remote: normalizeRemoteName(remote), url: normalizeGitRepositoryUrl(url) }))
    const tracking = current ? {
      remote: await git.getConfig({ fs, dir: this.dir, path: `branch.${current}.remote` }).catch(() => undefined),
      merge: await git.getConfig({ fs, dir: this.dir, path: `branch.${current}.merge` }).catch(() => undefined),
    } : undefined
    const lines = [
      '[core]',
      '\trepositoryformatversion = 0',
      '\tfilemode = true',
      '\tbare = false',
      '[user]',
      `\tname = ${AUTHOR.name}`,
      `\temail = ${AUTHOR.email}`,
    ]
    for (const item of normalizedRemotes) lines.push(`[remote "${item.remote}"]`, `\turl = ${item.url}`, `\tfetch = +refs/heads/*:refs/remotes/${item.remote}/*`)
    if (current && tracking?.remote && tracking.merge && normalizedRemotes.some((item) => item.remote === tracking.remote) && /^refs\/heads\/[A-Za-z0-9._/-]+$/.test(tracking.merge)) {
      lines.push(`[branch "${current}"]`, `\tremote = ${tracking.remote}`, `\tmerge = ${tracking.merge}`)
    }
    await writeFile(join(this.dir, '.git', 'config'), `${lines.join('\n')}\n`, { mode: 0o600 })
    await rm(join(this.dir, '.git', 'hooks'), { recursive: true, force: true })
    await mkdir(join(this.dir, '.git', 'hooks'), { recursive: true, mode: 0o700 })
    if (await exists(join(this.dir, '.git', 'objects', 'info', 'alternates'))) throw new Error('Git object alternates are forbidden')
  }

  async validateRefTree(ref: string, limits: GitTreeLimits = DEFAULT_TREE_LIMITS): Promise<void> {
    await this.requireRepository()
    const oid = await git.resolveRef({ fs, dir: this.dir, ref })
    const commit = await git.readCommit({ fs, dir: this.dir, oid })
    let files = 0
    let bytes = 0
    const visit = async (treeOid: string, parent: string, depth: number): Promise<void> => {
      if (depth > 80) throw new Error('Git tree exceeds the 80-directory depth limit')
      const { tree } = await git.readTree({ fs, dir: this.dir, oid: treeOid })
      for (const entry of tree) {
        const path = validateTreePath(parent, entry.path)
        if (entry.type === 'tree') {
          await visit(entry.oid, path, depth + 1)
          continue
        }
        if (entry.type !== 'blob' || entry.mode === '120000' || entry.mode === '160000') throw new Error(`Git tree contains an unsupported link or submodule: ${path}`)
        const blob = await git.readBlob({ fs, dir: this.dir, oid: entry.oid })
        files += 1
        if (files > limits.maxFiles) throw new Error(`Git tree exceeds the ${limits.maxFiles.toLocaleString('en-US')} file limit`)
        if (blob.blob.byteLength > limits.maxFileBytes) throw new Error(`Git project file exceeds ${formatMegabytes(limits.maxFileBytes)}: ${path}`)
        bytes += blob.blob.byteLength
        if (bytes > limits.maxBytes) throw new Error(`Git tree exceeds the ${formatMegabytes(limits.maxBytes)} worktree limit`)
      }
    }
    await visit(commit.commit.tree, '', 0)
  }

  private async remote(name: string): Promise<MobileGitRemote> {
    const found = (await this.remotes()).find((item) => item.name === name)
    if (!found) throw new Error(`Git remote is not configured: ${name}`)
    return found
  }

  private async restoreBranch(branch: string, oid: string): Promise<void> {
    await git.writeRef({ fs, dir: this.dir, ref: `refs/heads/${branch}`, value: oid, force: true })
    await git.checkout({ fs, dir: this.dir, ref: branch, force: true, nonBlocking: true, batchSize: 50 }).catch(() => undefined)
  }

  private async requireCleanWorktree(operation: string): Promise<void> {
    const changed = await this.status()
    if (changed.length > 0) throw new Error(`Git cannot ${operation} while the project has ${changed.length} uncommitted file${changed.length === 1 ? '' : 's'}`)
  }

  private async hasStagedChanges(): Promise<boolean> {
    return (await this.status(true)).some(({ head, stage }) => head !== stage)
  }

  private async requireRepository(): Promise<void> {
    if (!await exists(join(this.dir, '.git', 'HEAD'))) throw new Error('project Git repository is not initialized')
  }

  private async audited<T>(operation: string, details: Record<string, unknown>, task: () => Promise<T>): Promise<T> {
    try {
      const result = await task()
      await this.audit(operation, { ...details, outcome: 'success' })
      return result
    } catch (error) {
      await this.audit(operation, { ...details, outcome: 'error', error: safeGitError(error) }).catch(() => undefined)
      throw error
    }
  }

  private async audit(operation: string, details: Record<string, unknown>): Promise<void> {
    const directory = join(this.dir, '.runwhale')
    await mkdir(directory, { recursive: true })
    await appendFile(join(directory, 'git-audit.jsonl'), `${JSON.stringify({ timestamp: Date.now(), operation, ...details })}\n`, { encoding: 'utf8', mode: 0o600 })
  }
}

export function normalizeGitRepositoryUrl(value: string): string {
  const input = value.trim()
  if (!input || input.length > 2_048 || /[\0\r\n]/.test(input)) throw new Error('Git repository URL is invalid')
  const scp = /^([A-Za-z0-9._-]{1,64})@([A-Za-z0-9.-]{1,253}):(.+)$/.exec(input)
  if (scp) return normalizeStructuredGitUrl(`ssh://${scp[1]}@${scp[2]}/${scp[3]}`)
  return normalizeStructuredGitUrl(input)
}

export function normalizeGitHubRepositoryUrl(value: string): string {
  const normalized = normalizeGitRepositoryUrl(value)
  const url = new URL(normalized)
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') throw new Error('GitHub repository URL must use https://github.com')
  const parts = repositoryPathSegments(url)
  if (parts.length !== 2) throw new Error('GitHub repository URL must name one owner and repository')
  return `${url.origin}/${parts.join('/')}${parts.at(-1)!.toLowerCase().endsWith('.git') ? '' : '.git'}`
}

export async function validateMaterializedGitRepository(root: string, limits: GitTreeLimits = DEFAULT_TREE_LIMITS): Promise<void> {
  const repositoryRoot = await realpath(root)
  const directories = [repositoryRoot]
  let worktreeFiles = 0
  let worktreeDirectories = 0
  let worktreeBytes = 0
  let gitEntries = 0
  let gitBytes = 0
  while (directories.length > 0) {
    const directory = directories.pop()!
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name)
      const portable = relative(repositoryRoot, absolute).split(sep).join('/')
      if (!portable || portable === '..' || portable.startsWith('../') || portable.startsWith('/')) throw new Error('Git repository entry escapes the project root')
      const inGit = portable === '.git' || portable.startsWith('.git/')
      const internal = portable === '.runwhale' || portable.startsWith('.runwhale/') || portable === 'node_modules' || portable.startsWith('node_modules/')
      const info = await lstat(absolute)
      if (info.isSymbolicLink()) throw new Error(`Git project links are forbidden: ${portable}`)
      if (info.isDirectory()) {
        if (!internal) directories.push(absolute)
        if (inGit) gitEntries += 1
        else if (!internal) {
          worktreeDirectories += 1
          if (worktreeDirectories > MAX_WORKTREE_ENTRIES) throw new Error(`Git project exceeds the ${MAX_WORKTREE_ENTRIES.toLocaleString('en-US')} directory limit`)
        }
        continue
      }
      if (!info.isFile()) throw new Error(`Git project contains an unsupported entry: ${portable}`)
      if (!inGit && info.nlink > 1) throw new Error(`Git project hard links are forbidden: ${portable}`)
      if (inGit) {
        gitEntries += 1
        gitBytes += info.size
        if (gitEntries > MAX_GIT_ENTRIES || gitBytes > MAX_GIT_BYTES) throw new Error('Git history exceeds the 100 MB / 50,000 entry limit')
      } else if (!internal) {
        validateMaterializedPath(portable)
        worktreeFiles += 1
        worktreeBytes += info.size
        if (info.size > limits.maxFileBytes) throw new Error(`Git project file exceeds ${formatMegabytes(limits.maxFileBytes)}: ${portable}`)
        if (worktreeFiles > limits.maxFiles || worktreeBytes > limits.maxBytes) throw new Error(`Git project exceeds the ${formatMegabytes(limits.maxBytes)} / ${limits.maxFiles.toLocaleString('en-US')} file limit`)
      }
    }
  }
  if (await exists(join(repositoryRoot, '.git', 'objects', 'info', 'alternates'))) throw new Error('Git object alternates are forbidden')
}

export async function inspectGitSnapshotSecurity(root: string, ref = 'HEAD'): Promise<string[]> {
  const findings = new Set<string>()
  const oid = await git.resolveRef({ fs, dir: root, ref })
  const commit = await git.readCommit({ fs, dir: root, oid })
  const visit = async (treeOid: string, parent: string, depth: number): Promise<void> => {
    if (depth > 80) throw new Error('Git tree exceeds the 80-directory depth limit')
    const { tree } = await git.readTree({ fs, dir: root, oid: treeOid })
    for (const entry of tree) {
      const path = validateTreePath(parent, entry.path)
      if (entry.type === 'tree') {
        await visit(entry.oid, path, depth + 1)
        continue
      }
      if (entry.type !== 'blob') continue
      const bytes = Buffer.from((await git.readBlob({ fs, dir: root, oid: entry.oid })).blob)
      if (sensitiveFilePath(path) || archivePayload(path, bytes) || executableBinary(bytes)) {
        findings.add(path)
        continue
      }
      if (bytes.byteLength <= SENSITIVE_TEXT_SCAN_BYTES && !bytes.includes(0)) {
        const text = bytes.toString('utf8')
        if (PRIVATE_KEY_MATERIAL.test(text) || findSecretLeaks(text).length > 0 || HIGH_CONFIDENCE_CREDENTIAL.test(text)) findings.add(path)
      }
    }
  }
  await visit(commit.commit.tree, '', 0)
  return [...findings].sort()
}

async function validateGitStorage(root: string): Promise<void> {
  const gitRoot = join(root, '.git')
  const directories = [gitRoot]
  let entries = 0
  let bytes = 0
  while (directories.length > 0) {
    const directory = directories.pop()!
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name)
      const info = await lstat(absolute)
      if (info.isSymbolicLink()) throw new Error('Git metadata links are forbidden')
      entries += 1
      if (entries > MAX_GIT_ENTRIES) throw new Error('Git history exceeds the 50,000 entry limit')
      if (info.isDirectory()) directories.push(absolute)
      else if (info.isFile()) {
        bytes += info.size
        if (bytes > MAX_GIT_BYTES) throw new Error('Git history exceeds the 100 MB limit')
      } else throw new Error('Git metadata contains an unsupported entry')
    }
  }
}

function normalizeStructuredGitUrl(input: string): string {
  let url: URL
  try { url = new URL(input) } catch { throw new Error('Git repository URL must use HTTPS or SSH') }
  if (url.protocol !== 'https:' && url.protocol !== 'ssh:') throw new Error('Git repository URL must use HTTPS or SSH')
  if (!url.hostname || url.password || url.search || url.hash) throw new Error('Git repository URL must not contain credentials, a query, or a fragment')
  if (url.protocol === 'https:' && url.username) throw new Error('HTTPS Git credentials must be stored in Keychain or Keystore, not in the remote URL')
  if (url.port && (!/^\d{1,5}$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65_535)) throw new Error('Git repository URL port is invalid')
  const segments = repositoryPathSegments(url)
  if (segments.length < 1) throw new Error('Git repository URL must include a repository path')
  url.pathname = `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`
  return url.toString().replace(/\/$/, '')
}

function repositoryPathSegments(url: URL): string[] {
  const raw = url.pathname.replace(/^\/+|\/+$/g, '')
  if (!raw) return []
  return raw.split('/').map((segment) => {
    let decoded: string
    try { decoded = decodeURIComponent(segment) } catch { throw new Error('Git repository path contains invalid percent encoding') }
    if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || /[\0-\x1f\x7f]/.test(decoded)) throw new Error('Git repository path is unsafe')
    return decoded
  })
}

function gitTransport(url: string): MobileGitRemote['transport'] {
  return new URL(url).protocol === 'ssh:' ? 'ssh' : 'https'
}

function cloneProgressPhase(phase: string): ProjectClonePhase {
  if (phase === 'Receiving objects') return 'receiving'
  if (phase === 'Resolving deltas') return 'resolving'
  if (phase === 'Analyzing workdir' || phase === 'Updating workdir') return 'checkout'
  return 'preparing'
}

async function gitNetworkTransport(url: string, http: HttpClient, options: MobileGitNetworkOptions): Promise<{ url: string; http: HttpClient; onAuth?: (url: string) => GitAuth; dispose?: () => void }> {
  if (gitTransport(url) === 'ssh') {
    if (!options.sshPrivateKey) throw new Error('GitHub SSH private key is not configured in Keychain or Keystore')
    const { createGitHubSshHttpClient } = await import('./github-ssh.js')
    const transport = createGitHubSshHttpClient(url, options.sshPrivateKey, options.signal ? { signal: options.signal } : {})
    return { url: transport.remote.httpUrl, http: transport.http, dispose: transport.dispose }
  }
  return { url, http, onAuth: authCallback(url, options.credential) }
}

function authCallback(remoteUrl: string, credential?: MobileGitHttpsCredential): (url: string) => GitAuth {
  const validated = credential ? validateHttpsCredential(credential) : undefined
  const remote = new URL(remoteUrl)
  return (requestUrl) => {
    if (!validated) return { cancel: true }
    const request = new URL(requestUrl)
    if (request.protocol !== remote.protocol || request.hostname !== remote.hostname || request.port !== remote.port) return { cancel: true }
    return { username: validated.username, password: validated.password }
  }
}

function validateHttpsCredential(credential: MobileGitHttpsCredential): MobileGitHttpsCredential {
  const username = credential.username.trim()
  const password = credential.password.trim()
  if (!username || username.length > 256 || /[\0\r\n]/.test(username)) throw new Error('Git HTTPS username is invalid')
  if (!password || password.length > 8_192 || /[\0\r\n]/.test(password)) throw new Error('Git HTTPS credential is invalid')
  return { username, password }
}

function boundedHttp(base: HttpClient, signal?: AbortSignal, maximumBytes = MAX_REMOTE_BYTES, maximumLabel = '120 MB', sharedBudget?: { remaining: number }): HttpClient {
  return {
    async request(request: GitHttpRequest): Promise<GitHttpResponse> {
      if (signal?.aborted) throw signal.reason
      const response = await base.request({ ...request, fetchOptions: { ...request.fetchOptions, ...(signal ? { signal } : {}) } })
      if (!response.body) return response
      const source = response.body
      async function* bounded(): AsyncIterableIterator<Uint8Array> {
        let bytes = 0
        for await (const chunk of source) {
          bytes += chunk.byteLength
          if (sharedBudget) sharedBudget.remaining -= chunk.byteLength
          if (bytes > maximumBytes || (sharedBudget && sharedBudget.remaining < 0)) throw new Error(`Git remote response exceeds ${maximumLabel}`)
          yield chunk
        }
      }
      return { ...response, body: bounded() }
    },
  }
}

function githubRemoteIdentity(value: string): { owner: string; repo: string } {
  const url = new URL(normalizeGitRepositoryUrl(value))
  const hostname = url.hostname.toLowerCase()
  if (hostname !== 'github.com' && hostname !== 'ssh.github.com') throw new Error('GitHub remote must use github.com')
  const parts = repositoryPathSegments(url)
  if (parts.length !== 2) throw new Error('GitHub remote must name one owner and repository')
  const selected = validatedGitHubCommitReference({ owner: parts[0]!, repo: parts[1]!.replace(/\.git$/i, ''), commit: '0'.repeat(40) })
  return { owner: selected.owner, repo: selected.repo }
}

const PRIVATE_KEY_MATERIAL = /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/
const HIGH_CONFIDENCE_CREDENTIAL = /(?:AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[0-9A-Za-z-]{20,}|glpat-[0-9A-Za-z_-]{20,}|(?:api[-_]?key|access[-_]?token|auth(?:orization)?|password|secret)\s*[:=]\s*["']?[0-9A-Za-z/+_.=-]{20,})/i

function sensitiveFilePath(path: string): boolean {
  const name = path.split('/').at(-1)?.toLowerCase() ?? ''
  return name === '.env'
    || (name.startsWith('.env.') && !name.endsWith('.example') && !name.endsWith('.sample'))
    || name === '.npmrc'
    || name === '.pypirc'
    || name === '.netrc'
    || name === 'id_rsa'
    || name === 'id_dsa'
    || name === 'id_ecdsa'
    || name === 'id_ed25519'
    || /\.(?:jks|keystore|p12|pfx)$/i.test(name)
}

function archivePayload(path: string, bytes: Buffer): boolean {
  const name = path.toLowerCase()
  if (/\.(?:zip|tar|tgz|tbz2?|txz|gz|bz2|xz|7z|rar)$/i.test(name)) return true
  if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return true
  if (bytes.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b]))) return true
  if (bytes.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) return true
  if (bytes.subarray(0, 6).equals(Buffer.from('Rar!\x1a\x07', 'binary'))) return true
  return bytes.byteLength > 262 && bytes.subarray(257, 262).toString('ascii') === 'ustar'
}

function executableBinary(bytes: Buffer): boolean {
  if (bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return true
  if (bytes.subarray(0, 2).toString('ascii') === 'MZ') return true
  if (bytes.byteLength < 4) return false
  const magic = bytes.readUInt32BE(0)
  return magic === 0xfeedface || magic === 0xfeedfacf || magic === 0xcefaedfe || magic === 0xcffaedfe || magic === 0xcafebabe || magic === 0xbebafeca
}

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

function publicFetchResult(remote: string, branch: string | undefined, result: FetchResult): MobileGitFetchResult {
  return {
    remote,
    ...(branch ? { branch } : {}),
    ...(result.fetchHead ? { oid: result.fetchHead } : {}),
    ...(result.defaultBranch ? { defaultBranch: result.defaultBranch.replace(/^refs\/heads\//, '') } : {}),
  }
}

function publicPushResult(remote: string, branch: string, result: PushResult): MobileGitPushResult {
  return {
    remote,
    branch,
    ok: result.ok,
    ...(result.error ? { error: safeGitError(result.error) } : {}),
    refs: Object.fromEntries(Object.entries(result.refs).map(([ref, status]) => [ref, { ok: status.ok, error: safeGitError(status.error) }])),
  }
}

function visiblePath(path: string): boolean {
  return path !== '.runwhale' && !path.startsWith('.runwhale/') && path !== 'node_modules' && !path.startsWith('node_modules/')
}

function normalizePath(path: string): string {
  const normalized = posix.normalize(path.replaceAll('\\', '/')).replace(/^\.\//, '')
  if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/') || !visiblePath(normalized)) {
    throw new Error('Git path escapes the visible project workspace')
  }
  return normalized
}

function normalizeRemoteName(value: string): string {
  const name = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name) || name.endsWith('.lock')) throw new Error('Git remote name is invalid')
  return name
}

function normalizeRefName(value: string, label: string): string {
  const ref = value.trim()
  if (!ref || ref.length > 127 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) || ref.includes('..') || ref.includes('//') || ref.includes('@{') || ref.endsWith('/') || ref.endsWith('.') || ref.endsWith('.lock') || ref.split('/').some((segment) => !segment || segment.startsWith('.'))) {
    throw new Error(`Git ${label} name is invalid`)
  }
  return ref
}

function validateTreePath(parent: string, name: string): string {
  const path = parent ? `${parent}/${name}` : name
  const normalized = posix.normalize(path.replaceAll('\\', '/'))
  const reserved = path.split('/').some((segment, index) => segment.toLowerCase() === '.git' || (index === 0 && (segment === '.runwhale' || segment === 'node_modules')))
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || /[\0\r\n]/.test(name) || normalized !== path || normalized.startsWith('../') || normalized.startsWith('/') || reserved) {
    throw new Error(`Git tree path is unsafe: ${path}`)
  }
  return path
}

function validateMaterializedPath(path: string): void {
  const normalized = posix.normalize(path.replaceAll('\\', '/'))
  if (!path || /[\0\r\n]/.test(path) || normalized !== path || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/') || path.split('/').some((segment) => segment.toLowerCase() === '.git')) {
    throw new Error(`Git project path is unsafe: ${path}`)
  }
}

function stateFor(head: number, workdir: number, stage: number): MobileGitStatusEntry['state'] {
  if (stage === 3 || (head === 2 && workdir === 2 && stage === 2)) return 'conflict'
  if (head === 1 && workdir === 1 && stage === 1) return 'unmodified'
  if (head === 0 && workdir === 2 && stage === 0) return 'untracked'
  if (head === 0 && stage === 2) return 'added'
  if (workdir === 0) return stage === 0 ? 'deleted' : 'staged'
  if (head !== stage) return 'staged'
  return 'modified'
}

function safeGitError(error: unknown): string {
  return String(error instanceof Error ? error.message : error)
    .replace(/https?:\/\/[^\s/@:]+:[^\s/@]+@/gi, 'https://[redacted]@')
    .replace(/((?:authorization|password|token|credential)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .slice(0, 500)
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}
