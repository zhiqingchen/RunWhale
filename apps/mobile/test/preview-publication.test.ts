import { MOBILE_HOST_PROTOCOL_VERSION, type HostEvent } from '@runwhale/mobile-protocol'
import { describe, expect, it } from 'vitest'
import { latestAgentPreviewPublication } from '../src/utils/preview-publication'

function ready(sequence: number, projectId: string, revision: number, requestedBySessionId?: string): HostEvent {
  return {
    v: MOBILE_HOST_PROTOCOL_VERSION,
    type: 'event',
    sequence,
    timestamp: sequence,
    name: 'preview.ready',
    data: {
      projectId,
      platform: 'ios',
      revision,
      port: 31_337 + sequence,
      token: `token-${sequence}`,
      bundleUrl: `http://127.0.0.1:${31_337 + sequence}/index.bundle?token=token-${sequence}`,
      ...(requestedBySessionId ? { requestedBySessionId } : {}),
    },
  }
}

describe('Agent Preview publication', () => {
  it('selects only a new Agent publication for the current project', () => {
    const events = [
      ready(1, 'current-project', 1),
      ready(2, 'other-project', 2, 'other-session'),
      ready(3, 'current-project', 2, 'older-session'),
      ready(4, 'current-project', 3, 'newer-session'),
    ]

    expect(latestAgentPreviewPublication(events, 'current-project', 'newer-session', 2)).toMatchObject({
      sequence: 4,
      endpoint: { projectId: 'current-project', revision: 3, requestedBySessionId: 'newer-session' },
    })
    expect(latestAgentPreviewPublication(events, 'current-project', 'older-session', 2)).toMatchObject({
      sequence: 3,
      endpoint: { projectId: 'current-project', revision: 2, requestedBySessionId: 'older-session' },
    })
    expect(latestAgentPreviewPublication(events, 'current-project', 'newer-session', 4)).toBeUndefined()
    expect(latestAgentPreviewPublication(events.slice(0, 2), 'current-project', 'current-session', 0)).toBeUndefined()
  })
})
