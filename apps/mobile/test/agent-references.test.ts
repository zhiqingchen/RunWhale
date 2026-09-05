import { describe, expect, it } from 'vitest'
import { filterProjectReferencePaths, insertAgentReference, isSafeProjectReferencePath, projectReferenceLoadReducer } from '../src/utils/agent-references'

describe('agent composer references', () => {
  it('excludes internal, dependency, generated, absolute, and traversing paths in one shared filter', () => {
    expect(filterProjectReferencePaths([
      'src/app.tsx',
      'node_modules/pkg/index.js',
      '.git/config',
      '.runwhale/sessions/private.json',
      'dist/bundle.js',
      'coverage/index.html',
      '../outside.txt',
      '/private/file',
      'src/app.tsx',
      'README.md',
    ])).toEqual(['README.md', 'src/app.tsx'])
    expect(isSafeProjectReferencePath('src/../secret')).toBe(false)
    expect(isSafeProjectReferencePath('C:/secret.txt')).toBe(false)
  })

  it('inserts file and session references without damaging existing input', () => {
    expect(insertAgentReference('Review', 'src/app.tsx')).toBe('Review @src/app.tsx ')
    expect(insertAgentReference('', 'session:abc')).toBe('@session:abc ')
  })

  it('keeps failed reference loading distinct from an empty ready result and permits retry', () => {
    expect(projectReferenceLoadReducer('loading', 'fail')).toBe('failed')
    expect(projectReferenceLoadReducer('failed', 'start')).toBe('loading')
    expect(projectReferenceLoadReducer('loading', 'succeed')).toBe('ready')
  })
})
