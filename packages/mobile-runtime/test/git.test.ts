import * as fs from 'node:fs'
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as git from 'isomorphic-git'
import { describe, expect, it, vi } from 'vitest'
import { MobileGitRepository, inspectGitSnapshotSecurity, normalizeGitHubRepositoryUrl, normalizeGitRepositoryUrl, validateMaterializedGitRepository } from '../src/git.js'

const sshTransportMocks = vi.hoisted(() => ({ dispose: vi.fn() }))

vi.mock('../src/github-ssh.js', () => ({
  createGitHubSshHttpClient: (repositoryUrl: string) => ({
    remote: { httpUrl: repositoryUrl.replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/') },
    http: { request: async () => { throw new Error('unexpected SSH HTTP request') } },
    dispose: sshTransportMocks.dispose,
  }),
}))

describe('mobile project Git', () => {
  it('initializes, reviews, stages, commits, logs, and audits without a subprocess', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-git-'))
    await writeFile(join(root, '.gitignore'), '.runwhale/\nnode_modules/\n')
    await writeFile(join(root, 'app.ts'), 'export const value = 1\n')
    const repository = new MobileGitRepository(root)

    expect(await repository.ensureInitialized()).toBe(true)
    expect(await repository.ensureInitialized()).toBe(false)
    expect(await repository.status()).toEqual([])
    expect((await repository.log())[0]).toMatchObject({
      message: 'Initialize RunWhale project',
      author: { name: 'RunWhaleDev', email: 'runwhale@runwhale.dev' },
    })

    await writeFile(join(root, 'app.ts'), 'export const value = 200\n')
    expect(await repository.status()).toEqual([expect.objectContaining({ path: 'app.ts', state: 'modified' })])
    expect(await repository.diff('app.ts')).toEqual([expect.objectContaining({
      path: 'app.ts',
      before: 'export const value = 1\n',
      after: 'export const value = 200\n',
    })])

    expect(await repository.stage(['app.ts'])).toEqual(['app.ts'])
    expect(await repository.status()).toEqual([expect.objectContaining({ path: 'app.ts', state: 'staged' })])
    expect(await repository.commit('Update value', false)).toMatch(/^[0-9a-f]{40}$/)
    expect((await repository.log()).map((entry) => entry.message)).toEqual(['Update value', 'Initialize RunWhale project'])
    expect(await repository.status()).toEqual([])

    const audit = await readFile(join(root, '.runwhale/git-audit.jsonl'), 'utf8')
    expect(audit).toContain('"operation":"add"')
    expect(audit).toContain('"operation":"commit"')
  })

  it('rejects paths outside visible project scope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-git-path-'))
    await writeFile(join(root, 'app.ts'), 'ok\n')
    const repository = new MobileGitRepository(root)
    await repository.ensureInitialized()
    await expect(repository.diff('../outside')).rejects.toThrow(/escapes/)
    await expect(repository.stage(['.runwhale/session.json'])).rejects.toThrow(/escapes/)
  })

  it('creates and checks out branches and manages provider-neutral remotes with an audit trail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-git-branch-'))
    await writeFile(join(root, 'app.ts'), 'main\n')
    const repository = new MobileGitRepository(root)
    await repository.ensureInitialized()

    await repository.createBranch('feature/mobile', 'HEAD', true)
    expect(await repository.branches()).toMatchObject({ current: 'feature/mobile', local: ['feature/mobile', 'main'] })
    await repository.checkout('main')
    expect((await repository.branches()).current).toBe('main')
    expect(await repository.setRemote('origin', 'https://gitlab.example.com/team/mobile-app.git')).toEqual({
      name: 'origin',
      url: 'https://gitlab.example.com/team/mobile-app.git',
      transport: 'https',
    })
    expect(await repository.setRemote('origin', 'git@github.com:example/mobile-app.git')).toEqual({
      name: 'origin',
      url: 'ssh://git@github.com/example/mobile-app.git',
      transport: 'ssh',
    })

    await writeFile(join(root, 'app.ts'), 'dirty\n')
    await expect(repository.checkout('feature/mobile')).rejects.toThrow(/uncommitted/)
    const audit = await readFile(join(root, '.runwhale/git-audit.jsonl'), 'utf8')
    expect(audit).toContain('"operation":"branch"')
    expect(audit).toContain('"operation":"checkout"')
    expect(audit).toContain('"operation":"remote.set"')
    expect(audit).toContain('"outcome":"error"')
  })

  it('rejects materialized links before a repository is exposed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-git-link-'))
    await writeFile(join(root, 'app.ts'), 'safe\n')
    const repository = new MobileGitRepository(root)
    await repository.ensureInitialized()
    await symlink('../outside', join(root, 'escape'))
    await expect(validateMaterializedGitRepository(root)).rejects.toThrow(/links are forbidden/)
  })

  it('blocks committed credentials, keystores, archives, and executable binaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-git-security-'))
    await writeFile(join(root, 'safe.ts'), 'export const safe = true\n')
    await writeFile(join(root, '.env'), 'SERVICE_TOKEN="abcdefghijklmnopqrstuvwxyz123456"\n')
    await writeFile(join(root, 'release.keystore'), 'not-a-real-keystore')
    await writeFile(join(root, 'payload.zip'), Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    await writeFile(join(root, 'program.bin'), Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    const repository = new MobileGitRepository(root)
    await repository.ensureInitialized()

    expect(await inspectGitSnapshotSecurity(root)).toEqual(['.env', 'payload.zip', 'program.bin', 'release.keystore'])
    expect((await repository.inspectShare()).blockers).toContainEqual(expect.objectContaining({ code: 'SENSITIVE_CONTENT' }))
  })

  it('enforces the 500-file snapshot limit before checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-git-file-limit-'))
    await Promise.all(Array.from({ length: 501 }, (_, index) => writeFile(join(root, `file-${index}.txt`), 'x')))
    const repository = new MobileGitRepository(root)
    await repository.ensureInitialized()
    await expect(repository.validateRefTree('HEAD', { maxFiles: 500, maxBytes: 50 * 1024 * 1024, maxFileBytes: 10 * 1024 * 1024 })).rejects.toThrow(/500 file limit/)
  })

  it('routes a private snapshot fetch through the restricted SSH transport adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-git-private-fetch-'))
    const commit = 'a'.repeat(40)
    const refs = vi.spyOn(git, 'listServerRefs')
      .mockRejectedValueOnce(new Error('HTTP 404'))
      .mockResolvedValueOnce([])
    const fetch = vi.spyOn(git, 'fetch').mockRejectedValueOnce(new Error('stop after transport selection'))

    await expect(MobileGitRepository.importGitHubSnapshot(root, {
      owner: 'runwhale',
      repo: 'private-demo',
      commit,
    }, { sshPrivateKey: 'test-device-key' })).rejects.toThrow(/could not be fetched/)

    expect(refs).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://github.com/runwhale/private-demo.git',
      remoteRef: commit,
      depth: 1,
    }))
    vi.restoreAllMocks()
  })

  it('disposes a GitHub SSH inspection transport on success and failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runwhale-git-inspect-ssh-'))
    await writeFile(join(root, 'app.ts'), 'safe\n')
    const repository = new MobileGitRepository(root)
    await repository.ensureInitialized()
    await repository.setRemote('origin', 'git@github.com:runwhale/private-demo.git')
    const head = await git.resolveRef({ fs, dir: root, ref: 'HEAD' })
    const refs = vi.spyOn(git, 'listServerRefs')
      .mockResolvedValueOnce([{ ref: 'refs/heads/main', oid: head }])
      .mockRejectedValueOnce(new Error('SSH offline'))
    sshTransportMocks.dispose.mockClear()

    expect(await repository.inspectShare({ sshPrivateKey: 'test-device-key' })).toMatchObject({ remoteAccessible: true, remoteMatchesHead: true })
    expect(await repository.inspectShare({ sshPrivateKey: 'test-device-key' })).toMatchObject({
      remoteAccessible: false,
      blockers: expect.arrayContaining([expect.objectContaining({ code: 'REMOTE_UNREACHABLE' })]),
    })
    expect(sshTransportMocks.dispose).toHaveBeenCalledTimes(2)

    refs.mockRestore()
  })

  it('accepts only canonical HTTPS GitHub repository URLs', () => {
    expect(normalizeGitHubRepositoryUrl('https://github.com/openai/openai-node')).toBe('https://github.com/openai/openai-node.git')
    expect(normalizeGitHubRepositoryUrl('https://github.com/openai/openai-node.git/')).toBe('https://github.com/openai/openai-node.git')
    expect(() => normalizeGitHubRepositoryUrl('git@github.com:openai/openai-node.git')).toThrow(/https/)
    expect(() => normalizeGitHubRepositoryUrl('https://example.com/openai/openai-node')).toThrow(/github\.com/)
    expect(() => normalizeGitHubRepositoryUrl('https://github.com/openai/openai-node/issues')).toThrow(/owner and repository/)
  })

  it('normalizes provider-neutral HTTPS and GitHub SSH repository URLs without embedded credentials', () => {
    expect(normalizeGitRepositoryUrl('https://gitlab.example.com/group/subgroup/repository.git')).toBe('https://gitlab.example.com/group/subgroup/repository.git')
    expect(normalizeGitRepositoryUrl('git@github.com:openai/openai-node.git')).toBe('ssh://git@github.com/openai/openai-node.git')
    expect(() => normalizeGitRepositoryUrl('https://token@example.com/repository.git')).toThrow(/credentials/)
    expect(() => normalizeGitRepositoryUrl('file:///tmp/repository')).toThrow(/HTTPS or SSH/)
  })
})
