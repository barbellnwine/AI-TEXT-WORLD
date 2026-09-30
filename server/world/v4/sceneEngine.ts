// v4 SCENE ENGINE — one scene per call:
//   spotlight (who/where) → each character decides freely → GM adjudicates + writes prose → apply.
// Model calls go through the injected callModel so budget, pricing and tracing stay shared.
import type { Agent, ChronicleEntry, Place, WorldState } from '../../domain/worldTypes.ts'
import { gmModel, modelFor, worldRequestBody, type WorldExecution, type WorldModelRequest } from '../../domain/worldAgent.ts'
import { ProviderCallError } from '../../providers/httpUtil.ts'
import type { CharacterIntent, V4State } from './sceneTypes.ts'
import { closedPlaceIds, ensureV4State } from './director.ts'
import { buildCharacterPrompt, buildGmPrompt, buildSceneContext, CHARACTER_SCHEMA, GM_SCHEMA, type SceneContext } from './scenePrompts.ts'
import { applyGmResult, gmIssues, parseGmResult, type AppliedScene } from './sceneApply.ts'

export const MAX_SCENE_CAST = 4

export interface SceneHooks {
  callModel(request: WorldModelRequest, actorId: string): Promise<unknown>
  // False once the season changed, paused or shut down while a model was answering.
  current(): boolean
  scenes(): ChronicleEntry[]
}

const alive = (a: Agent) => a.publicState.status === 'alive' || a.publicState.status === 'injured'

// Whoever has waited longest gets the spotlight; an encounter counts as 90 extra minutes of
// waiting, so meetings come first without starving a lone character. The same group can hold
// the spotlight for at most three scenes in a row so everyone's story keeps moving.
export function selectSpotlight(world: WorldState, v4: V4State): { place: Place; agents: Agent[]; key: string } | null {
  const minute = world.engine!.minute
  const groups = new Map<string, Agent[]>()
  for (const a of world.agents.filter(alive)) groups.set(a.publicState.locationId, [...(groups.get(a.publicState.locationId) ?? []), a])
  const waited = (a: Agent) => minute - (v4.lastSceneMinute[a.id] ?? -100_000)
  // People standing in a closing or closed zone must get a chance to flee before it kills them.
  const endangered = new Set([...closedPlaceIds(v4, minute), ...v4.director.closures.map(c => c.placeId)])
  const candidates = [...groups.entries()].flatMap(([placeId, members]) => {
    const place = world.places.find(p => p.id === placeId)
    if (!place) return []
    const agents = [...members].sort((a, b) => waited(b) - waited(a)).slice(0, MAX_SCENE_CAST)
    const key = `${placeId}:${agents.map(a => a.id).sort().join(',')}`
    const score = (endangered.has(placeId) ? 10_000 : 0) + (agents.length > 1 ? 90 : 0) + Math.max(...agents.map(waited)) - (key === v4.lastGroupKey && v4.repeatCount >= 3 ? 50_000 : 0)
    return [{ place, agents, key, score }]
  })
  if (!candidates.length) return null
  return candidates.sort((a, b) => b.score - a.score)[0]
}

function lastSceneWith(scenes: ChronicleEntry[], agentIds: string[]): string {
  const scene = [...scenes].reverse().find(s => s.agentIds.some(id => agentIds.includes(id)) && s.id.startsWith('scene-v4-'))
  return scene ? `${scene.title}\n${scene.body}` : ''
}

function fitRequest(build: (trim: number) => WorldModelRequest): WorldModelRequest {
  for (const trim of [0, 1, 2]) {
    const request = build(trim)
    try { worldRequestBody(request); return request } catch (error) { if (!(error instanceof ProviderCallError) || trim === 2) throw error }
  }
  throw new Error('unreachable')
}

export function parseCharacterIntent(raw: unknown, agentId: string): CharacterIntent | null {
  const r = raw as Record<string, unknown> | null
  if (!r || typeof r !== 'object' || typeof r.action !== 'string' || !r.action.trim()) return null
  const opt = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim().slice(0, 400) : null
  return { agentId, thought: typeof r.thought === 'string' ? r.thought.trim().slice(0, 600) : '', action: r.action.trim().slice(0, 600),
    speech: opt(r.speech), targetName: opt(r.targetName), moveTo: opt(r.moveTo) }
}

async function decide(world: WorldState, execution: WorldExecution, v4: V4State, ctx: SceneContext, hooks: SceneHooks): Promise<CharacterIntent[]> {
  const results = await Promise.allSettled(ctx.cast.map(async member => {
    const last = lastSceneWith(hooks.scenes(), [member.agent.id])
    const request = fitRequest(trim => ({ role: 'character', ...modelFor(execution, member.agent.id), schema: CHARACTER_SCHEMA, maxOutputTokens: 900,
      prompt: buildCharacterPrompt(world, execution, v4, ctx, member, trim ? last.slice(-600 / trim) : last) }))
    return parseCharacterIntent(await hooks.callModel(request, member.agent.id), member.agent.id)
  }))
  const intents = results.flatMap(r => r.status === 'fulfilled' && r.value ? [r.value] : [])
  // A budget/key/transport failure for every character is a runtime problem, not a quiet scene.
  if (!intents.length) {
    const failure = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined
    if (failure) throw failure.reason
  }
  return intents
}

export async function runScene(world: WorldState, execution: WorldExecution, seasonId: string, hooks: SceneHooks): Promise<AppliedScene | null> {
  const v4 = ensureV4State(world, execution)
  const spotlight = selectSpotlight(world, v4)
  if (!spotlight) return null
  const ctx = buildSceneContext(world, v4, spotlight.place, spotlight.agents)
  const intents = await decide(world, execution, v4, ctx, hooks)
  if (!hooks.current()) return null
  const previous = lastSceneWith(hooks.scenes(), spotlight.agents.map(a => a.id))
  let corrections = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const request = fitRequest(trim => ({ role: 'gm', ...gmModel(), schema: GM_SCHEMA, maxOutputTokens: 5000,
      prompt: buildGmPrompt(world, execution, v4, ctx, intents, trim ? previous.slice(-700 / trim) : previous, corrections) }))
    const raw = await hooks.callModel(request, spotlight.agents[0].id)
    if (!hooks.current()) return null
    let issues: string[]
    let result
    try { result = parseGmResult(raw); issues = gmIssues(ctx, result) } catch { issues = ['JSON 구조가 스키마와 맞지 않는다.'] }
    if (!issues.length && result) {
      v4.repeatCount = spotlight.key === v4.lastGroupKey ? v4.repeatCount + 1 : 1
      v4.lastGroupKey = spotlight.key
      return applyGmResult(world, v4, seasonId, ctx, result, intents)
    }
    corrections = issues.join('\n').slice(0, 1500)
    console.warn('[world-v4] GM result rejected', attempt, corrections.slice(0, 400))
  }
  // Unusable twice: publish nothing, but rotate the spotlight so one bad scene can't stall the world.
  for (const a of spotlight.agents) v4.lastSceneMinute[a.id] = world.engine!.minute
  return null
}
