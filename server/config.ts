try {
  // Node 20.6+. Silently ignored if .env is absent — real deployments may inject env vars directly.
  process.loadEnvFile()
} catch {
  /* no .env file present, fall back to already-set process.env */
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return value === 'true' || value === '1'
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return value !== undefined && Number.isFinite(parsed) ? parsed : fallback
}

export const config = {
  port: num(process.env.PORT, 8787),
  dbPath: process.env.AI_COMMUNITY_DB_PATH ?? 'data/ai-community.sqlite',
  adminToken: process.env.AI_COMMUNITY_ADMIN_TOKEN ?? '',

  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001',

  communityEnabled: bool(process.env.AI_COMMUNITY_ENABLED, false),
  demoMode: bool(process.env.AI_COMMUNITY_DEMO_MODE, true),

  weeklyBudgetKrw: num(process.env.AI_COMMUNITY_WEEKLY_BUDGET_KRW, 10000),
  budgetSafetyMargin: num(process.env.AI_COMMUNITY_BUDGET_SAFETY_MARGIN, 0.1),
  budgetTimezone: process.env.AI_COMMUNITY_BUDGET_TIMEZONE ?? 'Asia/Seoul',
  weekStartDay: process.env.AI_COMMUNITY_WEEK_START_DAY ?? 'MONDAY',
  usdToKrwRate: num(process.env.USD_TO_KRW_RATE, 1400),

  tickIntervalMs: num(process.env.AI_COMMUNITY_TICK_INTERVAL_MS, 45_000),
  maxOutputTokens: num(process.env.AI_COMMUNITY_MAX_OUTPUT_TOKENS, 400),
  maxInputContextTokens: num(process.env.AI_COMMUNITY_MAX_INPUT_TOKENS, 2000),
  requestTimeoutMs: num(process.env.AI_COMMUNITY_REQUEST_TIMEOUT_MS, 20_000),
  maxRetries: num(process.env.AI_COMMUNITY_MAX_RETRIES, 1),
  cooldownMs: num(process.env.AI_COMMUNITY_COOLDOWN_MS, 5 * 60_000),
  maxConsecutivePicks: 3,
}

// Default per-1M-token USD prices. Editable at runtime via ai_model_pricing (admin settings).
export const DEFAULT_PRICING: Array<{ provider: 'openai' | 'anthropic'; model: string; inputUsdPerMTok: number; outputUsdPerMTok: number }> = [
  { provider: 'openai', model: config.openaiModel, inputUsdPerMTok: 0.4, outputUsdPerMTok: 1.6 },
  { provider: 'anthropic', model: config.anthropicModel, inputUsdPerMTok: 1.0, outputUsdPerMTok: 5.0 },
]
