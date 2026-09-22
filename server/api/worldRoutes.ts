import { Router, sendJson, paginationNumber, HttpError } from '../http.ts'
import type { DatabaseSync } from 'node:sqlite'
import { requireAdminRole } from './userAuth.ts'
import * as store from '../domain/worldStore.ts'
import type { WorldEvent } from '../domain/worldTypes.ts'

function num(value: string | null, fallback: number): number {
  if (value === null) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

import { toPublicAgent, toPublicEvent, toPublicWorld } from '../world/publicView.ts'

export function registerWorldRoutes(router: Router, db?: DatabaseSync): void {
  const get = (path: string, handler: Parameters<Router['get']>[1]) => router.get(path, ctx => {
    if (!store.isWorldPublic()) {
      if (!db) { sendJson(ctx.res, 403, { error: 'private_world' }); return }
      if (!requireAdminRole(ctx, db)) return
    }
    return handler(ctx)
  })
  get('/api/world/current', ctx => {
    const spotlight = store.getSpotlightEvent()
    sendJson(ctx.res, 200, {
      season: store.getSeason(),
      worldState: toPublicWorld(store.getWorldState()),
      spotlightEvent: spotlight ? toPublicEvent(spotlight) : null,
    })
  })

  get('/api/world/runtime', ctx => {
    sendJson(ctx.res, 200, store.getPublicRuntime())
  })

  get('/api/world/events', ctx => {
    const hours = ctx.query.get('hours')
    const sinceIso = hours ? new Date(Date.now() - num(hours, 24) * 3_600_000).toISOString() : ctx.query.get('since') ?? undefined
    const limit = paginationNumber(ctx.query.get('limit'), 30, 1, 100)
    const offset = paginationNumber(ctx.query.get('offset'), 0, 0, 10_000)
    const { items, total } = store.listEvents({
      sinceIso,
      beforeId: ctx.query.get('before') ?? undefined,
      type: ctx.query.get('type') ?? undefined,
      agentId: ctx.query.get('agentId') ?? undefined,
      placeId: ctx.query.get('placeId') ?? undefined,
      importantOnly: ctx.query.get('importantOnly') === 'true',
      limit,
      offset,
    })
    sendJson(ctx.res, 200, { items: items.map(toPublicEvent), total, hasMore: ctx.query.has('before') ? items.length === limit : offset + items.length < total })
  })

  get('/api/world/events/:id', ctx => {
    const event = store.getEvent(ctx.params.id)
    if (!event || event.outcome === 'REJECTED' || event.visibility === 'private') throw new HttpError(404, 'event_not_found')
    sendJson(ctx.res, 200, { event: toPublicEvent(event) })
  })

  get('/api/world/away', ctx => {
    const since = ctx.query.get('since') ?? ''
    if (!Number.isFinite(Date.parse(since))) throw new HttpError(400, 'invalid_since')
    sendJson(ctx.res, 200, store.awaySummary(new Date(since).toISOString()))
  })

  // Scene-level narrative feed — this is what the main reading page renders. Cursor-paginated by
  // createdAt so "이전 기록 불러오기" can page backwards through history.
  get('/api/world/scenes', ctx => {
    const limit = paginationNumber(ctx.query.get('limit'), 2, 1, 50)
    const { items, hasMore } = store.listScenes({
      beforeCreatedAt: ctx.query.get('before') ?? undefined,
      importantOnly: ctx.query.get('importantOnly') === 'true',
      limit,
    })
    sendJson(ctx.res, 200, { items, hasMore })
  })

  get('/api/world/scenes/:id', ctx => {
    const scene = store.getScene(ctx.params.id)
    if (!scene) throw new HttpError(404, 'scene_not_found')
    sendJson(ctx.res, 200, { scene })
  })

  get('/api/world/places', ctx => {
    sendJson(ctx.res, 200, { places: toPublicWorld(store.getWorldState()).places })
  })

  get('/api/world/places/:id', ctx => {
    const place = toPublicWorld(store.getWorldState()).places.find(p => p.id === ctx.params.id)
    if (!place) throw new HttpError(404, 'place_not_found')
    const recentEvents = place.recentEventIds.map(id => store.getEvent(id)).filter((e): e is WorldEvent => Boolean(e && e.visibility !== 'private' && e.outcome !== 'REJECTED')).map(toPublicEvent)
    sendJson(ctx.res, 200, { place, recentEvents })
  })

  get('/api/world/agents', ctx => {
    sendJson(ctx.res, 200, { agents: store.listAgents().map(toPublicAgent) })
  })

  get('/api/world/agents/:id', ctx => {
    const agentRecord = store.getAgent(ctx.params.id)
    if (!agentRecord) throw new HttpError(404, 'agent_not_found')
    const keyEvents = agentRecord.keyEventIds.map(id => store.getEvent(id)).filter((e): e is WorldEvent => Boolean(e && e.visibility !== 'private' && e.outcome !== 'REJECTED')).map(toPublicEvent)
    sendJson(ctx.res, 200, { agent: toPublicAgent(agentRecord), keyEvents })
  })

  get('/api/world/factions', ctx => {
    sendJson(ctx.res, 200, { factions: store.listFactions() })
  })

  get('/api/world/chronicle', ctx => {
    sendJson(ctx.res, 200, { chapters: store.listChapters() })
  })

  get('/api/world/seasons', ctx => {
    sendJson(ctx.res, 200, { seasons: store.listSeasons() })
  })

  get('/api/world/seasons/:id', ctx => {
    const season = store.getSeasonById(ctx.params.id)
    if (!season) throw new HttpError(404, 'season_not_found')
    sendJson(ctx.res, 200, { season })
  })

  get('/api/world/stream', ctx => {
    ctx.res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    ctx.res.write('retry: 4000\n\n')
    const unsubscribe = store.subscribeStream(ctx.res)
    const heartbeat = setInterval(() => {
      try {
        ctx.res.write(': ping\n\n')
      } catch {
        clearInterval(heartbeat)
      }
    }, 25_000)
    ctx.req.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })
}
