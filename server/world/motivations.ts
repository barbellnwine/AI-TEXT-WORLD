import {buildAgentKnowledgeView} from './knowledgeFilter.ts'
import {eventMinute} from './contextSelection.ts'
import {accessibleObject} from './physicalActions.ts'
import {contextualSpeech} from './socialVoice.ts'
import { combatOpportunity } from './combatOpportunity.ts'
import type { Agent, WorldEvent, WorldState } from '../domain/worldTypes.ts'
import type { ProposedAction } from './actionSchema.ts'
import { DEFAULT_DISPOSITIONS, parseDispositions } from './dispositions.ts'
import { inContact } from './interactions.ts'
import { decisionPerception } from './decisionPerception.ts'
import { LOCAL_AREAS } from './actionSchema.ts'
import { informationUtility } from './informationUtility.ts'
import { agentPoint,distance,searchDestination } from './spatialWorld.ts'

export function ensureMotivations(actor: Agent, _minute: number, longTerm = actor.publicState.visibleGoal ?? '') {
  actor.dispositions ??= { ...DEFAULT_DISPOSITIONS }
  actor.motivations ??= { version: 1, longTerm, goals: [] }
  // Old saves get defaults once; time and outcome history are never reset.
  actor.dispositions = parseDispositions(actor.dispositions)
  return actor.motivations
}

export function observePossessions(world: WorldState, e: WorldEvent) {
  if (e.phase !== 'COMPLETED' || e.visibility === 'private') return
  const offer = world.engine!.interactions?.find(i => i.sourceEventId === e.id && i.offerItemId)
  const ids = [...new Set([...e.stateChanges.filter(c => c.field.startsWith('object:') && c.field.endsWith(':holder')).map(c => c.field.slice(7,-7)), ...(offer?.offerItemId ? [offer.offerItemId] : [])])]
  for (const observer of world.agents.filter(a => e.witnessIds?.includes(a.id) || e.agentIds.includes(a.id))) {
    if (world.engine!.ongoingActions.some(t => t.proposal.actorId === observer.id && t.proposal.actionType === 'SLEEP')) continue
    observer.observedPossessions ??= []
    for (const id of ids) {
      const object = world.engine!.objects.find(o => o.id === id)
      if (!object || object.location.kind !== 'agent') continue
      observer.observedPossessions = observer.observedPossessions.filter(o => o.id !== id)
      observer.observedPossessions.push({ id, ownerId: object.location.id, name: object.name, kind: object.kind, atMinute: world.engine!.minute, sourceEventId: e.id })
    }
    observer.observedPossessions = observer.observedPossessions.slice(-40)
  }
}

export function rememberGoalChoice(world: WorldState, action: ProposedAction) {
  const actor = world.agents.find(a => a.id === action.actorId)!, state = ensureMotivations(actor, world.engine!.minute)
  const prior = actor.v2?.decisionV3
  const continuing = prior?.status === 'active' && ['CONTINUE','MODIFY','COMPLETE'].includes(action.decisionV3?.transition ?? '')
  const goal = continuing ? prior.goal : action.goalKey ?? action.intent ?? action.actionType
  const targetId = continuing ? prior.targetId : action.targetIds[0]
  const objectId = continuing ? prior.itemId : action.usedItemIds?.[0]
  let current = [...state.goals].reverse().find(g => g.goal === goal && g.targetId === targetId && g.objectId === objectId && g.status !== 'achieved')
  if (!current) { current = { id: `${goal}:${targetId ?? ''}:${objectId ?? ''}:${world.engine!.minute}:${state.goals.length}`, goal, targetId, objectId, status: 'active', attempts: 0, failures: 0, createdMinute: world.engine!.minute, updatedMinute: world.engine!.minute, evidenceEventIds: [] }; state.goals.push(current) }
  const id = current.id
  const previous = state.goals.find(g => g.id === state.currentId)
  if (previous && previous.id !== id && previous.status === 'active') previous.status = 'abandoned'
  current.status = 'active'; current.attempts++; current.updatedMinute = world.engine!.minute; state.currentId = id
  state.goals = state.goals.slice(-24)
  return current
}

export function rememberGoalResult(world: WorldState, e: WorldEvent) {
  if (!e.actionId || e.outcome === 'REJECTED' || !e.actionType || !['COMPLETED','FAILED','CANCELLED'].includes(e.phase ?? '')) return
  const reply = world.engine!.interactions?.find(i => e.stateChanges.some(c => c.field === `interaction:${i.id}:status`))
  for (const actor of world.agents.filter(a => a.id === e.agentIds[0] || a.id === reply?.actorId)) {
  const state = ensureMotivations(actor, world.engine!.minute)
  const goal = state.goals.find(g => g.actionIds?.includes(e.actionId!)) ?? (reply?.actorId === actor.id ? [...state.goals].reverse().find(g => g.status === 'active' && g.evidenceEventIds.includes(reply.sourceEventId!)) : undefined)
  if (!goal || goal.evidenceEventIds.includes(e.id)) continue
  goal.updatedMinute = world.engine!.minute; goal.evidenceEventIds.push(e.id); goal.evidenceEventIds = goal.evidenceEventIds.slice(-12)
  const physicalGain = e.stateChanges.some(c => c.field.endsWith(':holder') && c.to === actor.id || c.field === `agent:${actor.id}:survival_need` && Number(c.to) < Number(c.from))
  const recovered = e.stateChanges.some(c => c.field === `agent:${actor.id}:fatigue` && Number(c.to) < Number(c.from))
  const changedPlace = e.stateChanges.some(c => c.field === `agent:${actor.id}:location` || c.field === `agent:${actor.id}:localArea`)
  const failed = e.phase !== 'COMPLETED' || reply?.actorId === actor.id && reply.status === 'refused' || e.actionType === 'EXPLORE' && !e.stateChanges.some(c => c.field.startsWith('knowledge:')) || ['STEAL','ROB'].includes(e.actionType) && !physicalGain
  if (failed) { goal.failures++; goal.status = 'blocked' }
  // A request, threat, attack or acceptance alone does NOT fulfill a resource goal.
  if (/SUPPLIES|RESOURCE|FOOD|WATER/.test(goal.goal) && physicalGain || goal.goal === 'RECOVER' && recovered || goal.goal === 'LEAVE_DANGER' && changedPlace) goal.status = 'achieved'
  if (goal.goal === 'KEEP_RESERVE' && e.stateChanges.some(c => c.field.endsWith(':concealed') && c.to === 'true')) goal.status = 'achieved'
  if (goal.goal === 'BUILD_TRUST' && e.stateChanges.some(c => c.field.startsWith(`relationship:${actor.id}:`) && c.field.endsWith(':trust') && Number(c.to)>Number(c.from))) goal.status = 'achieved'
  }
}

export interface Candidate {
  id: string; goal: string; action: ProposedAction
  benefit: number; cost: number; risk: number; fit: number; relationship: number; continuity: number; score: number; evidenceEventIds: string[]
  reasonCodes?: string[]
}

export function observeLocalObjects(world: WorldState, actorId: string) {
  const actor=world.agents.find(a=>a.id===actorId)
  if(!actor||!world.engine)return
  const placeId=actor.publicState.locationId,localArea=actor.publicState.localArea??'CENTER'
  const visible=world.engine.objects.filter(o=>o.location.kind==='place'&&accessibleObject(world,actor,o))
  const visibleIds=new Set(visible.map(o=>o.id))
  actor.observedObjects=(actor.observedObjects??[]).filter(o=>o.placeId!==placeId||o.localArea!==localArea||visibleIds.has(o.id))
  for(const o of visible){
    actor.observedObjects=actor.observedObjects.filter(x=>x.id!==o.id)
    actor.observedObjects.push({id:o.id,name:o.name,kind:o.kind,placeId,localArea,position:o.position,atMinute:world.engine.minute})
  }
  actor.observedObjects=actor.observedObjects.slice(-30)
}

// Only self, observed actors/items, public local stocks and known paths are inputs. No
// opponent's private traits, needs, inventory or goals may enter utility calculations.
export function deliberation(world: WorldState, actorId: string, events: WorldEvent[] = []) {
  world = decisionPerception(world, actorId, events)
  const actor = world.agents.find(a => a.id === actorId)!, engine = world.engine!
  const traits = actor.dispositions ?? DEFAULT_DISPOSITIONS
  const place = world.places.find(p => p.id === actor.publicState.locationId)!
  const h = actor.vitals?.hunger ?? actor.humanState?.survival_need ?? 0, t = actor.vitals?.thirst ?? h, fatigue = actor.humanState?.fatigue ?? 0
  const need = Math.max(h,t), safety = Math.max(actor.emotion?.fear ?? 0, actor.body?.injury ?? 0), belonging = actor.vitals?.loneliness ?? 0
  const contacts = world.agents.filter(a => a.id !== actor.id && inContact(world, actor.id, a.id))
  const visibleDistant=world.agents.filter(a=>a.id!==actor.id&&a.publicState.locationId===actor.publicState.locationId&&(a.publicState.localArea??'CENTER')===(actor.publicState.localArea??'CENTER')&&!inContact(world,actor.id,a.id)&&distance(agentPoint(actor),agentPoint(a))<=.28)
  const stocks = place.resources.filter(r => ['food','water','식량','식수'].includes(r.key))
  const scarce = stocks.reduce((sum,r) => sum+r.level,0) < (contacts.length+1)*2
  const survivorTarget=engine.objectiveStatus?.targets.find(t=>t.type==='survivors'&&t.gap>0)
  const battle = Boolean(survivorTarget && engine.competition?.lastSurvivor)
  const endMinute = engine.competition?.endMinute
  const battlePressure = battle && endMinute && Number.isFinite(endMinute) ? Math.max(0,Math.min(1,engine.minute/endMinute)) : 0
  const motivation = actor.motivations
  const observed=buildAgentKnowledgeView(actorId,world,events)?.observedEvents??[]
  const encounters=observed.filter(e=>e.detail?.combat && [e.detail.combat.attackerId,e.detail.combat.targetId].includes(actorId) && engine.minute-eventMinute(e)>=0 && engine.minute-eventMinute(e)<360).sort((a,b)=>eventMinute(b)-eventMinute(a))
  const suffered=encounters.filter(e=>e.detail!.combat!.targetId===actorId).reduce((n,e)=>n+e.detail!.combat!.damage,0)
  const choices: Candidate[] = []
  const add = (goal: string, actionType: ProposedAction['actionType'], benefit: number, cost: number, risk: number, fit: number, relationship: number, why: string, extra: Partial<ProposedAction> = {}, evidence: string[] = []) => {
    // Persistence and repetition are scored once in evaluateV2. Legacy motivation
    // records remain as historical evidence for migrated seasons.
    const continuity = 0
    const action: ProposedAction = { actorId, locationId: place.id, actionType, targetIds: [], intendedAction: goal, publicReason: why, goalKey: goal, ...extra }
    const loss=actor.trauma?.functions
    cost+=['MOVE','EXPLORE'].includes(actionType)?(loss?.mobility??0)*12:['ATTACK','ROB'].includes(actionType)?((loss?.vision??0)+(loss?.dexterity??0))*10:0
    // Outcomes affect options, not compulsory scripts. More pain makes effort expensive;
    // aggressive risk-takers can still choose to continue, cautious actors value cover/exit.
    if(encounters.length){
      const pain=actor.trauma?.pain??actor.body?.injury??0
      if(['ATTACK','ROB'].includes(actionType))cost+=pain*1.5+suffered*(1-traits.riskTolerance/10)
      if(actionType==='OBSERVE')benefit+=suffered*(1+(10-traits.riskTolerance)/5)
      if(actionType==='MOVE')benefit+=suffered*(10-traits.riskTolerance)/3
      if(goal==='TREAT_INJURY')benefit+=suffered*2
      if(goal==='DEESCALATE')benefit+=suffered*traits.negotiation/5
    }
    const score = benefit + fit + relationship + continuity - cost - risk*(1.6-traits.riskTolerance/10)
    choices.push({ id: `choice-${choices.length}`, goal, action, benefit, cost, risk, fit, relationship, continuity, score: Math.round(score*10)/10, evidenceEventIds: evidence })
  }
  for (const r of stocks.filter(r=>r.level>=1)) {
    const food = ['food','식량'].includes(r.key)
    if ((food?h:t)>=3) add('SECURE_SUPPLIES',food?'EAT':'DRINK',(food?h:t)*2,1,0,traits.selfInterest/2,0,food?'허기를 달랠 수 있는 식량이 이곳에 남아 있었다.':'갈증을 해소할 식수가 이곳에 남아 있었다.',{resourceKey:r.key,intent:food?'SEARCH_FOOD':'SEARCH_WATER'})
  }
  const owned = engine.objects.filter(o=>o.location.kind==='agent'&&o.location.id===actorId&&o.quantity>0&&o.condition!=='destroyed')
  if(actor.trauma?.injuries.some(w=>!w.healed&&w.treatedAt===null)){
    const medicine=owned.find(o=>o.kind==='medicine'),stock=place.resources.find(r=>['medicine','의약품'].includes(r.key)&&r.level>=1)
    if(medicine||stock)add('TREAT_INJURY','USE_ITEM',15+actor.trauma.pain,2,safety/2,10-traits.impulsivity,0,'상처의 출혈과 기능 저하가 이어져 확보한 의약품으로 처치하려 했다.',medicine?{usedItemIds:[medicine.id]}:{resourceKey:stock!.key})
    for(const other of contacts)add('SEEK_TREATMENT','SPEAK',8+actor.trauma.pain,1,2,traits.trust,0,'상처를 혼자 감당하기 어려워 눈앞의 사람에게 도움을 청하려 했다.',{targetIds:[other.id],intent:'REQUEST_HELP',spokenText:'상처 때문에 힘들어. 처치를 도와줄 수 있어?'})
  }
  for(const o of owned) {
    if (['food','water'].includes(o.kind) && need>=3) add('SECURE_SUPPLIES','USE_ITEM',need*2,1,0,traits.selfInterest/2,0,'소지한 식량이나 물로 당장의 부족함을 해결하려 했다.',{usedItemIds:[o.id]})
    if (scarce && ['food','water'].includes(o.kind) && !o.concealedBy) add('KEEP_RESERVE','HIDE',need+5,2,1,traits.selfInterest+traits.competitiveness/2-traits.empathy/2,0,'물자가 부족한 상황에서 자신의 비축분을 드러내지 않으려 했다.',{usedItemIds:[o.id]})
  }
  for(const invitation of engine.interactions?.filter(i=>i.targetId===actorId&&i.status==='pending'&&i.expiresMinute>engine.minute)??[]) {
    if (!contacts.some(c=>c.id===invitation.actorId)) continue
    const relation=actor.relationships.find(r=>r.otherAgentId===invitation.actorId)
    for(const response of ['ACCEPT','REFUSE'] as const) add(response==='ACCEPT'?'BUILD_TRUST':'KEEP_AUTONOMY','SPEAK',8,1,0,response==='ACCEPT'?traits.trust+traits.negotiation:(10-traits.trust)+traits.selfInterest,response==='ACCEPT'?(relation?.trust??5)-5:0,'상대가 건넨 제안에 자신의 입장을 답하려 했다.',{replyTo:invitation.id,response,targetIds:[invitation.actorId],spokenText:response==='ACCEPT'?'그 제안을 받아들이겠어.':'그 제안은 받아들이기 어려워.',intent:'SOCIAL'},invitation.sourceEventId?[invitation.sourceEventId]:[])
  }
  for(const other of visibleDistant)add('APPROACH_CONTACT','EXPLORE',3+belonging+safety/2,2+fatigue/2,1,traits.negotiation+traits.trust/2,0,`${other.name}이(가) 보이는 방향으로 접근해 거리를 좁히려 했다.`,{areaHint:actor.publicState.localArea as typeof LOCAL_AREAS[number]??'CENTER',searchPoint:other.publicState.position??{x:.5,y:.5}})
  for(const other of contacts) {
    const relation=actor.relationships.find(r=>r.otherAgentId===other.id), trust=relation?.trust??traits.trust, hostility=relation?.hostility??0
    if(Math.max(h,t,fatigue,actor.body?.injury??0)>=7){
      const condition=t>=h&&t>=fatigue?'갈증':h>=fatigue?'허기':'피로'
      add('SEEK_HELP','SPEAK',Math.max(h,t,fatigue)*.8,1,1,traits.trust+traits.negotiation/2,0,`${condition}가 심해 현재 상태를 알리고 도움을 구하려 했다.`,{targetIds:[other.id],intent:'SELF_STATE_DISCLOSURE',spokenText:`${condition}가 심해. 쓸 수 있는 방법을 같이 찾을 수 있을까?`})
    }
    if (trust >= 5) for (const item of owned.slice(0,2)) add('BUILD_TRUST','GIVE_ITEM',2+trust,2,1,traits.empathy+traits.negotiation/2-traits.selfInterest/2,trust/2,`${other.name}와의 관계를 지키기 위해 자신이 가진 ${item.name}을 건네려 했다.`,{targetIds:[other.id],usedItemIds:[item.id]})
    for (const fact of actor.knowledge.slice(-8)) {
      const utility=informationUtility(world,actor,other.id,fact)
      if(utility>0)add('SHARE_RELEVANT_FACT','SHARE_INFO',utility,1,1,traits.trust/2+traits.empathy/2,trust/3,`${other.name}에게 현재 판단에 도움이 될 수 있는 확인된 사실을 전달하려 했다.`,{targetIds:[other.id],factId:fact.id},fact.sourceEventId?[fact.sourceEventId]:[])
    }
    const threatened=engine.ongoingActions.some(a=>['ATTACK','ROB'].includes(a.proposal.actionType)&&a.proposal.actorId===other.id&&a.proposal.targetIds.includes(actorId))
    const guarded=engine.ongoingActions.some(a=>a.proposal.actorId===other.id&&['OBSERVE','ATTACK','ROB'].includes(a.proposal.actionType))
    // Injured is an observable status. Precise strength and private state remain unknown.
    const opening = combatOpportunity(world, other).opening
    const retaliation=Math.max(0, (other.publicState.status==='injured'?3:7)+(guarded?3:0)+hostility/3+Math.max(0,contacts.length-1)-opening*3)
    const known=(actor.observedPossessions??[]).filter(o=>o.ownerId===other.id&&['food','water'].includes(o.kind))
    const evidence=known.map(o=>o.sourceEventId)
    if(scarce||belonging>3||known.length) {
      add('SECURE_SUPPLIES','SPEAK',need*0.8+belonging/2+2,1,1,traits.empathy+traits.trust/2,trust/2,'혼자 확보하기 어려운 물자를 상대에게 부탁하려 했다.',{targetIds:[other.id],intent:'REQUEST_HELP',spokenText:'지금 물자가 필요한데, 조금 나눠 줄 수 있어?'},evidence)
      add('BUILD_TRUST','COOPERATE',need+belonging+2,2,2,traits.empathy+traits.trust,trust/2,'혼자서보다 함께 부족한 물자를 찾을 방법을 의논하려 했다.',{targetIds:[other.id],intent:'PROPOSE_SURVIVAL_PLAN'},evidence)
      add('ASSESS_OPPORTUNITY','OBSERVE',need*0.35+1,2,0,traits.selfInterest+traits.competitiveness/2+(10-traits.impulsivity)/2,0,'곧바로 요구하거나 충돌하기 전에 눈앞의 상황을 살피려 했다.',{targetIds:[other.id],intent:'KEEP_WATCH'},evidence)
      for(const item of known) {
        for(const mine of owned.slice(0,3)) add('SECURE_SUPPLIES','SPEAK',need+6,3,1,traits.negotiation*2,trust/2,'상대에게서 본 물자를 자신의 소지품과 교환하려 했다.',{targetIds:[other.id],intent:'NEGOTIATE',offerItemId:mine.id,requestItemId:item.id,spokenText:`내 ${mine.name}과 네가 보여 준 ${item.name}을 바꿀 수 있을까?`},[item.sourceEventId])
        add('SECURE_SUPPLIES','STEAL',need+8+opening*4,3+fatigue/2,retaliation+2,traits.selfInterest+traits.competitiveness-traits.empathy, -trust/2,'상대에게서 확인한 물자를 몰래 가져올 기회를 노리려 했다.',{targetIds:[other.id],usedItemIds:[item.id]},[item.sourceEventId])
        add('SEIZE_RESOURCE','ROB',need+9,4+fatigue,retaliation+4,traits.selfInterest+traits.aggression+traits.impulsivity/2-traits.empathy*1.5,-trust,'상대에게서 확인한 물자를 힘으로 빼앗는 위험을 감수하려 했다.',{targetIds:[other.id],usedItemIds:[item.id]},[item.sourceEventId])
      }
    }
    if(threatened){
      for(const defense of ['DODGE','BLOCK'] as const)add('DEFEND_SELF','OBSERVE',23,1,2,defense==='DODGE'?10-traits.riskTolerance:traits.aggression,0,defense==='DODGE'?'자신을 향한 공격과 맞부딪치기보다 몸을 빼 피하려 했다.':'상대를 경계하며 공격을 막아 자신의 몸을 지키려 했다.',{targetIds:[other.id],defense,intent:'KEEP_WATCH'})
    }
    if(actor.wakeReason==='witnessed_conflict')add('PROTECT_CONTACT','SPEAK',traits.empathy+8,1,2,traits.negotiation,trust/2,'앞서 목격한 충돌을 떠올려 상대에게 멈추자고 경고하려 했다.',{targetIds:[other.id],intent:'WARN',spokenText:'잠깐 멈춰. 먼저 이야기하자.'})
    const grievance=actor.v2?.human.resentment[other.id]??0
    if(hostility>=4||grievance>=3||scarce&&known.length>0&&traits.aggression>=6)
      add('PRESS_RIVAL','SPEAK',hostility+grievance+need*.5,1,retaliation/2,
        traits.aggression+traits.competitiveness/2,-trust/3,
        `${other.name}과의 갈등을 공격 전에 말로 압박해 물러설 기회를 주려 했다.`,
        {targetIds:[other.id],intent:'THREATEN',spokenText:'더 가까이 오지 마. 지금은 물러서.'})
    // Combat motives remain broader than resource greed: immediate defense, hostility and
    // the publicly supplied battle-royale premise all contribute without requiring combat.
    const prior=encounters.filter(e=>{const c=e.detail!.combat!;return c.attackerId===other.id||c.targetId===other.id})
    const last=prior[0],lastCombat=last?.detail?.combat
    const ownAttempts=prior.filter(e=>e.detail!.combat!.attackerId===actorId)
    const missed=ownAttempts.filter(e=>e.detail!.combat!.damage===0).length
    const injuryReceived=prior.filter(e=>e.detail!.combat!.targetId===actorId).reduce((n,e)=>n+e.detail!.combat!.damage,0)
    const outcomeReason=lastCombat?lastCombat.targetId===actorId?`${other.name}의 직전 공격${lastCombat.damage>0?'으로 부상을 입은 뒤':'을 피해를 입지 않고 넘긴 뒤'}`:`직전 시도에서 ${other.name}에게 ${lastCombat.damage>0?'타격을 가했지만':'피해를 주지 못했고'}`:''
    const conflictMemory=actor.memories?.filter(m=>m.summary.includes(other.name)).at(-1)
    const survivalReason=known.length&&need>=3?`${other.name}이(가) 지닌 물자가 생존에 필요했다`:injuryReceived>0?`${other.name}에게 다시 다치기 전에 위협을 줄여야 했다`:other.publicState.status==='injured'&&battle?`부상당한 경쟁자 ${other.name}이(가) 회복하기 전에 위험을 판단했다`:battle?`남은 생존 시간과 경쟁자를 고려해 ${other.name}의 위협을 줄이려 했다`:`${other.name}과의 적대 관계로 안전을 위협받았다`
    const why=lastCombat?`${outcomeReason}, ${threatened?'이어지는 공격을 저지하려 했다':survivalReason}.`:threatened?`${other.name}의 진행 중 공격을 인지해 그 공격을 저지하려 했다.`:`${survivalReason}.`
    const pressureBenefit=battlePressure*Math.max(0,traits.aggression+traits.competitiveness+traits.riskTolerance-traits.empathy-(actor.emotion?.fear??0)-(actor.body?.injury??0))/3
    if(threatened||hostility>0||battle) add(threatened?'DEFEND_SELF':'CONFRONT_RIVAL','ATTACK',(threatened?24:hostility*2+(battle?7:0))+pressureBenefit-missed*4-(threatened?0:Math.min(12,ownAttempts.length*4)),3+fatigue,retaliation+injuryReceived,traits.aggression+traits.competitiveness+traits.impulsivity/2-traits.empathy,-trust/2,why,{targetIds:[other.id]},last?[last.id]:conflictMemory?.sourceEventIds.slice(-2)??[])
    if(threatened||hostility>0||lastCombat){add('DEESCALATE','SPEAK',10+safety,1,retaliation/2,traits.negotiation+traits.empathy,trust/2,`${outcomeReason||other.name+'과 충돌할 위험 때문에'} 서로 물러설 수 있는지 협상하려 했다.`,{targetIds:[other.id],intent:'NEGOTIATE',spokenText:'여기서 서로 물러나자.'})}
  }
  const attacks=choices.filter(c=>c.action.actionType==='ATTACK')
  for(const c of attacks){
    // A defensive strike aims to interrupt the attacking arm. A committed aggressive
    // strike may risk the smaller head target; otherwise choose a larger contact area.
    c.action.aim=c.goal==='DEFEND_SELF'?'ARM':traits.aggression>=8&&traits.riskTolerance>=7&&fatigue<6?'HEAD':'TORSO'
    c.action.publicReason+=c.action.aim==='ARM'?' 공격하는 팔을 겨눠 방해하려 했다.':c.action.aim==='HEAD'?' 빗맞을 위험을 감수하고 머리를 겨누려 했다.':' 무리하게 좁은 부위를 노리기보다 몸통을 겨누려 했다.'
    for(const o of engine.objects.filter(o=>accessibleObject(world,actor,o)&&o.physical?.portable&&o.physical.attackPower>0).slice(0,3)){
      const action={...c.action,usedItemIds:o.location.kind==='agent'?[o.id]:[],pickupItemId:o.location.kind==='place'?o.id:undefined}
      choices.push({...c,id:`choice-${choices.length}`,action,benefit:c.benefit+o.physical!.attackPower,cost:c.cost+1,score:c.score+o.physical!.attackPower-1})
    }
  }
  for(const o of engine.objects.filter(o=>o.location.kind==='place'&&accessibleObject(world,actor,o)&&o.physical?.portable!==false)) {
    const weapon=(o.physical?.attackPower??0)>0
    const resource=o.kind==='food'?h:o.kind==='water'?t:o.kind==='medicine'?actor.trauma?.pain??0:0
    const goal=weapon?'PREPARE_PROTECTION':resource>0?'SECURE_SUPPLIES':'SECURE_RESOURCE'
    const benefit=weapon?safety+3+(o.physical?.attackPower??0)*2:resource*2+2
    add(goal,'TAKE_ITEM',benefit,2,1,weapon?traits.riskTolerance+traits.competitiveness:traits.selfInterest,0,
      `눈앞에 있는 ${o.name}을(를) 확보해 다음 행동에 쓰려 했다.`,{usedItemIds:[o.id]})
  }
  add('RECOVER','REST',fatigue*2+(actor.exposure?.wetness??0),2,safety/2,(10-traits.impulsivity)/2,0,'지친 몸을 회복해 다음 행동을 이어가려 했다.',{intent:'RECOVER',durationMinutes:60})
  add('KEEP_SAFE','OBSERVE',safety*2+3,1,0,10-traits.riskTolerance,0,'바로 움직이기 전에 주변 위험을 확인하려 했다.',{intent:'KEEP_WATCH'})
  const recentSightings=observed.filter(e=>e.placeId && e.visibility!=='private' &&
    (e.witnessIds?.includes(actorId)||e.agentIds.includes(actorId)) &&
    e.agentIds.some(id=>id!==actorId) && e.actionType!=='MOVE' &&
    engine.minute-eventMinute(e)>=0 && engine.minute-eventMinute(e)<720)
    .sort((a,b)=>eventMinute(b)-eventMinute(a))
  for(const id of place.connectedPlaceIds.filter(id=>actor.knownPlaceIds?.includes(id))) {
    if(!survivorTarget||safety>=5||engine.ongoingActions.some(t=>['ATTACK','ROB'].includes(t.proposal.actionType)&&t.proposal.targetIds.includes(actorId)))
      add('LEAVE_DANGER','MOVE',safety+need/2+3,4,3,10-traits.riskTolerance,0,'현재 확인된 위험에서 거리를 확보하려 했다.',{destinationId:id})
    if(survivorTarget && !contacts.length){
      const sighting=recentSightings.find(e=>e.placeId===id)
      const age=sighting?engine.minute-eventMinute(sighting):null
      add(sighting?'LOCATE_COMPETITOR':'SCOUT_OBJECTIVE','MOVE',
        sighting?10+Math.max(0,6-age!/120):6+traits.competitiveness/2,
        4,3,traits.riskTolerance/2,0,
        sighting?'전에 목격한 참가자의 마지막 위치를 확인하려 했다. 현재도 그곳에 있다고 단정하지 않았다.':'남은 경쟁자를 찾기 위해 아직 충분히 확인하지 않은 인접 장소를 정찰하려 했다.',
        {destinationId:id},sighting?[sighting.id]:[])
    }
    for(const report of actor.knowledge.filter(k=>k.acquisition==='report'&&k.placeId===id&&k.sourceAgentId&&k.sourceEventId).slice(-2))
      add('VERIFY_REPORT','MOVE',4+(report.confidence??.5)*8+need/2,4,2,traits.riskTolerance+traits.negotiation/3,0,
        `${report.sourceAgentId}에게서 들은 장소 정보를 직접 확인하려 했다.`,{destinationId:id,claimedKnowledgeId:report.id},[report.sourceEventId!])
  }
  for(const area of ['FOREST','SHORE','WATER','CAMP','HIGH_GROUND','CAVE','CENTER'] as const) {
    const failures=engine.outcomes?.[actorId]?.filter(o=>o.area===area&&o.failed&&engine.minute-o.minute<1440).length??0
    const searchPoint=searchDestination(world,actor,{actorId,actionType:'EXPLORE',targetIds:[],locationId:place.id,intendedAction:'탐색',areaHint:area})
    add('SECURE_SUPPLIES','EXPLORE',need+5,3+fatigue/2+failures*4,2,traits.riskTolerance+traits.competitiveness/2,0,'앞서 지나간 곳을 고려해 아직 확인하지 않은 경로를 살피려 했다.',{areaHint:area,searchPoint,intent:h>=t?'SEARCH_FOOD':'SEARCH_WATER'})
    if(actor.v2?.strategy?.failedActionType==='ATTACK'&&actor.v2.strategy.stage==='prepare')
      add('PREPARE_PROTECTION','EXPLORE',safety+8,3+fatigue/2+failures*6,2,traits.riskTolerance+traits.competitiveness,0,
        '직전 충돌에서 수단이 부족했으므로 확인하지 않은 경로에 실제로 쓸 만한 물건이 있는지 살피려 했다.',{areaHint:area,searchPoint})
  }
  for(const known of (actor.observedObjects??[]).slice(-12)) {
    if(actor.inventory.includes(known.id))continue
    const motive=known.kind==='food'?h:known.kind==='water'?t:known.kind==='medicine'?(actor.trauma?.pain??0):known.kind==='tool'?safety+traits.competitiveness/2:0
    if(motive<=0)continue
    if(known.placeId===place.id&&known.localArea!==(actor.publicState.localArea??'CENTER')&&LOCAL_AREAS.includes(known.localArea as typeof LOCAL_AREAS[number]))
      add('SEEK_KNOWN_ITEM','EXPLORE',motive*1.5+7,3+fatigue/2,2,traits.selfInterest,0,
        `전에 ${known.localArea}에서 본 ${known.name}이(가) 아직 있는지 확인하러 향했다.`,{areaHint:known.localArea as typeof LOCAL_AREAS[number],searchPoint:known.position})
    if(known.placeId===place.id&&known.localArea===(actor.publicState.localArea??'CENTER')&&known.position&&distance(agentPoint(actor),known.position)>.28)
      add('SEEK_KNOWN_ITEM','EXPLORE',motive*1.5+7,3+fatigue/2,2,traits.selfInterest,0,
        `전에 본 ${known.name}이(가) 있던 위치로 다시 향했다.`,{areaHint:known.localArea as typeof LOCAL_AREAS[number],searchPoint:known.position})
    if(known.placeId!==place.id&&place.connectedPlaceIds.includes(known.placeId)&&actor.knownPlaceIds?.includes(known.placeId))
      add('SEEK_KNOWN_ITEM','MOVE',motive*1.5+7,4,2,traits.selfInterest,0,
        `전에 본 ${known.name}을(를) 확인하기 위해 알고 있는 장소로 향했다.`,{destinationId:known.placeId})
  }
  add('WAIT_FOR_CHANGE','WAIT',1,0,0,0,0,'지금 감수할 수 있는 선택을 다시 살피며 잠시 기다리려 했다.')
  for(const c of choices)if(c.action.spokenText&&c.action.targetIds[0])c.action.spokenText=contextualSpeech(world,actorId,c.action.targetIds[0],c.action.spokenText)
  return { needs:{hunger:h,thirst:t,fatigue,safety,belonging}, traits, longTerm:motivation?.longTerm??actor.publicState.visibleGoal, goals:motivation?.goals.slice(-6)??[], scarce, choices:choices.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)) }
}
