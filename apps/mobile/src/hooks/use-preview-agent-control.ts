import { useCallback, useEffect, useState } from 'react'
import { NodeHost } from '@runwhale/node-host'

export function usePreviewAgentControl(projectId: string, sessionId: string, running: boolean, label: string) {
  const [owner, setOwner] = useState<string>()
  const agentLabel = running && owner === sessionId ? label : ''

  const setAgentControl = useCallback((controlled: boolean) => {
    setOwner(controlled && running ? sessionId : undefined)
    NodeHost.setNativePreviewAgentStatus?.(projectId, controlled && running ? label : '')
  }, [label, projectId, running, sessionId])

  useEffect(() => {
    if (!running) setOwner(undefined)
    NodeHost.setNativePreviewAgentStatus?.(projectId, agentLabel)
  }, [agentLabel, projectId, running])

  useEffect(() => {
    setOwner(undefined)
    return () => { NodeHost.setNativePreviewAgentStatus?.(projectId, '') }
  }, [projectId, sessionId])

  return { agentLabel, setAgentControl }
}
