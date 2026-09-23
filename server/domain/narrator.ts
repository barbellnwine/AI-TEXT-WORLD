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
  narrateFallbackScene(events: WorldEvent[], placesById: Map<string, Place>, agentsById: Map<string, Agent>, context?: { genre: string; background: string }): ChronicleEntry
}

export const mockNarrator: NarratorAdapter = {
  narrateFallbackScene(events, placesById, _agentsById, context) {
    const first = events[0]
    const agentIds = [...new Set(events.flatMap(e => e.agentIds))]
    const groups: Array<{ placeId: string; sentences: string[] }> = []
    for (const event of events) {
      if (event.outcome === 'REJECTED' || event.visibility === 'private' || event.phase === 'STARTED') continue
      const quote = event.publicQuote ? ` “${event.publicQuote}”라는 말이 오갔다.` : ''
      const previous = groups.at(-1)
      const sentence = `${event.summary}${quote}`
      if (previous?.placeId === event.placeId) previous.sentences.push(sentence)
      else groups.push({ placeId: event.placeId, sentences: [sentence] })
    }
    const paragraphs = groups.map(group => `${placesById.get(group.placeId)?.name ?? '기록된 장소'}에서의 기록이다. ${group.sentences.join(' ')}`)
    const isOperator = events.some(e => e.type === 'OPERATOR_EVENT')
    const placeName = placesById.get(first.placeId)?.name ?? first.placeId
    const genre = context?.genre.includes('미스터리') ? '관찰 기록' : context?.genre.includes('생존') ? '생존 기록' : '세계 기록'
    const heading = isOperator ? `[${placeName} · 운영자가 기록한 사건]\n` : `[${placeName}${context ? ` · ${genre}` : ''}]\n`
    const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16)
    return {
      id: `scene-auto-${first.id}`,
      seasonId: 'season-01-eden',
      worldDay: first.day,
      timeStart: hhmm(first.occurredAt),
      timeEnd: hhmm(events[events.length - 1].occurredAt),
      title: (events.find(e => e.importance === 'high' || e.importance === 'critical') ?? events.at(-1) ?? first).title,
      body: heading + paragraphs.join('\n\n'),
      locationIds: [...new Set(events.map(e => e.placeId))],
      agentIds,
      sourceEventIds: events.map(e => e.id),
      stateChanges: events.flatMap(e => e.stateChanges.filter(c => !c.field.startsWith('knowledge:'))),
      importance: events.some(e => e.importance === 'critical' || e.importance === 'high') ? 'notable' : 'ordinary',
      createdAt: new Date().toISOString(),
      operator: first.operator,
    }
  },
}
