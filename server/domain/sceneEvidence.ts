import {koreanParticles} from './eventProse.ts'
import type {WorldEvent,Agent,Place} from './worldTypes.ts'
// Presentation migration only. Preserve IDs, quantities, injury proposals and immutable raw events.
export function sceneEvidence(e:WorldEvent):WorldEvent{
 const copy=structuredClone(e),d=copy.detail
 if(d?.combat){
  d.steps=d.steps.filter(s=>s.kind!=='WITNESS')
  if(d.combat.reaction.kind==='COUNTER'&&!d.exchange){
   d.combat.reaction={...d.combat.reaction,kind:'CONTINUE_ATTACK',reason:'상대의 별도 공격은 기록되었지만 대응 인지의 근거는 남아 있지 않다.'}
   d.steps=d.steps.filter(s=>s.kind!=='DEFEND') // No verified perception/reaction chronology for this legacy row.
  }
  copy.actionResult=d.steps.map(s=>s.text).join(' ')
 }
 return copy
}
export function collisionProse(events:WorldEvent[],agents:Map<string,{name:string}>):string|null{
 if(events.length!==2||!events.every(e=>e.detail?.combat))return null
 const [a,b]=events,ca=a.detail!.combat!,cb=b.detail!.combat!
 if(ca.attackerId!==cb.targetId||ca.targetId!==cb.attackerId)return null
 const name=(id:string)=>agents.get(id)?.name??'인물',part=(p:string)=>({HEAD:'머리',TORSO:'몸통',ARM:'팔',LEG:'다리'}[p]??'몸')
 const toolSteps=events.flatMap(e=>e.detail!.steps.filter(s=>s.kind==='PICK_UP').map(s=>s.text))
 const strikes=a.worldMinute===b.worldMinute&&ca.tool.source==='unarmed'&&cb.tool.source==='unarmed'&&ca.aimedPart===cb.aimedPart?`같은 시각, 두 사람은 서로의 ${part(ca.aimedPart)}을(를) 겨누고 각자 주먹을 한 번씩 뻗었다.`:events.flatMap(e=>e.detail!.steps.filter(s=>s.kind==='AIM'||s.kind==='STRIKE').map(s=>s.text)).join(' ')
 const results=events.map(e=>{const c=e.detail!.combat!,w=e.detail!.adjudication?.proposal.injury;if(!w)return e.detail!.steps.find(s=>s.kind==='RESULT')?.text??e.actionResult??e.summary
  const type={contusion:'타박상',abrasion:'찰과상',laceration:'열상',fracture:'골절'}[w.type]
  const functions=w.effects.filter(x=>x.degree>0).map(x=>({vision:'시야',mobility:'움직임',dexterity:'손 사용',attention:'집중'}[x.function]))
  return `${name(c.targetId)}은(는) ${part(w.part)}에 ${type}을(를) 입었다.${w.bleeding>0?' 상처에서 피가 흘렀다.':''}${functions.length?` ${functions.join('과 ')}에 불편이 남았다.`:''}`})
 return koreanParticles([...toolSteps,strikes,results.join(' ')].filter(Boolean).join(' '))
}
export function collisionGroups(events:WorldEvent[]){
 const groups=new Map<string,WorldEvent[]>()
 for(const e of events){const c=e.detail?.combat;if(!c||e.phase==='STARTED'||e.visibility==='private'||e.outcome==='REJECTED')continue
  const key=e.detail?.exchange?.id?`exchange:${e.detail.exchange.id}`:`${e.day}:${e.placeId}:${e.worldMinute??e.worldTime}:${[c.attackerId,c.targetId].sort().join(':')}`
  groups.set(key,[...(groups.get(key)??[]),e])
 }
 return [...groups].map(([id,es])=>({id,events:es.map(e=>({eventId:e.id,actionId:e.actionId,actorId:e.detail!.combat!.attackerId,targetId:e.detail!.combat!.targetId,exchange:e.detail!.exchange??{role:'unlinked'},outcome:e.detail!.combat!.outcome,injury:e.detail!.adjudication?.proposal.injury??null})),instruction:'One encounter, each recorded strike exactly once. No additional counterstrike.'}))
}
export function actionTrace(event:WorldEvent,places:Map<string,Place>){
 const movement=event.actionType==='MOVE'?event.stateChanges.find(c=>c.field.startsWith('agent:')&&/:location(?:Id)?$/.test(c.field)):undefined
 const start=event.detail?.startedMinute,end=event.detail?.endedMinute??event.worldMinute
 const placeIds=[movement?.from,movement?.to,event.placeId].filter((id):id is string=>Boolean(id))
 return {startedMinute:start??null,endedMinute:end??null,durationMinutes:start!==undefined&&end!==undefined&&end>=start?end-start:null,
  fromPlaceId:movement?.from??null,toPlaceId:movement?.to??null,
  places:[...new Set(placeIds)].map(id=>({id,name:places.get(id)?.name??id,terrain:places.get(id)?.description?.slice(0,180)??''})),
  recordedSteps:event.detail?.steps.filter(s=>s.kind!=='WITNESS').map(s=>({kind:s.kind,text:s.text}))??[],
  observedAreas:[...new Set(event.perceptions?.filter(p=>p.agentId===event.agentIds[0]).map(p=>p.area)??[])].slice(0,3),
  result:event.actionResult??event.summary,completed:event.phase==='COMPLETED',routeRecorded:false}
}
export function scenePeople(events:WorldEvent[],agents:Map<string,Agent>,objects:Array<{id:string;name:string}>=[]){
 const ids=new Set(events.flatMap(e=>e.agentIds)),eids=new Set(events.map(e=>e.id))
 const relevantObjects=new Set(events.flatMap(e=>[...e.stateChanges.filter(c=>c.field.startsWith('object:')).map(c=>c.field.split(':')[1]),...(e.detail?.steps.flatMap(s=>s.objectId?[s.objectId]:[])??[])]))
 const names=new Map(objects.map(o=>[o.id,o.name]))
 return [...ids].flatMap(id=>{const a=agents.get(id);if(!a)return []
  const others=[...ids].filter(other=>other!==id).map(other=>agents.get(other)?.name).filter(Boolean) as string[]
  const memories=(a.memories??[]).filter(m=>m.sourceEventIds.some(source=>eids.has(source))||others.some(name=>m.summary.includes(name))).slice(-3)
  return [{id,name:a.name,age:a.age??null,gender:a.profile?.gender??null,locationId:a.publicState?.locationId??null,localArea:a.publicState?.localArea??null,status:a.publicState?.status??null,
   relevantInventory:(a.inventory??[]).filter(item=>relevantObjects.has(item)).slice(0,5).map(item=>({id:item,name:names.get(item)??item})),
   injury:a.trauma?.injuries.filter(w=>!w.healed).slice(-3).map(w=>({part:w.part,type:w.type,severity:w.severity,bleeding:w.bleeding}))??[],
   character:(a.shortBio??'').slice(0,240),goal:(a.v2?.decisionV3?.goalDescription??a.v2?.currentGoal??a.publicState?.visibleGoal??'').slice(0,180),
   plan:a.v2?.plan&&!a.v2.plan.abandoned?{stage:a.v2.plan.stage,nextStep:a.v2.plan.nextStep,progress:a.v2.plan.progress}:null,
   recentFailure:a.v2?.recentFailures.slice(-1).map(f=>({actionType:f.actionType,result:f.result,minute:f.minute}))??[],
   knownRelations:(a.relationships??[]).filter(r=>ids.has(r.otherAgentId)).map(r=>({other:r.otherAgentId,stance:r.stance,trust:r.trust,hostility:r.hostility,note:r.note?.slice(0,120)})),
   ownMemories:memories.map(m=>({summary:m.summary.slice(0,160),eventIds:m.sourceEventIds})),knowledgeScope:'This character only; not shared knowledge. Snapshot state is after these events.'}]
 })
}

// Stable scene boundaries are built by code, not left to the writer to infer from actor rows.
export function narrativeSceneUnits(events:WorldEvent[]){
 const visible=events.filter(e=>e.phase!=='STARTED'&&e.visibility!=='private'&&e.outcome!=='REJECTED')
 const groups=collisionGroups(visible),seen=new Set<string>()
 return [...visible].sort((a,b)=>(a.worldMinute??0)-(b.worldMinute??0)).flatMap(e=>{
  if(seen.has(e.id))return []
  const group=groups.find(g=>g.events.some(x=>x.eventId===e.id))
  const ids=group?.events.map(x=>x.eventId)??[e.id];ids.forEach(id=>seen.add(id))
  return [{sceneId:group?.id??e.id,eventIds:ids,events:visible.filter(e=>ids.includes(e.id))}]
 })
}

// Scene continuity requires a shared place, nearby event time, and an actual
// participant or evidence link. Mere adjacency in the journal is insufficient.
export function groupNarrativeScenes(events:WorldEvent[]):WorldEvent[][] {
 const units=narrativeSceneUnits(events),groups:WorldEvent[][]=[]
 for(const unit of units){
   const head=unit.events[0]
   const prior=[...groups].reverse().find(group=>{
    const tail=group.at(-1)!,elapsed=(head.worldMinute??0)-(tail.worldMinute??0)
    const linked=group.some(a=>unit.events.some(b=>a.relatedEventIds.includes(b.id)||b.relatedEventIds.includes(a.id)||
      Boolean(a.detail?.exchange?.id&&a.detail.exchange.id===b.detail?.exchange?.id)))
    const shared=group.some(a=>unit.events.some(b=>a.agentIds.some(id=>b.agentIds.includes(id))))
    return head.placeId===tail.placeId&&elapsed>=0&&elapsed<=60&&(linked||shared)
   })
   if(prior)prior.push(...unit.events)
  else groups.push([...unit.events])
 }
 return groups
}

export function splitNarrativeScenes(events:WorldEvent[]):[WorldEvent[],WorldEvent[]]|null{
 const units=narrativeSceneUnits(events)
 if(units.length<2)return null // Never split one exchange just to fit a transport budget.
 const mid=Math.ceil(units.length/2)
 return [units.slice(0,mid).flatMap(u=>u.events),units.slice(mid).flatMap(u=>u.events)]
}
