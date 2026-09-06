import { beforeEach, expect, it, vi } from 'vitest'
import { saveProjectShortcut } from '../src/utils/project-shortcut-storage'

const mocks = vi.hoisted(() => ({ copy: vi.fn(), setItem: vi.fn(), prune: vi.fn() }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { setItem: mocks.setItem } }))
vi.mock('react-native', () => ({ Image: { getSize: async () => ({ width: 512, height: 512 }) } }))
vi.mock('expo-asset', () => ({ Asset: {} }))
vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: async () => ({ uri: 'file:///cache/prepared.png' }), SaveFormat: { PNG: 'png' },
}))
vi.mock('expo-file-system', () => {
  class File {
    uri: string
    name: string
    copy = mocks.copy
    delete = mocks.prune
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map(part => typeof part === 'string' ? part : part.uri).join('/')
      this.name = this.uri.split('/').at(-1)!
    }
  }
  return {
    File,
    Directory: class {
      uri = 'file:///documents/project-shortcuts/daily-notes'
      create() {}
      list() { return [new File(this, 'old.png')] }
    },
    Paths: { document: 'file:///documents' },
  }
})

beforeEach(() => vi.resetAllMocks())

it('finishes copying the icon before publishing metadata or pruning the previous icon', async () => {
  let complete!: () => void
  mocks.copy.mockImplementation(() => new Promise<void>(resolve => { complete = resolve }))
  const saving = saveProjectShortcut('daily-notes', { name: 'Daily notes', iconUri: 'file:///photos/icon.png' })
  await vi.waitFor(() => expect(mocks.copy).toHaveBeenCalledOnce())
  expect(mocks.setItem).not.toHaveBeenCalled()
  expect(mocks.prune).not.toHaveBeenCalled()
  complete()
  const saved = await saving
  expect(JSON.parse(mocks.setItem.mock.calls[0][1]).icon).toBe(saved.iconUri.split('/').at(-1))
  expect(mocks.prune).toHaveBeenCalledOnce()
})

it('propagates a failed copy without publishing metadata or deleting the previous icon', async () => {
  mocks.copy.mockRejectedValue(new Error('Copy failed'))
  await expect(saveProjectShortcut('daily-notes', { name: 'Daily notes', iconUri: 'file:///photos/icon.png' })).rejects.toThrow('Copy failed')
  expect(mocks.setItem).not.toHaveBeenCalled()
  expect(mocks.prune).not.toHaveBeenCalled()
})
