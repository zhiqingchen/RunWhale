import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { usePreviewAgentControl } from '../src/hooks/use-preview-agent-control'

const setNativeStatus = vi.hoisted(() => vi.fn())
vi.mock('@runwhale/node-host', () => ({ NodeHost: { setNativePreviewAgentStatus: setNativeStatus } }))

let tree: ReactTestRenderer
afterEach(async () => {
  await act(async () => tree?.unmount())
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('marks Agent opens and interactions, clears user opens and completed runs, and isolates sessions', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let control!: ReturnType<typeof usePreviewAgentControl>
  function Harness({ running = true, session = 'first' }: { running?: boolean; session?: string }) {
    control = usePreviewAgentControl('notes', session, running, 'Model operating')
    return null
  }
  await act(async () => { tree = create(<Harness />) })
  expect(control.agentLabel).toBe('')
  await act(async () => control.setAgentControl(true))
  expect(control.agentLabel).toBe('Model operating')
  expect(setNativeStatus).toHaveBeenLastCalledWith('notes', 'Model operating')
  await act(async () => control.setAgentControl(false))
  expect(control.agentLabel).toBe('')
  expect(setNativeStatus).toHaveBeenLastCalledWith('notes', '')
  await act(async () => control.setAgentControl(true))
  await act(async () => tree.update(<Harness running={false} />))
  expect(control.agentLabel).toBe('')
  await act(async () => tree.update(<Harness />))
  expect(control.agentLabel).toBe('')
  await act(async () => control.setAgentControl(true))
  await act(async () => tree.update(<Harness session="second" />))
  expect(control.agentLabel).toBe('')
  expect(setNativeStatus).toHaveBeenLastCalledWith('notes', '')
  await act(async () => tree.update(<Harness />))
  expect(control.agentLabel).toBe('')
})
