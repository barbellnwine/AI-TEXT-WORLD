import type {WorldEvent,WorldState} from '../domain/worldTypes.ts'
import {inContact} from './interactions.ts'
import {recordExperience} from './worldEngine.ts'

function rememberPrivateEvent(world:WorldState,event:WorldEvent,agentIds:string[]){
 for(const id of agentIds){
  const agent=world.agents.find(a=>a.id===id)
  if(!agent)continue
  agent.knowledge.push({id:`knowledge:${event.id}:${id}`,summary:event.summary,sourceEventId:event.id,
    learnedAt:event.occurredAt,acquisition:event.actionType==='OFFSCREEN_ASSAULT'?'experience':'report',verified:event.actionType==='OFFSCREEN_ASSAULT'})
  agent.memories??=[]
  agent.memories.push({id:`memory:${event.id}:${id}`,summary:event.summary,sourceEventIds:[event.id],importance:'high',atMinute:event.worldMinute??world.engine!.minute})
  agent.memories=agent.memories.slice(-30)
  agent.keyEventIds=[event.id,...agent.keyEventIds.filter(existing=>existing!==event.id)].slice(0,50)
 }
}

// Test/operator-confirmed incident only. This is intentionally not an agent action:
// an LLM cannot assert that an assault occurred or use it as a generated strategy.
export function recordOffscreenAssault(world:WorldState,events:WorldEvent[],input:{
  eventId:string;perpetratorId:string;victimId:string
}):WorldEvent{
  if(!world.engine)throw new Error('engine_required')
  if(events.some(e=>e.id===input.eventId))throw new Error('incident_already_recorded')
  const perpetrator=world.agents.find(a=>a.id===input.perpetratorId)
  const victim=world.agents.find(a=>a.id===input.victimId)
  if(!perpetrator||!victim||perpetrator.id===victim.id)throw new Error('invalid_incident_participants')
  if((perpetrator.age??0)<21||(victim.age??0)<21)throw new Error('adult_test_only')
  if(!['alive','injured'].includes(perpetrator.publicState.status)||!['alive','injured'].includes(victim.publicState.status))throw new Error('participant_not_actionable')
  if(perpetrator.publicState.locationId!==victim.publicState.locationId)throw new Error('participants_not_colocated')
  const oldStress=victim.humanState?.stress??0,oldFear=victim.emotion?.fear??0
  const stress=Math.min(10,oldStress+3),fear=Math.min(10,oldFear+3)
  if(victim.humanState)victim.humanState.stress=stress
  if(victim.emotion)victim.emotion.fear=fear
  const relation=victim.relationships.find(r=>r.otherAgentId===perpetrator.id)
  const oldStance=relation?.stance??'neutral',oldTrust=relation?.trust??5
  if(relation){relation.stance='hostile';relation.trust=Math.max(0,oldTrust-4)}
  else victim.relationships.push({agentId:victim.id,otherAgentId:perpetrator.id,stance:'hostile',trust:1})
  const minute=world.engine.minute
  const event:WorldEvent={id:input.eventId,occurredAt:new Date().toISOString(),day:world.clock.day,worldMinute:minute,
    worldTime:world.clock.time,placeId:victim.publicState.locationId,agentIds:[perpetrator.id,victim.id],witnessIds:[],
    type:'CONFLICT',phase:'COMPLETED',actionType:'OFFSCREEN_ASSAULT',cause:'operator_confirmed_test_incident',
    title:'비공개 폭력 사건',summary:`${victim.name}에게 성폭력 사건이 발생했다. 행위는 화면 밖에서 처리되었다.`,
    actionResult:`${victim.name}의 안전과 의사를 우선해 후속 대응이 필요하다.`,
    stateChanges:[{field:`agent:${victim.id}:stress`,from:String(oldStress),to:String(stress)},
      {field:`agent:${victim.id}:fear`,from:String(oldFear),to:String(fear)},
      {field:`relationship:${victim.id}:${perpetrator.id}:stance`,from:oldStance,to:'hostile'},
      {field:`relationship:${victim.id}:${perpetrator.id}:trust`,from:String(oldTrust),to:String(relation?.trust??1)}],
    relatedEventIds:[],importance:'critical',visibility:'private',outcome:'CONFIRMED'}
  events.push(event)
  recordExperience(world,event)
  rememberPrivateEvent(world,event,[perpetrator.id,victim.id])
  victim.nextDecisionAt=minute
  victim.wakeReason='local_danger'
  return event
}

// A recipient learns about the incident only after the victim chooses to disclose it.
export function recordVictimDisclosure(world:WorldState,events:WorldEvent[],input:{
  eventId:string;incidentId:string;victimId:string;recipientId:string;victimAuthorized:true
}):WorldEvent{
  if(!world.engine)throw new Error('engine_required')
  if(events.some(e=>e.id===input.eventId))throw new Error('disclosure_already_recorded')
  const incident=events.find(e=>e.id===input.incidentId&&e.actionType==='OFFSCREEN_ASSAULT'&&e.agentIds[1]===input.victimId)
  const victim=world.agents.find(a=>a.id===input.victimId),recipient=world.agents.find(a=>a.id===input.recipientId)
  if(input.victimAuthorized!==true||!incident||!victim||!recipient||victim.id===recipient.id||!inContact(world,victim.id,recipient.id))throw new Error('disclosure_not_possible')
  const event:WorldEvent={id:input.eventId,occurredAt:new Date().toISOString(),day:world.clock.day,worldMinute:world.engine.minute,
    worldTime:world.clock.time,placeId:victim.publicState.locationId,agentIds:[victim.id,recipient.id],witnessIds:[recipient.id],
    type:'DIALOGUE',phase:'COMPLETED',actionType:'DISCLOSE_INCIDENT',cause:`event:${incident.id}`,
    title:'피해 사실 전달',summary:`${victim.name}이(가) ${recipient.name}에게 사건을 알리고 안전한 도움을 요청했다.`,
    stateChanges:[],relatedEventIds:[incident.id],importance:'critical',visibility:'private',outcome:'CONFIRMED'}
  events.push(event)
  recordExperience(world,event)
  rememberPrivateEvent(world,event,[recipient.id])
  return event
}
