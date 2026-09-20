// NARRATOR adapter. Today this only ever assembles a plain, literal paragraph from confirmed
// WorldEvent facts — it never invents anything. A real NARRATOR plugs in here later by
// implementing NarratorAdapter and being passed into worldStore instead of `mockNarrator`. No
// caller outside this file and worldStore.ts should ever construct scene prose directly.
//
// WHERE A REAL MODEL CALL GOES: build the request with
// `buildNarratorPrompt(events, placesById, agentsById)` from ../prompts/narratorPrompt.ts, send it
// to the configured provider, parse a NarratorOutput ({ title, body, sourceEventIds }) back out,
// verify sourceEventIds matches the events passed in, and record provenance (provider/model/
// promptVersionId from ../prompts/promptVersions.ts) on the resulting WorldEvent's `provenance`
// field before it is ever attached to a public ChronicleEntry.
import type { Agent, ChronicleEntry, Place, WorldEvent } from './worldTypes.ts'

export interface NarratorAdapter {
  // Used for events that don't belong to any hand-authored scene (e.g. an operator-injected
  // event). Must only describe what the given events actually record.
  narrateFallbackScene(events: WorldEvent[], placesById: Map<string, Place>, agentsById: Map<string, Agent>): ChronicleEntry
}

function agentNames(ids: string[], agentsById: Map<string, Agent>): string {
  const names = ids.map(id => agentsById.get(id)?.name ?? id)
  return names.length > 0 ? names.join(', ') : '관측되지 않은 인물'
}

export const mockNarrator: NarratorAdapter = {
  narrateFallbackScene(events, placesById, agentsById) {
    const first = events[0]
    const agentIds = [...new Set(events.flatMap(e => e.agentIds))]
    const paragraphs = events.map(event => {
      const who = agentNames(event.agentIds, agentsById)
      const quote = event.publicQuote ? `\n${event.publicQuote}` : ''
      return `${event.summary}${event.agentIds.length > 0 ? ` (관련 인물: ${who})` : ''}${quote}`
    })
    const isOperator = events.some(e => e.type === 'OPERATOR_EVENT')
    const placeName = placesById.get(first.placeId)?.name ?? first.placeId
    const heading = isOperator ? `[${placeName} · 운영자가 기록한 사건]\n` : `[${placeName}]\n`
    const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16)
    return {
      id: `scene-auto-${first.id}`,
      seasonId: 'season-01-eden',
      worldDay: first.day,
      timeStart: hhmm(first.occurredAt),
      timeEnd: hhmm(events[events.length - 1].occurredAt),
      title: first.title,
      body: heading + paragraphs.join('\n\n'),
      locationIds: [...new Set(events.map(e => e.placeId))],
      agentIds,
      sourceEventIds: events.map(e => e.id),
      stateChanges: events.flatMap(e => e.stateChanges),
      importance: events.some(e => e.importance === 'critical' || e.importance === 'high') ? 'notable' : 'ordinary',
      createdAt: new Date().toISOString(),
      operator: first.operator,
    }
  },
}
