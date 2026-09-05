import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'

const port = parentPort
if (!port) throw new Error('fixture package worker requires a parent port')
const data = workerData as { staging: string; cacheRoot: string; offline: boolean }
const marker = join(data.cacheRoot, 'fixture-registry-cache')

try {
  if (data.offline) await readFile(marker, 'utf8')
  await mkdir(data.cacheRoot, { recursive: true })
  await writeFile(marker, 'cached\n')
  const packageRoot = join(data.staging, 'node_modules', 'is-number')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), '{"name":"is-number","version":"7.0.0"}\n')
  await writeFile(join(packageRoot, 'index.js'), 'module.exports = value => typeof value === "number"\n')
  const manifest = JSON.parse(await readFile(join(data.staging, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
  await writeFile(join(data.staging, 'package-lock.json'), `${JSON.stringify({
    name: 'fixture',
    lockfileVersion: 3,
    packages: {
      '': { dependencies: manifest.dependencies },
      'node_modules/is-number': {
        version: '7.0.0',
        resolved: 'https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz',
        integrity: 'sha512-YQ==',
      },
    },
  })}\n`)
  port.postMessage({ type: 'done' })
} catch (error) {
  port.postMessage({ type: 'done', error: error instanceof Error ? error.message : String(error) })
}
