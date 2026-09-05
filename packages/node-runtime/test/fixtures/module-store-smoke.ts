import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativePreviewModulesFor } from '@runwhale/mobile-runtime/native-preview-modules'
import { RUNTIME_ABI } from '@runwhale/mobile-runtime/manifest'
import { MobileMetroRuntime, type MetroPlatform } from '../../src/metro-runtime.js'

const moduleStore = resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('module store path is required')
const additionalWatchRoots = process.argv.slice(3).map((path) => resolve(path))
const runnerRoot = dirname(fileURLToPath(import.meta.url))
const projectsRoot = join(runnerRoot, 'projects')
await mkdir(projectsRoot)
const result: Record<string, boolean> = {}
for (const platform of ['ios', 'android'] as const) {
  await bundleCatalog(platform)
  result[platform] = true
}
console.log(JSON.stringify(result))

async function bundleCatalog(platform: Extract<MetroPlatform, 'ios' | 'android'>): Promise<void> {
  const project = await mkdtemp(join(projectsRoot, `module-store-${platform}-`))
  const modules = nativePreviewModulesFor(platform)
  const imports = modules.map((module, index) => module.name === 'react-native'
    ? `import { View as Module${index} } from 'react-native'`
    : `import * as Module${index} from ${JSON.stringify(module.name)}`)
  const references = modules.map((module, index) => module.name === 'react-native'
    ? `typeof Module${index}`
    : `Object.keys(Module${index}).length`).join(', ')
  const metro = new MobileMetroRuntime(moduleStore, additionalWatchRoots, false)
  try {
    await mkdir(join(project, 'src'))
    await Promise.all([
      writeFile(join(project, 'package.json'), `${JSON.stringify({
        name: `runwhale-module-store-${platform}`,
        private: true,
        dependencies: Object.fromEntries(modules.map((module) => [module.name, module.version])),
      }, null, 2)}\n`),
      writeFile(join(project, 'runwhale.json'), `${JSON.stringify({
        schemaVersion: 1,
        id: `module-store-${platform}`,
        name: `Module store ${platform}`,
        runtimeAbi: { [platform]: RUNTIME_ABI[platform] },
        entry: { [platform]: 'src/index.ts' },
        preview: { target: 'native' },
        capabilities: [],
        tasks: {},
        source: { kind: 'local' },
      }, null, 2)}\n`),
      writeFile(join(project, 'src/index.ts'), `${imports.join('\n')}\nglobalThis.__runwhaleModuleStoreSmoke = [${references}]\n`),
    ])

    const bundle = await metro.bundle(project, platform)
    if (!bundle.code.includes('__runwhaleModuleStoreSmoke') || bundle.code.length <= 100_000) {
      throw new Error(`${platform} module-store smoke bundle is incomplete`)
    }
  } finally {
    await metro.stop()
    await rm(project, { recursive: true, force: true })
  }
}
