import type { Agent, AgentKnowledgeEntry, WorldState } from '../domain/worldTypes.ts'

const selfStatePattern=/(?:내|나의|자신의|본인의).{0,15}(?:허기|갈증|피로|부상|상처|건강|배고픔|목마름)/
export function isWorldInformation(actor: Agent, fact: AgentKnowledgeEntry): boolean {
  return fact.kind!=='self_state'&&!selfStatePattern.test(fact.summary) && fact.sourceAgentId!==actor.id &&
    Boolean(fact.truthId||fact.placeId||fact.sourceEventId) && fact.verified===true
}
export function informationUtility(world: WorldState, actor: Agent, recipientId: string, fact: AgentKnowledgeEntry): number {
  if(!isWorldInformation(actor,fact))return -100
  const now=world.engine?.minute??0
  const recipient=world.agents.find(a=>a.id===recipientId)
  if(recipient?.knowledge.some(k=>k.sourceFactId===fact.id||Boolean(fact.truthId&&k.truthId===fact.truthId)||k.id===fact.id))return -100
  const prior=(actor.v2?.recentActions??[]).filter(a=>a.actionType==='SHARE_INFO'&&a.targetId===recipientId&&a.factId===fact.id&&a.result==='completed')
  if(prior.length)return -100 // The speaker knows this recipient already received this fact.
  const similar=(actor.v2?.recentActions??[]).filter(a=>a.actionType==='SHARE_INFO'&&a.targetId===recipientId&&a.result==='completed'&&now-a.minute<360)
  const placeRelevant=fact.placeId===actor.publicState.locationId?3:actor.knownPlaceIds?.includes(fact.placeId??'')?1:0
  const goalRelevant=actor.v2?.currentGoal&&/(SEARCH|SEEK|SECURE|PLAN|SURVIV|RESOURCE|SAFE)/.test(actor.v2.currentGoal)?2:0
  const recent=now-([...(world.engine?.outcomes?.[actor.id]??[])].reverse().find(o=>o.eventId===fact.sourceEventId)?.minute??-Infinity)
  const freshness=Number.isFinite(recent)&&recent<360?2:0
  return Math.max(0,3+placeRelevant+goalRelevant+freshness-similar.length*5)
}
