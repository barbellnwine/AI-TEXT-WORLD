// In-memory world simulation store — the mock service standing in for a real simulation engine.
// A future engine only needs to replace the mutation logic inside this module; every consumer
// (public routes, admin routes, SSE) only ever talks to the functions exported here.
import type { ServerResponse } from 'node:http'
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
import { validateGmEvent } from '../world/worldValidator.ts'
import { applyStateChanges } from '../world/stateTransition.ts'

const DEFAULT_TICK_MS = 60_000
const MAX_EVENTS_KEPT = 500

interface State {
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
    maxActiveAgents: 10,
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

function pushEvent(event: WorldEvent): void {
  state.events.unshift(event)
  if (state.events.length > MAX_EVENTS_KEPT) state.events.length = MAX_EVENTS_KEPT
  state.worldState.activeEventIds = [event.id]
  state.worldState.updatedAt = event.occurredAt
  applyStateChanges(state.worldState, event.stateChanges)
  const place = state.worldState.places.find(p => p.id === event.placeId)
  if (place) {
    place.recentEventIds = [event.id, ...place.recentEventIds].slice(0, 8)
  }
  broadcast({ type: 'event', payload: event })
  broadcast({ type: 'worldState', payload: state.worldState })
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

export function getWorldState(): WorldState {
  return state.worldState
}

export function getSpotlightEvent(): WorldEvent | undefined {
  const id = state.worldState.activeEventIds[0]
  return state.events.find(e => e.id === id) ?? state.events[0]
}

export interface EventFilter {
  sinceIso?: string
  type?: string
  agentId?: string
  placeId?: string
  importantOnly?: boolean
  limit: number
  offset: number
}

export function listEvents(filter: EventFilter): { items: WorldEvent[]; total: number } {
  let items = state.events.filter(e => e.outcome !== 'REJECTED')
  if (filter.sinceIso) items = items.filter(e => e.occurredAt >= filter.sinceIso!)
  if (filter.type) items = items.filter(e => e.type === filter.type)
  if (filter.agentId) items = items.filter(e => e.agentIds.includes(filter.agentId!))
  if (filter.placeId) items = items.filter(e => e.placeId === filter.placeId)
  if (filter.importantOnly) items = items.filter(e => e.importance === 'high' || e.importance === 'critical')
  const total = items.length
  return { items: items.slice(filter.offset, filter.offset + filter.limit), total }
}

export function getEvent(id: string): WorldEvent | undefined {
  return state.events.find(e => e.id === id)
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
  return { ...state.runtime, queuedEvents: state.queued.length }
}

// --- Simulation tick ---------------------------------------------------------

let timer: ReturnType<typeof setInterval> | null = null

function advanceClock(): void {
  const clock = state.worldState.clock
  const [h, m] = clock.time.split(':').map(Number)
  let totalMinutes = h * 60 + m + 15
  let day = clock.day
  if (totalMinutes >= 24 * 60) {
    totalMinutes -= 24 * 60
    day += 1
  }
  clock.day = day
  clock.time = `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
}

function runTick(): void {
  state.runtime.lastTickAt = new Date().toISOString()
  state.runtime.nextTickAt = new Date(Date.now() + state.runtime.tickIntervalMs).toISOString()
  if (state.runtime.status !== 'RUNNING') return
  advanceClock()
  const next = state.queued.shift()
  if (next) {
    next.occurredAt = new Date().toISOString()
    pushEvent(next)
    state.runtime.callsUsed += 1
    const usage = state.runtime.providerUsage[0]
    usage.calls += 1
    usage.estTokens += 180
    state.season.currentDay = state.worldState.clock.day
  }
  broadcast({ type: 'runtime', payload: publicRuntime() })
}

function scheduleTimer(): void {
  if (timer) clearInterval(timer)
  timer = setInterval(runTick, state.runtime.tickIntervalMs)
}

scheduleTimer()

// --- Admin mutations ----------------------------------------------------------

function logOperator(entry: Omit<OperatorLogEntry, 'id' | 'addedAt'>): void {
  state.runtime.operatorLog.unshift({ id: `oplog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, addedAt: new Date().toISOString(), ...entry })
  state.runtime.operatorLog = state.runtime.operatorLog.slice(0, 100)
}

export function startSeason(): WorldRuntime {
  state.runtime.status = 'RUNNING'
  state.runtime.paused = false
  state.season.status = 'RUNNING'
  scheduleTimer()
  return getAdminRuntime()
}

export function pauseSeason(): WorldRuntime {
  state.runtime.status = 'PAUSED'
  state.runtime.paused = true
  state.season.status = 'PAUSED'
  return getAdminRuntime()
}

export function resumeSeason(): WorldRuntime {
  state.runtime.status = 'RUNNING'
  state.runtime.paused = false
  state.season.status = 'RUNNING'
  return getAdminRuntime()
}

export function endSeason(): WorldRuntime {
  state.runtime.status = 'ENDED'
  state.season.status = 'ENDED'
  state.season.endedAt = new Date().toISOString()
  if (timer) clearInterval(timer)
  return getAdminRuntime()
}

export function setTickInterval(ms: number): WorldRuntime {
  state.runtime.tickIntervalMs = ms
  state.runtime.nextTickAt = new Date(Date.now() + ms).toISOString()
  scheduleTimer()
  return getAdminRuntime()
}

export function setMaxActiveAgents(n: number): WorldRuntime {
  state.runtime.maxActiveAgents = n
  return getAdminRuntime()
}

export function setCallBudget(n: number): WorldRuntime {
  state.runtime.callBudget = n
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
    title: input.title.trim(),
    summary: input.summary.trim(),
    stateChanges: [],
    importance: (input.importance as WorldEvent['importance']) ?? 'normal',
    relatedEventIds: [],
    operator: { addedBy: input.addedBy, addedAt: new Date().toISOString() },
  }
  pushEvent(event)
  // Operator events are never part of a hand-authored scene, so narrate one immediately via the
  // fallback NARRATOR path instead of waiting on emitReadyScenes() (which only fires for
  // pre-defined QUEUED_SCENES).
  const scene = mockNarrator.narrateFallbackScene([event], placesById(), agentsById())
  state.scenes.push(scene)
  broadcast({ type: 'scene', payload: scene })
  logOperator({ addedBy: input.addedBy, eventId: event.id, summary: event.title })
  return { ok: true, event }
}

export function listOperatorLog(): OperatorLogEntry[] {
  return state.runtime.operatorLog
}

export function recordRuntimeError(scope: string, message: string): void {
  const error: RuntimeError = { id: `err-${Date.now()}`, occurredAt: new Date().toISOString(), scope, message }
  state.runtime.recentErrors.unshift(error)
  state.runtime.recentErrors = state.runtime.recentErrors.slice(0, 50)
  state.runtime.failedJobs += 1
}

export type { ProviderUsage }
