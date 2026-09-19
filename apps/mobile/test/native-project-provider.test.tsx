import { Profiler } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { HostEvent } from '@runwhale/mobile-protocol'
import { NativeProjectProvider } from '../src/state/projects-native'
import { useProjects, type ProjectStore } from '../src/state/project-context'

const storage = vi.hoisted(() => new Map<string, string>())
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => storage.get(key) ?? null,
  multiGet: async (keys: string[]) => keys.map((key) => [key, storage.get(key) ?? null]),
  multiSet: async (entries: [string, string][]) => { for (const [key, value] of entries) storage.set(key, value) },
  multiRemove: async (keys: string[]) => { for (const key of keys) storage.delete(key) },
  removeItem: async (key: string) => { storage.delete(key) },
} }))

let tree: ReactTestRenderer
let projects: ProjectStore
let consumerRenders: number
let commits: number
let paths: string[]
const nativeFiles = {
  listProjects: async () => [{ id: 'project', name: 'Project', updatedAt: 1 }],
  createProject: vi.fn(),
  listFiles: vi.fn(async () => paths),
  readFile: vi.fn(async () => ({ content: 'content', version: '1' })),
  writeFile: vi.fn(),
}
function ObserveProjects() {
  projects = useProjects()
  consumerRenders++
  return null
}
const observer = <ObserveProjects />
function view(events: readonly HostEvent[] = []) {
  return <Profiler id="projects" onRender={() => { commits++ }}>
    <NativeProjectProvider nativeFiles={nativeFiles} runtimeReady events={events}>{observer}</NativeProjectProvider>
  </Profiler>
}
function event(sequence: number, name: HostEvent['name'], data: Record<string, unknown> = {}): HostEvent {
  return { v: 1, type: 'event', sequence, timestamp: sequence, name, data: { projectId: 'project', ...data } }
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  storage.clear()
  vi.clearAllMocks()
  paths = ['index.ts']
  consumerRenders = commits = 0
  await act(async () => { tree = create(view()) })
  expect(projects.ready).toBe(true)
  nativeFiles.listFiles.mockClear()
  consumerRenders = commits = 0
})
afterEach(async () => {
  await act(async () => tree?.unmount())
  vi.unstubAllGlobals()
})

it('consumes streaming events without scheduling another render or notifying project consumers', async () => {
  for (let sequence = 1; sequence <= 2; sequence++) {
    await act(async () => tree.update(view([event(sequence, 'agent.delta', { kind: 'tool-call', tool: 'write_files', characters: 4 })])))
  }
  expect(commits).toBe(2)
  expect(consumerRenders).toBe(0)
  expect(nativeFiles.listFiles).not.toHaveBeenCalled()
})

it('refreshes files once per new change batch and terminal event', async () => {
  paths = ['index.ts', 'game.ts']
  const changes = [event(1, 'project.changed', { path: 'index.ts' }), event(2, 'project.changed', { path: 'game.ts' })]
  await act(async () => tree.update(view(changes)))
  expect(projects.projects[0]?.filePaths).toEqual(['game.ts', 'index.ts'])
  expect(nativeFiles.listFiles).toHaveBeenCalledTimes(1)
  expect(consumerRenders).toBeGreaterThan(0)

  await act(async () => tree.update(view([...changes])))
  expect(nativeFiles.listFiles).toHaveBeenCalledTimes(1)

  paths = ['game.ts']
  await act(async () => tree.update(view([...changes, event(3, 'agent.state', { state: 'completed' })])))
  expect(projects.projects[0]?.filePaths).toEqual(['game.ts'])
  expect(nativeFiles.listFiles).toHaveBeenCalledTimes(2)
})
