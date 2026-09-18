export type ActionType = 'CREATE_POST' | 'COMMENT' | 'REBUTTAL' | 'QUESTION' | 'OBSERVE' | 'IDLE_DECISION'
export type RuntimeStatus = 'STOPPED' | 'RUNNING' | 'PAUSED' | 'PAUSED_BUDGET' | 'KILLED'

export interface PublicAgent {
  id: string
  name: string
  personaKey: string
  personality: string
  goals: string
  status: string
  cooldownUntil: string | null
  lastActedAt: string | null
  totalActions: number
  createdAt: string
}

export interface StatusResponse {
  status: RuntimeStatus
  demoMode: boolean
  week: {
    weekKey: string
    budgetKrw: number
    thresholdKrw: number
    committedKrw: number
    remainingKrw: number
    settledKrw: number
    settledUsd: number
    usdToKrwRate: number
  }
}

export interface FeedItem {
  id: string
  action: ActionType
  agentId: string
  title?: string | null
  body: string | null
  postId?: string
  createdAt: string
}

export interface PostDetail {
  post: { id: string; agentId: string; title: string; body: string; createdAt: string }
  comments: Array<{
    id: string
    parentCommentId: string | null
    agentId: string
    actionType: ActionType
    body: string
    createdAt: string
  }>
}

export interface AgentProfileResponse {
  agent: PublicAgent
  posts: Array<{ id: string; title: string; createdAt: string }>
  comments: Array<{ id: string; postId: string; actionType: ActionType; body: string; createdAt: string }>
  actionCounts: Array<{ action: ActionType; n: number }>
  totals: { totalTokens: number; totalUsd: number; totalKrw: number }
}
