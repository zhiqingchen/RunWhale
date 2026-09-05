import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'

const checker = fileURLToPath(new URL('./check-no-secrets.mjs', import.meta.url))
const ignoreRules = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8')
const token = (prefix, length = 32) => prefix + 'A'.repeat(length)

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'runwhale-secret-check-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, 'Fixture Git command must succeed')
  }
  git('init', '-b', 'main')
  git('config', 'user.name', 'Secret scan test')
  git('config', 'user.email', 'secret-scan@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(root, '.gitignore'), ignoreRules)
  writeFileSync(join(root, 'tracked.txt'), 'Public source\n')
  git('add', '.')
  git('commit', '-m', 'Public source')
  const scan = (cwd = root) => {
    const result = spawnSync(process.execPath, [checker], { cwd, encoding: 'utf8' })
    return { status: result.status, output: result.stdout + result.stderr }
  }
  return { root, git, scan }
}

test('clean source passes and Apple private-key files are ignored', (t) => {
  const { root, scan } = fixture(t)
  writeFileSync(join(root, 'AuthKey_test.p8'), ['-----BEGIN', 'PRIVATE KEY-----'].join(' '))
  const result = scan()
  assert.equal(result.status, 0)
  assert.match(result.output, /1 reachable commits/)
})

test('common token formats and private keys fail without exposing source or matches', (t) => {
  const { root, scan } = fixture(t)
  const secrets = [
    token('sk-'), token('sk-proj-'), token('sk-svcacct-'), token('sk-ant-api03-'),
    token('ghp_'), token('github_pat_'), token('AKIA', 16), token('ASIA', 16),
    token('xoxb-'), token('npm_'), token('AIza', 35),
    ['-----BEGIN', 'ENCRYPTED PRIVATE KEY-----'].join(' '),
    ['-----BEGIN', 'OPENSSH PRIVATE KEY-----'].join(' '),
  ]
  writeFileSync(join(root, 'untracked.txt'), secrets.map((value) => `private-context=${value}`).join('\n'))
  const result = scan()
  assert.equal(result.status, 1)
  for (let i = 0; i < secrets.length; i++) {
    assert.ok(result.output.includes(`"untracked.txt":${i + 1}`), 'Each format must have a location')
    assert.ok(!result.output.includes(secrets[i]), 'Secret values must be withheld')
  }
  assert.ok(!result.output.includes('private-context'), 'Source context must be withheld')
})

test('tracked edits and index-only secrets are both checked, including the lockfile', (t) => {
  const { root, git, scan } = fixture(t)
  const secret = token('github_pat_')
  writeFileSync(join(root, 'tracked.txt'), secret)
  writeFileSync(join(root, 'pnpm-lock.yaml'), secret)
  git('add', 'pnpm-lock.yaml')
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'Clean working copy\n')
  const result = scan()
  assert.equal(result.status, 1)
  assert.match(result.output, /Working tree: "tracked.txt":1/)
  assert.match(result.output, /Index: "pnpm-lock.yaml":1/)
  assert.ok(!result.output.includes(secret))
})

test('deleted secrets on another branch are detected when invoked from a subdirectory', (t) => {
  const { root, git, scan } = fixture(t)
  const secret = token('sk-proj-')
  git('checkout', '-b', 'old-branch')
  writeFileSync(join(root, 'removed.txt'), secret)
  git('add', 'removed.txt')
  git('commit', '-m', 'Synthetic fixture')
  git('rm', 'removed.txt')
  git('commit', '-m', 'Remove fixture')
  git('checkout', 'main')
  mkdirSync(join(root, 'nested'))
  const result = scan(join(root, 'nested'))
  assert.equal(result.status, 1)
  assert.match(result.output, /History: "[a-f0-9]+:removed.txt":1/)
  assert.ok(!result.output.includes(secret))
})

test('shallow history fails with instructions to fetch the missing history', (t) => {
  const { root, git, scan } = fixture(t)
  const clone = join(root, 'shallow')
  git('clone', '--depth=1', pathToFileURL(root).href, clone)
  const result = scan(clone)
  assert.equal(result.status, 1)
  assert.match(result.output, /git fetch --unshallow/)
  assert.doesNotMatch(result.output, /No credential patterns found/)
})
