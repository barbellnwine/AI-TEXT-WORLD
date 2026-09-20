import type {
  AdminWorldRuntime,
  Agent,
  Chapter,
  ChronicleEntry,
  CurrentWorldResponse,
  EventListResponse,
  Faction,
  OperatorLogEntry,
  Place,
  PublicWorldRuntime,
  Season,
  SceneListResponse,
  WorldEvent,
} from './types'

const ADMIN_TOKEN_KEY = 'worldAdminToken'

export function getWorldAdminToken(): string {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setWorldAdminToken(token: string): void {
  try {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token)
  } catch {
    /* private-mode browsers may block storage; admin session simply won't persist */
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: 'no-store' })
  if (!res.ok) throw new Error(`request failed: ${res.status}`)
  return (await res.json()) as T
}

async function adminRequest<T>(url: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-admin-token': getWorldAdminToken() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.error ?? `admin request failed: ${res.status}`)
  }
  return (await res.json()) as T
}

export interface EventQuery {
  hours?: number
  type?: string
  agentId?: string
  placeId?: string
  importantOnly?: boolean
  limit?: number
  offset?: number
}

export const worldApi = {
  current: (signal?: AbortSignal) => getJson<CurrentWorldResponse>('/api/world/current', signal),
  runtime: (signal?: AbortSignal) => getJson<PublicWorldRuntime>('/api/world/runtime', signal),
  events: (query: EventQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (query.hours) params.set('hours', String(query.hours))
    if (query.type) params.set('type', query.type)
    if (query.agentId) params.set('agentId', query.agentId)
    if (query.placeId) params.set('placeId', query.placeId)
    if (query.importantOnly) params.set('importantOnly', 'true')
    params.set('limit', String(query.limit ?? 30))
    params.set('offset', String(query.offset ?? 0))
    return getJson<EventListResponse>(`/api/world/events?${params.toString()}`, signal)
  },
  event: (id: string) => getJson<{ event: WorldEvent }>(`/api/world/events/${encodeURIComponent(id)}`),
  scenes: (query: { before?: string; importantOnly?: boolean; limit?: number }, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (query.before) params.set('before', query.before)
    if (query.importantOnly) params.set('importantOnly', 'true')
    params.set('limit', String(query.limit ?? 2))
    return getJson<SceneListResponse>(`/api/world/scenes?${params.toString()}`, signal)
  },
  scene: (id: string) => getJson<{ scene: ChronicleEntry }>(`/api/world/scenes/${encodeURIComponent(id)}`),
  places: (signal?: AbortSignal) => getJson<{ places: Place[] }>('/api/world/places', signal),
  place: (id: string) => getJson<{ place: Place; recentEvents: WorldEvent[] }>(`/api/world/places/${encodeURIComponent(id)}`),
  agents: (signal?: AbortSignal) => getJson<{ agents: Agent[] }>('/api/world/agents', signal),
  agent: (id: string) => getJson<{ agent: Agent; keyEvents: WorldEvent[] }>(`/api/world/agents/${encodeURIComponent(id)}`),
  factions: (signal?: AbortSignal) => getJson<{ factions: Faction[] }>('/api/world/factions', signal),
  chronicle: (signal?: AbortSignal) => getJson<{ chapters: Chapter[] }>('/api/world/chronicle', signal),
  seasons: (signal?: AbortSignal) => getJson<{ seasons: Season[] }>('/api/world/seasons', signal),
  season: (id: string) => getJson<{ season: Season }>(`/api/world/seasons/${encodeURIComponent(id)}`),
}

export const worldAdminApi = {
  runtime: () => adminRequest<{ runtime: AdminWorldRuntime; season: Season; operatorLog: OperatorLogEntry[] }>('/api/admin/world/runtime', 'GET'),
  start: () => adminRequest<{ runtime: AdminWorldRuntime }>('/api/admin/world/start', 'POST'),
  pause: () => adminRequest<{ runtime: AdminWorldRuntime }>('/api/admin/world/pause', 'POST'),
  resume: () => adminRequest<{ runtime: AdminWorldRuntime }>('/api/admin/world/resume', 'POST'),
  end: () => adminRequest<{ runtime: AdminWorldRuntime }>('/api/admin/world/end', 'POST'),
  setTickInterval: (ms: number) => adminRequest<{ runtime: AdminWorldRuntime }>('/api/admin/world/tick-interval', 'POST', { ms }),
  setMaxAgents: (maxActiveAgents: number) => adminRequest<{ runtime: AdminWorldRuntime }>('/api/admin/world/max-agents', 'POST', { maxActiveAgents }),
  setCallBudget: (callBudget: number) => adminRequest<{ runtime: AdminWorldRuntime }>('/api/admin/world/call-budget', 'POST', { callBudget }),
  addEvent: (body: { placeId: string; agentIds: string[]; title: string; summary: string; importance?: string }) =>
    adminRequest<{ event: WorldEvent } | { error: string; details: string[] }>('/api/admin/world/events', 'POST', body),
  operatorLog: () => adminRequest<{ entries: OperatorLogEntry[] }>('/api/admin/world/operator-log', 'GET'),
}
