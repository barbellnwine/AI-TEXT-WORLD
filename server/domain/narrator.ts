import {sceneEvidence,collisionProse,collisionGroups,groupNarrativeScenes,actionTrace} from './sceneEvidence.ts'
// NARRATOR adapter. This only ever assembles a plain, literal paragraph from confirmed WorldEvent
// facts — it never invents anything, makes no network call, and costs nothing. It is always
// computed first for every chapter (see worldStore.ts's flushChapter), so a scene is never blocked
// on or lost to a model call. worldStore.ts's enhanceSceneNarration() then tries to replace a
// chapter's scene.title/body with real model prose (see ../prompts/narratorPrompt.ts) shortly
// after; on any failure, budget exhaustion, or demo mode, this deterministic version stands as-is.
import type { Agent, ChronicleEntry, Place, WorldEvent } from './worldTypes.ts'
import { compactProse, eventProse, koreanParticles } from './eventProse.ts'
import { causalStoryOrder } from './novelNarration.ts'

export interface NarratorAdapter {
  // Used for events that don't belong to any hand-authored scene (e.g. an operator-injected
  // event). Must only describe what the given events actually record.
  narrateFallbackScene(events: WorldEvent[], placesById: Map<string, Place>, agentsById: Map<string, Agent>, context?: { genre: string; background: string }): ChronicleEntry
}

export const mockNarrator: NarratorAdapter = {
  narrateFallbackScene(events, placesById, agentsById) {
    const projected=causalStoryOrder(events.filter(e=>e.visibility!=='private'&&e.phase!=='STARTED'&&e.outcome!=='REJECTED'&&
      e.type!=='OPERATOR_EVENT'&&e.cause!=='administrator_created_world'&&e.cause!=='operator_announcement')
      .map(sceneEvidence))
    const first = projected[0]
    const agentIds = [...new Set(projected.flatMap(e => e.agentIds))]
    const motives = new Set<string>()
    const encounters=collisionGroups(projected)
    const paragraphs=groupNarrativeScenes(projected).map(group=>{
      const seen=new Set<string>(),sentences:string[]=[]
      for(const event of group){
        if(seen.has(event.id))continue
        const ids=encounters.find(g=>g.events.some(e=>e.eventId===event.id))?.events.map(e=>e.eventId)??[]
        const exchange=group.filter(e=>ids.includes(e.id)),joined=collisionProse(exchange,agentsById)
        if(joined){exchange.forEach(e=>seen.add(e.id));sentences.push(joined);continue}
        const key=event.detail?`${event.placeId}:${[...event.agentIds].sort().join(':')}:${event.detail.intent}`:''
        const move=event.actionType==='MOVE'&&event.phase==='COMPLETED'?event.stateChanges.find(c=>c.field.startsWith('agent:')&&/:location(?:Id)?$/.test(c.field)):undefined
        const from=move&&placesById.get(move.from)?.name,to=move&&placesById.get(move.to)?.name
        const actor=agentsById.get(event.agentIds[0])?.name
        const trace=actionTrace(event,placesById),duration=trace.durationMinutes
        const long=duration!==null&&duration>=30
        const motive=event.actionMotive?.trim().replace(/뇌의 의도에 따라/g,'').slice(0,160)
        const process=actor&&long&&['MOVE','EXPLORE','OBSERVE'].includes(event.actionType??'')?
          koreanParticles(`${actor}은(는) ${motive?`${motive}는 목적을 두고 `:''}${from??placesById.get(event.placeId)?.name??'그곳'}에서 ${event.actionType==='MOVE'?'이동을 시작했다':event.actionType==='EXPLORE'?'탐색을 시작했다':'주변을 살피기 시작했다'}. ${duration}분 동안 ${event.actionType==='MOVE'?`${to??'목적지'}로 향했다`:`${placesById.get(event.placeId)?.name??'그곳'}에 머물며 행동을 이어 갔다`}.`):''
        const prose=from&&to&&actor?koreanParticles(process?`${process} ${actor}은(는) ${to}에 도착했다.`:`${actor}은(는) ${from}을(를) 떠나 ${to}에 도착했다.`):
          process?`${process} ${eventProse(event,agentsById)}`:
          eventProse(key&&motives.has(key)?{...event,detail:{...event.detail!,intent:''}}:event,agentsById)
        if(key)motives.add(key)
        const clean=prose.match(/(?:순간 이동 결과|validation|tick|candidate|Planner|Brain|grounding|WorldEvent|WORLD STATE|actionType|판정 완료|관리자 이벤트)/i)?'':prose
        if(clean&&!sentences.includes(clean))sentences.push(clean)
        if(event.publicQuote)sentences.push(`“${event.publicQuote}”`)
      }
      return compactProse(sentences,agentsById).join(' ')
    }).filter(Boolean)
    const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16)
    const minuteTime=(minute:number)=>`${String(Math.floor(minute%1440/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`
    return {
      id: `scene-auto-${first.id}`,
      seasonId: 'season-01-eden',
      worldDay: first.day,
      timeStart: first.detail&&first.worldMinute!==undefined&&first.detail.startedMinute<=first.worldMinute&&Math.floor(first.detail.startedMinute/1440)===Math.floor(first.worldMinute/1440)?minuteTime(first.detail.startedMinute):first.worldTime??hhmm(first.occurredAt),
      timeEnd: projected.at(-1)?.worldTime??hhmm(projected.at(-1)?.occurredAt??first.occurredAt),
      title: projected.some(e=>e.detail?.combat) ? `${agentsById.get(projected.find(e=>e.detail?.combat)!.detail!.combat!.attackerId)?.name??'인물'}의 공격` : eventProse(projected.find(e => e.importance === 'high' || e.importance === 'critical') ?? projected.at(-1) ?? first, agentsById),
      body: paragraphs.join('\n\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).join('\n\n'),
      locationIds: [...new Set(projected.map(e => e.placeId))],
      agentIds,
      sourceEventIds: projected.map(e => e.id),
      resolvedActionIds: [...new Set(projected.filter(e => e.actionId && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(e.phase ?? '')).map(e => e.actionId!))],
      stateChanges: projected.flatMap(e => e.stateChanges.filter(c => !c.field.startsWith('knowledge:'))),
      importance: projected.some(e => e.importance === 'critical' || e.importance === 'high') ? 'notable' : 'ordinary',
      createdAt: new Date().toISOString(),
      operator: first.operator,
    }
  },
}
