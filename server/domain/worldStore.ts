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
import { agentRequest, judgeRequest, demoAction, parseProposedAction, parseJudgment, worldModelAdapter, ensureModelConfigured, worldRequestBody, type WorldExecution, type WorldModelAdapter, type WorldModelRequest } from './worldAgent.ts'
import { initializeEngine, advanceEngine, selectDecisionAgents, validateEngineAction, beginAction, recordExperience, nextDecisionDelay } from '../world/worldEngine.ts'
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
import { processStudio } from '../world/studioEngine.ts'
import { validateGmEvent } from '../world/worldValidator.ts'
import { applyStateChanges } from '../world/stateTransition.ts'

const DEFAULT_TICK_MS = 5_000
const MAX_EVENTS_KEPT = 500

interface State {
  execution?: WorldExecution
  recentActions?: Record<string, ProposedAction[]>
  nextAgentIndex?: number
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

const subscribers = new Set<ServerResponse>()
let runtimeDb: DatabaseSync | undefined
let modelAdapter: WorldModelAdapter = worldModelAdapter
let revision = 0
let activeTick: Promise<void> | null = null
let shuttingDown = false

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

export function initializeWorldRuntime(db: DatabaseSync, adapter: WorldModelAdapter = worldModelAdapter): void {
  stopSimulationTimerForTests()
  runtimeDb = db
  ensurePricingSeeded(db)
  modelAdapter = adapter
  shuttingDown = false
  const row = db.prepare('SELECT payload FROM world_runtime_checkpoint WHERE id=1').get() as { payload: string } | undefined
  if (row) {
    Object.assign(state, JSON.parse(row.payload) as State)
    if (state.execution) initializeEngine(state.worldState, state.execution.draft)
    revision++
    state.runtime.lockHolder = null
    state.runtime.lockExpiresAt = null
    // Restore all progress, but require the operator to resume after an interrupted process.
    if (state.runtime.status === 'RUNNING') {
      state.runtime.status = state.season.status = 'PAUSED'
      state.runtime.paused = true
    }
    state.runtime.nextTickAt = null
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
  state.worldState.activeEventIds = [event.id]
  state.worldState.updatedAt = event.occurredAt
  if (!alreadyApplied) applyStateChanges(state.worldState, event.stateChanges)
  const place = state.worldState.places.find(p => p.id === event.placeId)
  if (place) {
    place.recentEventIds = [event.id, ...place.recentEventIds].slice(0, 8)
  }
  persist()
  if (event.visibility !== 'private') broadcast({ type: 'event', payload: toPublicEvent(event) })
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
  return state.events.find(e => e.id === id && e.outcome !== 'REJECTED' && e.visibility !== 'private') ?? state.events.find(e => e.outcome !== 'REJECTED' && e.visibility !== 'private')
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
  let items = historyEvents().filter(e => e.outcome !== 'REJECTED' && e.visibility !== 'private')
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

function publicRuntime(): Pick<WorldRuntime, 'connected' | 'status' | 'paused' | 'lastTickAt' | 'nextTickAt'> {
  return { connected: true, status: state.runtime.status, paused: state.runtime.paused, lastTickAt: state.runtime.lastTickAt, nextTickAt: state.runtime.nextTickAt }
}

export function getPublicRuntime() {
  return publicRuntime()
}

export function getAdminRuntime(): WorldRuntime {
  return { ...state.runtime, mode: state.execution?.mode ?? 'preview', queuedEvents: state.worldState.engine?.ongoingActions.length ?? state.queued.length, maxActiveCharacters: config.maxActiveCharacters, worldMinutesPerTick: state.execution?.draft.studio?.minutesPerTick ?? config.worldMinutesPerTick }
}

export function listActionAudit(): WorldEvent[] { return state.events.filter(e => e.provenance).slice(0, 50) }
export function assertWorldIdle(): void { if (activeTick) throw new HttpError(409, 'world_tick_in_progress') }

// --- Simulation tick ---------------------------------------------------------

let timer: ReturnType<typeof setInterval> | null = null

export function advanceWorldTick(minutes = state.execution?.draft.studio?.minutesPerTick ?? config.worldMinutesPerTick): void {
  if (shuttingDown || state.runtime.status !== 'RUNNING' || !state.execution) return
  state.runtime.lastTickAt = new Date().toISOString()
  advanceEngine(state.worldState, minutes, state.events, recordEngineEvent)
  state.season.currentDay = state.worldState.clock.day
  state.season.survivorCount = state.worldState.agents.filter(a => a.publicState.status !== 'deceased').length
  if (state.worldState.engine?.studio?.ended || state.execution.draft.maxDays !== null && state.worldState.clock.day >= state.execution.draft.startDay + state.execution.draft.maxDays || state.season.survivorCount === 0) endSeason()
  flushChapter(false)
  state.runtime.nextTickAt = state.runtime.status === 'RUNNING' ? new Date(Date.now() + state.runtime.tickIntervalMs).toISOString() : null
  persist()
  broadcast({ type: 'worldState', payload: toPublicWorld(state.worldState) })
  broadcast({ type: 'runtime', payload: publicRuntime() })
}

function recordEngineEvent(e: WorldEvent): void {
  const extra = recordExperience(state.worldState, e)
  pushEvent(e, true)
  queueChapter(e)
  for (const followup of extra) { pushEvent(followup, true); queueChapter(followup) }
}

async function performDecisions(): Promise<void> {
  if (shuttingDown || state.runtime.status !== 'RUNNING' || !state.execution || state.runtime.decisionsPaused) {
    // Temporary diagnostic: identify why decisions never run when the world looks RUNNING.
    console.error(`[world] performDecisions skipped shuttingDown=${shuttingDown} status=${state.runtime.status} hasExecution=${Boolean(state.execution)} decisionsPaused=${state.runtime.decisionsPaused}`)
    return
  }
  const execution = state.execution
  if (execution.mode === 'live' && (state.nextPaidDecisionAt ?? 0) > Date.now()) {
    console.error(`[world] performDecisions skipped cooldown nextPaidDecisionAt=${state.nextPaidDecisionAt} now=${Date.now()}`)
    return
  }
  const ticket = revision
  const current = () => ticket === revision && state.runtime.status === 'RUNNING' && !shuttingDown
  state.runtime.lockHolder = 'agent-decision'
  try {
    const selected = selectDecisionAgents(state.worldState, Math.min(state.runtime.maxActiveAgents, config.maxActiveCharacters))
    console.error(`[world] performDecisions selected ${selected.length} agent(s): ${selected.map(a => a.name).join(', ')}`)
    for (const actor of selected) {
      if (!current()) break
      if (!['alive', 'injured'].includes(actor.publicState.status) || state.worldState.engine!.ongoingActions.some(a => a.proposal.actorId === actor.id)) continue
      if (execution.mode === 'live' && state.runtime.callBudget - state.runtime.callsUsed < 2) {
        state.runtime.decisionsPaused = true
        state.runtime.decisionStatus = 'CALL_BUDGET_EXHAUSTED'
        break
      }
      const request = agentRequest(execution, actor.id, state.worldState, state.events)
      if (execution.mode === 'live') { state.nextPaidDecisionAt = Date.now() + config.worldDecisionCooldownMs; persist() }
      const raw = execution.mode === 'demo' ? demoAction(actor.id, state.worldState) : await callModel(request, actor.id)
      if (!current()) break
      const action = parseProposedAction(raw, actor.id)
      let validation = validateEngineAction(action, state.worldState, state.events, state.recentActions?.[actor.id])
      if (validation.approved && execution.mode === 'live') {
        const beforeMinute = state.worldState.engine!.minute
        const judgment = parseJudgment(await callModel(judgeRequest(execution, action, state.worldState, state.events), actor.id))
        if (!current()) break
        if (!execution.draft.studio && judgment.ended && execution.draft.endCondition.trim() && state.worldState.engine!.minute === beforeMinute) { endSeason(); break }
        // Time and other actions can progress while a provider is responding. Validate again.
        validation = validateEngineAction(action, state.worldState, state.events, state.recentActions?.[actor.id])
        if (!judgment.approved) { validation.approved = false; validation.reasons.push('RULE_VIOLATION'); validation.notes.push(judgment.reason) }
      }
      if (!current()) break
      state.recentActions ??= {}
      state.recentActions[actor.id] = [action, ...(state.recentActions[actor.id] ?? [])].slice(0, 3)
      let e: WorldEvent
      if (validation.approved) e = beginAction(state.worldState, action)
      else {
        actor.nextDecisionAt = state.worldState.engine!.minute + nextDecisionDelay(actor, 'WAIT')
        e = { id: randomUUID(), occurredAt: new Date().toISOString(), day: state.worldState.clock.day,
          worldTime: state.worldState.clock.time, worldMinute: state.worldState.engine!.minute,
          type: 'DECISION', placeId: action.locationId, agentIds: [actor.id], title: `${actor.name} · ${action.actionType}`,
          summary: 'Action rejected by WORLD ENGINE', outcome: 'REJECTED', phase: 'FAILED', actionType: action.actionType,
          attemptedAction: action.intendedAction, engineVerdict: validation.notes.join(', '), stateChanges: [], importance: 'low', relatedEventIds: [] }
      }
      e.provenance = { provider: execution.mode === 'demo' ? 'demo' : request.provider, model: request.model,
        promptVersionId: `agent@${AGENT_PROMPT_VERSION}`, inputDataVersion: state.season.id, calledAt: new Date().toISOString(),
        validation: { approved: validation.approved, reasons: validation.notes } }
      recordEngineEvent(e)
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
    state.runtime.lockHolder = null
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
  const reservedUsd = estimateCostUsd(pricing, inputBound, 1500)
  const rate = getUsdToKrwRate(runtimeDb)
  const reservedKrw = reservedUsd * rate
  const budget = checkBudget(runtimeDb, reservedKrw)
  if (!budget.allowed) throw new ProviderCallError('BUDGET_LIMIT', 'shared weekly or monthly budget exhausted')
  if (state.runtime.callsUsed >= state.runtime.callBudget) throw new Error('call_budget_exhausted')
  reserveBudget(runtimeDb, budget.weekKey, reservedKrw, reservedUsd, budget.monthKey)
  state.runtime.callsUsed++
  state.runtime.agentLastCallAt[actorId] = new Date().toISOString()
  let usage = state.runtime.providerUsage.find(u => u.provider === request.provider)
  if (!usage) { usage = { provider: request.provider, calls: 0, estTokens: 0, estCostUsd: 0 }; state.runtime.providerUsage.push(usage) }
  usage.calls++
  // Reserve durably before the network call; even a crash or failed request consumes budget.
  persist()
  let actualUsd = reservedUsd
  try {
    const result = await modelAdapter(request)
    if (Number.isFinite(result.inputTokens) && result.inputTokens > 0 && Number.isFinite(result.outputTokens) && result.outputTokens >= 0) {
      actualUsd = estimateCostUsd(pricing, result.inputTokens, result.outputTokens)
      usage.estTokens += result.inputTokens + result.outputTokens
    }
    return result.raw
  } finally {
    // Failed/unknown-usage calls retain their conservative estimate; no free retries.
    usage.estCostUsd += actualUsd
    settleReservation(runtimeDb, budget.weekKey, reservedKrw, reservedUsd, actualUsd * rate, actualUsd, request.provider as Provider, budget.monthKey)
  }
}

function queueChapter(e: WorldEvent): void {
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
  state.chapterBuffer.eventIds.push(e.id)
  chapter.eventIds.push(e.id)
  flushChapter(false)
}

function flushChapter(force: boolean): void {
  const buffer = state.chapterBuffer
  if (!buffer || !state.worldState.engine) return
  const age = state.worldState.engine.minute - buffer.startedMinute
  if (!force && age < config.worldChapterMinutes) return
  const events = buffer.eventIds.map(id => getEvent(id)).filter((e): e is WorldEvent => Boolean(e && e.outcome !== 'REJECTED' && e.visibility !== 'private'))
  if (!events.length) return
  const chapter = state.chapters.find(c => c.id === buffer.chapterId)!
  const scene = mockNarrator.narrateFallbackScene(events, placesById(), agentsById(), state.worldState.engine?.context)
  scene.seasonId = state.season.id
  scene.worldDay = buffer.day
  scene.timeStart = events[0].worldTime ?? state.worldState.clock.time
  scene.timeEnd = events.at(-1)!.worldTime ?? state.worldState.clock.time
  chapter.status = 'COMPLETED'
  chapter.endedMinute = events.at(-1)!.worldMinute
  chapter.sceneId = scene.id
  chapter.summary = scene.body
  chapter.changes = events.flatMap(e => e.stateChanges.filter(c => !c.field.startsWith('knowledge:')).map(c => `${c.field}: ${c.from} → ${c.to}`))
  state.scenes.push(scene)
  state.chapterBuffer = undefined
  persist()
  broadcast({ type: 'scene', payload: scene })
}

export function runWorldTick(): Promise<void> {
  if (activeTick) return activeTick
  advanceWorldTick()
  activeTick = performDecisions().finally(() => { activeTick = null })
  return activeTick
}

function scheduleTimer(): void {
  if (timer) clearInterval(timer)
  if (shuttingDown || state.runtime.status !== 'RUNNING') return
  timer = setInterval(() => {
    try {
      advanceWorldTick()
      if (!activeTick) activeTick = performDecisions().finally(() => { activeTick = null })
      void activeTick.catch(() => { state.runtime.decisionsPaused = true })
    } catch { state.runtime.status = state.season.status = 'PAUSED'; state.runtime.paused = true; stopSimulationTimerForTests() }
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
  scheduleTimer()
  state.runtime.nextTickAt = new Date(Date.now() + state.runtime.tickIntervalMs).toISOString()
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
  stopSimulationTimerForTests()
  persist()
  broadcast({ type: 'runtime', payload: publicRuntime() })
  return getAdminRuntime()
}

export function resumeSeason(): WorldRuntime {
  return startSeason()
}

export function endSeason(): WorldRuntime {
  revision++
  flushChapter(true)
  state.runtime.status = 'ENDED'
  state.season.status = 'ENDED'
  state.season.endedAt = new Date().toISOString()
  state.runtime.paused = false
  state.runtime.nextTickAt = null
  if (timer) clearInterval(timer)
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
  state.recentActions = {}
  state.nextAgentIndex = 0
  state.nextPaidDecisionAt = 0
  state.season = input.season
  state.worldState = input.worldState
  input.initialEvent.sequence = 1
  state.events = [input.initialEvent]
  state.queued = []
  state.scenes = []
  state.queuedScenes = []
  state.chapters = []
  state.runtime.status = 'RUNNING'
  state.runtime.decisionsPaused = false
  state.runtime.decisionStatus = 'READY'
  state.runtime.paused = false
  state.runtime.lastTickAt = null
  state.runtime.nextTickAt = new Date(Date.now() + state.runtime.tickIntervalMs).toISOString()
  state.runtime.callsUsed = 0
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

export function recordRuntimeError(scope: string, message: string): void {
  const error: RuntimeError = { id: `err-${Date.now()}`, occurredAt: new Date().toISOString(), scope, message }
  state.runtime.recentErrors.unshift(error)
  state.runtime.recentErrors = state.runtime.recentErrors.slice(0, 50)
  state.runtime.failedJobs += 1
}

export type { ProviderUsage }
