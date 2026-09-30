import {collisionGroups,groupNarrativeScenes} from './sceneEvidence.ts'
import type { Agent, ChronicleEntry, Place, WorldEvent } from './worldTypes.ts'
import { mockNarrator } from './narrator.ts'

// STATE_UPDATE remains in the journal and state screens. Only consequences belong in a story.
export function storyEvent(e: WorldEvent): boolean {
  if (e.visibility === 'private' || e.outcome === 'REJECTED' || e.phase === 'STARTED') return false
  // Administrative records remain in the journal, never in reader-facing scenes.
  if (e.type === 'OPERATOR_EVENT' || e.cause === 'administrator_created_world' || e.cause === 'operator_announcement') return false
  if (e.type === 'DECISION' && !e.actionType) return false
  if (e.cause === 'world_ended') return true
  if(e.cause==='injury_deterioration_death')return true
  if(e.cause==='injury_progression')return consequentialInjuryProgress(e)
  if (e.phase === 'STATE_UPDATE') return e.stateChanges.some(c => c.field.endsWith(':status') && c.to === 'deceased') || Boolean(e.cause?.startsWith('scheduled:'))
  const longObservation=e.actionType==='OBSERVE'&&e.detail&&e.phase==='COMPLETED'&&e.detail.endedMinute-e.detail.startedMinute>=30&&Boolean(e.actionResult)
  return !(e.actionType === 'WAIT' || e.actionType === 'OBSERVE') || e.stateChanges.length > 0 || Boolean(longObservation)
}

// Keep every progression in WORLD STATE / EVENT LOG. Publish only a clinically or
// functionally consequential crossing; routine pain and mobility drift is not a scene.
export function consequentialInjuryProgress(e:WorldEvent):boolean{
 if(e.stateChanges.some(c=>c.field.endsWith(':status')&&c.to==='deceased'))return true
 const crossed=(a:number,b:number,limits:number[])=>limits.some(t=>a<t&&b>=t)
 return e.stateChanges.some(c=>{
  if(/:(health|injury)$/.test(c.field))return crossed(Number(c.from),Number(c.to),[5,7,9])
  if(!c.field.endsWith(':trauma'))return false
  try{const before=JSON.parse(c.from),after=JSON.parse(c.to);if(!before||!after)return false
   if(crossed(Number(before.bloodLoss??0),Number(after.bloodLoss??0),[1,3]))return true
   if(crossed(Number(before.pain??0),Number(after.pain??0),[5,8]))return true
   return Object.keys(after.functions??{}).some(key=>crossed(Number(before.functions?.[key]??0),Number(after.functions[key]??0),[.5,.8]))
  }catch{return false}
 })
}

// The editor selects evidence, not new sentences. Every paragraph is rendered from engine
// records. Invalid, duplicate, missing, or reversed evidence fails closed.
export function validateEditorialPlan(raw: unknown, events: WorldEvent[]): string[][] | null {
  if (!raw || typeof raw !== 'object') return null
  const groups = (raw as { paragraphs?: unknown }).paragraphs
  if (!Array.isArray(groups) || !groups.length || groups.length > events.length) return null
  const ids: string[] = []
  for (const group of groups) {
    if (!Array.isArray(group) || !group.length || group.some(id => typeof id !== 'string')) return null
    ids.push(...group)
  }
  if(collisionGroups(events).some(g=>!groups.some(ids=>g.events.every(e=>ids.includes(e.eventId)))))return null
  const expected = events.map(e => e.id)
  return ids.length === expected.length && ids.every((id, i) => id === expected[i]) ? groups as string[][] : null
}

export function composeDay(day: number, seasonId: string, events: WorldEvent[], places: Map<string, Place>, agents: Map<string, Agent>, completed: boolean): ChronicleEntry | null {
  const meaningful = events.filter(e => e.day === day && storyEvent(e)).sort((a,b) => (a.worldMinute ?? 0) - (b.worldMinute ?? 0))
  if (!meaningful.length) return null
  // Focus the chapter on consequential threads. Other characters still act in the engine.
  const weight = (e: WorldEvent) => e.cause === 'world_ended' ? 20 : ['DIALOGUE', 'CONFLICT', 'COOPERATION'].includes(e.type) ? 5 : e.stateChanges.some(c => !c.field.endsWith(':fatigue')) ? 3 : 1
  const focus = new Map<string, number>()
  for (const e of meaningful) for (const id of e.agentIds) focus.set(id, (focus.get(id) ?? 0) + weight(e))
  const focal = new Set([...focus].sort((a,b) => b[1]-a[1]).slice(0, 3).map(([id]) => id))
  const selected = meaningful.filter(e => !e.agentIds.length || weight(e) >= 5 || e.agentIds.some(id => focal.has(id)))
  const sections=groupNarrativeScenes(selected)
  const rendered = sections.map(group => mockNarrator.narrateFallbackScene(group, places, agents))
  const base = mockNarrator.narrateFallbackScene(selected, places, agents)
  return { ...base, id: `day-${seasonId}-${day}`, seasonId, worldDay: day, kind: 'DAY', completed,
    title: `DAY ${day} \u00B7 ${completed ? '\uC644\uB8CC\uB41C \uD558\uB8E8' : '\uC9C4\uD589 \uC911\uC778 \uD558\uB8E8'}`,
    timeStart: selected[0].worldTime ?? base.timeStart, timeEnd: selected.at(-1)!.worldTime ?? base.timeEnd,
    body: rendered.map((scene, i) => `${sections[i][0].worldTime ?? ''} \u00B7 ${places.get(sections[i][0].placeId)?.name ?? ''}\n\n${scene.body}`).join('\n\n\uFF0A \uFF0A \uFF0A\n\n'),
    createdAt: selected.at(-1)!.occurredAt,
  }
}
