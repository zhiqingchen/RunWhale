import { describe, expect, it } from 'vitest'
import { readTextProjectFiles } from '../src/utils/project-text-files'

describe('project text files', () => {
  it('keeps readable files in project order and skips binary files', async () => {
    const files = await readTextProjectFiles(['README.md', 'logo.png', 'runwhale.json'], async (path) => {
      if (path === 'logo.png') throw new TypeError('binary files cannot be read as text')
      return { content: path }
    })

    expect(files).toEqual([
      { path: 'README.md', content: 'README.md' },
      { path: 'runwhale.json', content: 'runwhale.json' },
    ])
  })

  it('does not hide unexpected project read failures', async () => {
    await expect(readTextProjectFiles(['README.md'], async () => {
      throw new Error('embedded runtime disconnected')
    })).rejects.toThrow('embedded runtime disconnected')
  })
})
