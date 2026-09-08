import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const metroConfig = createRequire(import.meta.url)('../metro.config.cjs')
const originModulePath = fileURLToPath(new URL('../src/components/PendingButton.tsx', import.meta.url))

describe('Studio Metro resolution', () => {
  it.each(['ios', 'android'])('preserves Uniwind component resolution on %s', (platform) => {
    const resolveRequest = vi.fn((_context: unknown, moduleName: string) => ({
      type: 'sourceFile',
      filePath: `/modules/${moduleName}/index.js`,
    }))

    const result = metroConfig.resolver.resolveRequest(
      { originModulePath, resolveRequest }, 'react-native', platform,
    )

    expect(result.filePath).toBe('/modules/uniwind/components/index.js')
  })

  it('keeps the workspace fallback for TypeScript imports with .js specifiers', () => {
    const missing = new Error('No runtime.js source file')
    const resolveRequest = vi.fn((_context: unknown, moduleName: string) => {
      if (moduleName === './runtime.js') throw missing
      return { type: 'sourceFile', filePath: '/workspace/runtime.ts' }
    })

    const result = metroConfig.resolver.resolveRequest(
      { originModulePath, resolveRequest }, './runtime.js', 'ios',
    )

    expect(result.filePath).toBe('/workspace/runtime.ts')
    expect(resolveRequest.mock.calls.map(([, moduleName]) => moduleName)).toEqual([
      './runtime.js', './runtime',
    ])
  })
})
