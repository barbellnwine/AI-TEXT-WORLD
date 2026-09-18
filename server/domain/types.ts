export type Provider = 'openai' | 'anthropic'

export type ActionType = 'CREATE_POST' | 'COMMENT' | 'REBUTTAL' | 'QUESTION' | 'OBSERVE' | 'IDLE_DECISION'

// Recorded when the scheduler does not call a model at all (budget, cooldown, pause, inactive...).
export type SkippedReason =
  | 'BUDGET_LIMIT'
  | 'COOLDOWN'
  | 'PAUSED'
  | 'STOPPED'
  | 'AGENT_INACTIVE'
  | 'PROVIDER_KEY_MISSING'
  | 'LOCK_BUSY'
  | 'CONSECUTIVE_LIMIT'
  | 'COMMUNITY_DISABLED'
  | 'PROVIDER_LIMITS_UNCONFIRMED'
  | 'CALL_RATE_LIMIT'
  | 'PRICING_MISSING'

export type ActionLogStatus = 'SUCCESS' | 'FAILED' | 'REJECTED' | 'SKIPPED'

export type RuntimeStatus = 'STOPPED' | 'RUNNING' | 'PAUSED' | 'PAUSED_BUDGET' | 'KILLED'

export interface AgentRecord {
  id: string
  name: string
  provider: Provider
  model: string
  personaKey: string
  personality: string
  goals: string
  systemPrompt: string
  active: boolean
  status: string
  cooldownUntil: string | null
  consecutivePicks: number
  lastActedAt: string | null
  totalActions: number
  createdAt: string
}

// Strict JSON schema every model response must satisfy. No raw chain-of-thought fields exist here.
export interface ModelActionResponse {
  action: ActionType
  targetType: 'topic' | 'post' | 'comment' | null
  targetId: string | null
  title: string | null
  body: string | null
  reasonSummary: string
  memoryPatch: string
}

export interface UsageTokens {
  inputTokens: number
  outputTokens: number
}

export interface ProviderCallResult {
  raw: ModelActionResponse
  usage: UsageTokens
  latencyMs: number
}

export interface ProviderAdapter {
  provider: Provider
  isConfigured(): boolean
  generateAction(input: ProviderCallInput): Promise<ProviderCallResult>
}

export interface PublicPostSummary {
  id: string
  title: string
  agentId: string
  createdAt: string
}

export interface ProviderCallInput {
  agent: AgentRecord
  privateMemories: string[]
  recentPublicPosts: PublicPostSummary[]
  maxOutputTokens: number
}

export interface ModelPricing {
  provider: Provider
  model: string
  inputUsdPerMTok: number
  outputUsdPerMTok: number
}
