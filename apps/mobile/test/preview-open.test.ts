import type { PreviewEndpoint } from '@runwhale/mobile-protocol'
import { describe, expect, it, vi } from 'vitest'
import { resolvePreviewLaunch } from '../src/utils/preview-open'

const activeEndpoint: PreviewEndpoint = {
  projectId: 'active-project',
  platform: 'web',
  revision: 1,
  port: 31_337,
  token: 'active-token',
  bundleUrl: 'http://127.0.0.1:31337/index.bundle?token=active-token',
}

describe('Preview cache-first open', () => {
  it.each(['active', 'cache'] as const)('opens the %s bundle without rebuilding', async (source) => {
    await expect(resolvePreviewLaunch(
      'open',
      async () => ({ status: 'ready', source, endpoint: activeEndpoint }),
    )).resolves.toEqual({ status: 'ready', endpoint: activeEndpoint })
  })

  it('requests a build when the project has no packaged Preview', async () => {
    await expect(resolvePreviewLaunch(
      'open',
      async () => ({ status: 'missing' }),
    )).resolves.toEqual({ status: 'build' })
  })

  it('forces a fresh build for explicit Run / Reload', async () => {
    const openCached = vi.fn(async () => ({ status: 'ready', source: 'active', endpoint: activeEndpoint } as const))

    await expect(resolvePreviewLaunch('run', openCached)).resolves.toEqual({ status: 'build' })
    expect(openCached).not.toHaveBeenCalled()
  })

  it('surfaces cache lookup failures without silently rebuilding', async () => {
    await expect(resolvePreviewLaunch(
      'open',
      async () => { throw new Error('Preview cache is unavailable') },
    )).rejects.toThrow('Preview cache is unavailable')
  })
})
