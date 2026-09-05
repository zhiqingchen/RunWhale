import { build } from 'esbuild'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const dshRequire = createRequire(resolve(import.meta.dirname, '../../dsh-mobile/package.json'))
const dshLlmEntry = dshRequire.resolve('@deepseek-ai/dsh-llm')
const dshLlmPackage = JSON.parse(await readFile(dshRequire.resolve('@deepseek-ai/dsh-llm/package.json'), 'utf8'))
const dshCodeWorker = dshRequire.resolve('@deepseek-ai/dsh-code-runtime-worker-thread/worker')
const runtimeBundle = resolve(import.meta.dirname, '../../../native/node-host/runtime/runwhale-runtime.mjs')
const agentRuntimeBundle = resolve(import.meta.dirname, '../../../native/node-host/runtime/runwhale-agent-runtime.mjs')
const runtimeCodeWorker = resolve(import.meta.dirname, '../../../native/node-host/runtime/worker.cjs')
const nodeEsmBanner = "import { createRequire as __runwhaleCreateRequire } from 'node:module';const require=__runwhaleCreateRequire(import.meta.url);const __filename=import.meta.filename;const __dirname=import.meta.dirname;"
let replacedIsomorphicGitJoinCount = 0
const replaceIsomorphicGitJoin = {
  name: 'replace-isomorphic-git-join',
  setup(context) {
    context.onLoad({ filter: /[/\\]isomorphic-git[/\\]index\.(?:cjs|js)$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8')
      const pattern = /\/\*![\s\S]*?This code for `path\.join` is directly copied from @zenfs\/core\/path[\s\S]*?\nfunction join\(\.\.\.args\) \{[\s\S]*?\n\}\n\n(?=\/\/ This is straight from parse_unit_factor)/
      const replacement = "const { posix: runWhalePosixPath } = require('node:path');\nconst join = (...args) => runWhalePosixPath.join(...args);\n\n"
      const contents = source.replace(pattern, replacement)
      if (contents === source) throw new Error(`isomorphic-git path.join seam changed: ${path}`)
      replacedIsomorphicGitJoinCount += 1
      return { contents, loader: 'js' }
    })
  },
}
const inlineDshPackageVersion = {
  name: 'inline-dsh-package-version',
  setup(context) {
    context.onLoad({ filter: /[/\\]@deepseek-ai[/\\]dsh-llm[/\\]lib[/\\]index\.js$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8')
      const contents = source.replace(
        /const \{ version \} = createRequire\(import\.meta\.url\)\("\.\.\/package\.json"\);/,
        `const version = ${JSON.stringify(dshLlmPackage.version)};`,
      )
      if (contents === source) throw new Error(`DSH attribution seam changed: ${dshLlmEntry}`)
      return { contents, loader: 'js' }
    })
  },
}
const makeSshMobileCompatible = {
  name: 'make-ssh-mobile-compatible',
  setup(context) {
    context.onLoad({ filter: /[/\\]ssh2[/\\]lib[/\\]protocol[/\\]crypto\.js$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8')
      const withoutWasmCipher = source.replace(
        "info('chacha20', 8, 64, 0, 16, 0, CIPHER_STREAM)",
        "info('runwhale-disabled-chacha20', 8, 64, 0, 16, 0, CIPHER_STREAM)",
      )
      const contents = withoutWasmCipher.replace(
        /  init: \(\(\) => \{[\s\S]*?\n  \}\)\(\),\n\n  NullCipher,/,
        '  init: Promise.resolve(),\n\n  NullCipher,',
      )
      if (contents === source || contents.includes("require('./crypto/poly1305.js')")) {
        throw new Error(`SSH mobile crypto compatibility seam changed: ${path}`)
      }
      return { contents, loader: 'js' }
    })
    context.onResolve({ filter: /^cpu-features$/ }, () => ({ path: 'cpu-features', namespace: 'ssh-pure-js' }))
    context.onResolve({ filter: /sshcrypto\.node$/ }, () => ({ path: 'sshcrypto.node', namespace: 'ssh-pure-js' }))
    context.onLoad({ filter: /.*/, namespace: 'ssh-pure-js' }, ({ path }) => ({
      contents: path === 'cpu-features' ? 'module.exports = () => undefined' : 'module.exports = undefined',
      loader: 'js',
    }))
  },
}

await build({
  entryPoints: [resolve(import.meta.dirname, '../src/entry.ts')],
  outfile: runtimeBundle,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: [
    '@expo/metro',
    '@expo/metro/*',
    '@expo/metro-config',
    '@expo/metro-config/*',
    'typescript',
  ],
  banner: { js: nodeEsmBanner },
  plugins: [replaceIsomorphicGitJoin, makeSshMobileCompatible],
})

await build({
  entryPoints: [resolve(import.meta.dirname, '../src/agent-runtime-entry.ts')],
  outfile: agentRuntimeBundle,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  banner: { js: nodeEsmBanner },
  plugins: [inlineDshPackageVersion, replaceIsomorphicGitJoin, makeSshMobileCompatible],
})

await build({
  entryPoints: [resolve(import.meta.dirname, '../../mobile-runtime/src/package-worker.ts')],
  outfile: resolve(import.meta.dirname, '../../../native/node-host/runtime/runwhale-package-worker.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  banner: { js: nodeEsmBanner },
  plugins: [replaceIsomorphicGitJoin, makeSshMobileCompatible],
})

// nodejs-mobile intentionally builds without ICU to keep the embedded runtime small.
// The SDK's Python schema renderer only needs stable ASCII class names, so avoid
// Unicode property escapes that V8 rejects when ICU data is unavailable.
const bundledRuntime = await readFile(agentRuntimeBundle, 'utf8')
const mobileCompatibleRuntime = bundledRuntime
  .replace(
    'var IDENTIFIER = new RegExp("^[\\\\p{XID_Start}_]\\\\p{XID_Continue}*$", "u");',
    'var IDENTIFIER = /^[A-Za-z_][0-9A-Za-z_]*$/;',
  )
  .replace(
    'raw.split(/[^\\p{XID_Continue}]+|_+/u)',
    'raw.split(/[^0-9A-Za-z]+|_+/)',
  )
  .replace(
    'new RegExp("^\\\\p{XID_Start}", "u").test(joined)',
    '/^[A-Za-z]/.test(joined)',
  )

if (mobileCompatibleRuntime === bundledRuntime || mobileCompatibleRuntime.includes('p{XID_')) {
  throw new Error('Mobile ICU compatibility seam changed')
}
await writeFile(agentRuntimeBundle, mobileCompatibleRuntime)
await copyFile(dshCodeWorker, runtimeCodeWorker)

await build({
  entryPoints: [resolve(import.meta.dirname, '../../mobile-runtime/src/task-worker.ts')],
  outfile: resolve(import.meta.dirname, '../../../native/node-host/runtime/runwhale-task-worker.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  banner: { js: nodeEsmBanner },
  plugins: [makeSshMobileCompatible],
})

if (replacedIsomorphicGitJoinCount !== 2) {
  throw new Error(`Expected to replace 2 isomorphic-git path.join copies, replaced ${replacedIsomorphicGitJoinCount}`)
}

for (const bundle of [runtimeBundle, agentRuntimeBundle]) {
  const source = await readFile(bundle, 'utf8')
  if (source.includes('@zenfs/core/path') || source.includes('SPDX-License-Identifier: LGPL-3.0-or-later')) {
    throw new Error(`LGPL ZenFS path.join remains in runtime bundle: ${bundle}`)
  }
}
