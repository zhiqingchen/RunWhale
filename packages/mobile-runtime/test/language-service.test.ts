import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MobileTypeScriptService } from '../src/language-service.js'

describe('MobileTypeScriptService', () => {
  it('returns diagnostics and navigation data for an in-memory project', () => {
    const source = `const speed: number = 4\nconst next = speed + 1\nconst bad: string = speed\n`
    const service = new MobileTypeScriptService([{ path: 'app/game.ts', content: source }])
    expect(service.diagnostics('app/game.ts').some((item) => item.code === 2322)).toBe(true)
    const reference = source.indexOf('speed +')
    expect(service.definitions('app/game.ts', reference)[0]?.name).toBe('speed')
    expect(service.references('app/game.ts', reference).length).toBeGreaterThanOrEqual(3)
    service.dispose()
  })

  it('requires monotonic document versions and rejects traversal', () => {
    const service = new MobileTypeScriptService([{ path: 'app/index.ts', content: 'export {}', version: 2 }])
    expect(() => service.update('app/index.ts', 'export {}', 2)).toThrow('must increase')
    expect(() => service.update('../outside.ts', '')).toThrow('invalid source path')
    service.dispose()
  })

  it('reads project configuration and local imports while blocking linked files outside the project', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'runwhale-types-'))
    const root = join(directory, 'project')
    await mkdir(root)
    try {
      await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noUnusedLocals: true, paths: { '@score': ['./score.ts'] } }, include: ['*.ts'] }))
      await writeFile(join(root, 'score.ts'), 'export const score: number = 7')
      await writeFile(join(directory, 'outside.ts'), 'export const outside = "unreadable"')
      await symlink(join(directory, 'outside.ts'), join(root, 'escape.ts'))
      const service = new MobileTypeScriptService([{ path: 'game.ts', content: "import { score } from '@score'; import { outside } from './escape'; export const wrong: string = score; const unused = 1; console.log(outside)" }], { root })
      try {
        const codes = service.diagnostics('game.ts').filter((item) => item.category === 'error').map((item) => item.code)
        expect(codes).toEqual(expect.arrayContaining([2322, 2307, 6133]))
        expect(service.definitions('game.ts', 10)[0]?.fileName).toBe(await realpath(join(root, 'score.ts')))
      } finally { service.dispose() }
      expect(() => new MobileTypeScriptService([], { root, moduleStore: join(root, 'missing-store') })).toThrow('TypeScript environment is unavailable')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
