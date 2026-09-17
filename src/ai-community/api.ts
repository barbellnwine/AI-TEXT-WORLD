import type { AgentProfileResponse, FeedItem, PostDetail, PublicAgent, StatusResponse } from './types'

const ADMIN_TOKEN_KEY = 'aiCommunityAdminToken'

export function getAdminToken(): string {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setAdminToken(token: string): void {
  try {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token)
  } catch {
    /* private-mode browsers may block storage; admin session simply won't persist */
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`request failed: ${res.status}`)
  return (await res.json()) as T
}

async function adminRequest<T>(url: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-admin-token': getAdminToken() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`admin request failed: ${res.status}`)
  return (await res.json()) as T
}

export const api = {
  status: () => getJson<StatusResponse>('/api/ai-community/status'),
  agents: () => getJson<{ agents: PublicAgent[] }>('/api/ai-community/agents'),
  agent: (id: string) => getJson<AgentProfileResponse>(`/api/ai-community/agents/${encodeURIComponent(id)}`),
  feed: (params: { agentId?: string; action?: string; offset?: number }) => {
    const query = new URLSearchParams()
    if (params.agentId) query.set('agentId', params.agentId)
    if (params.action) query.set('action', params.action)
    if (params.offset) query.set('offset', String(params.offset))
    return getJson<{ items: FeedItem[] }>(`/api/ai-community/feed?${query.toString()}`)
  },
  post: (id: string) => getJson<PostDetail>(`/api/ai-community/posts/${encodeURIComponent(id)}`),
}

export const adminApi = {
  status: () => adminRequest<{ runtime: { status: string; demo_mode: number }; openaiConfigured: boolean; anthropicConfigured: boolean; communityEnabled: boolean }>(
    '/api/ai-community/admin/status',
    'GET'
  ),
  agents: () => adminRequest<{ agents: Array<{ id: string; name: string; provider: string; active: number; status: string; cooldown_until: string | null; total_actions: number }> }>(
    '/api/ai-community/admin/agents',
    'GET'
  ),
  settings: () => adminRequest<{ weeklyBudgetKrw: number; safetyMargin: number; usdToKrwRate: number; pricing: Array<{ provider: string; model: string; inputUsdPerMTok: number; outputUsdPerMTok: number }> }>(
    '/api/ai-community/admin/settings',
    'GET'
  ),
  usage: () => adminRequest<{ ledger: Record<string, number> }>('/api/ai-community/admin/usage', 'GET'),
  logs: (errorsOnly = false) => adminRequest<{ logs: Array<Record<string, unknown>> }>(`/api/ai-community/admin/logs?limit=100${errorsOnly ? '&errorsOnly=true' : ''}`, 'GET'),
  start: () => adminRequest('/api/ai-community/admin/start', 'POST'),
  pause: () => adminRequest('/api/ai-community/admin/pause', 'POST'),
  stop: () => adminRequest('/api/ai-community/admin/stop', 'POST'),
  kill: () => adminRequest('/api/ai-community/admin/kill', 'POST'),
  tick: () => adminRequest('/api/ai-community/admin/tick', 'POST'),
  setMode: (demoMode: boolean) => adminRequest('/api/ai-community/admin/mode', 'POST', { demoMode }),
  toggleAgent: (id: string, active: boolean) => adminRequest(`/api/ai-community/admin/agents/${encodeURIComponent(id)}/toggle`, 'POST', { active }),
  updateSettings: (body: { weeklyBudgetKrw?: number; safetyMargin?: number; usdToKrwRate?: number }) =>
    adminRequest('/api/ai-community/admin/settings', 'POST', body),
}
