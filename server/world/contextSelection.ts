import type {AgentKnowledgeView} from './knowledgeFilter.ts'
import type {WorldEvent,StateChange} from '../domain/worldTypes.ts'
export function eventMinute(e:WorldEvent){return e.worldMinute??((e.day-1)*1440+Number((e.worldTime??'00:00').slice(0,2))*60+Number((e.worldTime??'00:00').slice(3,5)))}
export function decisionChanges(e:WorldEvent,selfId:string):StateChange[]{
 return e.stateChanges.filter(c=>c.field.startsWith(`agent:${selfId}:`)||c.field.startsWith(`relationship:${selfId}:`)||c.field.startsWith('interaction:')&&c.field.endsWith(':status')||/^agent:[^:]+:(location|localArea|status)$/.test(c.field)||/^place:[^:]+:(food|water|medicine)$/.test(c.field)).sort((a,b)=>Number(b.field===`agent:${selfId}:trauma`)-Number(a.field===`agent:${selfId}:trauma`)).slice(0,6).map(c=>{
  if(c.field.endsWith(':trauma')){const compact=(s:string)=>{try{const t=JSON.parse(s);return JSON.stringify(t?{pain:t.pain,bloodLoss:t.bloodLoss,functions:t.functions}:null)}catch{return '[invalid trauma record]'}};return {...c,from:compact(c.from),to:compact(c.to)}}
  return {...c,from:c.from.slice(0,160),to:c.to.slice(0,160)}
 })
}
// The input has already passed the per-character knowledge boundary. Selection never reads
// another character's memory, hidden goal, injury details or inventory.
export function selectDecisionContext(view:AgentKnowledgeView){
 const v=structuredClone(view),nearby=new Set(v.othersPresent.map(a=>a.id))
 const recent=[...v.observedEvents].filter(e=>e.visibility!=='private'||e.agentIds.includes(v.self.id)).sort((a,b)=>eventMinute(b)-eventMinute(a)||(b.sequence??0)-(a.sequence??0)||b.id.localeCompare(a.id))
 const own=(e:WorldEvent)=>e.agentIds.includes(v.self.id)
 const protectedEvents=[
  recent.find(e=>own(e)&&!!e.detail?.combat),
  recent.find(e=>e.detail?.combat?.targetId===v.self.id&&e.detail.combat.damage>0||e.stateChanges.some(c=>c.field===`agent:${v.self.id}:trauma`||c.field===`agent:${v.self.id}:injury`&&Number(c.to)>Number(c.from))),
  recent.find(e=>e.agentIds[0]===v.self.id&&(['FAILED','CANCELLED'].includes(e.phase??'')||v.failedEventIds?.includes(e.id))),
  recent.find(e=>own(e)&&e.agentIds[0]!==v.self.id&&(!!e.publicQuote||e.stateChanges.some(c=>c.field.startsWith('interaction:')&&c.field.endsWith(':status')))),
 ].filter((e):e is WorldEvent=>!!e)
 const selected=[...protectedEvents,...recent].filter((e,i,a)=>a.findIndex(x=>x.id===e.id)===i).slice(0,6)
 // The newest witnessed event stays available even when older history is removed for transport.
 const evidence=[...new Map([...protectedEvents,...recent.slice(0,1)].map(e=>[e.id,e])).values()]
 v.decisionEvidence=evidence.map(e=>({eventId:e.id,minute:eventMinute(e),phase:e.phase,actorId:e.agentIds[0],actionType:e.actionType,result:e.detail?.combat?undefined:(e.actionResult??e.summary).slice(0,160),quote:e.publicQuote?.slice(0,240),changes:decisionChanges(e,v.self.id),combat:e.detail?.combat?{attackerId:e.detail.combat.attackerId,targetId:e.detail.combat.targetId,outcome:e.detail.combat.outcome,damage:e.detail.combat.damage,reaction:e.detail.combat.reaction.kind==='COUNTER'&&!e.detail.exchange?'UNLINKED_ATTACK':e.detail.combat.reaction.kind}:undefined}))
 v.observedEvents=selected.map(e=>({id:e.id,occurredAt:e.occurredAt,day:e.day,worldMinute:e.worldMinute,worldTime:e.worldTime,placeId:e.placeId,agentIds:e.agentIds,type:e.type,phase:e.phase,actionId:e.actionId,actionType:e.actionType,title:'',summary:e.detail?.combat?`${e.detail.combat.attackerId} → ${e.detail.combat.targetId}: ${e.detail.combat.outcome}`:(e.actionResult??e.summary).slice(0,140),stateChanges:decisionChanges(e,v.self.id),publicQuote:e.publicQuote?.slice(0,240),importance:e.importance,relatedEventIds:e.relatedEventIds.slice(0,2)})).sort((a,b)=>eventMinute(b)-eventMinute(a))
 v.self.memories=v.self.memories?.sort((a,b)=>b.atMinute-a.atMinute||Number(b.importance==='high')-Number(a.importance==='high')).slice(0,4).map(m=>({...m,summary:m.summary.slice(0,100),sourceEventIds:m.sourceEventIds.slice(-2)}))
 const retained=new Set([...(v.self.memories??[]).flatMap(m=>m.sourceEventIds),...selected.map(e=>e.id)])
 v.knownFacts=v.knownFacts.filter(k=>!k.sourceEventId||!retained.has(k.sourceEventId)).filter(k=>!k.placeId||k.placeId===v.currentPlace.id).slice(-6).map(k=>({...k,summary:k.summary.slice(0,100)}))
 v.relationships=v.relationships.filter(r=>nearby.has(r.otherAgentId)).map(r=>({...r,note:r.note?.slice(0,120)}))
 v.currentPlace.description=v.currentPlace.description.slice(0,180)
 return v
}
