import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import appConfig from '../app.json'

const require = createRequire(import.meta.url)
const withIosRuntimeDependencies = require('../plugins/with-ios-runtime-dependencies')

async function generatedGuard() {
  const config = withIosRuntimeDependencies({ name: 'RunWhale', slug: 'runwhale' })
  const result = await config.mods.ios.podfile({
    ...config,
    modRequest: {},
    modResults: { contents: '  post_install do |installer|\n  end\n' },
  })
  return result.modResults.contents.split('  post_install')[0]
}

describe('iOS prebuilt runtime dependencies', () => {
  it('includes the guard in the canonical Expo configuration', () => {
    expect(appConfig.expo.plugins).toContain('./plugins/with-ios-runtime-dependencies')
  })

  // Execute the generated Ruby condition, including the failed artifact-probe case.
  it.skipIf(process.platform !== 'darwin')('rejects source dependencies with prebuilt consumers', async () => {
    const guard = await generatedGuard()
    for (const [depsSource, coreSource, expoPrebuilt, succeeds] of [
      [false, false, true, true],
      [true, false, true, false],
      [true, true, true, false],
      [true, true, false, true],
    ]) {
      const result = spawnSync('ruby', ['-e', `
        class ReactNativeDependenciesUtils
          def self.build_react_native_deps_from_source; ${depsSource}; end
        end
        class ReactNativeCoreUtils
          def self.build_rncore_from_source; ${coreSource}; end
        end
        ENV['EXPO_USE_PRECOMPILED_MODULES'] = '${expoPrebuilt ? '1' : '0'}'
        ${guard}
      `], { encoding: 'utf8' })
      expect(result.error).toBeUndefined()
      expect(result.status === 0).toBe(succeeds)
      if (!succeeds) expect(result.stderr).toContain('RunWhale requires ReactNativeDependencies.framework')
    }
  })

  it.skipIf(process.platform !== 'darwin')('detects a missing transitive framework in a real Mach-O bundle', () => {
    const root = mkdtempSync(join(tmpdir(), 'runwhale-framework-test-'))
    try {
      const app = join(root, 'Fixture.app')
      const framework = join(app, 'Frameworks/Dependency.framework')
      mkdirSync(framework, { recursive: true })
      const dependency = join(framework, 'Dependency')
      const source = join(root, 'dependency.c')
      writeFileSync(source, 'int dependency(void) { return 0; }\n')
      execFileSync('xcrun', ['clang', '-dynamiclib', source, '-o', dependency,
        '-install_name', '@rpath/Dependency.framework/Dependency'])
      const consumer = join(app, 'Frameworks/Consumer.framework')
      mkdirSync(consumer)
      writeFileSync(source, 'extern int dependency(void); int consumer(void) { return dependency(); }\n')
      execFileSync('xcrun', ['clang', '-dynamiclib', source, dependency, '-o', join(consumer, 'Consumer'),
        '-install_name', '@rpath/Consumer.framework/Consumer'])
      const validator = fileURLToPath(new URL('../../../scripts/validate-ios-framework-dependencies.sh', import.meta.url))
      expect(execFileSync('bash', [validator, app], { encoding: 'utf8' }))
        .toContain('Validated 1 required embedded framework references')
      rmSync(framework, { recursive: true })
      const missing = spawnSync('bash', [validator, app], { encoding: 'utf8' })
      expect(missing.status).toBe(1)
      expect(missing.stderr).toContain('Missing embedded framework: @rpath/Dependency.framework/Dependency')
      expect(missing.stderr).toContain('required by Frameworks/Consumer.framework/Consumer')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
