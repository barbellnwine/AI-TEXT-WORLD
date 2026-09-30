import {randomUUID} from 'node:crypto'
import type {Agent,WorldState,StateChange} from '../domain/worldTypes.ts'
import type {ProposedAction} from './actionSchema.ts'
import type {ActionDetail,OngoingAction,WorldObject} from './engineTypes.ts'
import {DEFAULT_DISPOSITIONS} from './dispositions.ts'
import {combatOpportunity} from './combatOpportunity.ts'
import {agentPoint,distance,objectPoint,SIGHT_RADIUS} from './spatialWorld.ts'

export const PARTS={HEAD:'머리',TORSO:'몸통',ARM:'팔',LEG:'다리'} as const
export function accessibleObject(world:WorldState,actor:Agent,o:WorldObject){
 return o.quantity>0&&o.condition!=='destroyed'&&(!o.concealedBy||o.concealedBy===actor.id)&&(
  o.location.kind==='agent'?o.location.id===actor.id:
  o.location.id===actor.publicState.locationId&&(o.localArea??'CENTER')===(actor.publicState.localArea??'CENTER')&&distance(agentPoint(actor),objectPoint(o))<=SIGHT_RADIUS&&world.places.find(p=>p.id===o.location.id)?.accessible!==false)
}
export function combatEquipmentError(world:WorldState,action:ProposedAction):string|undefined {
 const actor=world.agents.find(a=>a.id===action.actorId)!
 if(action.defense&&action.actionType!=='OBSERVE')return 'defense_requires_observation'
 if(action.defense&&(!['DODGE','BLOCK'].includes(action.defense)||action.targetIds.length!==1||action.targetIds[0]===actor.id))return 'defense_requires_one_opponent'
 if(action.aim&&!Object.hasOwn(PARTS,action.aim))return 'invalid_aim'
 if(action.pickupItemId&&action.actionType!=='ATTACK')return 'pickup_attack_only'
 if(action.aim&&!['ATTACK','ROB'].includes(action.actionType))return 'aim_requires_attack'
 if(action.actionType!=='ATTACK')return
 if(action.pickupItemId&&action.usedItemIds?.length)return 'choose_one_attack_tool'
 if((action.usedItemIds?.length??0)>1)return 'choose_one_attack_tool'
 const id=action.pickupItemId??action.usedItemIds?.[0]
 if(!id)return
 const o=world.engine!.objects.find(o=>o.id===id)
 if(!o||!accessibleObject(world,actor,o)||!o.physical?.portable||o.physical.attackPower<=0)return 'attack_tool_unavailable'
 if(action.pickupItemId&&o.location.kind!=='place')return 'pickup_requires_ground_object'
 if(!action.pickupItemId&&o.location.kind!=='agent')return 'attack_tool_not_owned'
 if(world.engine!.ongoingActions.some(t=>t.proposal.actorId!==actor.id&&(t.proposal.pickupItemId===id||t.proposal.usedItemIds?.includes(id))))return 'object_reserved'
}
export function preparePhysicalAction(world:WorldState,task:OngoingAction,changes:StateChange[]):ActionDetail {
 const a=world.agents.find(a=>a.id===task.proposal.actorId)!,p=task.proposal
 if(world.engine!.defenses)delete world.engine!.defenses[a.id]
 const detail:ActionDetail={version:1,startedMinute:task.startedMinute,endedMinute:task.completesMinute,intent:p.publicReason??p.intendedAction,steps:[]}
 if(p.pickupItemId){
  const original=world.engine!.objects.find(o=>o.id===p.pickupItemId)!,sourceId=original.id
  let held=original
  if(original.quantity>1){
   const from=original.quantity;original.quantity--
   held={...original,id:randomUUID(),quantity:1,location:{kind:'agent',id:a.id}};world.engine!.objects.push(held)
   changes.push({field:`object:${original.id}:quantity`,from:String(from),to:String(original.quantity)})
  }
  held.location={kind:'agent',id:a.id};held.localArea=undefined
  a.inventory.push(held.id);p.usedItemIds=[held.id];p.pickupItemId=undefined
  changes.push({field:`object:${held.id}:holder`,from:`place:${a.publicState.locationId}`,to:a.id})
  detail.steps.push({minute:task.startedMinute,actorId:a.id,kind:'PICK_UP',objectId:held.id,text:`${a.name}은(는) 발이 닿는 곳의 ${held.name}을(를) 집어 들었다.`})
  detail.equipment={id:held.id,name:held.name,source:'ground',sourceId}
 }
 if(p.actionType==='OBSERVE'&&p.defense&&p.targetIds[0]){
  world.engine!.defenses??={};world.engine!.defenses[a.id]={againstId:p.targetIds[0],kind:p.defense,until:task.completesMinute,reason:detail.intent}
 }
 return detail
}

// Reflexes belong to the defender. They use their own traits/body, not the attacker's prose.
function defense(world:WorldState,target:Agent,attacker:Agent,incoming?:OngoingAction){
 const task=world.engine!.ongoingActions.find(t=>t.proposal.actorId===target.id)
 const explicit=world.engine!.defenses?.[target.id]
 if(task?.proposal.actionType==='SLEEP')return {kind:'UNAWARE' as const,source:'reflex' as const,reason:'잠든 상태여서 공격에 맞춘 대응을 하지 못했다.'}
 if(explicit&&task?.proposal.defense===explicit.kind&&explicit.until>=world.engine!.minute&&explicit.againstId===attacker.id)return {kind:explicit.kind,source:'chosen_action' as const,reason:explicit.reason}
 if(task&&['ATTACK','ROB'].includes(task.proposal.actionType)&&task.proposal.targetIds.includes(attacker.id))return {kind:task.responseToActionId===incoming?.id?'COUNTER' as const:incoming?.responseToActionId===task.id?'CONTINUE_ATTACK' as const:'SIMULTANEOUS' as const,source:'chosen_action' as const,reason:task.proposal.publicReason??'이미 시작한 공격을 이어가려 했다.'}
 if(task?.proposal.actionType==='OBSERVE')return {kind:'BLOCK' as const,source:'chosen_action' as const,reason:task.proposal.publicReason??'상대를 경계하며 공격을 막으려 했다.'}
 const t=target.dispositions??DEFAULT_DISPOSITIONS
 const psyche=target.v2?.human
 const scores=[{kind:'DODGE' as const,score:(10-t.riskTolerance)+(target.emotion?.fear??0)+5-(target.humanState?.fatigue??0)-(target.body?.injury??0)+(psyche?.trauma??0)*.3},
 {kind:'BLOCK' as const,score:t.aggression/2+t.competitiveness/2+3-(target.body?.injury??0)+(psyche?.violenceEscalation??0)*.3},
 {kind:'BRACE' as const,score:(target.humanState?.fatigue??0)+(target.body?.injury??0)-6+(psyche?.trauma??0)*.4}]
 const kind=scores.sort((a,b)=>b.score-a.score)[0].kind
 return {kind,source:'reflex' as const,reason:kind==='DODGE'?'상대와 맞부딪치기보다 몸을 빼 피해를 피하려 했다.':kind==='BLOCK'?'정면으로 오는 공격을 막아 자신을 지키려 했다.':'지친 몸을 움직이기 어려워 충격에 대비하려 했다.'}
}
export function resolvePhysicalCombat(world:WorldState,task:OngoingAction,rollOverride?:number){
 const a=world.agents.find(a=>a.id===task.proposal.actorId)!,b=world.agents.find(a=>a.id===task.proposal.targetIds[0])!,p=task.proposal
 const tool=p.actionType==='ATTACK'?world.engine!.objects.find(o=>o.id===p.usedItemIds?.[0]):undefined
 const detail=task.detail??{version:1,startedMinute:task.startedMinute,endedMinute:task.completesMinute,intent:p.publicReason??p.intendedAction,steps:[]} as ActionDetail
 const reaction=task.adjudication?.reaction??defense(world,b,a,task),aim=p.aim??'TORSO'
 const cover=reaction.kind==='BLOCK'?world.engine!.objects.filter(o=>accessibleObject(world,b,o)&&(o.physical?.cover??0)>0).sort((x,y)=>y.physical!.cover-x.physical!.cover)[0]:undefined
 const random=((Math.imul(world.engine!.combatRng??world.engine!.studio?.config.seed??12345,1664525)+1013904223)>>>0)
 world.engine!.combatRng=random
 const roll=rollOverride??random/4294967296
 const tired=a.humanState?.fatigue??0,injury=a.body?.injury??0
 const opening=combatOpportunity(world,b).opening
 const mobility=Math.max(0,10-(b.humanState?.fatigue??0)-(b.body?.injury??0)/2)
 const functional=(a.trauma?.functions.vision??0)*.3+(a.trauma?.functions.dexterity??0)*.3+(a.trauma?.pain??0)*.01
 const chance=Math.max(.08,Math.min(.95,.86-tired*.035-injury*.025-functional-(aim==='HEAD'?.18:0)-(reaction.kind==='DODGE'?mobility*(1-(b.trauma?.functions.mobility??0))*.055:0)+(reaction.kind==='UNAWARE'?.09:0)))
 const hit=roll<chance
 const base=Math.max(0,Math.min(3,(tired>=9?0:tired>=6?1:2)+opening+(tool?.physical?.attackPower??0)+(aim==='HEAD'?1:0)))
 const blocked=hit&&reaction.kind==='BLOCK'&&roll>chance*.3
 const adjudicated=task.adjudication?.proposal
 const damage=adjudicated?(adjudicated.injury?.severity??0):hit?Math.max(0,base-(blocked?2:0)-(reaction.kind==='BRACE'?1:0)-(cover?.physical?.cover??0)):0
 const outcome=adjudicated?.outcome??(!hit?(reaction.kind==='DODGE'?'DODGED':'MISSED'):(blocked||cover)&&!damage?'BLOCKED':damage?'HIT':'MISSED')
 const part=adjudicated?(adjudicated.injury?.part??null):damage?(blocked?'ARM':aim):null
 const opposed=world.engine!.ongoingActions.find(t=>t.proposal.actorId===b.id&&t.proposal.targetIds.includes(a.id)&&['ATTACK','ROB'].includes(t.proposal.actionType))
 const root=task.responseToActionId??(opposed?.responseToActionId===task.id?task.id:opposed?[task.id,opposed.id].sort().join(':'):task.id)
 detail.exchange=task.adjudication?.exchange??{id:root,role:task.responseToActionId?'response':opposed?.responseToActionId===task.id?'initiator':opposed?'simultaneous':'unlinked',responseToActionId:task.responseToActionId,noticedEventId:task.noticedEventId}
 detail.adjudication=task.adjudication
 detail.combat={method:'CONTACT',attackerId:a.id,targetId:b.id,tool:detail.equipment??{id:tool?.id??null,name:tool?.name??'맨손',source:tool?'inventory':'unarmed'},toolAfter:tool?{kind:'agent',id:a.id}:null,aimedPart:aim,reaction,outcome,injuredPart:part,damage,roll,hitChance:chance}
 if(opening>0)detail.steps.push({minute:task.completesMinute,actorId:a.id,kind:'NOTICE',text:`${a.name}은(는) ${b.name}의 방비가 약해진 것을 보고 그 틈을 노렸다.`})
 if(reaction.kind!=='UNAWARE')detail.steps.push({minute:task.completesMinute,actorId:b.id,kind:'NOTICE',text:`${b.name}은(는) 자신을 향한 공격을 알아차렸다.`})
 detail.steps.push({minute:task.completesMinute,actorId:a.id,kind:'AIM',objectId:tool?.id,text:`${a.name}은(는) ${tool?`${tool.name}을(를) 사용해`:'맨손으로'} ${b.name}의 ${PARTS[aim]}을(를) 노렸다.`})
 detail.steps.push({minute:task.completesMinute,actorId:a.id,kind:'STRIKE',objectId:tool?.id,text:tool?`${a.name}은(는) ${tool.name}을(를) 손에 쥔 채 휘둘렀다.`:`${a.name}은(는) 주먹을 뻗었다.`})
 const response={DODGE:'몸을 빼 피하려 했다',BLOCK:'팔을 들어 막으려 했다',COUNTER:'인지한 공격에 대응해 반격하려 했다',SIMULTANEOUS:'동시에 시작한 자신의 공격을 이어갔다',CONTINUE_ATTACK:'앞서 시작한 공격을 이어갔다',BRACE:'몸을 굳히며 충격에 대비했다',UNAWARE:'잠든 채 대응하지 못했다'}[reaction.kind]
 detail.steps.push({minute:task.completesMinute,actorId:b.id,kind:'DEFEND',objectId:cover?.id,text:cover?`${b.name}은(는) 접근 가능한 ${cover.name}을(를) 엄폐에 이용해 공격을 막으려 했다.`:`${b.name}은(는) ${response}.`})
 const result=outcome==='DODGED'?`${b.name}은(는) 공격을 피했다. 새 부상은 없었다.`:outcome==='BLOCKED'?`${b.name}은(는) 공격을 막아 새 부상을 입지 않았다.`:damage?`${a.name}의 공격이 ${b.name}의 ${PARTS[part as keyof typeof PARTS]}에 닿아 ${damage===1?'가벼운':damage===2?'뚜렷한':'큰'} 부상을 남겼다.`:`${a.name}의 공격은 ${b.name}에게 부상을 입히지 못했다.`
 detail.steps.push({minute:task.completesMinute,actorId:a.id,kind:'RESULT',text:result})
 return {detail,damage,summary:detail.steps.map(s=>s.text).join(' ')}
}
export function captureWitnesses(world:WorldState,actor:Agent,targetId:string|undefined,detail:ActionDetail){
 detail.witnesses=[]
 for(const observer of world.agents.filter(o=>o.id!==actor.id&&o.id!==targetId&&o.publicState.locationId===actor.publicState.locationId&&(o.publicState.localArea??'CENTER')===(actor.publicState.localArea??'CENTER')&&distance(agentPoint(actor),agentPoint(o))<=SIGHT_RADIUS&&!world.engine!.ongoingActions.some(t=>t.proposal.actorId===o.id&&t.proposal.actionType==='SLEEP'))){
  const ally=observer.relationships.find(r=>r.otherAgentId===targetId)
  const concern=detail.combat?((ally?.trust??0)>=7?'ally_safety':'self_safety'):'resource_availability'
  observer.nextDecisionAt=Math.min(observer.nextDecisionAt??Infinity,world.engine!.minute)
  observer.wakeReason=detail.combat?'witnessed_conflict':'witnessed_resource_use'
  detail.witnesses.push({actorId:observer.id,concern,nextDecisionAt:observer.nextDecisionAt})
  // Observation schedules a real decision; it does not manufacture feelings or intervention.
 }
}
