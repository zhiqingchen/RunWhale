import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectIdentity } from '../src/project-identity.js'

it('keeps retries stable but separates same-name projects on other devices and recreated projects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-identity-'))
  try {
    const first = join(root, 'device-one/timer')
    const second = join(root, 'device-two/timer')
    const identities = await Promise.all(Array.from({ length: 8 }, () => projectIdentity(first)))
    expect(new Set(identities).size).toBe(1)
    const id = identities[0]
    expect(await projectIdentity(first)).toBe(id)
    expect(await projectIdentity(second)).not.toBe(id)
    await rm(first, { recursive: true })
    expect(await projectIdentity(first)).not.toBe(id)
  } finally { await rm(root, { recursive: true, force: true }) }
})
