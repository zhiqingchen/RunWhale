import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { AssistantStreamAccumulator, type StreamChunk } from '@deepseek-ai/dsh-llm'

/** Preserve pre-0.1.5 mobile logs and their sequence references when restoring DSH. */
export function restoreMobileSessionSeed(seed: readonly unknown[]): SessionEvent[] {
  const events = seed as readonly {
    type: string
    seq: number
    time: number
    data: Record<string, unknown>
    sourceEventSeqs?: number[]
  }[]
  const bySequence = new Map(events.map(event => [event.seq, event]))
  return events.map(event => {
    if (event.type === 'assistant/chunk') return { ...event, ignorable: true }
    if (event.type !== 'assistant/message' || Array.isArray(event.data.stream)) return event
    const { sourceEventSeqs, ...rest } = event
    const stream = new AssistantStreamAccumulator()
    for (const seq of sourceEventSeqs ?? []) {
      const source = bySequence.get(seq)
      if (source?.type === 'assistant/chunk') stream.push({ time: source.time, chunk: source.data.chunk as StreamChunk })
    }
    return { ...rest, data: { ...event.data, stream: [...stream.snapshot()] } }
  }) as SessionEvent[]
}
