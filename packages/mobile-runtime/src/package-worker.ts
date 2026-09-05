import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { parentPort, workerData } from 'node:worker_threads'

interface WorkerData {
  npmRoot: string
  staging: string
  cacheRoot: string
  offline: boolean
}

const port = parentPort
if (!port) throw new Error('package worker requires a parent message port')
const data = workerData as WorkerData
const require = createRequire(import.meta.url)

// npm must never obtain a subprocess escape hatch on mobile. Registry packages
// are pure JavaScript and lifecycle scripts and bin links are disabled below.
const childProcess = require('node:child_process') as Record<string, unknown>
const subprocessDenied = (): never => { throw new Error('subprocesses are disabled in the mobile npm worker') }
for (const name of ['exec', 'execFile', 'execFileSync', 'execSync', 'fork', 'spawn', 'spawnSync']) childProcess[name] = subprocessDenied

const output = new Writable({
  write(chunk, _encoding, callback) {
    port.postMessage({ type: 'output', chunk: Buffer.from(chunk).toString('utf8') })
    callback()
  },
})

try {
  process.argv = ['node', join(data.npmRoot, 'bin/npm-cli.js')]
  const Npm = require(join(data.npmRoot, 'lib/npm.js')) as new (options: Record<string, unknown>) => {
    load(): Promise<{ exec: boolean; command?: string; args?: string[] }>
    exec(command: string, args?: string[]): Promise<void>
    unload(): void
  }
  const argv = [
    'install',
    `--prefix=${data.staging}`,
    `--cache=${data.cacheRoot}`,
    '--registry=https://registry.npmjs.org/',
    `--userconfig=${join(data.staging, '.npmrc-user-disabled')}`,
    `--globalconfig=${join(data.staging, '.npmrc-global-disabled')}`,
    '--ignore-scripts=true',
    '--foreground-scripts=false',
    '--bin-links=false',
    '--install-links=false',
    '--workspaces=false',
    '--audit=false',
    '--fund=false',
    '--update-notifier=false',
    '--package-lock=true',
    '--omit=dev',
    '--progress=false',
    '--logs-max=0',
    '--fetch-retries=2',
    '--fetch-timeout=120000',
    '--maxsockets=4',
    ...(data.offline ? ['--offline=true'] : []),
  ]
  const npm = new Npm({ stdout: output, stderr: output, npmRoot: data.npmRoot, argv, excludeNpmCwd: true })
  try {
    const loaded = await npm.load()
    if (!loaded.exec || !loaded.command) throw new Error('embedded npm did not resolve the install command')
    await npm.exec(loaded.command, loaded.args)
  } finally {
    npm.unload()
  }
  port.postMessage({ type: 'done' })
} catch (error) {
  port.postMessage({ type: 'done', error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) })
}
