import {initializeModelTrace,traceModel,traceOutcome} from './modelTrace.ts'
import {sceneEvidence,splitNarrativeScenes} from './sceneEvidence.ts'
import { prepareDecision, bindCandidate } from '../world/decisionController.ts'
import { orderConflictingIntents } from '../world/intentConflict.ts'
import { groundPlannerSteps, GroundingFailure } from '../world/plannerGrounding.ts'
import {acceptCombatBatch,combatBatchIssue,combatBatchRequest,combatFingerprint,normalizeCombatBatch} from '../world/traumaAdjudication.ts'
import { ensureMotivations } from '../world/motivations.ts'
import { ensureAgentV2, type AgentV2State } from '../world/agentV2State.ts'
import { parseDispositions, type Dispositions } from '../world/dispositions.ts'
import { storyEvent, composeDay, validateEditorialPlan } from './storyComposition.ts'
// Single-world runtime. Builder seasons are checkpointed in SQLite; the initial sample world
// remains a read-only design preview with a demo event queue. All action effects pass through
// validation and stateTransition before being exposed to the reader.
import type { ServerResponse } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { config } from '../config.ts'
import { ensurePricingSeeded, getPricing, estimateCostUsd, getUsdToKrwRate, checkBudget, reserveBudget, settleReservation } from './budget.ts'
import type { Provider } from './types.ts'
import { ProviderCallError } from '../providers/httpUtil.ts'
import { HttpError } from '../http.ts'
import { agentRequest, brainRequest, plannerRequest, parseBrainIntent, judgeRequest, parseProposedAction, parseJudgment, worldModelAdapter, ensureModelConfigured, worldRequestBody, type BrainIntent, type WorldExecution, type WorldModelAdapter, type WorldModelRequest } from './worldAgent.ts'
import { initializeEngine, advanceEngine, selectDecisionAgents, validateEngineAction, beginAction, recordExperience, nextDecisionDelay, prepareThreatResponse } from '../world/worldEngine.ts'
import type { ProposedAction } from '../world/actionSchema.ts'
import { toPublicWorld, toPublicEvent } from '../world/publicView.ts'
import { AGENT_PROMPT_VERSION } from '../prompts/agentPrompt.ts'
import type { Agent, Chapter, ChronicleEntry, Faction, OperatorLogEntry, Place, ProviderUsage, RuntimeError, Season, WorldEvent, WorldRuntime, WorldState } from './worldTypes.ts'
import {
  buildArchivedSeasons,
  buildBaselineEvents,
  buildChapters,
  buildInitialSeason,
  buildInitialWorldState,
  buildQueuedEvents,
  buildQueuedScenes,
  buildScenes,
  type QueuedSceneDefinition,
} from './worldMock.ts'
import { mockNarrator } from './narrator.ts'
import { eventProse } from './eventProse.ts'
import { buildNarratorPrompt } from '../prompts/narratorPrompt.ts'
import { unsupportedNarrative } from './narrativeGuard.ts'
import { storySchemaFor, causalStoryOrder, validateStory, storyValidationIssue, verifiedStory, reviewPrompt, REVIEW_SCHEMA } from './novelNarration.ts'
import { processStudio } from '../world/studioEngine.ts'
import { validateGmEvent } from '../world/worldValidator.ts'
import { applyStateChanges } from '../world/stateTransition.ts'
import { eraseWorldDesign } from './worldDrafts.ts'
import { runScene } from '../world/v4/sceneEngine.ts'
import { runDirector, ensureV4State } from '../world/v4/director.ts'
import { ensureGeo } from '../world/geo/geoBuild.ts'
import { matchesIslandMap } from '../world/geo/islandMap.ts'
import { advanceSpace } from '../world/v4/spatialTick.ts'

const DEFAULT_TICK_MS = 5_000
const MAX_EVENTS_KEPT = 500
const emptyPipeline = () => ({ brainCalls:0, plannerCalls:0, groundingSuccesses:0, groundingFailures:0,
  validationAccepted:0, validationRejected:0, resultJudgmentCalls:0, acceptedActions:0, completedActions:0, worldEvents:0, providerFailures:0 })

interface State {
  dayNarration?: Record<number, { entry: ChronicleEntry; throughMinute: number; eventCount: number }>
  execution?: WorldExecution
  nextPaidDecisionAt?: number
  chapterBuffer?: { chapterId: string; eventIds: string[]; day: number; startedMinute: number }
  season: Season
  worldState: WorldState
  events: WorldEvent[]
  queued: WorldEvent[]
  scenes: ChronicleEntry[]
  queuedScenes: QueuedSceneDefinition[]
  chapters: Chapter[]
  archivedSeasons: Season[]
  runtime: WorldRuntime
}

const state: State = {
  season: buildInitialSeason(),
  worldState: buildInitialWorldState(),
  events: buildBaselineEvents(),
  queued: buildQueuedEvents(),
  scenes: buildScenes(),
  queuedScenes: buildQueuedScenes(),
  chapters: buildChapters(),
  archivedSeasons: buildArchivedSeasons(),
  runtime: {
    connected: true,
    status: 'RUNNING',
    paused: false,
    tickIntervalMs: DEFAULT_TICK_MS,
    maxActiveAgents: config.worldDecisionsPerCycle,
    callBudget: 500,
    callsUsed: 0,
    pipeline: emptyPipeline(),
    providerUsage: [
      { provider: 'demo', calls: 0, estTokens: 0, estCostUsd: 0 },
    ],
    lastTickAt: null,
    nextTickAt: new Date(Date.now() + DEFAULT_TICK_MS).toISOString(),
    lockHolder: null,
    lockExpiresAt: null,
    queuedEvents: buildQueuedEvents().length,
    failedJobs: 0,
    retryCount: 0,
    agentLastCallAt: {},
    recentErrors: [],
    operatorLog: [],
  },
}
const pipeline = () => state.runtime.pipeline ??= emptyPipeline()

const subscribers = new Set<ServerResponse>()
let runtimeDb: DatabaseSync | undefined
let modelAdapter: WorldModelAdapter = worldModelAdapter
// Off by default so no existing test that flushes a chapter in 'live' mode needs to also stub a
// narrator call — only server/index.ts's real boot opts in explicitly.
let narratorEnabled = false
let revision = 0
let activeTick: Promise<void> | null = null
let shuttingDown = false
// Fire-and-forget narrator enhancements (see enhanceSceneNarration). Tracked so shutdown/tests can
// await them instead of leaving dangling promises/timers across process or test-case boundaries.
const pendingNarrations = new Set<Promise<void>>()

function persist(): void {
  if (!runtimeDb || !state.execution) return
  runtimeDb.exec('SAVEPOINT world_checkpoint')
  try {
    const append = runtimeDb.prepare('INSERT OR IGNORE INTO world_event_journal (id, season_id, payload) VALUES (?, ?, ?)')
    for (const event of [...state.events].reverse()) append.run(event.id, state.season.id, JSON.stringify(event))
    runtimeDb.prepare('INSERT INTO world_runtime_checkpoint (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(JSON.stringify(state))
    runtimeDb.prepare('UPDATE world_drafts SET status=?, ended_at=? WHERE id=?').run(state.season.status, state.season.endedAt, state.season.id)
    runtimeDb.exec('RELEASE world_checkpoint')
  } catch (error) {
    runtimeDb.exec('ROLLBACK TO world_checkpoint; RELEASE world_checkpoint')
    throw error
  }
}

export function initializeWorldRuntime(db: DatabaseSync, adapter: WorldModelAdapter = worldModelAdapter, enableNarrator = false): void {
  stopSimulationTimerForTests()
  runtimeDb = db; initializeModelTrace(db)
  ensurePricingSeeded(db)
  modelAdapter = adapter
  narratorEnabled = enableNarrator
  shuttingDown = false
  const row = db.prepare('SELECT payload FROM world_runtime_checkpoint WHERE id=1').get() as { payload: string } | undefined
  if (row) {
    Object.assign(state, JSON.parse(row.payload) as State)
    state.runtime.pipeline ??= emptyPipeline()
    delete (state as State & { recentActions?: unknown; nextAgentIndex?: unknown }).recentActions
    delete (state as State & { nextAgentIndex?: unknown }).nextAgentIndex
    if (state.execution) initializeEngine(state.worldState, state.execution.draft)
    // A season played on a painted map gets its ground the moment the server comes back, so the
    // map, the scattered starting positions and every distance exist before the first tick.
    if (state.execution && matchesIslandMap(state.worldState.places)) ensureGeo(state.worldState, state.execution.draft)
    revision++
    state.runtime.lockHolder = null
    state.runtime.lockExpiresAt = null
    // Restore all progress, but require the operator to resume after an interrupted process.
    if (state.runtime.status === 'RUNNING') {
      state.runtime.status = state.season.status = 'PAUSED'
      state.runtime.paused = true
    }
    state.runtime.nextTickAt = null
    // Old checkpoints assigned tasks on invitation alone. Keep historical actions,
    // but require an actual recorded acceptance before any untouched target task runs.
    for (const plan of state.worldState.engine?.behavior?.plans ?? []) {
      const invitations = (state.worldState.engine?.interactions ?? []).filter(i =>
        i.actorId === plan.proposerId && i.intent === 'PROPOSE_SURVIVAL_PLAN' && i.placeId === plan.placeId &&
        Math.abs(i.minute - plan.createdMinute) <= 3)
      plan.sourceEventId ??= invitations[0]?.sourceEventId
      for (const task of plan.tasks) {
        if (task.actorId === plan.proposerId || task.status !== 'suggested') continue
        const invitation = invitations.find(i => i.targetId === task.actorId)
        if (invitation?.status === 'accepted') continue
        task.status = invitation?.status === 'pending' ? 'invited' : 'blocked'
      }
    }
    for (const actor of state.worldState.agents) {
      actor.age??=state.execution?.draft.characters.find(c=>c.id===actor.id)?.age??null
      actor.dispositions ??= state.execution?.draft.characters.find(c => c.id === actor.id)?.dispositions
      ensureMotivations(actor, state.worldState.engine?.minute ?? 0)
      ensureAgentV2(actor, state.worldState)
    }
    // Repair persisted unsupported claims without changing historical engine facts.
    for (const scene of state.scenes) {
      const sources = scene.sourceEventIds.map(id => getEvent(id)).filter((e): e is WorldEvent => Boolean(e))
      if (!sources.length || sources.length !== scene.sourceEventIds.length) continue
      if (unsupportedNarrative(`${scene.title}\n${scene.body}`, sources) || sources.every(e => e.phase === 'STATE_UPDATE')) {
        const corrected = mockNarrator.narrateFallbackScene(sources.map(toPublicEvent), placesById(), agentsById())
        if (scene.title === corrected.title && scene.body === corrected.body) continue
        scene.corrections ??= []
        scene.corrections.push({ at: new Date().toISOString(), reason: 'Engine evidence correction: unsupported narration or state-only repetition', previousTitle: scene.title, previousBody: scene.body })
        scene.title = corrected.title; scene.body = corrected.body
        const chapter = state.chapters.find(c => c.sceneId === scene.id)
        if (chapter) chapter.summary = scene.body
      }
    }
    persist()
  }
  scheduleTimer()
}

export async function shutdownWorldRuntime(): Promise<void> {
  shuttingDown = true
  revision++
  stopSimulationTimerForTests()
  for (const res of subscribers) res.end()
  subscribers.clear()
  await activeTick
  await Promise.all(pendingNarrations)
  persist()
  runtimeDb = undefined
}

function broadcast(payload: unknown): void {
  const data = `data: ${JSON.stringify(payload)}\n\n`
  for (const res of subscribers) {
    try {
      res.write(data)
    } catch {
      subscribers.delete(res)
    }
  }
}

export function subscribeStream(res: ServerResponse): () => void {
  subscribers.add(res)
  return () => subscribers.delete(res)
}

function placesById(): Map<string, Place> {
  return new Map(state.worldState.places.map(p => [p.id, p]))
}

function agentsById(): Map<string, Agent> {
  return new Map(state.worldState.agents.map(a => [a.id, a]))
}

function pushEvent(event: WorldEvent, alreadyApplied = false): void {
  event.sequence = (state.events[0]?.sequence ?? state.events.length) + 1
  state.events.unshift(event)
  if (state.events.length > MAX_EVENTS_KEPT) state.events.length = MAX_EVENTS_KEPT
  if (event.outcome === 'REJECTED') { persist(); return }
  if (event.visibility !== 'private' && event.phase !== 'STARTED') state.worldState.activeEventIds = [event.id]
  state.worldState.updatedAt = event.occurredAt
  if (!alreadyApplied) applyStateChanges(state.worldState, event.stateChanges)
  const place = state.worldState.places.find(p => p.id === event.placeId)
  if (place && event.visibility !== 'private' && event.phase !== 'STARTED') {
    place.recentEventIds = [event.id, ...place.recentEventIds].slice(0, 8)
  }
  persist()
  if (storyEvent(event)) broadcast({ type: 'event', payload: toPublicEvent(event) })
  broadcast({ type: 'worldState', payload: toPublicWorld(state.worldState) })
  emitReadyScenes()
}

// A queued scene becomes real the moment every WorldEvent it depends on has actually fired — the
// reading page never sees a scene ahead of the events that justify it. This is the "adapter"
// (WorldEvent[] -> ChronicleEntry) required to stay separate from any UI component: it lives here
// and in narrator.ts, never inside a React component.
function emitReadyScenes(): void {
  const firedIds = new Set(state.events.map(e => e.id))
  const stillWaiting: QueuedSceneDefinition[] = []
  for (const queuedScene of state.queuedScenes) {
    if (queuedScene.requiredEventIds.every(id => firedIds.has(id))) {
      const sourceEvents = queuedScene.requiredEventIds.map(id => state.events.find(e => e.id === id)!).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16)
      const scene: ChronicleEntry = {
        ...queuedScene.scene,
        worldDay: sourceEvents[sourceEvents.length - 1].day,
        timeStart: hhmm(sourceEvents[0].occurredAt),
        timeEnd: hhmm(sourceEvents[sourceEvents.length - 1].occurredAt),
        createdAt: new Date().toISOString(),
      }
      state.scenes.push(scene)
      broadcast({ type: 'scene', payload: scene })
    } else {
      stillWaiting.push(queuedScene)
    }
  }
  state.queuedScenes = stillWaiting
}

// --- Public reads -----------------------------------------------------------

export function getSeason(): Season {
  return state.season
}
export function isWorldPublic(): boolean { return state.execution?.draft.isPublic !== false }

export function getWorldState(): WorldState {
  return state.worldState
}

export function getSpotlightEvent(): WorldEvent | undefined {
  const id = state.worldState.activeEventIds[0]
  return state.events.find(e => e.id === id && storyEvent(e)) ?? state.events.find(storyEvent)
}

export interface EventFilter {
  beforeId?: string
  sinceIso?: string
  type?: string
  agentId?: string
  placeId?: string
  importantOnly?: boolean
  limit: number
  offset: number
}

function historyEvents(): WorldEvent[] {
  if (!runtimeDb || !state.execution) return state.events
  return (runtimeDb.prepare('SELECT payload FROM world_event_journal WHERE season_id=? ORDER BY sequence DESC').all(state.season.id) as { payload: string }[]).map(row => JSON.parse(row.payload) as WorldEvent)
}

function readArchivedEvent(id: string): WorldEvent | undefined {
  const row = runtimeDb?.prepare('SELECT payload FROM world_event_journal WHERE id=? AND season_id=?').get(id, state.season.id) as { payload: string } | undefined
  return row ? JSON.parse(row.payload) as WorldEvent : undefined
}

export function awaySummary(since: string) {
  const events = historyEvents().filter(e => e.occurredAt > since && e.outcome !== 'REJECTED' && e.visibility !== 'private')
  return { since, until: new Date().toISOString(), eventCount: events.length,
    actions: events.filter(e => e.phase === 'COMPLETED').length,
    majorEvents: events.filter(e => e.importance === 'high' || e.importance === 'critical').length }
}

export function listEvents(filter: EventFilter): { items: WorldEvent[]; total: number } {
  let items = historyEvents().filter(storyEvent)
  if (filter.sinceIso) items = items.filter(e => e.occurredAt >= filter.sinceIso!)
  if (filter.type) items = items.filter(e => e.type === filter.type)
  if (filter.agentId) items = items.filter(e => e.agentIds.includes(filter.agentId!))
  if (filter.placeId) items = items.filter(e => e.placeId === filter.placeId)
  if (filter.importantOnly) items = items.filter(e => e.importance === 'high' || e.importance === 'critical')
  const total = items.length
  if (filter.beforeId) {
    const index = items.findIndex(e => e.id === filter.beforeId)
    items = index < 0 ? [] : items.slice(index + 1)
  }
  return { items: items.slice(filter.offset, filter.offset + filter.limit), total }
}

export function getEvent(id: string): WorldEvent | undefined {
  return state.events.find(e => e.id === id) ?? readArchivedEvent(id)
}

export interface SceneFilter {
  beforeCreatedAt?: string
  importantOnly?: boolean
  limit: number
}

// Scenes are returned newest-first, matching how the reader paginates "이전 기록 불러오기"
// backwards from the present. buildScenes()/queued scenes are always kept sorted by creation.
export function listScenes(filter: SceneFilter): { items: ChronicleEntry[]; hasMore: boolean } {
  let items = [...state.scenes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (filter.beforeCreatedAt) items = items.filter(s => s.createdAt < filter.beforeCreatedAt!)
  if (filter.importantOnly) items = items.filter(s => s.importance !== 'ordinary')
  const page = items.slice(0, filter.limit)
  return { items: page, hasMore: items.length > filter.limit }
}

export function getScene(id: string): ChronicleEntry | undefined {
  return state.scenes.find(s => s.id === id)
}

export function listPlaces(): Place[] {
  return state.worldState.places
}

export function getPlace(id: string): Place | undefined {
  return state.worldState.places.find(p => p.id === id)
}

export function listAgents(): Agent[] {
  return state.worldState.agents
}

export function getAgent(id: string): Agent | undefined {
  return state.worldState.agents.find(a => a.id === id)
}

export function listFactions(): Faction[] {
  return state.worldState.factions
}

export function listChapters(): Chapter[] {
  return state.chapters
}

export function listSeasons(): Season[] {
  return [state.season, ...state.archivedSeasons]
}

export function getSeasonById(id: string): Season | undefined {
  return [state.season, ...state.archivedSeasons].find(s => s.id === id)
}

// Permanently wipes a past season's record: its archive-list entry and its raw event journal
// rows. The currently live season can never be deleted this way — end it first.
export function deleteArchivedSeason(db: DatabaseSync, seasonId: string): { ok: true } | { ok: false; error: string } {
  assertWorldIdle()
  if (state.season.id === seasonId) return { ok: false, error: 'cannot_delete_active_season' }
  const index = state.archivedSeasons.findIndex(s => s.id === seasonId)
  if (index === -1) return { ok: false, error: 'season_not_found' }
  const archived = state.archivedSeasons[index]
  db.exec('SAVEPOINT delete_archived_world')
  try {
    state.archivedSeasons.splice(index, 1)
    db.prepare('DELETE FROM world_event_journal WHERE season_id=?').run(seasonId)
    eraseWorldDesign(db, seasonId)
    persist()
    db.exec('RELEASE delete_archived_world')
  } catch (error) {
    state.archivedSeasons.splice(index, 0, archived)
    db.exec('ROLLBACK TO delete_archived_world; RELEASE delete_archived_world')
    throw error
  }
  return { ok: true }
}

interface AgentIntent {
  actorId: string
  snapshotMinute: number
  assessment?: ReturnType<typeof prepareDecision>
  request: WorldModelRequest
  proposed: ProposedAction
  freeIntent?: BrainIntent
  plannedSteps?: ProposedAction[]
  futureSteps?: unknown[]
  evaluatedHuman?: Pick<AgentV2State['human'], 'desperation' | 'power' | 'resourceControl' | 'moralProfile' |
    'physicalPower' | 'informationPower' | 'socialInfluence' | 'dependencyControl' | 'betrayalProcess'>
}

export function deleteCurrentWorld(db: DatabaseSync, seasonId: string): { ok: true } | { ok: false; error: string } {
  assertWorldIdle()
  if (!state.execution || state.season.id !== seasonId) return { ok: false, error: 'current_world_not_found' }
  db.exec('SAVEPOINT delete_current_world')
  try {
    db.prepare('DELETE FROM world_event_journal WHERE season_id=?').run(seasonId)
    db.prepare('DELETE FROM world_runtime_checkpoint WHERE id=1').run()
    eraseWorldDesign(db, seasonId)
    db.exec('RELEASE delete_current_world')
  } catch (error) { db.exec('ROLLBACK TO delete_current_world; RELEASE delete_current_world'); throw error }
  revision++
  stopSimulationTimerForTests()
  for (const res of subscribers) res.end()
  subscribers.clear()
  state.execution = undefined
  state.nextPaidDecisionAt = 0
  state.chapterBuffer = undefined
  state.season = buildInitialSeason()
  state.worldState = buildInitialWorldState()
  state.events = buildBaselineEvents()
  state.queued = []
  state.scenes = buildScenes()
  state.queuedScenes = []
  state.chapters = buildChapters()
  state.dayNarration = {}
  state.runtime.status = 'PAUSED'
  state.runtime.paused = true
  state.runtime.decisionsPaused = false
  state.runtime.nextTickAt = null
  state.runtime.lockHolder = null
  state.runtime.queuedEvents = 0
  return { ok: true }
}

function publicRuntime(): Pick<WorldRuntime, 'connected' | 'status' | 'paused' | 'lastTickAt' | 'nextTickAt'> {
  return { connected: true, status: state.runtime.status, paused: state.runtime.paused, lastTickAt: state.runtime.lastTickAt, nextTickAt: state.runtime.nextTickAt }
}

export function getPublicRuntime() {
  return publicRuntime()
}

export function getAdminRuntime(): WorldRuntime {
  return { ...state.runtime, schedulerRegistered: timer !== null && !shuttingDown,
    tickSkipReason: timer === null && state.runtime.status === 'RUNNING' ? 'scheduler_not_registered' : state.runtime.tickSkipReason,
    mode: state.execution?.mode ?? 'preview', queuedEvents: state.worldState.engine?.ongoingActions.length ?? state.queued.length, maxActiveCharacters: config.maxActiveCharacters, worldMinutesPerTick: state.execution?.draft.studio?.minutesPerTick ?? config.worldMinutesPerTick, engine: v4Active() ? 'v4' : 'v3' }
}

export function listActionAudit(): WorldEvent[] { return state.events.filter(e => e.provenance).slice(0, 50) }
export function assertWorldIdle(): void { if (activeTick) throw new HttpError(409, 'world_tick_in_progress') }

// --- Simulation tick ---------------------------------------------------------

let timer: ReturnType<typeof setInterval> | null = null
let reactionPending = false

export function advanceWorldTick(minutes = state.execution?.draft.studio?.minutesPerTick ?? config.worldMinutesPerTick): void {
  if (shuttingDown || state.runtime.status !== 'RUNNING' || !state.execution) return
  if (state.runtime.decisionsPaused) { pauseSeason(); return }
  if (reactionPending) return
  if(state.runtime.lockHolder==='combat-adjudication')return
  const previousDay = state.worldState.clock.day
  // v4 never runs the v3 combat adjudicator; a v3 attack left over from before a switch resolves by the engine's own rules.
  state.worldState.engine!.requireCombatAdjudication=state.execution.mode==='live'&&!v4Active()
  state.runtime.lastTickAt = new Date().toISOString()
  const deadline = state.execution.draft.maxDays === null ? Infinity : (state.execution.draft.startDay - 1 + state.execution.draft.maxDays) * 1440
  advanceEngine(state.worldState, Math.min(minutes, Math.max(0, deadline - state.worldState.engine!.minute)), state.events, recordEngineEvent)
  state.season.currentDay = state.worldState.clock.day
  state.season.survivorCount = state.worldState.agents.filter(a => a.publicState.status !== 'deceased').length
  const timeLimit = state.execution.draft.maxDays !== null && state.worldState.clock.day >= state.execution.draft.startDay + state.execution.draft.maxDays
  if (state.worldState.engine?.studio?.ended || timeLimit || state.season.survivorCount === 0) {
    const survivorRule = state.worldState.engine?.studio?.config.endings.find(e => e.type === 'survivors' && state.season.survivorCount <= e.value)
    finishWorld(timeLimit ? '설정된 세계 시간 제한이 끝났다. 시간 만료만으로 승자나 탈출이 확정되지는 않는다' : state.season.survivorCount === 0 ? '생존자가 더 이상 남아 있지 않다' : survivorRule ? `생존자가 ${state.season.survivorCount}명이 되어 설정된 생존자 종료 조건에 도달했다` : '설정된 세계 종료 조건이 충족되었다')
  }
  flushChapter(false)
  if(narratorEnabled && previousDay < state.worldState.clock.day){
    const job=refreshDayNarration(previousDay,true).catch(()=>{})
    pendingNarrations.add(job);void job.finally(()=>pendingNarrations.delete(job))
  }
  state.runtime.nextTickAt = state.runtime.status === 'RUNNING' ? new Date(Date.now() + state.runtime.tickIntervalMs).toISOString() : null
  persist()
  broadcast({ type: 'worldState', payload: toPublicWorld(state.worldState) })
  broadcast({ type: 'runtime', payload: publicRuntime() })
}

function recordEngineEvent(e: WorldEvent): void {
  pipeline().worldEvents++
  if (e.phase === 'COMPLETED') pipeline().completedActions++
  if (e.actionId && ['COMPLETED','FAILED','CANCELLED'].includes(e.phase ?? '')) {
    const actor=state.worldState.agents.find(a=>a.id===e.agentIds[0])
    const plan=actor?.v2?.freePlan
    if(plan?.activeActionId===e.actionId){
      if(e.phase==='COMPLETED')plan.steps.shift()
      plan.activeActionId=undefined
    }
  }
  const extra = recordExperience(state.worldState, e)
  pushEvent(e, true)
  queueChapter(e)
  for (const followup of extra) recordEngineEvent(followup)
}

function recordGroundingFailure(actor: Agent, request: WorldModelRequest, intent: BrainIntent, snapshotMinute: number, reason: string): void {
  pipeline().groundingFailures++
  const failed: WorldEvent = { id: randomUUID(), occurredAt: new Date().toISOString(), day: state.worldState.clock.day,
    worldTime: state.worldState.clock.time, worldMinute: state.worldState.engine!.minute, type: 'DECISION', placeId: actor.publicState.locationId,
    agentIds: [actor.id], title: `${actor.name} · grounding failure`, summary: 'Planner reference could not be grounded',
    outcome: 'REJECTED', phase: 'FAILED', attemptedAction: intent.method, engineVerdict: reason,
    stateChanges: [], importance: 'low', relatedEventIds: [] }
  failed.provenance = { provider: request.provider, model: request.model, promptVersionId: `agent@${AGENT_PROMPT_VERSION}`,
    inputDataVersion: state.season.id, snapshotMinute, calledAt: new Date().toISOString(),
    validation: { approved: false, reasons: [`grounding_failure:${reason}`] } }
  recordEngineEvent(failed)
  const v=ensureAgentV2(actor,state.worldState)
  v.lastActionResult={eventId:failed.id,actionType:'GROUNDING',result:`grounding_failure:${reason}`,minute:state.worldState.engine!.minute}
  v.recentFailures.push({key:'',actionType:'GROUNDING',intent:intent.method,locationId:actor.publicState.locationId,
    minute:state.worldState.engine!.minute,result:'failed',eventId:failed.id,reason,
    goal:intent.goal,method:intent.method,targetReference:intent.targetId ?? intent.objectIds[0] ?? intent.placeId ?? undefined,
    failureStage:'grounding'})
  v.recentFailures=v.recentFailures.slice(-12)
  if(v.decisionV3?.status==='active'){v.decisionV3.failureCount++;v.decisionV3.replanRequired=true;v.decisionV3.lastFailureReason=`grounding_failure:${reason}`}
  actor.nextDecisionAt = state.worldState.engine!.minute + nextDecisionDelay(actor,'WAIT')
}

async function performDecisions(intraTick = false): Promise<void> {
  if (shuttingDown || state.runtime.status !== 'RUNNING' || !state.execution || state.runtime.decisionsPaused) {
    state.runtime.tickSkipReason = state.runtime.decisionsPaused ? state.runtime.decisionStatus === 'CALL_BUDGET_EXHAUSTED' ? 'budget_exhausted' : 'decisions_paused' : 'not_running'
    // Temporary diagnostic: identify why decisions never run when the world looks RUNNING.
    console.error(`[world] performDecisions skipped shuttingDown=${shuttingDown} status=${state.runtime.status} hasExecution=${Boolean(state.execution)} decisionsPaused=${state.runtime.decisionsPaused}`)
    return
  }
  const execution = state.execution
  if (!intraTick && execution.mode === 'live' && (state.nextPaidDecisionAt ?? 0) > Date.now()) {
    state.runtime.tickSkipReason = 'decision_cooldown'
    console.error(`[world] performDecisions skipped cooldown nextPaidDecisionAt=${state.nextPaidDecisionAt} now=${Date.now()}`)
    return
  }
  const ticket = revision
  const current = () => ticket === revision && state.runtime.status === 'RUNNING' && !shuttingDown
  state.runtime.lockHolder = 'agent-decision'
  try {
    const snapshot = structuredClone(state.worldState)
    const snapshotEvents = [...state.events]
    const selected = selectDecisionAgents(snapshot, Math.min(state.runtime.maxActiveAgents, config.maxActiveCharacters))
    if (!selected.length) state.runtime.tickSkipReason = 'no_eligible_agents'
    const pending: AgentIntent[] = []
    const responded = new Set<string>()
    console.error(`[world] performDecisions selected ${selected.length} agent(s): ${selected.map(a => a.name).join(', ')}`)
    // Build every selected request before paying for any of them. An oversized
    // later character must not strand earlier paid intentions from Snapshot T.
    const prepared: Array<{actor: typeof selected[number];assessment?: ReturnType<typeof prepareDecision>;request:WorldModelRequest}>=[]
    for (const actor of selected) {
      if (!current()) break
      if (!['alive', 'injured'].includes(actor.publicState.status) || snapshot.engine!.ongoingActions.some(a => a.proposal.actorId === actor.id)) continue
      const assessment = execution.mode === 'demo' || modelAdapter !== worldModelAdapter ? prepareDecision(snapshot, actor.id, snapshotEvents) : undefined
      const request = execution.mode === 'demo' ? agentRequest(execution, actor.id, snapshot, snapshotEvents, assessment!) : brainRequest(execution, actor.id, snapshot, snapshotEvents)
      prepared.push({actor,assessment,request})
    }
    for (const {actor,assessment,request} of prepared) {
      if (!current()) break
      // Keep one JUDGE reservation for every already collected intent before paying
      // for another AGENT response. Otherwise the last agent call can be stranded.
      if (execution.mode === 'live' && state.runtime.callBudget - state.runtime.callsUsed < pending.length + 3) {
        state.runtime.decisionsPaused = true
        state.runtime.decisionStatus = 'CALL_BUDGET_EXHAUSTED'
        break
      }
      if (execution.mode === 'live') { state.nextPaidDecisionAt = Date.now() + config.worldDecisionCooldownMs; persist() }
      const raw = execution.mode === 'demo' ? { ...assessment!.choices[0]?.action, targetIds: assessment!.choices[0]?.action.targetIds ?? [], usedItemIds: assessment!.choices[0]?.action.usedItemIds ?? [], candidateId: assessment!.choices[0]?.id, publicAction: assessment!.choices[0]?.action.intendedAction } : await callModel(request, actor.id)
      if (!current()) break
      // Old injected test adapters may still return a direct action. The real provider
      // must use the Brain schema and cannot re-enter candidate selection.
      const legacy = (execution.mode === 'demo' || modelAdapter !== worldModelAdapter) && Boolean(raw && typeof raw === 'object' && 'actionType' in raw)
      const freeIntent = legacy ? undefined : parseBrainIntent(raw)
      let plannedSteps: ProposedAction[] | undefined
      let futureSteps: unknown[] | undefined
      if (freeIntent) {
        const plannerRaw = await callModel(plannerRequest(execution, actor.id, snapshot, snapshotEvents, freeIntent), actor.id)
        futureSteps=Array.isArray((plannerRaw as {steps?:unknown})?.steps)?(plannerRaw as {steps:unknown[]}).steps.slice(1):undefined
        try { plannedSteps = groundPlannerSteps(plannerRaw, actor.id, snapshot); pipeline().groundingSuccesses++ }
        catch (error) {
          if (!(error instanceof GroundingFailure)) throw error
          recordGroundingFailure(state.worldState.agents.find(a=>a.id===actor.id)!,request,freeIntent,snapshot.engine!.minute,error.reason)
          continue
        }
      }
      if (!current()) break
      const proposed = plannedSteps?.[0] ?? parseProposedAction(raw, actor.id)
      if (freeIntent && plannedSteps) { const prior=snapshot.agents.find(a=>a.id===actor.id)?.v2?.freePlan?.brain
        const transition=prior?prior.goal!==freeIntent.goal?'ABANDON':prior.method!==freeIntent.method?'MODIFY':'CONTINUE':'MODIFY'
        proposed.goalKey=freeIntent.goal; proposed.decisionV3={transition,goal:freeIntent.goal,purpose:freeIntent.purpose,method:freeIntent.method,nextSteps:plannedSteps.slice(1).map(s=>s.actionType),nextStepTargets:plannedSteps.slice(1).map(s=>s.targetIds[0]??null),expectedReward:5,expectedRisk:5} }
      pending.push({ actorId: actor.id, snapshotMinute: snapshot.engine!.minute, assessment, request, proposed, freeIntent, plannedSteps, futureSteps,
        evaluatedHuman: snapshot.agents.find(a => a.id === actor.id)?.v2?.human })
    }
    // All eligible agents above observed Snapshot T. Only the resolver below may
    // inspect and mutate current WORLD TRUTH. A later actor never re-deliberates on
    // another actor's just-started action during this phase.
    const ordered = orderConflictingIntents(pending.map(intent => {
      const chosen = intent.assessment?.choices.find(c => c.id === intent.proposed.candidateId)
      return { actorId: intent.actorId, snapshotMinute: intent.snapshotMinute,
        action: intent.freeIntent ? intent.proposed : chosen?.action, score: chosen?.score ?? 0, value: intent }
    }))
    for (const intent of ordered) {
      if (!current()) break
      const actor = state.worldState.agents.find(a => a.id === intent.actorId)!
      if (intent.evaluatedHuman) {
        const human = ensureAgentV2(actor, state.worldState).human
        human.desperation = intent.evaluatedHuman.desperation
        human.power = intent.evaluatedHuman.power
        human.resourceControl = intent.evaluatedHuman.resourceControl
        human.moralProfile = { ...intent.evaluatedHuman.moralProfile }
        human.physicalPower = intent.evaluatedHuman.physicalPower
        human.informationPower = intent.evaluatedHuman.informationPower
        human.socialInfluence = intent.evaluatedHuman.socialInfluence
        human.dependencyControl = intent.evaluatedHuman.dependencyControl
        human.betrayalProcess = { ...intent.evaluatedHuman.betrayalProcess }
      }
      const { assessment, request, proposed } = intent
      const unknownCandidate = !intent.freeIntent && Boolean(proposed.candidateId && !assessment?.choices.some(c=>c.id===proposed.candidateId))
      let action = proposed
      let bound = Boolean(intent.freeIntent)
      if (!bound && !unknownCandidate) {
        try { action = bindCandidate(proposed, assessment!.choices); bound = true } catch { /* preserve rejected proposal for audit */ }
      }
      let validation = validateEngineAction(action, state.worldState, state.events)
      if (!bound) { validation.approved = false; validation.reasons.push('RULE_VIOLATION'); validation.notes.push('candidate_not_available') }
      if (validation.approved) pipeline().validationAccepted++
      else pipeline().validationRejected++
      if (validation.approved && execution.mode === 'live') {
        const judgment = parseJudgment(await callModel(judgeRequest(execution, action, state.worldState, state.events), actor.id))
        if (!current()) break
        // Time and other actions can progress while a provider is responding. Validate again.
        validation = validateEngineAction(action, state.worldState, state.events)
        if (!judgment.approved) { validation.approved = false; validation.reasons.push('RULE_VIOLATION'); validation.notes.push(judgment.reason) }
      }
      if (!current()) break
      let e: WorldEvent
      if (validation.approved) { e = beginAction(state.worldState, action); pipeline().acceptedActions++ }
      else {
        actor.nextDecisionAt = state.worldState.engine!.minute + nextDecisionDelay(actor, 'WAIT')
        e = { id: randomUUID(), occurredAt: new Date().toISOString(), day: state.worldState.clock.day,
          worldTime: state.worldState.clock.time, worldMinute: state.worldState.engine!.minute,
          type: 'DECISION', placeId: action.locationId, agentIds: [actor.id], title: `${actor.name} · ${action.actionType}`,
          summary: 'Action rejected by WORLD ENGINE', outcome: 'REJECTED', phase: 'FAILED', actionType: action.actionType,
          attemptedAction: action.intendedAction, engineVerdict: validation.notes.join(', '), stateChanges: [], importance: 'low', relatedEventIds: [] }
      }
      e.provenance = { provider: execution.mode === 'demo' ? 'demo' : request.provider, model: request.model,
        promptVersionId: `agent@${AGENT_PROMPT_VERSION}`, inputDataVersion: state.season.id, snapshotMinute: intent.snapshotMinute, calledAt: new Date().toISOString(),
        validation: { approved: validation.approved, reasons: validation.notes } }
      const selectedEvidence = intent.freeIntent ? [] : assessment?.choices.find(c => c.id === action.candidateId)?.evidenceEventIds ?? []
      if (validation.approved && selectedEvidence.length) {
        e.relatedEventIds = [...new Set([...e.relatedEventIds, ...selectedEvidence])]
        const goal = actor.motivations?.goals.find(g => g.id === actor.motivations?.currentId)
        if (goal) goal.evidenceEventIds = [...new Set([...goal.evidenceEventIds, ...selectedEvidence])].slice(-12)
      }
      recordEngineEvent(e)
      if (!validation.approved && intent.freeIntent) {
        const v=ensureAgentV2(actor,state.worldState)
        const reason=validation.notes.join(', ') || validation.reasons.join(', ')
        v.recentFailures.push({key:'',actionType:action.actionType,intent:intent.freeIntent.method,
          locationId:actor.publicState.locationId,minute:state.worldState.engine!.minute,result:'failed',
          eventId:e.id,reason,goal:intent.freeIntent.goal,method:intent.freeIntent.method,
          targetReference:intent.freeIntent.targetId ?? intent.freeIntent.objectIds[0] ?? intent.freeIntent.placeId ?? undefined,
          failureStage:'validation'})
        v.recentFailures=v.recentFailures.slice(-12)
        if(v.decisionV3?.status==='active'){v.decisionV3.failureCount++;v.decisionV3.replanRequired=true;v.decisionV3.lastFailureReason=reason}
      }
      if (intent.freeIntent && validation.approved) ensureAgentV2(actor, state.worldState).freePlan = {brain:intent.freeIntent,steps:intent.plannedSteps??[],createdMinute:intent.snapshotMinute,activeActionId:e.actionId,futureSteps:intent.futureSteps}
      const decision = state.worldState.engine!.decisions?.[actor.id]
      if (decision && validation.approved) {
        decision.basisEventIds = [...new Set([...decision.basisEventIds, ...selectedEvidence])].slice(-6)
        decision.candidateId = action.candidateId
        const selected = assessment?.choices.find(c => c.id === action.candidateId)
        decision.reasonCodes = selected?.reasonCodes
        ensureAgentV2(actor, state.worldState).goalPriority = selected?.score ?? 0
        decision.evaluation = assessment?.choices.map(c => ({ id:c.id, goal:c.goal, actionType:c.action.actionType, score:c.score, benefit:c.benefit, cost:c.cost, risk:c.risk, fit:c.fit, relationship:c.relationship, reasonCodes:c.reasonCodes }))
      }
      // One bounded reaction slot: the target chooses, the attacker cannot dictate defense.
      if (validation.approved && ['ATTACK','ROB'].includes(action.actionType)) {
        reactionPending = true
        const target = state.worldState.agents.find(a => a.id === action.targetIds[0])
        if (target) {
          const alreadyAttacking = pending.some(p => p.actorId === target.id && (p.freeIntent ? ['ATTACK','ROB'].includes(p.proposed.actionType) : p.assessment?.choices.some(c =>
            c.id === p.proposed.candidateId && ['ATTACK', 'ROB'].includes(c.action.actionType))))
          // An intent chosen from Snapshot T is simultaneous, never a reaction to
          // an attack the target had not yet observed when it chose that intent.
          if (alreadyAttacking) continue
          for (const interrupted of prepareThreatResponse(state.worldState, target.id, e.id)) recordEngineEvent(interrupted)
          if (!alreadyAttacking && !responded.has(target.id) && !state.worldState.engine!.ongoingActions.some(t => t.proposal.actorId === target.id) && responded.size < 1 && current()) {
            responded.add(target.id)
            if (execution.mode === 'demo' || state.runtime.callBudget - state.runtime.callsUsed >= 3) {
              const reactionSnapshot = structuredClone(state.worldState)
              const reactionAssessment = execution.mode==='demo'||modelAdapter!==worldModelAdapter?prepareDecision(reactionSnapshot,target.id,state.events):undefined
              const reactionRequest = execution.mode==='demo' ? agentRequest(execution, target.id, reactionSnapshot, state.events, reactionAssessment!) : brainRequest(execution, target.id, reactionSnapshot, state.events)
              const reactionRaw = execution.mode === 'demo' ? { ...reactionAssessment!.choices[0]?.action, targetIds: reactionAssessment!.choices[0]?.action.targetIds ?? [], usedItemIds: reactionAssessment!.choices[0]?.action.usedItemIds ?? [], candidateId: reactionAssessment!.choices[0]?.id, publicAction: reactionAssessment!.choices[0]?.action.intendedAction } : await callModel(reactionRequest, target.id)
              const reactionLegacy=(execution.mode==='demo'||modelAdapter!==worldModelAdapter)&&Boolean(reactionRaw&&typeof reactionRaw==='object'&&'actionType' in reactionRaw)
              const reactionIntent=reactionLegacy?undefined:parseBrainIntent(reactionRaw)
              let reactionSteps: ProposedAction[] | undefined
              let reactionGrounded=true
              if(reactionIntent){
                try { reactionSteps=groundPlannerSteps(await callModel(plannerRequest(execution,target.id,reactionSnapshot,state.events,reactionIntent),target.id),target.id,reactionSnapshot);pipeline().groundingSuccesses++ }
                catch(error){if(!(error instanceof GroundingFailure))throw error;reactionGrounded=false;recordGroundingFailure(target,reactionRequest,reactionIntent,reactionSnapshot.engine!.minute,error.reason)}
              }
              if(reactionGrounded){
                const reactionProposed=reactionSteps?.[0]??parseProposedAction(reactionRaw,target.id)
                if(reactionIntent&&reactionSteps){const prior=target.v2?.freePlan?.brain;const transition=prior?prior.goal!==reactionIntent.goal?'ABANDON':prior.method!==reactionIntent.method?'MODIFY':'CONTINUE':'MODIFY';reactionProposed.goalKey=reactionIntent.goal;reactionProposed.decisionV3={transition,goal:reactionIntent.goal,purpose:reactionIntent.purpose,method:reactionIntent.method,nextSteps:reactionSteps.slice(1).map(s=>s.actionType),nextStepTargets:reactionSteps.slice(1).map(s=>s.targetIds[0]??null),expectedReward:5,expectedRisk:5}}
                if (current()) ordered.push({ actorId: target.id, snapshotMinute: reactionSnapshot.engine!.minute, assessment: reactionAssessment, request: reactionRequest, proposed: reactionProposed,freeIntent:reactionIntent,plannedSteps:reactionSteps,
                  evaluatedHuman: reactionSnapshot.agents.find(a => a.id === target.id)?.v2?.human })
              }
            }
          }
        }
      }
    }
  } catch (error) {
    if (ticket === revision) {
      const code = error instanceof ProviderCallError ? error.code : 'WORLD_DECISION_FAILED'
      console.error('[world] agent-decision failed', code, error instanceof Error ? error.message : error)
      recordRuntimeError('agent-decision', code)
      state.runtime.decisionsPaused = true
      state.runtime.decisionStatus = code
    }
  } finally {
    reactionPending = false
    state.runtime.lockHolder = null
    if (state.runtime.decisionsPaused && state.runtime.status === 'RUNNING') pauseSeason()
    persist()
    broadcast({ type: 'runtime', payload: publicRuntime() })
  }
}

async function callModel(request: WorldModelRequest, actorId: string): Promise<unknown> {
  if (modelAdapter === worldModelAdapter) ensureModelConfigured(request)
  if (!runtimeDb) throw new ProviderCallError('WORLD_STORAGE_REQUIRED', 'initialize durable runtime first')
  if (config.production && !config.providerLimitsConfirmed) throw new ProviderCallError('PROVIDER_LIMITS_UNCONFIRMED', 'provider limits must be configured')
  const pricing = getPricing(runtimeDb, request.provider as Provider, request.model)
  if (!pricing) throw new ProviderCallError('MODEL_PRICING_MISSING', 'model pricing required')
  const inputBound = Buffer.byteLength(worldRequestBody(request)) + 1024
  const reservedUsd = estimateCostUsd(pricing, inputBound, request.maxOutputTokens??1500)
  const rate = getUsdToKrwRate(runtimeDb)
  const reservedKrw = reservedUsd * rate
  const budget = checkBudget(runtimeDb, reservedKrw)
  if (!budget.allowed) throw new ProviderCallError('BUDGET_LIMIT', 'shared weekly or monthly budget exhausted')
  if (state.runtime.callsUsed >= state.runtime.callBudget) throw new Error('call_budget_exhausted')
  reserveBudget(runtimeDb, budget.weekKey, reservedKrw, reservedUsd, budget.monthKey)
  state.runtime.callsUsed++
  if (request.role === 'agent') pipeline().brainCalls++
  if (request.role === 'planner') pipeline().plannerCalls++
  if (request.role === 'judge') pipeline().resultJudgmentCalls++
  state.runtime.agentLastCallAt[actorId] = new Date().toISOString()
  let usage = state.runtime.providerUsage.find(u => u.provider === request.provider)
  if (!usage) { usage = { provider: request.provider, calls: 0, estTokens: 0, estCostUsd: 0 }; state.runtime.providerUsage.push(usage) }
  usage.calls++
  // Reserve durably before the network call; even a crash or failed request consumes budget.
  persist()
  let actualUsd = reservedUsd
  try {
    const result = await traceModel(request,()=>modelAdapter(request),Buffer.byteLength(worldRequestBody(request)))
    if (Number.isFinite(result.inputTokens) && result.inputTokens > 0 && Number.isFinite(result.outputTokens) && result.outputTokens >= 0) {
      actualUsd = estimateCostUsd(pricing, result.inputTokens, result.outputTokens)
      usage.estTokens += result.inputTokens + result.outputTokens
    }
    return result.raw
  } catch (error) {
    pipeline().providerFailures++
    throw error
  } finally {
    // Failed/unknown-usage calls retain their conservative estimate; no free retries.
    usage.estCostUsd += actualUsd
    settleReservation(runtimeDb, budget.weekKey, reservedKrw, reservedUsd, actualUsd * rate, actualUsd, request.provider as Provider, budget.monthKey)
  }
}

function queueChapter(e: WorldEvent): void {
  if (v4Active()) return // v4 scenes carry their own prose; the v3 chapter narrator never runs.
  if (!storyEvent(e)) return
  if (e.outcome === 'REJECTED' || e.visibility === 'private' || !state.execution) return
  if (state.chapterBuffer && state.chapterBuffer.day !== e.day) flushChapter(true)
  if (!state.chapterBuffer) {
    const chapter: Chapter = { id: randomUUID(), day: e.day, number: state.chapters.length + 1,
      title: `Chapter ${state.chapters.length + 1}`, summary: '', agentIds: [], changes: [], eventIds: [],
      status: 'IN_PROGRESS', startedMinute: e.worldMinute ?? state.worldState.engine!.minute }
    state.chapters.push(chapter)
    state.chapterBuffer = { chapterId: chapter.id, eventIds: [], day: e.day, startedMinute: chapter.startedMinute! }
  }
  const chapter = state.chapters.find(c => c.id === state.chapterBuffer!.chapterId)!
  chapter.agentIds = [...new Set([...chapter.agentIds, ...e.agentIds])]
  // A chapter may advertise work in progress, but its narrative only consumes terminal results.
  if (e.phase === 'STARTED') return
  if (!state.chapterBuffer.eventIds.length) { chapter.day = e.day; state.chapterBuffer.day = e.day }
  if (state.chapterBuffer.eventIds.includes(e.id) || state.scenes.some(s => s.sourceEventIds.includes(e.id))) return
  state.chapterBuffer.eventIds.push(e.id)
  chapter.eventIds.push(e.id)
  flushChapter(false)
}

function flushChapter(force: boolean): void {
  const buffer = state.chapterBuffer
  if (!buffer || !state.worldState.engine) return
  const age = state.worldState.engine.minute - buffer.startedMinute
  if (!force && age < config.worldChapterMinutes) return
  const narrated = new Set(state.scenes.flatMap(s => s.sourceEventIds))
  const events = [...new Set(buffer.eventIds)].filter(id => !narrated.has(id)).map(id => getEvent(id)).filter((e): e is WorldEvent => Boolean(e && storyEvent(e)))
  if (!events.length) return
  const chapter = state.chapters.find(c => c.id === buffer.chapterId)!
  const scene = mockNarrator.narrateFallbackScene(events, placesById(), agentsById(), state.worldState.engine?.context)
  scene.seasonId = state.season.id
  scene.worldDay = buffer.day
  chapter.status = 'COMPLETED'
  chapter.endedMinute = events.at(-1)!.worldMinute
  chapter.sceneId = scene.id
  chapter.summary = scene.body
  chapter.changes = events.flatMap(e => e.stateChanges.filter(c => !c.field.startsWith('knowledge:')).map(c => `${c.field}: ${c.from} → ${c.to}`))
  state.scenes.push(scene)
  state.chapterBuffer = undefined
  persist()
  broadcast({ type: 'scene', payload: scene })
  if (narratorEnabled) {
    const narration = enhanceSceneNarration(scene.id, events).then(()=>refreshDayNarration(buffer.day)).catch(() => {})
    pendingNarrations.add(narration)
    void narration.finally(() => pendingNarrations.delete(narration))
  }
}

// Replaces a chapter's deterministic scene text with real model prose once it's ready. Never
// blocks or affects the tick loop, and deliberately bypasses callModel()/callsUsed — this is a
// supplementary enrichment call (like studioRecommendations.ts's recommendStudio), not a world
// decision, so it must never change the "N ticks = N decision calls" cost invariants those track.
// It still spends from the same shared weekly/monthly KRW budget. The deterministic scene from
// mockNarrator (already saved and broadcast above) stands as-is on any failure, demo mode, missing
// budget, or invalid response.
async function callNarration(request: WorldModelRequest): Promise<unknown | null> {
  if (!state.execution || state.execution.mode !== 'live' || !runtimeDb || config.production && !config.providerLimitsConfirmed) return null
  try { ensureModelConfigured(request) } catch { return null }
  const db = runtimeDb
  ensurePricingSeeded(db)
  const pricing = getPricing(db, request.provider as Provider, request.model)
  if (!pricing) return null
  let inputBound: number
  try { inputBound = Buffer.byteLength(worldRequestBody(request)) + 1024 } catch { return null }
  const reservedUsd = estimateCostUsd(pricing, inputBound, request.maxOutputTokens ?? 1500)
  const rate = getUsdToKrwRate(db), reservedKrw = reservedUsd * rate
  const budget = checkBudget(db, reservedKrw)
  if (!budget.allowed) return null
  reserveBudget(db, budget.weekKey, reservedKrw, reservedUsd, budget.monthKey)
  let actualUsd = reservedUsd
  try {
    const result = await traceModel(request,()=>modelAdapter(request),Buffer.byteLength(worldRequestBody(request)))
    if (Number.isFinite(result.inputTokens) && result.inputTokens > 0 && Number.isFinite(result.outputTokens) && result.outputTokens >= 0) actualUsd = estimateCostUsd(pricing, result.inputTokens, result.outputTokens)
    return result.raw
  } catch (error) { console.warn('[narrator] provider failure', error instanceof ProviderCallError ? error.code : 'call_failed'); return null } finally {
    settleReservation(db, budget.weekKey, reservedKrw, reservedUsd, actualUsd * rate, actualUsd, request.provider as Provider, budget.monthKey)
  }
}

async function writeVerifiedNarration(events: WorldEvent[], kind: 'LIVE'|'DAY', previous = '', revisionNotes = '', attempt = 0): Promise<string|null> {
  const seasonId = state.season.id
  events=causalStoryOrder(events).map(sceneEvidence).map(e=>e.actionResult?{...e,actionResult:eventProse(e,agentsById())}:e)
  const request: WorldModelRequest = { role:'narrator', provider:'openai', model:config.openaiModel, schema:storySchemaFor(events,kind),
    maxOutputTokens:kind === 'DAY' ? 12000 : 2400, prompt:buildNarratorPrompt(events, placesById(), agentsById(), previous, kind,state.worldState.engine?.objects??[])+(revisionNotes?`\n[FACTUAL CORRECTIONS REQUIRED]\nA previous draft was rejected for these claims. Rewrite from evidence, removing or correcting them. Retain a full literary chapter where supported.\n${revisionNotes}`:'') }
  try { worldRequestBody(request) } catch {
    const split=splitNarrativeScenes(events)
    if(!split)return null
    const first=await writeVerifiedNarration(split[0],kind,previous,revisionNotes,attempt)
    if(!first||state.season.id!==seasonId)return null
    const second=await writeVerifiedNarration(split[1],kind,first.slice(-1200),revisionNotes,attempt)
    return second&&state.season.id===seasonId?`${first}\n\n＊ ＊ ＊\n\n${second}`:null
  }
  const raw = await callNarration(request)
  if (state.season.id !== seasonId || !raw) return null
  // Legacy mock adapters still provide an evidence-only paragraph plan.
  const plan = validateEditorialPlan(raw, events)
  if (plan) return plan.map(ids => mockNarrator.narrateFallbackScene(events.filter(e=>ids.includes(e.id)),placesById(),agentsById()).body).join('\n\n')
  const paragraphs = validateStory(raw, events,kind,agentsById())
  if (!paragraphs) {
    const issue=storyValidationIssue(raw,events,kind,agentsById())!
    traceOutcome(request,null,true)
    console.warn('[narrator] evidence/quote structure rejected',kind,events.length,issue)
    return attempt<1?writeVerifiedNarration(events,kind,previous,issue,attempt+1):null
  }
  const reviewRequest = (parts: typeof paragraphs, sources: WorldEvent[]): WorldModelRequest => ({ role:'narrator', provider:'openai', model:config.openaiModel, schema:REVIEW_SCHEMA, maxOutputTokens:1000, prompt:reviewPrompt(parts,sources,agentsById()) })
  let fits=true
  try { worldRequestBody(reviewRequest(paragraphs,events)) } catch { fits=false }
  if(fits){
    const review=await callNarration(reviewRequest(paragraphs,events))
    if((review as {approved?:boolean}|null)?.approved!==true)console.warn('[narrator] factual review rejected',JSON.stringify(review).slice(0,1200))
    const objections=(review as {unsupportedClaims?:unknown}|null)?.unsupportedClaims
    if(attempt<1&&Array.isArray(objections)&&objections.length&&state.season.id===seasonId)return writeVerifiedNarration(events,kind,previous,objections.filter(x=>typeof x==='string').join('\n').slice(0,1000),attempt+1)
    const body=state.season.id===seasonId?verifiedStory(raw,review,events,kind,agentsById()):null;traceOutcome(request,body,!body);return body
  }
  // Review long DAY chapters paragraph by paragraph without raising the transport limit.
  for(const paragraph of paragraphs){
    const sources=events.filter(e=>paragraph.eventIds.includes(e.id))
    const review=await callNarration(reviewRequest([paragraph],sources))
    if(state.season.id!==seasonId)return null
    if(!verifiedStory({paragraphs:[paragraph]},review,sources,'LIVE',agentsById())){
      const objections=(review as {unsupportedClaims?:unknown}|null)?.unsupportedClaims
      return attempt<1&&Array.isArray(objections)&&objections.length?writeVerifiedNarration(events,kind,previous,objections.join('\n').slice(0,1000),attempt+1):null
    }
  }
  const body=paragraphs.map(p=>p.text.trim()).join('\n\n');traceOutcome(request,body,false);return body
}

async function enhanceSceneNarration(sceneId: string, events: WorldEvent[]): Promise<void> {
  if (events.every(e=>e.phase==='STATE_UPDATE')) return
  const seasonId=state.season.id
  const sceneIndex=state.scenes.findIndex(s=>s.id===sceneId)
  const previous=state.scenes.slice(0,sceneIndex).slice(-1).map(s=>s.body).join('\n').slice(-1200)
  const body=await writeVerifiedNarration(events,'LIVE',previous)
  const scene=state.scenes.find(s=>s.id===sceneId)
  if(!body||!scene||state.season.id!==seasonId)return
  if(scene.body!==body){scene.corrections??=[];scene.corrections.push({at:new Date().toISOString(),reason:'Evidence-reviewed literary narration',previousTitle:scene.title,previousBody:scene.body})}
  scene.body=body
  const chapter=state.chapters.find(c=>c.sceneId===sceneId);if(chapter)chapter.summary=body
  persist();broadcast({type:'sceneUpdated',payload:scene})
}

const dayJobs=new Set<string>()
const dayAttempts=new Map<string,number>()
export async function refreshDayNarration(day: number, force=false): Promise<void> {
  if(!narratorEnabled||v4Active())return
  const seasonId=state.season.id,key=`${seasonId}:${day}`
  if(dayJobs.has(key))return
  const all=historyEvents().filter(e=>e.day===day&&storyEvent(e)).sort((a,b)=>(a.worldMinute??0)-(b.worldMinute??0))
  const cached=state.dayNarration?.[day], completed=day<state.worldState.clock.day||state.runtime.status==='ENDED'
  if(all.length<3||!force&&cached&&all.length-cached.eventCount<6&&cached.entry.completed===completed)return
  if(!force&&!completed&&state.worldState.engine!.minute-(dayAttempts.get(key)??-Infinity)<360)return
  dayAttempts.set(key,state.worldState.engine!.minute)
  // Focus a bounded chapter on consequential choices across the whole day, including its end.
  const weight=(e:WorldEvent)=>e.cause==='world_ended'?100:e.importance==='critical'?50:e.type==='CONFLICT'||e.type==='DIALOGUE'?10:1
  const ids=new Set([...all].sort((a,b)=>weight(b)-weight(a)||(b.worldMinute??0)-(a.worldMinute??0)).slice(0,24).map(e=>e.id))
  const events=all.filter(e=>ids.has(e.id))
  dayJobs.add(key)
  try{
    const body=await writeVerifiedNarration(events,'DAY')
    if(!body||state.season.id!==seasonId)return
    const entry=composeDay(day,seasonId,events,placesById(),agentsById(),completed)!
    entry.body=body;entry.sourceEventIds=events.map(e=>e.id)
    if(cached)entry.corrections=[...(cached.entry.corrections??[]),{at:new Date().toISOString(),reason:'Expanded chapter with newly confirmed evidence',previousTitle:cached.entry.title,previousBody:cached.entry.body}]
    state.dayNarration??={};state.dayNarration[day]={entry,throughMinute:all.at(-1)!.worldMinute??0,eventCount:all.length}
    persist()
  }finally{dayJobs.delete(key)}
}

export function correctDayNarration(day:number, seasonId:string, raw:unknown, reason:string):void {
  if(state.runtime.status!=='PAUSED')throw new HttpError(409,'pause_world_before_narrative_correction')
  if(seasonId!==state.season.id)throw new HttpError(409,'season_changed')
  if(!Number.isInteger(day)||day<1||!reason.trim())throw new HttpError(400,'invalid_narrative_correction')
  const events=historyEvents().filter(e=>e.day===day&&storyEvent(e))
  const paragraphs=validateStory(raw,events)
  if(!paragraphs)throw new HttpError(400,'narrative_evidence_invalid')
  const prior=listDayStories().find(e=>e.worldDay===day)
  const entry=composeDay(day,seasonId,events,placesById(),agentsById(),prior?.completed??false)
  if(!entry)throw new HttpError(404,'day_not_found')
  entry.body=paragraphs.map(p=>p.text).join('\n\n');entry.sourceEventIds=events.map(e=>e.id)
  entry.corrections=[...(prior?.corrections??[]),...(prior?[{at:new Date().toISOString(),reason:`Editorial correction: ${reason.slice(0,500)}`,previousTitle:prior.title,previousBody:prior.body}]:[])]
  state.dayNarration??={};state.dayNarration[day]={entry,eventCount:events.length,throughMinute:Math.max(...events.map(e=>e.worldMinute??0))}
  // Reuse edited paragraphs in LIVE only when their evidence exactly matches that scene.
  // Never pull a later event into an earlier scene merely because the actors overlap.
  for(const scene of state.scenes.filter(s=>s.worldDay===day)){
    const sceneIds=new Set(scene.sourceEventIds)
    const parts=paragraphs.filter(p=>p.eventIds.every(id=>sceneIds.has(id)))
    const covered=new Set(parts.flatMap(p=>p.eventIds))
    if(!parts.length||covered.size!==sceneIds.size)continue
    const body=parts.map(p=>p.text).join('\n\n')
    if(body===scene.body)continue
    scene.corrections??=[];scene.corrections.push({at:new Date().toISOString(),reason:`Editorial correction: ${reason.slice(0,500)}`,previousTitle:scene.title,previousBody:scene.body})
    scene.body=body
    const chapter=state.chapters.find(c=>c.sceneId===scene.id);if(chapter)chapter.summary=body
    broadcast({type:'sceneUpdated',payload:scene})
  }
  persist()
}

export async function rebuildCurrentNarration(): Promise<void> {
  // Explicit administrative repair, not a paid side effect of viewing a page.
  const seasonId=state.season.id
  for(const [day,cached] of Object.entries(state.dayNarration??{})){
    const fallback=composeDay(Number(day),seasonId,historyEvents(),placesById(),agentsById(),cached.entry.completed??false)
    if(!fallback)continue
    fallback.corrections=[...(cached.entry.corrections??[]),{at:new Date().toISOString(),reason:'Narrative repair: retain prior draft while rechecking factual accuracy',previousTitle:cached.entry.title,previousBody:cached.entry.body}]
    cached.entry=fallback
  }
  for(const scene of state.scenes){
    const sources=scene.sourceEventIds.map(getEvent).filter((e):e is WorldEvent=>Boolean(e&&storyEvent(e)))
    if(!sources.length)continue
    if(scene.corrections?.some(c=>c.reason==='Evidence-reviewed literary narration')&&validateStory({paragraphs:[{text:scene.body,eventIds:sources.map(e=>e.id)}]},sources))continue
    const corrected=mockNarrator.narrateFallbackScene(sources,placesById(),agentsById())
    if(scene.body===corrected.body)continue
    scene.corrections??=[];scene.corrections.push({at:new Date().toISOString(),reason:'Remove repeated attack motives and copied interruption text; original events retained',previousTitle:scene.title,previousBody:scene.body})
    scene.title=corrected.title;scene.body=corrected.body
    broadcast({type:'sceneUpdated',payload:scene})
  }
  persist()
  for(const scene of state.scenes.slice(-3)){
    if(state.season.id!==seasonId)return
    const events=scene.sourceEventIds.map(getEvent).filter((e):e is WorldEvent=>Boolean(e&&storyEvent(e)))
    if(events.length)await enhanceSceneNarration(scene.id,events)
  }
  for(const day of [...new Set(historyEvents().map(e=>e.day))].slice(-2))await refreshDayNarration(day,true)
}

// --- v4 scene engine ---------------------------------------------------------

// v4 needs real models; a demo-mode world always stays on the deterministic v3 engine.
// Seasons that never chose an engine (including checkpoints from before v4) follow the server default.
function v4Active(): boolean { return (state.execution?.engine ?? config.worldEngine) === 'v4' && state.execution?.mode === 'live' }

function publishScene(scene: ChronicleEntry): void {
  state.scenes.push(scene)
  broadcast({ type: 'scene', payload: scene })
}

// Retrying these only burns reservations: a bad key, missing price or empty budget won't fix itself.
const FATAL_SCENE_ERRORS = new Set(['BUDGET_LIMIT', 'PROVIDER_KEY_MISSING', 'MODEL_PRICING_MISSING', 'PROVIDER_LIMITS_UNCONFIRMED', 'WORLD_STORAGE_REQUIRED', 'WORLD_PROVIDER_HTTP_401', 'WORLD_PROVIDER_HTTP_403'])

async function performScene(): Promise<void> {
  if (shuttingDown || state.runtime.status !== 'RUNNING' || !state.execution || state.runtime.decisionsPaused) return
  const execution = state.execution
  const v4 = ensureV4State(state.worldState, execution)
  // Continuous space first: travelers walk their paths to the current minute; meeting someone on
  // the way stops both and queues an encounter scene.
  advanceSpace(state.worldState, execution, v4)
  // Director pressure is deterministic and free; it runs every tick, independent of model cooldown.
  for (const e of runDirector(state.worldState, execution)) {
    pushEvent(e, true)
    if (e.cause !== 'director:zone_damage') publishScene({ id: `scene-director-${e.id}`, kind: 'LIVE', seasonId: state.season.id, worldDay: e.day,
      timeStart: e.worldTime ?? state.worldState.clock.time, timeEnd: e.worldTime ?? state.worldState.clock.time, title: e.title, body: e.summary,
      locationIds: [e.placeId], agentIds: [], sourceEventIds: [e.id], stateChanges: e.stateChanges, importance: 'notable', createdAt: new Date().toISOString() })
  }
  if ((state.nextPaidDecisionAt ?? 0) > Date.now()) { state.runtime.tickSkipReason = 'decision_cooldown'; return }
  state.nextPaidDecisionAt = Date.now() + config.worldSceneCooldownMs
  const ticket = revision
  const current = () => ticket === revision && state.runtime.status === 'RUNNING' && !shuttingDown
  state.runtime.lockHolder = 'scene'
  try {
    const applied = await runScene(state.worldState, execution, state.season.id, { callModel, current, scenes: () => state.scenes })
    if (applied && current()) {
      v4.consecutiveFailures = 0
      pushEvent(applied.event, true)
      publishScene(applied.scene)
      state.season.survivorCount = state.worldState.agents.filter(a => a.publicState.status !== 'deceased').length
    } else if (current()) v4.consecutiveFailures++
  } catch (error) {
    if (ticket === revision) {
      const code = error instanceof ProviderCallError ? error.code : error instanceof Error && error.message === 'call_budget_exhausted' ? 'CALL_BUDGET_EXHAUSTED' : 'WORLD_SCENE_FAILED'
      console.error('[world-v4] scene failed', code, error instanceof Error ? error.message : error)
      recordRuntimeError('scene', code)
      v4.consecutiveFailures++
      if (FATAL_SCENE_ERRORS.has(code) || code === 'CALL_BUDGET_EXHAUSTED') { state.runtime.decisionsPaused = true; state.runtime.decisionStatus = code }
    }
  } finally {
    // Three unusable scenes in a row means something is systematically wrong — stop spending.
    if (v4.consecutiveFailures >= 3 && !state.runtime.decisionsPaused) { state.runtime.decisionsPaused = true; state.runtime.decisionStatus = 'SCENE_REPEATEDLY_FAILED' }
    state.runtime.lockHolder = null
    if (state.runtime.decisionsPaused && state.runtime.status === 'RUNNING') pauseSeason()
    persist()
    broadcast({ type: 'runtime', payload: publicRuntime() })
  }
}

// A v4 DAY chapter is simply that day's scenes in order — the prose already is the story.
function v4DayStories(): ChronicleEntry[] {
  const days = [...new Set(state.scenes.map(s => s.worldDay))].sort((a, b) => b - a)
  return days.map(day => {
    // Story time, not publication time: a scene covering 02:35–03:00 precedes a 03:00 broadcast.
    // A scene that began the previous evening (23:40–00:20) opens the day.
    const start = (s: ChronicleEntry) => s.timeStart <= s.timeEnd ? s.timeStart : '00:00'
    const scenes = state.scenes.filter(s => s.worldDay === day).sort((a, b) => start(a).localeCompare(start(b)) || a.createdAt.localeCompare(b.createdAt))
    const placeName = (id: string | undefined) => state.worldState.places.find(p => p.id === id)?.name ?? ''
    return { id: `day-${state.season.id}-${day}`, kind: 'DAY' as const, seasonId: state.season.id, worldDay: day,
      timeStart: scenes[0].timeStart, timeEnd: scenes.at(-1)!.timeEnd, title: `DAY ${day}`,
      body: scenes.map(s => `${s.timeStart} · ${placeName(s.locationIds[0])} — ${s.title}\n\n${s.body}`).join('\n\n＊ ＊ ＊\n\n'),
      locationIds: [...new Set(scenes.flatMap(s => s.locationIds))], agentIds: [...new Set(scenes.flatMap(s => s.agentIds))],
      sourceEventIds: scenes.flatMap(s => s.sourceEventIds), stateChanges: [],
      importance: scenes.some(s => s.importance === 'major') ? 'major' as const : scenes.some(s => s.importance === 'notable') ? 'notable' as const : 'ordinary' as const,
      createdAt: scenes[0].createdAt, completed: day < state.worldState.clock.day || state.runtime.status === 'ENDED' }
  })
}

export function runWorldTick(): Promise<void> {
  if (activeTick) return activeTick
  const minutes=state.execution?.draft.studio?.minutesPerTick??config.worldMinutesPerTick
  if (v4Active()) {
    activeTick = (async()=>{
      advanceWorldTick(minutes)
      if (state.runtime.status === 'RUNNING') await performScene()
    })().finally(() => { activeTick = null })
    return activeTick
  }
  const rounds=minutes>=120?2:1
  const start=state.worldState.engine?.minute??0
  const paidRoundAllowed=(state.nextPaidDecisionAt??0)<=Date.now()
  activeTick = (async()=>{
    for(let round=0;round<rounds&&state.runtime.status==='RUNNING';round++){
      // Long configured ticks contain more than one decision opportunity. Existing
      // actions resolve before the later snapshot, so consequences can influence it.
      const boundary=start+Math.round(minutes*(round+1)/rounds)
      advanceWorldTick(Math.max(0,boundary-(state.worldState.engine?.minute??boundary)))
      const pending=state.worldState.engine?.requireCombatAdjudication&&state.worldState.engine.ongoingActions.some(t=>t.completesMinute<=state.worldState.engine!.minute&&!t.adjudication&&['ATTACK','ROB'].includes(t.proposal.actionType))
      if(pending)await advanceAndAdjudicate(boundary)
      if(state.runtime.status!=='RUNNING')break
      await performDecisions(round>0&&paidRoundAllowed)
    }
  })().finally(() => { activeTick = null })
  return activeTick
}

async function advanceAndAdjudicate(horizon:number):Promise<void>{
 const ticket=revision
 try{
  while(state.runtime.status==='RUNNING'&&state.execution?.mode==='live'&&!shuttingDown){
   const engine=state.worldState.engine!
   let tasks=engine.ongoingActions.filter(t=>t.completesMinute<=engine.minute&&!t.adjudication&&['ATTACK','ROB'].includes(t.proposal.actionType)&&validateEngineAction(t.proposal,state.worldState,state.events,[],true).approved).slice(0,8)
   if(!tasks.length)break
   let request=combatBatchRequest(state.worldState,tasks,config.openaiModel)
   while(tasks.length>1){try{worldRequestBody(request);break}catch{tasks=tasks.slice(0,Math.ceil(tasks.length/2));request=combatBatchRequest(state.worldState,tasks,config.openaiModel)}}
   const fingerprints=tasks.map(t=>combatFingerprint(state.worldState,t))
   state.runtime.lockHolder='combat-adjudication';persist()
   let raw=await callModel(request,tasks[0].proposal.actorId)
   if(ticket!==revision||state.runtime.status!=='RUNNING'||shuttingDown)return
   let normalized=normalizeCombatBatch(state.worldState,tasks,raw)
   const issue=combatBatchIssue(state.worldState,tasks,fingerprints,normalized.batch)
   if(issue){
    recordRuntimeError('combat-validation',issue,false)
    // A stale snapshot cannot be corrected by another paid model call.
    if(issue==='stale_combat_batch')throw new Error(issue)
    state.runtime.retryCount++
    persist()
    const repairRequest={...request,prompt:`${request.prompt}\n\nThe previous structured result was rejected by the engine: ${issue}. Return a fresh full results array for the SAME actionIds. The world state and defender reactions above are authoritative. Check all injury bounds and body-part constraints. Do not repeat the rejected result.`}
    raw=await callModel(repairRequest,tasks[0].proposal.actorId)
    if(ticket!==revision||state.runtime.status!=='RUNNING'||shuttingDown)return
    normalized=normalizeCombatBatch(state.worldState,tasks,raw)
   }
   acceptCombatBatch(state.worldState,tasks,fingerprints,normalized.batch,config.openaiModel,normalized.corrections)
   persist() // Durable validated decision; a restart must not pay to decide it twice.
   state.runtime.lockHolder=null
   advanceWorldTick(Math.max(0,horizon-engine.minute))
  }
 }catch(error){
  if(ticket===revision){
   const code=error instanceof ProviderCallError?error.code:'COMBAT_ADJUDICATION_REJECTED'
   const detail=error instanceof Error?error.message:'unknown_error'
   console.error('[world] combat-adjudication failed',code,detail)
   recordRuntimeError('combat-adjudication',error instanceof ProviderCallError?code:`${code} · ${detail}`)
   state.runtime.decisionsPaused=true;state.runtime.decisionStatus=code
   if(state.runtime.status==='RUNNING')pauseSeason()
  }
 }finally{state.runtime.lockHolder=null;persist()}
}

function scheduleTimer(): void {
  if (timer) clearInterval(timer)
  timer = null
  if (shuttingDown || state.runtime.status !== 'RUNNING' || !state.execution) {
    state.runtime.tickSkipReason = shuttingDown ? 'scheduler_not_registered' : state.runtime.status !== 'RUNNING' ? 'not_running' : 'no_world'
    return
  }
  state.runtime.tickSkipReason = 'not_due'
  timer = setInterval(() => {
    if (activeTick || state.runtime.lockHolder) { state.runtime.tickSkipReason = 'lock_busy'; return }
    if (state.runtime.status !== 'RUNNING') { state.runtime.tickSkipReason = 'not_running'; return }
    state.runtime.lastTickAttemptAt = new Date().toISOString()
    state.runtime.lastTickResult = 'started'
    state.runtime.tickSkipReason = null
    try {
      void runWorldTick().then(() => {
        state.runtime.lastTickResult = state.runtime.tickSkipReason === 'no_eligible_agents' ? 'no_eligible_agents' :
          state.runtime.status === 'RUNNING' ? 'completed' : 'paused'
        persist()
      }).catch(error => {
        console.error('[world] scheduled tick failed', error instanceof Error ? error.stack ?? error.message : error)
        recordRuntimeError('scheduler', error instanceof Error ? error.message : String(error))
        state.runtime.lastTickResult = 'failed'
        state.runtime.decisionsPaused = true
        pauseSeason()
        state.runtime.tickSkipReason = 'tick_failed'
        persist()
      })
    } catch (error) {
      // This silently killed the tick timer with no trace before — log it so a crash here is diagnosable.
      console.error('[world] tick crashed, pausing', error instanceof Error ? error.stack ?? error.message : error)
      recordRuntimeError('scheduler', error instanceof Error ? error.message : String(error))
      state.runtime.lastTickResult = 'failed'
      state.runtime.tickSkipReason = 'tick_failed'
      state.runtime.status = state.season.status = 'PAUSED'; state.runtime.paused = true; stopSimulationTimerForTests()
      state.runtime.nextTickAt = null
      persist()
    }
  }, state.runtime.tickIntervalMs)
}

scheduleTimer()

// Test-only escape hatch — lets a test process exit instead of hanging on this module-level
// interval forever. Never called from application code.
export function stopSimulationTimerForTests(): void {
  if (timer) clearInterval(timer)
  timer = null
}

// --- Admin mutations ----------------------------------------------------------

function logOperator(entry: Omit<OperatorLogEntry, 'id' | 'addedAt'>): void {
  state.runtime.operatorLog.unshift({ id: `oplog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, addedAt: new Date().toISOString(), ...entry })
  state.runtime.operatorLog = state.runtime.operatorLog.slice(0, 100)
}

export function startSeason(): WorldRuntime {
  if (state.runtime.status === 'ENDED') throw new HttpError(409, 'season_ended_create_new_world')
  if (state.worldState.agents.filter(a => a.publicState.status !== 'deceased').length > config.maxActiveCharacters) throw new HttpError(409, 'max_active_characters_exceeded')
  state.runtime.status = 'RUNNING'
  state.runtime.decisionsPaused = false
  state.runtime.decisionStatus = 'READY'
  state.runtime.paused = false
  state.season.status = 'RUNNING'
  state.runtime.nextTickAt = new Date(Date.now() + state.runtime.tickIntervalMs).toISOString()
  scheduleTimer()
  persist()
  broadcast({ type: 'runtime', payload: publicRuntime() })
  return getAdminRuntime()
}

export function pauseSeason(): WorldRuntime {
  if (state.runtime.status === 'ENDED') throw new HttpError(409, 'season_already_ended')
  revision++
  state.runtime.status = 'PAUSED'
  state.runtime.paused = true
  state.season.status = 'PAUSED'
  state.runtime.nextTickAt = null
  state.runtime.tickSkipReason = 'not_running'
  stopSimulationTimerForTests()
  persist()
  broadcast({ type: 'runtime', payload: publicRuntime() })
  return getAdminRuntime()
}

export function resumeSeason(): WorldRuntime {
  return startSeason()
}

export function endSeason(): WorldRuntime {
  if (state.runtime.status === 'ENDED') return getAdminRuntime()
  logOperator({ addedBy: 'admin', summary: 'Administrative stop: paused without a fictional ending', eventId: '' })
  return pauseSeason()
}

function finishWorld(reason: string): WorldRuntime {
  if (state.runtime.status === 'ENDED') return getAdminRuntime()
  revision++
  const evidenceEventIds = state.events.filter(e => e.stateChanges.some(c => c.field.endsWith(':status') || c.field.startsWith('goal:')) || e.cause?.startsWith('scheduled:')).slice(0, 20).map(e => e.id)
  if (state.worldState.engine) state.worldState.engine.termination = { minute: state.worldState.engine.minute, reason, evidenceEventIds, survivors: state.worldState.agents.filter(a => a.publicState.status !== 'deceased').length }
  state.runtime.status = 'ENDED'
  state.season.status = 'ENDED'
  state.season.endedAt = new Date().toISOString()
  state.runtime.paused = false
  state.runtime.nextTickAt = null
  if (timer) clearInterval(timer)
  if (state.execution) {
    const summary = `${reason}. DAY ${state.worldState.clock.day} ${state.worldState.clock.time}, 시즌 진행이 종료되었다. 생존자는 ${state.worldState.agents.filter(a => a.publicState.status !== 'deceased').length}명이다.`
    recordEngineEvent({ id: randomUUID(), occurredAt: new Date().toISOString(), day: state.worldState.clock.day, worldTime: state.worldState.clock.time, worldMinute: state.worldState.engine?.minute, type: 'SYSTEM', phase: 'STATE_UPDATE', cause: 'world_ended', outcome: 'CONFIRMED', summary, title: summary, placeId: '', agentIds: [], stateChanges: [{ field: 'season:status', from: 'active', to: 'ENDED' }], importance: 'high', relatedEventIds: evidenceEventIds })
  }
  flushChapter(true)
  persist()
  broadcast({ type: 'runtime', payload: publicRuntime() })
  return getAdminRuntime()
}

export function setTickInterval(ms: number): WorldRuntime {
  state.runtime.tickIntervalMs = ms
  state.runtime.nextTickAt = new Date(Date.now() + ms).toISOString()
  scheduleTimer()
  if (state.runtime.status !== 'RUNNING') state.runtime.nextTickAt = null
  persist()
  return getAdminRuntime()
}

export function setMaxActiveAgents(n: number): WorldRuntime {
  if (!Number.isInteger(n) || n < 1 || n > config.maxActiveCharacters) throw new HttpError(400, 'max_active_characters_exceeded')
  state.runtime.maxActiveAgents = n
  persist()
  return getAdminRuntime()
}

export function setCallBudget(n: number): WorldRuntime {
  state.runtime.callBudget = n
  state.runtime.decisionsPaused = false
  state.runtime.decisionStatus = 'READY'
  persist()
  return getAdminRuntime()
}

export interface OperatorEventInput {
  type: string
  placeId: string
  agentIds: string[]
  title: string
  summary: string
  importance?: string
  addedBy: string
}

export interface OperatorEventResult {
  ok: boolean
  event?: WorldEvent
  errors?: string[]
}

export function addOperatorEvent(input: OperatorEventInput): OperatorEventResult {
  if (activeTick) throw new HttpError(409, 'world_tick_in_progress')
  // WORLD RULES enforcement for GM/operator-submitted events: same existence checks a real GM
  // PROMPT's output would have to pass (see server/prompts/gmPrompt.ts, server/world/worldValidator.ts).
  const validation = validateGmEvent({ placeId: input.placeId, agentIds: input.agentIds }, state.worldState)
  const errors = [...validation.notes]
  if (!input.title.trim()) errors.push('제목이 비어 있습니다.')
  if (!input.summary.trim()) errors.push('요약이 비어 있습니다.')
  if (!validation.approved || errors.length > validation.notes.length) {
    return { ok: false, errors }
  }

  const event: WorldEvent = {
    id: `evt-op-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'OPERATOR_EVENT',
    occurredAt: new Date().toISOString(),
    day: state.worldState.clock.day,
    placeId: input.placeId,
    agentIds: input.agentIds,
    title: `운영자 공지: ${input.title.trim()}`,
    summary: `운영자가 공지했다: ${input.summary.trim()}`,
    worldMinute: state.worldState.engine?.minute,
    worldTime: state.worldState.clock.time,
    cause: 'operator_announcement',
    stateChanges: [],
    importance: (input.importance as WorldEvent['importance']) ?? 'normal',
    relatedEventIds: [],
    operator: { addedBy: input.addedBy, addedAt: new Date().toISOString() },
  }
  pushEvent(event)
  // Operator events are never part of a hand-authored scene, so narrate one immediately via the
  // fallback NARRATOR path instead of waiting on emitReadyScenes() (which only fires for
  // pre-defined QUEUED_SCENES).
  queueChapter(event)
  logOperator({ addedBy: input.addedBy, eventId: event.id, summary: event.title })
  persist()
  return { ok: true, event }
}

export function listOperatorLog(): OperatorLogEntry[] {
  return state.runtime.operatorLog
}

// Admin World Builder hand-off (START WORLD) — replaces the entire in-memory simulation with a
// freshly constructed, already-validated world. This is the one function that lets an outside
// caller swap `state` wholesale; everything else here only ever mutates it incrementally. The
// caller (server/domain/worldLaunch.ts) is responsible for producing a shape that already passed
// server/world/builderValidation.ts — this function does not re-validate.
export function loadWorldState(input: { season: Season; worldState: WorldState; initialEvent: WorldEvent; execution?: WorldExecution }): void {
  if (activeTick) throw new HttpError(409, 'world_tick_in_progress')
  revision++
  if (state.execution?.draft.isPublic) state.archivedSeasons.unshift({ ...state.season, status: 'ENDED', endedAt: new Date().toISOString() })
  state.execution = input.execution ? structuredClone(input.execution) : undefined
  if (!isWorldPublic()) {
    for (const res of subscribers) res.end()
    subscribers.clear()
  }
  state.nextPaidDecisionAt = 0
  state.season = input.season
  state.worldState = input.worldState
  input.initialEvent.sequence = 1
  state.events = [input.initialEvent]
  state.queued = []
  state.scenes = []
  state.dayNarration = {}
  state.queuedScenes = []
  state.chapters = []
  state.runtime.status = 'RUNNING'
  state.runtime.decisionsPaused = false
  state.runtime.decisionStatus = 'READY'
  state.runtime.paused = false
  state.runtime.lastTickAt = null
  state.runtime.lastTickAttemptAt = null
  state.runtime.lastTickResult = 'waiting_for_first_tick'
  state.runtime.tickSkipReason = null
  state.runtime.nextTickAt = new Date(Date.now() + state.runtime.tickIntervalMs).toISOString()
  state.runtime.callsUsed = 0
  state.runtime.pipeline = emptyPipeline()
  state.runtime.providerUsage = []
  state.runtime.failedJobs = 0
  state.runtime.retryCount = 0
  state.runtime.lockHolder = null
  state.runtime.tickIntervalMs = input.execution?.draft.simSpeedMs ?? DEFAULT_TICK_MS
  state.runtime.maxActiveAgents = input.execution?.draft.studio?.activeLimit ?? config.worldDecisionsPerCycle
  state.runtime.nextTickAt = new Date(Date.now() + state.runtime.tickIntervalMs).toISOString()
  state.runtime.queuedEvents = 0
  state.runtime.recentErrors = []
  state.runtime.operatorLog = []
  state.runtime.agentLastCallAt = {}
  scheduleTimer()
  state.chapterBuffer = undefined
  queueChapter(input.initialEvent)
  for (const event of processStudio(state.worldState)) recordEngineEvent(event)
  persist()
  broadcast({ type: 'worldState', payload: toPublicWorld(state.worldState) })
  broadcast({ type: 'event', payload: toPublicEvent(input.initialEvent) })
}

export function recordRuntimeError(scope: string, message: string, failedJob=true): void {
  const error: RuntimeError = { id: `err-${Date.now()}`, occurredAt: new Date().toISOString(), scope, message }
  state.runtime.recentErrors.unshift(error)
  state.runtime.recentErrors = state.runtime.recentErrors.slice(0, 50)
  if(failedJob)state.runtime.failedJobs += 1
}

export type { ProviderUsage }

// DAY chapters are derived from the append-only event journal, not truncated LIVE pages.
export function listDayStories(): ChronicleEntry[] {
  if (v4Active()) return v4DayStories()
  const events = historyEvents().map(toPublicEvent)
  const days = [...new Set(events.map(e => e.day))].sort((a,b) => b-a)
  return days.map(day => {
    const chapter = composeDay(day, state.season.id, events, placesById(), agentsById(), day < state.worldState.clock.day || state.runtime.status === 'ENDED')
    const literary=state.dayNarration?.[day]
    if(chapter&&literary){
      const tail=composeDay(day,state.season.id,events.filter(e=>(e.worldMinute??0)>literary.throughMinute),placesById(),agentsById(),chapter.completed??false)
      chapter.body=literary.entry.body+(tail?`\n\n＊ ＊ ＊\n\n${tail.body}`:'')
      chapter.sourceEventIds=[...new Set([...literary.entry.sourceEventIds,...(tail?.sourceEventIds??[])])]
      chapter.corrections=literary.entry.corrections
    }
    if (chapter) chapter.corrections = [...(chapter.corrections??[]),...state.scenes.filter(s => s.worldDay === day).flatMap(s => s.corrections ?? [])]
    return chapter
  }).filter((c): c is ChronicleEntry => Boolean(c))
}

export function listCognition() {
  return state.worldState.agents.map(a => ({ id: a.id, name: a.name, dispositions: a.dispositions ?? parseDispositions(null), motivations: a.motivations, decision: state.worldState.engine?.decisions?.[a.id] }))
}
export function setActorDispositions(actorId: string, raw: unknown, addedBy = 'admin') {
  if (state.runtime.status !== 'PAUSED') throw new HttpError(409, 'pause_world_before_editing_traits')
  const actor = state.worldState.agents.find(a => a.id === actorId)
  if (!actor) throw new HttpError(404, 'actor_not_found')
  let next: Dispositions
  try { next = parseDispositions(raw, actor.dispositions) } catch { throw new HttpError(400, 'invalid_dispositions') }
  const before = actor.dispositions
  actor.dispositions = next
  const design = state.execution?.draft.characters.find(c => c.id === actorId)
  if (design) design.dispositions = next
  if (runtimeDb) runtimeDb.prepare('UPDATE draft_characters SET dispositions_json=? WHERE id=?').run(JSON.stringify(next),actorId)
  logOperator({addedBy, eventId:'', summary: `Disposition edit ${actor.name}: ${JSON.stringify(before)} -> ${JSON.stringify(next)}`})
  revision++; persist()
  return listCognition()
}

// Authenticated diagnostic snapshot; contains fictional world knowledge, never service credentials.
export function diagnosticSnapshot(){return structuredClone({world:state.worldState,execution:state.execution,events:state.events,scenes:state.scenes})}
