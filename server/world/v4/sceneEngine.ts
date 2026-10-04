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
import { dist, ensureGeo, regionAt } from '../geo/geoBuild.ts'
import { aware } from '../geo/perception.ts'

export const MAX_SCENE_CAST = 4

export interface SceneHooks {
  callModel(request: WorldModelRequest, actorId: string): Promise<unknown>
  // False once the season changed, paused or shut down while a model was answering.
  current(): boolean
  scenes(): ChronicleEntry[]
}

const alive = (a: Agent) => a.publicState.status === 'alive' || a.publicState.status === 'injured'

// A fight is only still a fight while both sides are alive and can still reach each other. It also
// cannot own the spotlight forever: six scenes is the hard ceiling, whatever the GM keeps reporting.
export function pruneStandoff(world: WorldState, v4: V4State): void {
  const standoff = v4.standoff
  if (!standoff) return
  const geo = world.engine!.geo
  const people = standoff.ids.map(id => world.agents.find(a => a.id === id)).filter((a): a is Agent => Boolean(a && alive(a) && a.publicState.coord))
  const together = Boolean(geo) && people.some(a => people.some(b => b.id !== a.id && aware(world, geo!, a, b)))
  if (people.length < 2 || !together || standoff.scenes >= 7) delete v4.standoff
}

// Scene groups are people who actually perceive each other (real distance, terrain, light) —
// never people who merely share a place name. Whoever has waited longest gets the spotlight; a
// fresh mid-route encounter or a closing zone jumps the queue; a group of several counts as 90
// extra minutes of waiting. The same group holds the spotlight at most three scenes in a row.
export function selectSpotlight(world: WorldState, v4: V4State): { place: Place; agents: Agent[]; key: string } | null {
  const minute = world.engine!.minute, geo = world.engine!.geo
  if (!geo) return null
  const people = world.agents.filter(a => alive(a) && a.publicState.coord)
  const root = new Map(people.map(a => [a.id, a.id]))
  const find = (id: string): string => root.get(id) === id ? id : find(root.get(id)!)
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++)
    if (aware(world, geo, people[i], people[j])) root.set(find(people[i].id), find(people[j].id))
  const groups = new Map<string, Agent[]>()
  for (const a of people) groups.set(find(a.id), [...(groups.get(find(a.id)) ?? []), a])
  const waited = (a: Agent) => minute - (v4.lastSceneMinute[a.id] ?? -100_000)
  // People standing in a closing or closed zone must get a chance to flee before it kills them.
  const endangered = new Set([...closedPlaceIds(v4, minute), ...v4.director.closures.map(c => c.placeId)])
  // People locked in an unresolved fight: the scene must keep returning to them until it ends.
  const locked = new Set(v4.standoff?.ids ?? [])
  const candidates = [...groups.values()].flatMap(members => {
    // A crowd larger than a scene: the longest-waiting person and those nearest to them — but a
    // party to an unresolved fight leads, so the fight itself is never cropped out of its scene.
    const lead = [...members].sort((a, b) => (locked.has(b.id) ? 1 : 0) - (locked.has(a.id) ? 1 : 0) || waited(b) - waited(a))[0]
    const agents = [...members].sort((a, b) => dist(a.publicState.coord!, lead.publicState.coord!) - dist(b.publicState.coord!, lead.publicState.coord!)).slice(0, MAX_SCENE_CAST)
    const place = world.places.find(p => p.id === regionAt(geo, lead.publicState.coord!).placeId)
    if (!place) return []
    const ids = agents.map(a => a.id)
    const key = [...ids].sort().join(',')
    const fresh = (v4.encounters ?? []).some(e => e.ids.every(id => ids.includes(id)))
    const fight = ids.filter(id => locked.has(id)).length >= 2
    const score = (fight ? 100_000 : 0) + (agents.some(a => endangered.has(a.publicState.locationId)) ? 10_000 : 0) + (fresh ? 500 : 0) + (agents.length > 1 ? 90 : 0)
      + Math.max(...agents.map(waited)) - (!fight && key === v4.lastGroupKey && v4.repeatCount >= 3 ? 50_000 : 0)
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
  ensureGeo(world, execution.draft)
  pruneStandoff(world, v4)
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
  // Unusable twice: publish nothing, but rotate the spotlight so one bad scene can't stall the
  // world — including releasing a fight the GM could not adjudicate.
  for (const a of spotlight.agents) v4.lastSceneMinute[a.id] = world.engine!.minute
  if (ctx.standoff) delete v4.standoff
  return null
}
