import { beforeEach, expect, it, vi } from 'vitest'
import { exportSessionLog } from '../src/utils/session-log-download'

const mocks = vi.hoisted(() => ({
  platform: { OS: 'android' }, available: vi.fn(), share: vi.fn(), pick: vi.fn(), copy: vi.fn(), cleanup: vi.fn(), rename: vi.fn(), move: vi.fn(),
  cacheEntries: [] as { name: string; delete(): void }[],
}))
vi.mock('react-native', () => ({ Platform: mocks.platform }))
vi.mock('expo-sharing', () => ({ isAvailableAsync: mocks.available, shareAsync: mocks.share }))
vi.mock('expo-file-system', () => ({
  File: class {
    uri: string
    name = 'dsh-session-test.zip'
    parentDirectory = { name: 'session-fixture', delete: mocks.cleanup }
    copy = mocks.copy
    rename(name: string) { this.name = name; mocks.rename(name) }
    async move() { mocks.move(); this.uri = 'file:///cache/session-log-shares/shared.zip' }
    constructor(uri: string) { this.uri = uri }
  },
  Directory: class {
    static pickDirectoryAsync = mocks.pick
    create() {}
    list() { return mocks.cacheEntries }
  },
  Paths: { cache: 'file:///cache' },
}))
beforeEach(() => {
  vi.resetAllMocks()
  mocks.platform.OS = 'android'
  mocks.available.mockResolvedValue(true)
  mocks.cacheEntries = []
})

it('waits for Android destination copy before removing the temporary archive', async () => {
  const destination = { list: () => [] }
  mocks.pick.mockResolvedValue(destination)
  let complete!: () => void
  mocks.copy.mockImplementation(() => new Promise<void>(resolve => { complete = resolve }))
  const downloading = exportSessionLog(async () => ({ path: '/private/export/dsh-session-test.zip' }), 'Download session log')
  await vi.waitFor(() => expect(mocks.copy).toHaveBeenCalled())
  expect(mocks.cleanup).not.toHaveBeenCalled()
  complete()
  expect(await downloading).toBe('saved')
  expect(mocks.copy).toHaveBeenCalledWith(destination)
  expect(mocks.cleanup).toHaveBeenCalledOnce()
})

it.each(['ERR_PICKER_CANCELLED', 'ERR_FILE_PICKING_CANCELLED'])('treats %s as dismissal and removes the temporary archive', async (code) => {
  mocks.pick.mockRejectedValue({ code })
  await expect(exportSessionLog(async () => ({ path: '/private/export/session.zip' }), 'Download')).resolves.toBeUndefined()
  expect(mocks.cleanup).toHaveBeenCalledOnce()
  expect(mocks.copy).not.toHaveBeenCalled()
})

it('preserves earlier downloads by choosing the next available filename', async () => {
  const destination = { list: () => [{ name: 'dsh-session-test.zip' }, { name: 'dsh-session-test (1).zip' }] }
  mocks.pick.mockResolvedValue(destination)
  await expect(exportSessionLog(async () => ({ path: '/private/export/dsh-session-test.zip' }), 'Download')).resolves.toBe('saved')
  expect(mocks.rename).toHaveBeenCalledWith('dsh-session-test (2).zip')
  expect(mocks.copy).toHaveBeenCalledWith(destination)
})

it('shares a ZIP on iOS and cleans up after a sharing failure', async () => {
  mocks.platform.OS = 'ios'
  mocks.share.mockRejectedValue(new Error('Sharing failed'))
  await expect(exportSessionLog(async () => ({ path: '/private/export/session.zip' }), 'Download', 'share')).rejects.toThrow('Sharing failed')
  expect(mocks.share).toHaveBeenCalledWith('file:///private/export/session.zip', { mimeType: 'application/zip', UTI: 'public.zip-archive', dialogTitle: 'Download' })
  expect(mocks.cleanup).toHaveBeenCalledOnce()
})

it('retains the Android share copy while pruning expired cached shares', async () => {
  const expired = { name: `${Date.now() - 2 * 24 * 60 * 60_000}-old`, delete: vi.fn() }
  const recent = { name: `${Date.now()}-recent`, delete: vi.fn() }
  mocks.cacheEntries = [expired, recent]
  await exportSessionLog(async () => ({ path: '/private/export/session.zip' }), 'Session log', 'share')
  expect(mocks.move).toHaveBeenCalledOnce()
  expect(mocks.share).toHaveBeenCalledWith('file:///cache/session-log-shares/shared.zip', expect.objectContaining({ mimeType: 'application/zip' }))
  expect(expired.delete).toHaveBeenCalledOnce()
  expect(recent.delete).not.toHaveBeenCalled()
  expect(mocks.cleanup).toHaveBeenCalledOnce()
  expect(mocks.pick).not.toHaveBeenCalled()
})

it('downloads on iOS without opening the share sheet', async () => {
  mocks.platform.OS = 'ios'
  mocks.pick.mockResolvedValue({ list: () => [] })
  await expect(exportSessionLog(async () => ({ path: '/private/export/session.zip' }), 'Session log')).resolves.toBe('saved')
  expect(mocks.copy).toHaveBeenCalledOnce()
  expect(mocks.share).not.toHaveBeenCalled()
})
