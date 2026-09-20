import { useEffect, useRef, useState } from 'react'
import type { ChronicleEntry, PublicWorldRuntime, WorldEvent, WorldState } from './types'

interface StreamMessage {
  type: 'event' | 'worldState' | 'runtime' | 'scene'
  payload: unknown
}

interface Handlers {
  onEvent?: (event: WorldEvent) => void
  onWorldState?: (worldState: WorldState) => void
  onRuntime?: (runtime: PublicWorldRuntime) => void
  onScene?: (scene: ChronicleEntry) => void
}

// Live transport priority: SSE first (this hook). If EventSource itself is unsupported or the
// connection keeps failing, `connected` stays false and callers should keep relying on their
// initial fetch + manual refresh — no separate polling fallback is wired in yet (see report).
export function useWorldStream(enabled: boolean, handlers: Handlers): { connected: boolean } {
  const [connected, setConnected] = useState(false)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') {
      setConnected(false)
      return
    }
    const source = new EventSource('/api/world/stream')
    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)
    source.onmessage = event => {
      try {
        const message = JSON.parse(event.data) as StreamMessage
        if (message.type === 'event') handlersRef.current.onEvent?.(message.payload as WorldEvent)
        if (message.type === 'worldState') handlersRef.current.onWorldState?.(message.payload as WorldState)
        if (message.type === 'runtime') handlersRef.current.onRuntime?.(message.payload as PublicWorldRuntime)
        if (message.type === 'scene') handlersRef.current.onScene?.(message.payload as ChronicleEntry)
      } catch {
        /* ignore malformed frames */
      }
    }
    return () => {
      source.close()
      setConnected(false)
    }
  }, [enabled])

  return { connected }
}
