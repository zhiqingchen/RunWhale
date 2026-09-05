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
})
