import { Router, sendJson, paginationNumber, HttpError } from '../http.ts'
import * as store from '../domain/worldStore.ts'
import type { WorldEvent } from '../domain/worldTypes.ts'

function num(value: string | null, fallback: number): number {
  if (value === null) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// provenance (provider/model/prompt version/validation notes) is server-internal bookkeeping for
// a future real NARRATOR/AGENT call — never sent to any public response, per the "프론트엔드 보안"
// requirement. Strip it here rather than trusting every call site to remember to.
function toPublicEvent(event: WorldEvent): Omit<WorldEvent, 'provenance'> {
  const { provenance: _provenance, ...publicEvent } = event
  return publicEvent
}

export function registerWorldRoutes(router: Router): void {
  router.get('/api/world/current', ctx => {
    const spotlight = store.getSpotlightEvent()
    sendJson(ctx.res, 200, {
      season: store.getSeason(),
      worldState: store.getWorldState(),
      spotlightEvent: spotlight ? toPublicEvent(spotlight) : null,
    })
  })

  router.get('/api/world/runtime', ctx => {
    sendJson(ctx.res, 200, store.getPublicRuntime())
  })

  router.get('/api/world/events', ctx => {
    const hours = ctx.query.get('hours')
    const sinceIso = hours ? new Date(Date.now() - num(hours, 24) * 3_600_000).toISOString() : ctx.query.get('since') ?? undefined
    const limit = paginationNumber(ctx.query.get('limit'), 30, 1, 100)
    const offset = paginationNumber(ctx.query.get('offset'), 0, 0, 10_000)
    const { items, total } = store.listEvents({
      sinceIso,
      type: ctx.query.get('type') ?? undefined,
      agentId: ctx.query.get('agentId') ?? undefined,
      placeId: ctx.query.get('placeId') ?? undefined,
      importantOnly: ctx.query.get('importantOnly') === 'true',
      limit,
      offset,
    })
    sendJson(ctx.res, 200, { items: items.map(toPublicEvent), total, hasMore: offset + items.length < total })
  })

  router.get('/api/world/events/:id', ctx => {
    const event = store.getEvent(ctx.params.id)
    if (!event) throw new HttpError(404, 'event_not_found')
    sendJson(ctx.res, 200, { event: toPublicEvent(event) })
  })

  // Scene-level narrative feed — this is what the main reading page renders. Cursor-paginated by
  // createdAt so "이전 기록 불러오기" can page backwards through history.
  router.get('/api/world/scenes', ctx => {
    const limit = paginationNumber(ctx.query.get('limit'), 2, 1, 50)
    const { items, hasMore } = store.listScenes({
      beforeCreatedAt: ctx.query.get('before') ?? undefined,
      importantOnly: ctx.query.get('importantOnly') === 'true',
      limit,
    })
    sendJson(ctx.res, 200, { items, hasMore })
  })

  router.get('/api/world/scenes/:id', ctx => {
    const scene = store.getScene(ctx.params.id)
    if (!scene) throw new HttpError(404, 'scene_not_found')
    sendJson(ctx.res, 200, { scene })
  })

  router.get('/api/world/places', ctx => {
    sendJson(ctx.res, 200, { places: store.listPlaces() })
  })

  router.get('/api/world/places/:id', ctx => {
    const place = store.getPlace(ctx.params.id)
    if (!place) throw new HttpError(404, 'place_not_found')
    const recentEvents = place.recentEventIds.map(id => store.getEvent(id)).filter((e): e is WorldEvent => Boolean(e)).map(toPublicEvent)
    sendJson(ctx.res, 200, { place, recentEvents })
  })

  router.get('/api/world/agents', ctx => {
    sendJson(ctx.res, 200, { agents: store.listAgents() })
  })

  router.get('/api/world/agents/:id', ctx => {
    const agentRecord = store.getAgent(ctx.params.id)
    if (!agentRecord) throw new HttpError(404, 'agent_not_found')
    // hiddenNotes only ever exists server-side — strip it before it can leak to a public response.
    const { hiddenNotes: _hiddenNotes, ...publicAgent } = agentRecord
    const keyEvents = agentRecord.keyEventIds.map(id => store.getEvent(id)).filter((e): e is WorldEvent => Boolean(e)).map(toPublicEvent)
    sendJson(ctx.res, 200, { agent: publicAgent, keyEvents })
  })

  router.get('/api/world/factions', ctx => {
    sendJson(ctx.res, 200, { factions: store.listFactions() })
  })

  router.get('/api/world/chronicle', ctx => {
    sendJson(ctx.res, 200, { chapters: store.listChapters() })
  })

  router.get('/api/world/seasons', ctx => {
    sendJson(ctx.res, 200, { seasons: store.listSeasons() })
  })

  router.get('/api/world/seasons/:id', ctx => {
    const season = store.getSeasonById(ctx.params.id)
    if (!season) throw new HttpError(404, 'season_not_found')
    sendJson(ctx.res, 200, { season })
  })

  router.get('/api/world/stream', ctx => {
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
