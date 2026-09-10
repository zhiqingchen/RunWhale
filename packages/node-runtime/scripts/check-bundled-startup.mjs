import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const startupProbe = String.raw`
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { isBuiltin, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const rootUrl = pathToFileURL(root + '/').href
// A repository node_modules directory must not hide missing mobile dependencies.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context)
    if (!isBuiltin(result.url) && !result.url.startsWith(rootUrl)) {
      throw new Error('Cold startup loaded a dependency outside the bundled runtime: ' + specifier)
    }
    return result
  },
})
assert.equal(typeof WebAssembly, 'undefined')
process.argv = ['node', root + '/runwhale-runtime.mjs', root, root + '/node_modules']
await import(rootUrl + 'runwhale-runtime.mjs')
const { origin, token } = JSON.parse(await readFile(root + '/.runwhale/host.json', 'utf8'))
const response = await fetch(origin + '/rpc', {
  method: 'POST',
  headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
  body: JSON.stringify({ v: 1, type: 'request', id: 'cold-startup', method: 'host.snapshot', params: { afterSequence: 0 } }),
})
assert.equal(response.status, 200)
const reply = await response.json()
assert.equal(reply.ok, true)
assert.equal(reply.result.snapshot.state, 'running')
assert.deepEqual(await readdir(root + '/node_modules'), [])
process.exit(0)
`

export async function checkBundledStartup(bundle) {
  const cache = resolve(import.meta.dirname, '../../../.cache')
  await mkdir(cache, { recursive: true })
  const root = await mkdtemp(join(cache, 'runtime-cold-start-'))
  try {
    await copyFile(bundle, join(root, 'runwhale-runtime.mjs'))
    await mkdir(join(root, 'node_modules'))
    const result = spawnSync(process.execPath, ['--jitless', '--input-type=module', '--eval', startupProbe], {
      cwd: root,
      env: {},
      encoding: 'utf8',
      timeout: 30_000,
      killSignal: 'SIGKILL',
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Bundled runtime failed cold startup (exit ${result.status}):\n${result.stderr}`)
    console.log('Bundled runtime starts without installed dependencies in jitless Node.')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
