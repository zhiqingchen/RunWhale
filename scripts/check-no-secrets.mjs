import { spawnSync } from 'node:child_process'

// Keep these compatible with Git's extended regular expressions.
const patterns = [
  'sk-[A-Za-z0-9]{20,}',
  'sk-(proj|svcacct|ant-api[0-9]{2})-[A-Za-z0-9_-]{20,}',
  'gh[pousr]_[A-Za-z0-9]{20,}',
  'github_pat_[A-Za-z0-9_]{20,}',
  '(AKIA|ASIA)[0-9A-Z]{16}',
  'xox[baprs]-[A-Za-z0-9-]{20,}',
  'npm_[A-Za-z0-9]{20,}',
  'AIza[A-Za-z0-9_-]{35}',
  'BEGIN ([A-Z0-9]+ )*PRIVATE KEY',
].join('|')

function git(args, allowedStatuses = [0]) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.error || !allowedStatuses.includes(result.status)) {
    // Git diagnostics can contain source or credentials. Never forward them.
    throw new Error('Git could not complete the secret scan.')
  }
  return result.stdout
}

function scan(label, options) {
  const output = git(['grep', '-n', '-z', '-I', '-o', '-E', '-e', patterns, ...options, '--', '.'], [0, 1])
  let offset = 0
  const locations = new Set()
  while (offset < output.length) {
    const fileEnd = output.indexOf('\0', offset)
    const lineEnd = output.indexOf('\0', fileEnd + 1)
    const matchEnd = output.indexOf('\n', lineEnd + 1)
    if (fileEnd < offset || lineEnd < 0 || matchEnd < 0) throw new Error('Git returned an invalid scan result.')
    const file = output.slice(offset, fileEnd)
    const line = output.slice(fileEnd + 1, lineEnd)
    if (!/^\d+$/.test(line)) throw new Error('Git returned an invalid line number.')
    locations.add(`${JSON.stringify(file)}:${line}`)
    offset = matchEnd + 1
  }
  for (const location of locations) console.error(`${label}: ${location}`)
  return locations.size
}

try {
  process.chdir(git(['rev-parse', '--show-toplevel']).trim())
  if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    throw new Error('Full history is required. Run git fetch --unshallow before scanning.')
  }
  let findings = scan('Working tree', ['--untracked', '--exclude-standard'])
  findings += scan('Index', ['--cached'])
  const commits = git(['rev-list', '--all', 'HEAD']).trim().split('\n')
  for (const commit of commits) findings += scan('History', [commit])
  if (findings) {
    console.error('Possible credential material found. Source lines and secret values are withheld.')
    process.exitCode = 1
  } else {
    console.log(`No credential patterns found in the working tree, index, or ${commits.length} reachable commits.`)
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
