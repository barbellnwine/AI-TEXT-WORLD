import { config, DEFAULT_PRICING } from '../config.ts'
import { fetchWithLimits, ProviderCallError } from '../providers/httpUtil.ts'
import { MAX_PROVIDER_REQUEST_BYTES } from '../providers/requestBody.ts'
import { WORLD_RULES_TEXT } from '../prompts/worldRules.ts'
import { buildAgentPrompt } from '../prompts/agentPrompt.ts'
import { buildAgentKnowledgeView } from '../world/knowledgeFilter.ts'
import type { ProposedAction } from '../world/actionSchema.ts'
import type { DraftDTO } from './worldDrafts.ts'
import type { RulePresetDTO } from './rulePresets.ts'
import type { WorldState, WorldEvent } from './worldTypes.ts'

// Immutable, server-only season design. Never attach this object to a public response.
export interface WorldExecution {
  draft: DraftDTO
  rules: RulePresetDTO['rules']
  mode: 'demo' | 'live'
}
export interface WorldModelRequest {
  role: 'agent' | 'judge'
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
    actorId: string, actionType: { type: 'string', enum: ['MOVE', 'SPEAK', 'GIVE_ITEM', 'OBSERVE', 'WAIT', 'COOPERATE', 'INTERACT', 'REST', 'SLEEP', 'TAKE_ITEM', 'EAT', 'DRINK', 'EXPLORE', 'SHARE_INFO', 'USE_ITEM', 'DROP_ITEM'] },
    locationId: string, targetIds: { type: 'array', items: string }, intendedAction: string,
    destinationId: nullableString, spokenText: nullableString, usedItemIds: { type: 'array', items: string },
    claimedKnowledgeId: nullableString,
    resourceKey: nullableString, factId: nullableString, durationMinutes: { type: ['integer', 'null'] },
  },
  required: ['actorId', 'actionType', 'locationId', 'targetIds', 'intendedAction', 'destinationId', 'spokenText', 'usedItemIds', 'claimedKnowledgeId', 'resourceKey', 'factId', 'durationMinutes'],
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
  if (r.durationMinutes != null && (typeof r.durationMinutes !== 'number' || !Number.isInteger(r.durationMinutes) || r.durationMinutes < 1 || r.durationMinutes > 480)) throw new Error('invalid_action_duration')
  return { actorId, actionType: r.actionType as ProposedAction['actionType'], locationId: text('locationId')!,
    intendedAction: text('intendedAction')!, targetIds: ids('targetIds'), usedItemIds: ids('usedItemIds'),
    destinationId: text('destinationId', true), spokenText: text('spokenText', true), claimedKnowledgeId: text('claimedKnowledgeId', true),
    resourceKey: text('resourceKey', true), factId: text('factId', true), durationMinutes: typeof r.durationMinutes === 'number' && Number.isInteger(r.durationMinutes) && r.durationMinutes > 0 && r.durationMinutes <= 480 ? r.durationMinutes : undefined }
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

function rulesText(execution: WorldExecution): string {
  return JSON.stringify(execution.rules.filter(r => r.enabled).sort((a, b) => b.priority - a.priority).map(r => ({ title: r.title, description: r.description })))
}

export function agentRequest(execution: WorldExecution, actorId: string, world: WorldState, events: WorldEvent[]): WorldModelRequest {
  const view = buildAgentKnowledgeView(actorId, world, events.filter(e => e.outcome !== 'REJECTED'))
  if (!view) throw new Error('agent_has_no_location')
  view.observedEvents = view.observedEvents.slice(0, 12)
  view.knownFacts = view.knownFacts.slice(-30)
  const c = execution.draft.characters.find(c => c.id === actorId)!
  const profile = { age: c.age, gender: c.gender, background: c.background, occupation: c.occupation, personality: c.personality,
    goal: c.goal, strengths: c.strengths, weaknesses: c.weaknesses, privateInfo: c.privateInfo }
  const build = (): WorldModelRequest => ({ role: 'agent', ...modelFor(execution, actorId), schema: ACTION_SCHEMA,
    prompt: [buildAgentPrompt(view, []), '[SEASON RULES]', rulesText(execution), '[WORLD BACKGROUND]', execution.draft.background,
      '[GENRES]', execution.draft.genre,
      '[LOCAL ENVIRONMENT]', JSON.stringify({ weather: world.engine?.weather, place: { power: world.places.find(p=>p.id===view.self.locationId)?.power, flooded: world.places.find(p=>p.id===view.self.locationId)?.flooded } }),
      '[CLOCK]', JSON.stringify(world.clock), '[YOUR CHARACTER ONLY]', JSON.stringify(profile),
      '[YOUR INVENTORY]', JSON.stringify(world.engine?.objects.filter(o=>o.location.kind==='agent'&&o.location.id===actorId).map(({id,name,kind,quantity})=>({id,name,kind,quantity}))),
      'USE_ITEM은 소지한 food/water/medicine/fuel 1단위를 사용하거나 tool을 사용합니다. DROP_ITEM은 소지품을 현재 장소에 내려놓습니다. INTERACT에 resourceKey를 지정하면 해당 장소의 실제 자원 1단위를 작업에 소비합니다. 새 아이템을 만들거나 작업 성공을 보장하지 않습니다. 직업·장점은 가능한 시도를 판단하는 맥락이며 성공을 보장하지 않습니다.',
      'MOVE는 알고 있는 인접 장소로 이동, TAKE_ITEM은 현재 장소의 기존 물건 하나를 가져오기, GIVE_ITEM은 소지품 하나를 전달합니다. EAT/DRINK는 현재 장소의 food/water 자원을 1단위 소비합니다. SHARE_INFO는 자신의 factId를 상대에게 전달합니다. EXPLORE는 기존 장소/정보만 탐색합니다. REST/SLEEP/WAIT는 정상 선택입니다. 긴 행동은 엔진이 시간 동안 실행하며 재판단하지 않습니다. 타인의 반응·동의·행동이나 결과를 확정하지 마십시오. 성적 행동은 지원하지 않으며 욕구 수치가 행동을 강제하지 않습니다.',
      'intendedAction에는 시도만 적고 성공·발견·타인의 반응을 지어내지 마십시오. 사용하지 않는 선택 필드는 null 또는 []로 반환하십시오.',
      '[EXACT JSON SCHEMA]', JSON.stringify(ACTION_SCHEMA)].join('\n\n') })
  while (true) {
    const request = build()
    if (execution.mode === 'demo') return request
    try { worldRequestBody(request); return request } catch (error) {
      // Trim only historical context. Never silently drop the world rules or character design.
      if (view.observedEvents.length) view.observedEvents.pop()
      else if (view.knownFacts.length) view.knownFacts.shift()
      else if (view.self.memories?.length) view.self.memories.shift()
      else throw error
    }
  }
}

export function judgeRequest(execution: WorldExecution, action: ProposedAction, world: WorldState, events: WorldEvent[]): WorldModelRequest {
  return { role: 'judge', ...modelFor(execution, action.actorId), schema: JUDGE_SCHEMA,
    prompt: [WORLD_RULES_TEXT, '당신은 세계의 판정자입니다. 제안이 시즌 규칙·이동 조건·설정에 부합하는지만 판정하십시오. 상태 변경이나 새로운 사실을 만들지 마십시오. 종료 조건은 현재 확정된 상태에서만 검사하고 제안의 예상 결과로 종료하지 마십시오. 종료 조건이 비어 있으면 ended=false입니다. reason은 관리자에게만 공개됩니다.',
      '[SEASON RULES]', rulesText(execution), '[WORLD DESIGN — PRIVATE]', JSON.stringify({ background: execution.draft.background, hiddenWorldTruth: execution.draft.hiddenWorldTruth, endCondition: execution.draft.endCondition,
        connections: execution.draft.connections.filter(c => c.fromPlaceId === action.locationId || c.toPlaceId === action.locationId), powerStatus: execution.draft.powerStatus, facilityStatus: execution.draft.facilityStatus, resources: execution.draft.initialResources }),
      '[CURRENT STATE]', JSON.stringify({ clock: world.clock, dangerLevel: world.dangerLevel,
        places: world.places.map(p => ({ id: p.id, name: p.name, resources: p.resources, locked: p.locked, currentAgentIds: p.currentAgentIds })),
        agents: world.agents.map(a => ({ id: a.id, name: a.name, publicState: a.publicState, inventory: a.inventory })) }),
      '[RECENT CONFIRMED EVENTS]', JSON.stringify(events.filter(e => e.outcome !== 'REJECTED').slice(0, 5).map(e => ({ title: e.title, summary: e.summary, stateChanges: e.stateChanges }))),
      '[PROPOSAL]', JSON.stringify(action), '[EXACT JSON SCHEMA]', JSON.stringify(JUDGE_SCHEMA)].join('\n\n') }
}

export function demoAction(actorId: string, world: WorldState): ProposedAction {
  const actor = world.agents.find(a => a.id === actorId)!
  const place = world.places.find(p => p.id === actor.publicState.locationId)!
  const destinationId = place.connectedPlaceIds.find(id => actor.knownPlaceIds?.includes(id) && !world.places.find(p => p.id === id)?.locked)
  const base = { actorId, locationId: place.id, targetIds: [], usedItemIds: [], intendedAction: '현재 상태에 따라 행동한다.' }
  if ((actor.humanState?.survival_need ?? 1) >= 6) {
    const supply = place.resources.find(r => ['food', 'water'].includes(r.key) && r.level >= 1)
    if (supply) return { ...base, actionType: supply.key === 'food' ? 'EAT' : 'DRINK', resourceKey: supply.key }
  }
  if ((actor.humanState?.fatigue ?? 1) >= 7) return { ...base, actionType: 'SLEEP', durationMinutes: 180 }
  return { actorId, locationId: place.id, actionType: destinationId ? 'MOVE' : 'WAIT', destinationId,
    targetIds: [], usedItemIds: [], intendedAction: destinationId ? '인접 장소를 탐색한다.' : `${world.clock.time}에 주변을 살피며 기다린다.` }
}

export function ensureModelConfigured(request: Pick<WorldModelRequest, 'provider' | 'model'>): void {
  if (!(request.provider === 'openai' ? config.openaiApiKey : request.provider === 'anthropic' ? config.anthropicApiKey : '')) throw new ProviderCallError('PROVIDER_KEY_MISSING', 'provider key missing')
  if (!DEFAULT_PRICING.some(p => p.provider === request.provider && p.model === request.model)) throw new ProviderCallError('MODEL_PRICING_MISSING', 'configure model and pricing before running')
}

export function worldRequestBody(request: WorldModelRequest): string {
  const body = JSON.stringify(request.provider === 'openai' ? {
    model: request.model, messages: [{ role: 'user', content: request.prompt }], max_completion_tokens: 1500,
    response_format: { type: 'json_schema', json_schema: { name: `world_${request.role}`, strict: true, schema: request.schema } },
  } : {
    model: request.model, messages: [{ role: 'user', content: request.prompt }], max_tokens: 1500,
    tools: [{ name: 'submit_world_result', description: 'Submit the structured result.', input_schema: request.schema }],
    tool_choice: { type: 'tool', name: 'submit_world_result' },
  })
  if (Buffer.byteLength(body) > MAX_PROVIDER_REQUEST_BYTES) throw new ProviderCallError('WORLD_CONTEXT_TOO_LARGE', 'shorten world rules or character context')
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
  }, 0) // One budget reservation = exactly one HTTP attempt. No implicit paid retries.
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
