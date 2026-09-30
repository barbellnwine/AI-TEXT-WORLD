import {tracePreparationFailure} from './modelTrace.ts'
import {selectDecisionContext} from '../world/contextSelection.ts'
import {speechContext} from '../world/socialVoice.ts'
import { config, DEFAULT_PRICING } from '../config.ts'
import { fetchWithLimits, ProviderCallError } from '../providers/httpUtil.ts'
import { MAX_PROVIDER_REQUEST_BYTES } from '../providers/requestBody.ts'
import { WORLD_RULES_TEXT } from '../prompts/worldRules.ts'
import { buildAgentPrompt } from '../prompts/agentPrompt.ts'
import { buildAgentKnowledgeView } from '../world/knowledgeFilter.ts'
import { ACTION_INTENTS, LOCAL_AREAS, type ProposedAction } from '../world/actionSchema.ts'
import { validPoint } from '../world/spatialWorld.ts'
import { decisionPerception } from '../world/decisionPerception.ts'
import { behaviorContext } from '../world/behaviorPolicy.ts'
import type { DraftDTO } from './worldDrafts.ts'
import type { RulePresetDTO } from './rulePresets.ts'
import type { WorldState, WorldEvent } from './worldTypes.ts'

// Immutable, server-only season design. Never attach this object to a public response.
export interface WorldExecution {
  draft: DraftDTO
  rules: RulePresetDTO['rules']
  mode: 'demo' | 'live'
  // Frozen at START WORLD. Absent on older checkpoints = v3.
  engine?: 'v3' | 'v4'
}
export interface WorldModelRequest {
  maxOutputTokens?: number
  role: 'agent' | 'planner' | 'judge' | 'narrator' | 'character' | 'gm'
  provider: string
  model: string
  prompt: string
  schema: Record<string, unknown>
}
export interface WorldModelResult { raw: unknown; inputTokens: number; outputTokens: number }
export type WorldModelAdapter = (request: WorldModelRequest) => Promise<WorldModelResult>

const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }
export const ACTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    pickupItemId:nullableString, aim:{type:['string','null'],enum:['HEAD','TORSO','ARM','LEG',null]}, defense:{type:['string','null'],enum:['DODGE','BLOCK',null]},
    candidateId: nullableString, replyTo: nullableString, response: { type: ['string', 'null'], enum: ['ACCEPT', 'REFUSE', null] }, offerItemId: nullableString, requestItemId: nullableString,
    intent: { type: ['string', 'null'], enum: [...ACTION_INTENTS, null] }, taskId: nullableString,
    actorId: string, actionType: { type: 'string', enum: ['MOVE', 'SPEAK', 'GIVE_ITEM', 'OBSERVE', 'WAIT', 'COOPERATE', 'INTERACT', 'REST', 'SLEEP', 'TAKE_ITEM', 'EAT', 'DRINK', 'EXPLORE', 'SHARE_INFO', 'USE_ITEM', 'DROP_ITEM', 'ATTACK', 'STEAL', 'ROB', 'HIDE'] },
    locationId: string, targetIds: { type: 'array', items: string }, intendedAction: string,
    publicAction: { type: 'string', minLength: 1, maxLength: 500 }, publicReason: { type: 'string', minLength: 1, maxLength: 500 },
    destinationId: nullableString, spokenText: nullableString, usedItemIds: { type: 'array', items: string },
    claimedKnowledgeId: nullableString,
    resourceKey: nullableString, factId: nullableString, durationMinutes: { type: ['integer', 'null'] },
    areaHint: { type: ['string', 'null'], enum: [...LOCAL_AREAS, null] },
    interaction: {anyOf:[{type:'object',additionalProperties:false,properties:{operation:{type:'string',enum:['separate','alter','combine']},sourceObjectIds:{type:'array',items:string,maxItems:4},resultName:string,resultForm:string,materials:{type:'array',items:string,maxItems:8},quantity:{type:'integer',minimum:1,maximum:8}},required:['operation','sourceObjectIds','resultName','resultForm','materials','quantity']},{type:'null'}]},
    searchPoint: {anyOf:[{type:'object',additionalProperties:false,properties:{x:{type:'number'},y:{type:'number'}},required:['x','y']},{type:'null'}]},
    decisionV3: {anyOf:[{type:'object',additionalProperties:false,properties:{transition:{type:'string',enum:['CONTINUE','MODIFY','ABANDON','COMPLETE']},goal:{type:'string',maxLength:120},purpose:{type:'string',maxLength:160},method:{type:'string',maxLength:160},nextSteps:{type:'array',items:{type:'string',enum:['MOVE','SPEAK','GIVE_ITEM','OBSERVE','WAIT','COOPERATE','INTERACT','REST','SLEEP','TAKE_ITEM','EAT','DRINK','EXPLORE','SHARE_INFO','USE_ITEM','DROP_ITEM','ATTACK','STEAL','ROB','HIDE']},maxItems:4},nextStepTargets:{type:'array',items:{type:['string','null']},maxItems:4},expectedReward:{type:'number',minimum:0,maximum:10},expectedRisk:{type:'number',minimum:0,maximum:10}},required:['transition','goal','purpose','method','nextSteps','nextStepTargets','expectedReward','expectedRisk']},{type:'null'}]},
  },
  required: ['pickupItemId','aim','defense','candidateId', 'replyTo', 'response', 'offerItemId', 'requestItemId', 'intent', 'taskId', 'actorId', 'actionType', 'locationId', 'targetIds', 'intendedAction', 'publicAction', 'publicReason', 'destinationId', 'spokenText', 'usedItemIds', 'claimedKnowledgeId', 'resourceKey', 'factId', 'durationMinutes', 'areaHint','searchPoint','decisionV3','interaction'],
}
export const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { approved: { type: 'boolean' }, reason: string, ended: { type: 'boolean' } },
  required: ['approved', 'reason', 'ended'],
}

export function parseProposedAction(raw: unknown, actorId: string): ProposedAction {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_action_json')
  const r = raw as Record<string, unknown>
  const text = (key: string, optional = false): string | undefined => {
    if (optional && (r[key] === undefined || r[key] === null)) return undefined
    if (typeof r[key] !== 'string' || (r[key] as string).length > 1500 || (!optional && !(r[key] as string).trim())) throw new Error('invalid_action_field')
    return r[key] as string
  }
  const ids = (key: string): string[] => {
    if (!Array.isArray(r[key]) || r[key].length > 10 || r[key].some((id: unknown) => typeof id !== 'string' || !id || id.length > 200)) throw new Error('invalid_action_ids')
    return [...new Set(r[key] as string[])]
  }
  if (r.actorId !== actorId || !ACTION_SCHEMA.properties.actionType.enum.includes(String(r.actionType))) throw new Error('invalid_action_actor_or_type')
  if (r.intent != null && !(ACTION_INTENTS as readonly string[]).includes(String(r.intent))) throw new Error('invalid_action_intent')
  if (r.durationMinutes != null && (typeof r.durationMinutes !== 'number' || !Number.isInteger(r.durationMinutes) || r.durationMinutes < 1 || r.durationMinutes > 480)) throw new Error('invalid_action_duration')
  if (r.areaHint != null && !(LOCAL_AREAS as readonly string[]).includes(String(r.areaHint))) throw new Error('invalid_action_area_hint')
  if (r.searchPoint != null && !validPoint(r.searchPoint)) throw new Error('invalid_search_point')
  if (r.publicAction != null || r.publicReason != null) {
    for (const key of ['publicAction', 'publicReason']) if (typeof r[key] !== 'string' || !(r[key] as string).trim() || (r[key] as string).length > 500) throw new Error('public_action_and_reason_required')
  }
  if (r.response != null && !['ACCEPT', 'REFUSE'].includes(String(r.response))) throw new Error('invalid_response')
  if(r.aim!=null&&!['HEAD','TORSO','ARM','LEG'].includes(String(r.aim)))throw new Error('invalid_aim')
  if(r.defense!=null&&!['DODGE','BLOCK'].includes(String(r.defense)))throw new Error('invalid_defense')
  let interaction: ProposedAction['interaction']
  if (r.interaction != null) {
    const value = r.interaction as Record<string, unknown>
    if (!value || typeof value !== 'object' || !['separate','alter','combine'].includes(String(value.operation)) ||
      !Array.isArray(value.sourceObjectIds) || value.sourceObjectIds.length > 4 || value.sourceObjectIds.some(id=>typeof id!=='string') ||
      !Array.isArray(value.materials) || value.materials.length > 8 || value.materials.some(m=>typeof m!=='string') ||
      typeof value.resultName !== 'string' || typeof value.resultForm !== 'string' || !Number.isInteger(value.quantity)) throw new Error('invalid_interaction')
    interaction=value as ProposedAction['interaction']
  }
  let decisionV3: ProposedAction['decisionV3']
  if (r.decisionV3 != null) {
    const plan = r.decisionV3 as Record<string, unknown>
    const validText = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
    if (!plan || typeof plan !== 'object' || !['CONTINUE','MODIFY','ABANDON','COMPLETE'].includes(String(plan.transition)) ||
      !validText(plan.goal,120) || !validText(plan.purpose,160) || !validText(plan.method,160) ||
      !Array.isArray(plan.nextSteps) || plan.nextSteps.length > 4 || plan.nextSteps.some(step => !ACTION_SCHEMA.properties.actionType.enum.includes(String(step))) ||
      plan.nextStepTargets !== undefined && (!Array.isArray(plan.nextStepTargets) || plan.nextStepTargets.length > (plan.nextSteps as unknown[]).length || plan.nextStepTargets.some(id => id !== null && (typeof id !== 'string' || !id || id.length > 200))) ||
      typeof plan.expectedReward !== 'number' || plan.expectedReward < 0 || plan.expectedReward > 10 ||
      typeof plan.expectedRisk !== 'number' || plan.expectedRisk < 0 || plan.expectedRisk > 10) throw new Error('invalid_decision_plan')
    decisionV3 = plan as ProposedAction['decisionV3']
  }
  return {decisionV3,interaction,pickupItemId:text('pickupItemId',true),aim:r.aim==null?undefined:r.aim as ProposedAction['aim'],defense:r.defense==null?undefined:r.defense as ProposedAction['defense'], candidateId: text('candidateId', true), replyTo: text('replyTo', true), response: r.response == null ? undefined : r.response as ProposedAction['response'], offerItemId: text('offerItemId', true), requestItemId: text('requestItemId', true), actorId, actionType: r.actionType as ProposedAction['actionType'], locationId: text('locationId')!,
    intent: r.intent == null ? undefined : r.intent as ProposedAction['intent'], taskId: text('taskId', true),
    intendedAction: text('intendedAction')!, publicAction: text('publicAction', true), publicReason: text('publicReason', true), targetIds: ids('targetIds'), usedItemIds: ids('usedItemIds'),
    destinationId: text('destinationId', true), spokenText: text('spokenText', true), claimedKnowledgeId: text('claimedKnowledgeId', true),
    resourceKey: text('resourceKey', true), factId: text('factId', true), durationMinutes: typeof r.durationMinutes === 'number' && Number.isInteger(r.durationMinutes) && r.durationMinutes > 0 && r.durationMinutes <= 480 ? r.durationMinutes : undefined,
    areaHint: r.areaHint == null ? undefined : r.areaHint as ProposedAction['areaHint'],searchPoint:r.searchPoint == null ? undefined : r.searchPoint as ProposedAction['searchPoint'] }
}

export function parseJudgment(raw: unknown): { approved: boolean; reason: string; ended: boolean } {
  if (!raw || typeof raw !== 'object') throw new Error('invalid_judgment')
  const r = raw as Record<string, unknown>
  if (typeof r.approved !== 'boolean' || typeof r.ended !== 'boolean' || typeof r.reason !== 'string' || r.reason.length > 2000) throw new Error('invalid_judgment')
  return { approved: r.approved, ended: r.ended, reason: r.reason }
}

export function modelFor(execution: WorldExecution, actorId: string) {
  const character = execution.draft.characters.find(c => c.id === actorId)
  if (!character || !['openai', 'anthropic'].includes(character.provider)) throw new Error('invalid_character_provider')
  const model = character.model || (character.provider === 'openai' ? config.openaiModel : config.anthropicModel)
  return { provider: character.provider, model }
}

export interface BrainIntent {
  goal: string; purpose: string; method: string; targetId: string | null; placeId: string | null
  objectIds: string[]; desiredOutcome: string; longerTermPlan: string | null
}
export const BRAIN_SCHEMA = {type:'object',additionalProperties:false,properties:{
  goal:string,purpose:string,method:string,targetId:nullableString,placeId:nullableString,
  objectIds:{type:'array',items:string,maxItems:8},desiredOutcome:string,longerTermPlan:nullableString,
},required:['goal','purpose','method','targetId','placeId','objectIds','desiredOutcome','longerTermPlan']}
// The planner names perceived entities; the engine owns IDs, positions and timing.
const PLANNER_ENGINE_FIELDS = new Set(['candidateId','actorId','locationId','targetIds','usedItemIds','destinationId','pickupItemId','durationMinutes','searchPoint','decisionV3'])
const PLANNER_ACTION_SCHEMA = {...ACTION_SCHEMA,
  properties:{...Object.fromEntries(Object.entries(ACTION_SCHEMA.properties).filter(([key])=>!PLANNER_ENGINE_FIELDS.has(key))),
    targetRefs:{type:'array',items:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['character','place','object']},reference:string},required:['kind','reference']},maxItems:10},
    objectRefs:{type:'array',items:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['object']},reference:string},required:['kind','reference']},maxItems:10},
    destinationRef:nullableString},
  required:[...ACTION_SCHEMA.required.filter(key=>!PLANNER_ENGINE_FIELDS.has(key)),'targetRefs','objectRefs','destinationRef']}
export const PLANNER_SCHEMA = {type:'object',additionalProperties:false,properties:{
  steps:{type:'array',items:PLANNER_ACTION_SCHEMA,minItems:1,maxItems:4},
},required:['steps']}
export function parseBrainIntent(raw:unknown):BrainIntent {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('invalid_brain_intent')
  const r=raw as Record<string,unknown>
  for(const k of ['goal','purpose','method','desiredOutcome'])if(typeof r[k]!=='string'||!(r[k] as string).trim()||(r[k] as string).length>500)throw new Error('invalid_brain_intent')
  for(const k of ['targetId','placeId','longerTermPlan'])if(r[k]!=null&&(typeof r[k]!=='string'||(r[k] as string).length>500))throw new Error('invalid_brain_intent')
  if(!Array.isArray(r.objectIds)||r.objectIds.length>8||r.objectIds.some(id=>typeof id!=='string'||!id))throw new Error('invalid_brain_intent')
  return {goal:r.goal as string,purpose:r.purpose as string,method:r.method as string,targetId:r.targetId as string|null??null,placeId:r.placeId as string|null??null,objectIds:r.objectIds as string[],desiredOutcome:r.desiredOutcome as string,longerTermPlan:r.longerTermPlan as string|null??null}
}
export function parsePlannerSteps(raw:unknown,actorId:string):ProposedAction[] {
  const steps=(raw as {steps?:unknown})?.steps
  if(!Array.isArray(steps)||steps.length<1||steps.length>4)throw new Error('invalid_planner_steps')
  return steps.map(step=>parseProposedAction(step,actorId))
}
function boundedDecisionRequest(role:'agent'|'planner',execution:WorldExecution,actorId:string,world:WorldState,events:WorldEvent[],intent?:BrainIntent):WorldModelRequest {
  const view=selectDecisionContext(buildAgentKnowledgeView(actorId,world,events.filter(e=>e.outcome!=='REJECTED'))!)
  const actor=world.agents.find(a=>a.id===actorId)!
  const failures=(actor.v2?.recentFailures??[]).slice(-6).map(f=>({goal:f.goal??null,method:f.method??f.intent,
    target:f.targetReference??f.targetId??null,stage:f.failureStage??'resolution',reason:f.reason??f.result??'failed',minute:f.minute}))
  const failureKey=(f:typeof failures[number])=>JSON.stringify([f.goal,f.method,f.target,f.stage,f.reason])
  const latestFailure=failures.at(-1)
  const repeatedFailure=latestFailure?failures.filter(f=>failureKey(f)===failureKey(latestFailure)).length:0
  const profile=execution.draft.characters.find(c=>c.id===actorId)
  const relevant=new Set(intent?.objectIds??[])
  const keepRelevant=<T extends {id:string}>(items:T[],limit:number)=>[...items.filter(o=>relevant.has(o.id)),...items.filter(o=>!relevant.has(o.id)).slice(0,limit)]
  view.visibleObjects=keepRelevant(view.visibleObjects??[],12)
  view.observedObjects=keepRelevant(view.observedObjects??[],12)
  view.self.inventory=[...new Set([...view.self.inventory.filter(id=>relevant.has(id)),...view.self.inventory.filter(id=>!relevant.has(id)).slice(0,12)])]
  const plannerObjects=keepRelevant(world.engine?.objects.filter(o=>o.location.kind==='agent'&&o.location.id===actorId||o.location.kind==='place'&&view.visibleObjects?.some(v=>v.id===o.id))??[],12)
  const build=():WorldModelRequest=>({role,...modelFor(execution,actorId),schema:role==='agent'?BRAIN_SCHEMA:PLANNER_SCHEMA,
    prompt:[buildAgentPrompt(view,[]),'[SEASON RULES]',rulesText(execution),'[YOUR CHARACTER]',JSON.stringify(profile&&{age:profile.age,personality:profile.personality,goal:profile.goal,strengths:profile.strengths,weaknesses:profile.weaknesses}),
      '[CURRENT GOAL AND PLAN]',JSON.stringify({decisionV3:actor.v2?.decisionV3,freePlan:actor.v2?.freePlan,lastResult:actor.v2?.lastActionResult,recentFailures:actor.v2?.recentFailures.slice(-4)}),
      '[RECENT FAILED ATTEMPTS]',JSON.stringify({failures,repeatedSameFailure:repeatedFailure,
        reevaluatePlan:repeatedFailure>=2,guide:'A failed reference is not currently perceived. Reconsider the goal, method or target freely; do not repeat an identical failed attempt.'}),
      role==='agent'?'Propose what you want to accomplish and how, using only perceived or remembered facts. Do not claim success or alter state. No action list is supplied. An unperceived resource may exist in the world: choose a search to find out, not an invented item reference or a guaranteed discovery. Reconsider repeated failed goal/method/target combinations.':
        'Translate the Brain intent into at most four existing executable primitive steps. Preserve its goal and method. Execute only the first step now; later steps are intentions and will be re-evaluated. Refer to people, places and objects by perceived name or category in targetRefs/objectRefs/destinationRef, not invented IDs. The engine resolves IDs, current position and travel time. For TAKE_ITEM put an already perceived accessible object in objectRefs, not a person target. An unknown resource requires EXPLORE first; discovering it and taking it are separate possible outcomes, never guaranteed by EXPLORE text. A resource absent from world truth is never created by searching. For movement within the current place use EXPLORE with a different areaHint; never MOVE from a place to itself. To inspect another area, plan EXPLORE before OBSERVE. A MOVE or EXPLORE may be a prerequisite to the original goal; preserve that goal and method instead of replacing them with an unrelated intent. Use INTERACT with interaction for material separation, alteration or combination. Every source must exist in the perceived objects or inventory. Never invent material or an outcome. Do not silently substitute an unrelated action.',
      role==='planner'?'[BRAIN INTENT] '+JSON.stringify(intent):'',
      role==='planner'?'[ENGINE CAPABILITIES] '+JSON.stringify({actionTypes:ACTION_SCHEMA.properties.actionType.enum,interaction:['separate','alter','combine'],areas:LOCAL_AREAS,validation:'All source IDs, positions, ownership, material conservation and effects are checked by the engine.'}):'',
      role==='planner'?'[ACCESSIBLE MATERIALS] '+JSON.stringify(plannerObjects.map(o=>({id:o.id,name:o.name,kind:o.kind,quantity:o.quantity,materials:o.materials??[o.physical?.material].filter(Boolean),mass:o.mass??1,form:o.form,physical:o.physical,location:o.location}))):'',
      '[CLOCK]',JSON.stringify(world.clock)].filter(Boolean).join('\n\n')})
  while(true){const request=build();if(execution.mode==='demo'||Buffer.byteLength(serializeWorldRequest(request))<=MAX_PROVIDER_REQUEST_BYTES-2000)return request
    if(view.observedEvents.length)view.observedEvents.pop()
    else if(view.knownFacts.length)view.knownFacts.pop()
    else if(view.self.memories?.length)view.self.memories.pop()
    else if((view.observedPossessions?.length??0)>0)view.observedPossessions!.pop()
    else if((view.observedObjects?.length??0)>0)view.observedObjects!.pop()
    else if((view.visibleObjects?.length??0)>0)view.visibleObjects!.pop()
    else if(view.currentPlace.description.length>64)view.currentPlace.description=view.currentPlace.description.slice(0,Math.floor(view.currentPlace.description.length/2))
    else {worldRequestBody(request);return request}
  }
}
export function brainRequest(execution:WorldExecution,actorId:string,world:WorldState,events:WorldEvent[]):WorldModelRequest{return boundedDecisionRequest('agent',execution,actorId,world,events)}
export function plannerRequest(execution:WorldExecution,actorId:string,world:WorldState,events:WorldEvent[],intent:BrainIntent):WorldModelRequest{return boundedDecisionRequest('planner',execution,actorId,world,events,intent)}

function rulesText(execution: WorldExecution): string {
  return JSON.stringify(execution.rules.filter(r => r.enabled).sort((a, b) => b.priority - a.priority).map(r => ({ title: r.title, description: r.description })))
}

export function agentRequest(execution: WorldExecution, actorId: string, world: WorldState, events: WorldEvent[], assessment: ReturnType<typeof import('../world/decisionController.ts').prepareDecision>): WorldModelRequest {
  let view = buildAgentKnowledgeView(actorId, world, events.filter(e => e.outcome !== 'REJECTED'))
  if (!view) throw new Error('agent_has_no_location')
  view=selectDecisionContext(view)
  // A protected outcome is sent once in the compact evidence block, not again as a full event.
  const protectedIds=new Set(view.decisionEvidence?.map(e=>e.eventId))
  view.observedEvents=view.observedEvents.filter(e=>!protectedIds.has(e.id))
  view.observedEvents = view.observedEvents.sort((a,b) => (b.worldMinute ?? 0) - (a.worldMinute ?? 0)).slice(0, 12)
  view.knownFacts = view.knownFacts.slice(-30)
  const behavior = behaviorContext(world, actorId)
  const objectiveStatus=decisionPerception(world,actorId,events).engine?.objectiveStatus
  behavior.outcomes=behavior.outcomes.filter(o=>!protectedIds.has(o.eventId)).slice(-4).map(o=>({...o,summary:o.summary.slice(0,120)}))
  behavior.recent=behavior.recent.slice(-4)
  if(behavior.previousDecision)behavior.previousDecision={...behavior.previousDecision,intent:behavior.previousDecision.intent.slice(0,160),basisEventIds:behavior.previousDecision.basisEventIds.slice(-3)}
  const c = execution.draft.characters.find(c => c.id === actorId)!
  const profile = { age: c.age, gender: c.gender, background: c.background, occupation: c.occupation, personality: c.personality,
    goal: c.goal, strengths: c.strengths, weaknesses: c.weaknesses, privateInfo: c.privateInfo }
  const planContext = structuredClone(world.agents.find(a=>a.id===actorId)?.v2?.decisionV3)
  // Large inventories are state, not decision context. Keep the items referenced by
  // feasible choices and a small sample; the full inventory remains in WorldState.
  const relevantItemIds=new Set(assessment.choices.flatMap(choice=>[
    choice.action.pickupItemId,choice.action.offerItemId,choice.action.requestItemId,
    ...(choice.action.usedItemIds??[]),
  ].filter((id):id is string=>!!id)))
  const heldObjects=world.engine?.objects.filter(o=>o.location.kind==='agent'&&o.location.id===actorId)??[]
  const selectedHeld=[...heldObjects.filter(o=>relevantItemIds.has(o.id)),...heldObjects.filter(o=>!relevantItemIds.has(o.id)).slice(0,8)]
  view.self.inventory=selectedHeld.map(o=>o.id)
  const inventoryContext={total:heldObjects.length,items:selectedHeld.map(({id,name,kind,quantity,physical})=>({id,name:name.slice(0,80),kind,quantity,physical}))}
  const build = (): WorldModelRequest => ({ role: 'agent', ...modelFor(execution, actorId), schema: {
    ...ACTION_SCHEMA, properties: {...ACTION_SCHEMA.properties,candidateId:{type:['string','null'],enum:[...assessment.choices.map(c=>c.id),null]}}
  },
    prompt: [buildAgentPrompt(view, []), '[SEASON RULES]', rulesText(execution), '[WORLD BACKGROUND]', execution.draft.background,
      '[GENRES]', execution.draft.genre,
      '[PUBLIC PREMISE]', execution.draft.intro,
      view.self.wakeReason === 'visible_attack_attempt' ? 'You are responding to a visible attack NOW. Choose your own counterattack, guard, movement, warning, negotiation, urgent treatment or conscious waiting. Do not ignore it to start a meal or sleep. Record the specific response and public motive, without deciding the attacker\'s next reaction.' : '',
      '[NEEDS, DESIRES AND FEASIBLE CHOICES]', JSON.stringify({ ...assessment, longTerm: undefined, goals: assessment.goals.map(g => ({ goal: g.goal, status: g.status, targetId: g.targetId, objectId: g.objectId, attempts: g.attempts, failures: g.failures, evidenceEventIds: g.evidenceEventIds.slice(-2) })), choices: assessment.choices.map(c => ({ id:c.id,goal:c.goal,action:{actorId:c.action.actorId,locationId:c.action.locationId,actionType:c.action.actionType,intent:c.action.intent,targetIds:c.action.targetIds,usedItemIds:c.action.usedItemIds,pickupItemId:c.action.pickupItemId,offerItemId:c.action.offerItemId,requestItemId:c.action.requestItemId,aim:c.action.aim,defense:c.action.defense,destinationId:c.action.destinationId,areaHint:c.action.areaHint,searchPoint:c.action.searchPoint,resourceKey:c.action.resourceKey,replyTo:c.action.replyTo,response:c.action.response,taskId:c.action.taskId,claimedKnowledgeId:c.action.claimedKnowledgeId,factId:c.action.factId,spokenText:c.action.spokenText?.slice(0,100),intendedAction:c.action.intendedAction.slice(0,80),publicReason:c.action.publicReason?.slice(0,100)},score:c.score,risk:c.risk,reasonCodes:c.reasonCodes })) }),
      '[YOUR CURRENT PLAN]', JSON.stringify({plan:world.agents.find(a=>a.id===actorId)?.v2?.plan,decisionV3:planContext,strategy:world.agents.find(a=>a.id===actorId)?.v2?.strategy,item:world.agents.find(a=>a.id===actorId)?.v2?.itemPlan}),
      '[WORLD OBJECTIVE PROGRESS]',JSON.stringify(objectiveStatus??{elapsedMinute:world.engine?.minute}),
      'Choose exactly one listed candidateId. Scores advise, not compel; WAIT is valid. In decisionV3 choose whether the existing goal should CONTINUE, MODIFY, ABANDON or COMPLETE; state a concrete purpose/method and up to four possible future action-type steps AFTER this chosen action. Align nextStepTargets with nextSteps using only known agent IDs, or null for a step with no fixed target. A planned step is only an intention, never a claim that an item, person, event or outcome exists. Keep a useful multi-tick goal unless evidence changes it. You may supply natural wording but must not override candidate targets, items, place or effects. Combat can serve defense, hostility, competition or betrayal when the candidate exists.',
      '[ENGINE BEHAVIOR POLICY]', JSON.stringify({ ...behavior, priorities:undefined, deliberation: undefined, previousDecision: behavior.previousDecision ? { ...behavior.previousDecision, evaluation: undefined } : undefined }),
      'Write intendedAction/publicAction/publicReason in natural Korean: a concrete attempt and its public motive, never private facts, another person’s thoughts or confirmed outcomes.',
      'When a listed social or exchange action needs words, spokenText may carry the actual proposal, request, warning or condition within that same action. Words alone do not imply acceptance or a state change. A meaningful addressed response is a later decision by the recipient.',
      'Attack only reachable opponents; use only listed equipment. OBSERVE+defense guards against targetIds. EXPLORE+areaHint reaches a local area at completion. Missing data is unknown, not permission to invent.',
      '[LOCAL ENVIRONMENT]', JSON.stringify({ weather: world.engine?.weather, place: { power: world.places.find(p=>p.id===view.self.locationId)?.power, flooded: world.places.find(p=>p.id===view.self.locationId)?.flooded } }),
      '[VOICE AND RELATIONS]', JSON.stringify(view.othersPresent.map(other=>{const voice=speechContext(world.agents.find(a=>a.id===actorId)!,world.agents.find(a=>a.id===other.id)!);return {id:other.id,tone:voice.tone,relation:voice.relation}})), 'Speech uses your age/personality/known relations. Unknown age stays unknown.',
      '[PROTECTED RECENT OUTCOMES — retain for next choice]', JSON.stringify(view.decisionEvidence), '[CLOCK]', JSON.stringify(world.clock), '[YOUR CHARACTER ONLY]', JSON.stringify(profile),
      '[YOUR INVENTORY]', JSON.stringify(inventoryContext),

      // The exact schema is already enforced by response_format/tool_choice — restating the full
      // JSON schema in the prompt text only duplicates ~900 bytes without adding information.
      ].join('\n\n') })
  // Leave room for a new wound or witnessed event on the next tick without enlarging
  // the transport cap. Only redundant history and choice prose are removed.
  const targetBytes=MAX_PROVIDER_REQUEST_BYTES-2_000
  while (true) {
    const request = build()
    if (execution.mode === 'demo') return request
    const bytes=Buffer.byteLength(serializeWorldRequest(request))
    if(bytes<=targetBytes)return request
    {
      // Trim historical context first. World rules and the schema are never touched.
      if (view.observedEvents.length) view.observedEvents.pop()
      else if (behavior.recent.length) behavior.recent.shift()
      else if (view.knownFacts.length>2) view.knownFacts.shift()
      else if ((view.observedPossessions?.length ?? 0)>5) view.observedPossessions!.shift()
      else if ((view.observedObjects?.length ?? 0)>5) view.observedObjects!.shift()
      else if (assessment.choices.length > 4) {
        // Keep the best options and the explicit ability to defer even under a tight context budget.
        let last = assessment.choices.length - 1
        while (last > 0 && assessment.choices[last].action.actionType === 'WAIT') last--
        // Remove repeated strategies against other targets before losing a distinct choice.
        for (let i = last; i > 0; i--) {
          const action = assessment.choices[i].action
          if (action.actionType !== 'WAIT' && assessment.choices.slice(0, i).some(c => c.action.actionType === action.actionType && c.action.intent === action.intent)) { last = i; break }
        }
        assessment.choices.splice(last, 1)
      }
      else if (behavior.outcomes.length) behavior.outcomes.shift()
      else if (behavior.invitations.length > 1) behavior.invitations.shift()
      else if (view.self.memories?.length) view.self.memories.pop()
      else if (assessment.choices.length>2) {
        let index=assessment.choices.length-1
        while(index>0&&assessment.choices[index].action.actionType==='WAIT')index--
        assessment.choices.splice(index>=0?index:assessment.choices.length-1,1)
      }
      else if (planContext && [planContext.goalDescription,planContext.purpose,planContext.method,planContext.lastFailureReason].some(value => (value?.length ?? 0) > 64)) {
        for (const key of ['goalDescription','purpose','method','lastFailureReason'] as const) {
          const value=planContext[key]
          if (value && value.length>64) planContext[key]=value.slice(0,Math.max(64,Math.floor(value.length/2)))
        }
      }
      else {
        // Last resort: repeatedly halve whichever of the character's own free-text fields is
        // currently longest, all the way toward empty if needed. An overly verbose AI-generated
        // bio must shrink, never permanently stall every future decision for that character.
        const fields = ['background', 'personality', 'goal', 'privateInfo'] as const
        const longest = fields.reduce((a, b) => (profile[a]?.length ?? 0) >= (profile[b]?.length ?? 0) ? a : b)
        if (profile[longest]?.length) profile[longest] = profile[longest]!.slice(0, Math.floor(profile[longest]!.length / 2))
        else {
          if(bytes<=MAX_PROVIDER_REQUEST_BYTES)return request
          try{worldRequestBody(request)}catch(error){tracePreparationFailure(request,error);throw error}
          throw new Error('unreachable_context_limit')
        }
      }
    }
  }
}

export function judgeRequest(execution: WorldExecution, action: ProposedAction, world: WorldState, events: WorldEvent[]): WorldModelRequest {
  return { role: 'judge', ...modelFor(execution, action.actorId), schema: JUDGE_SCHEMA,
    prompt: [WORLD_RULES_TEXT, '당신은 세계의 판정자입니다. 제안이 시즌 규칙·이동 조건·설정에 부합하는지만 판정하십시오. 상태 변경이나 새로운 사실을 만들지 마십시오. 종료 조건은 현재 확정된 상태에서만 검사하고 제안의 예상 결과로 종료하지 마십시오. 종료 조건이 비어 있으면 ended=false입니다. reason은 관리자에게만 공개됩니다.',
      'LOCAL_AREAS는 엔진에서 지원하는 장소 내부 구역이다: SHORE, FOREST, HIGH_GROUND, CAVE, WATER, CAMP, CENTER. EXPLORE + areaHint는 같은 장소 내부 이동이며 places/connections에 별도 노드가 없어도 유효하다. CAVE 구역 이동만으로 쉼터나 동굴 자원 발견을 확정하지 않는다. MOVE로 다른 장소에 이동할 때만 장소 간 connections를 검사한다.',
      'EXPLORE는 탐색 시도이지 발견·획득의 확정이 아니다. WORLD에 자원이 존재하지만 이 Agent가 아직 모르는 경우 탐색을 허용하고, 실제 발견은 엔진의 위치·시야 판정에 맡긴다. 제안의 intendedAction/desired outcome에 발견 또는 획득 희망이 적혀 있어도 그것을 확정된 결과로 취급하지 않는다. 탐색만으로 WORLD에 없는 자원을 생성하거나 소지품에 추가할 수 없지만, 발견이 보장되지 않는 탐색 시도 자체를 그 이유로 거절하지 않는다. 이미 인지한 접근 가능한 물건의 획득은 TAKE_ITEM으로 별도 판정한다.',
      '[SEASON RULES]', rulesText(execution), '[WORLD DESIGN — PRIVATE]', JSON.stringify({ background: execution.draft.background, hiddenWorldTruth: execution.draft.hiddenWorldTruth, endCondition: execution.draft.endCondition,
        connections: execution.draft.connections.filter(c => c.fromPlaceId === action.locationId || c.toPlaceId === action.locationId), powerStatus: execution.draft.powerStatus, facilityStatus: execution.draft.facilityStatus, resources: execution.draft.initialResources }),
      '[CURRENT STATE]', JSON.stringify({ clock: world.clock, dangerLevel: world.dangerLevel,
        physicalObjects:world.engine?.objects.filter(o=>[action.pickupItemId,...(action.usedItemIds??[])].includes(o.id)).map(({id,name,location,localArea,quantity,condition,physical})=>({id,name,location,localArea,quantity,condition,physical})),
        places: world.places.filter(p=>[action.locationId,action.destinationId].includes(p.id)).map(p => ({ id: p.id, name: p.name, resources: p.resources, locked: p.locked, currentAgentIds: p.currentAgentIds })),
        agents: world.agents.filter(a=>[action.actorId,...action.targetIds].includes(a.id)).map(a => ({ id: a.id, name: a.name, publicState: a.publicState, inventory: a.inventory })) }),
      '[RECENT CONFIRMED EVENTS]', JSON.stringify(events.filter(e => e.outcome !== 'REJECTED' &&
        (e.agentIds.includes(action.actorId) || e.agentIds.some(id=>action.targetIds.includes(id)) || e.placeId===action.locationId))
        .slice(-2).map(e => ({ id:e.id,action:e.actionType,phase:e.phase,summary:(e.actionResult??e.summary).slice(0,120),
          stateChanges:e.stateChanges.filter(c=>!c.field.startsWith('knowledge:')).slice(0,4) }))),
      '[PROPOSAL]', JSON.stringify(action)].join('\n\n') }
}

export function ensureModelConfigured(request: Pick<WorldModelRequest, 'provider' | 'model'>): void {
  if (!(request.provider === 'openai' ? config.openaiApiKey : request.provider === 'anthropic' ? config.anthropicApiKey : '')) throw new ProviderCallError('PROVIDER_KEY_MISSING', 'provider key missing')
  if (!DEFAULT_PRICING.some(p => p.provider === request.provider && p.model === request.model)) throw new ProviderCallError('MODEL_PRICING_MISSING', 'configure model and pricing before running')
}

// v4 prompts carry narrative context (Korean is 3 bytes/char), so they get their own bound.
export const V4_MAX_REQUEST_BYTES = 48_000
const longForm = (request: Pick<WorldModelRequest, 'role'>) => request.role === 'narrator' || request.role === 'gm'
const requestLimit = (request: Pick<WorldModelRequest, 'role'>) => request.role === 'gm' || request.role === 'character' ? V4_MAX_REQUEST_BYTES : MAX_PROVIDER_REQUEST_BYTES
// The GM model: explicit WORLD_GM_MODEL (with its pricing) or the provider's configured model.
export function gmModel(): { provider: 'openai' | 'anthropic'; model: string } {
  const provider = config.worldGmProvider
  return { provider, model: config.worldGmModel || (provider === 'openai' ? config.openaiModel : config.anthropicModel) }
}

function serializeWorldRequest(request: WorldModelRequest): string {
  const body = JSON.stringify(request.provider === 'openai' ? {
    model: request.model, messages: [{ role: 'user', content: request.prompt }], max_completion_tokens: Math.min(longForm(request)?12000:6000, request.maxOutputTokens ?? 1500),
    response_format: { type: 'json_schema', json_schema: { name: `world_${request.role}`, strict: true, schema: request.schema } },
  } : {
    model: request.model, messages: [{ role: 'user', content: request.prompt }], max_tokens: Math.min(longForm(request)?12000:6000, request.maxOutputTokens ?? 1500),
    tools: [{ name: 'submit_world_result', description: 'Submit the structured result.', input_schema: request.schema }],
    tool_choice: { type: 'tool', name: 'submit_world_result' },
  })
  return body
}

export function worldRequestBody(request: WorldModelRequest): string {
  const body=serializeWorldRequest(request)
  if (Buffer.byteLength(body) > requestLimit(request)) {
    // Temporary diagnostic: pinpoint which requests overflow and by how much (never logs prompt content).
    console.error(`[world] WORLD_CONTEXT_TOO_LARGE role=${request.role} provider=${request.provider} bytes=${Buffer.byteLength(body)} limit=${requestLimit(request)} promptBytes=${Buffer.byteLength(request.prompt)}`)
    throw new ProviderCallError('WORLD_CONTEXT_TOO_LARGE', 'shorten world rules or character context')
  }
  return body
}

export const worldModelAdapter: WorldModelAdapter = async request => {
  ensureModelConfigured(request)
  const openai = request.provider === 'openai'
  const response = await fetchWithLimits(openai ? 'https://api.openai.com/v1/chat/completions' : 'https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: openai
      ? { 'content-type': 'application/json', authorization: `Bearer ${config.openaiApiKey}` }
      : { 'content-type': 'application/json', 'x-api-key': config.anthropicApiKey, 'anthropic-version': '2023-06-01' },
    body: worldRequestBody(request),
    }, 0, longForm(request) ? 120_000 : request.role === 'character' ? Math.max(config.requestTimeoutMs, 45_000) : config.requestTimeoutMs) // Long prose has a bounded separate timeout; no paid retries.
  if (!response.ok) throw new ProviderCallError(`WORLD_PROVIDER_HTTP_${response.status}`, 'world provider request failed')
  const data = await response.json() as {
    choices?: Array<{ finish_reason?: string; message: { content?: string; refusal?: string } }>
    content?: Array<{ type: string; input?: unknown }>
    usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number }
  }
  let raw: unknown
  if (openai) {
    const choice = data.choices?.[0]
    if (!choice?.message.content || choice.message.refusal || choice.finish_reason !== 'stop') throw new ProviderCallError('INVALID_MODEL_RESPONSE', 'refused, empty or truncated result')
    try { raw = JSON.parse(choice.message.content) } catch { throw new ProviderCallError('INVALID_MODEL_JSON', 'invalid model result') }
  } else raw = data.content?.find(c => c.type === 'tool_use')?.input
  if (!raw) throw new ProviderCallError('INVALID_MODEL_RESPONSE', 'missing structured result')
  return { raw, inputTokens: data.usage?.prompt_tokens ?? data.usage?.input_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? data.usage?.output_tokens ?? 0 }
}
