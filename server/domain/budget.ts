import type { DatabaseSync } from 'node:sqlite'
import { config, DEFAULT_PRICING } from '../config.ts'
import type { ModelPricing, Provider } from './types.ts'

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

export function getCurrentMonthKey(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 7)
}

// Monday 00:00 KST of the week containing `now`, formatted as YYYY-MM-DD. Used as the ledger's primary key
// so "this week" always means the same Mon..Sun-KST bucket regardless of server-local timezone.
export function getCurrentWeekKey(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS)
  const dayOfWeek = kst.getUTCDay() // 0 = Sunday .. 6 = Saturday, evaluated on the KST-shifted instant
  const daysSinceMonday = (dayOfWeek + 6) % 7
  const monday = new Date(kst.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000)
  const y = monday.getUTCFullYear()
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0')
  const d = String(monday.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function usdToKrw(usd: number, rate: number = config.usdToKrwRate): number {
  return usd * rate
}

export function ensurePricingSeeded(db: DatabaseSync): void {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO ai_model_pricing (provider, model, input_usd_per_mtok, output_usd_per_mtok) VALUES (?, ?, ?, ?)'
  )
  for (const p of DEFAULT_PRICING) insert.run(p.provider, p.model, p.inputUsdPerMTok, p.outputUsdPerMTok)
}

export function getPricing(db: DatabaseSync, provider: Provider, model: string): ModelPricing | null {
  const floor = DEFAULT_PRICING.find(p => p.provider === provider && p.model === model)
  if (!floor) return null // Unknown models must not inherit an invented low price.
  const row = db
    .prepare('SELECT provider, model, input_usd_per_mtok AS inputUsdPerMTok, output_usd_per_mtok AS outputUsdPerMTok FROM ai_model_pricing WHERE provider = ? AND model = ?')
    .get(provider, model) as { provider: Provider; model: string; inputUsdPerMTok: number; outputUsdPerMTok: number } | undefined
  if (!row) return null
  return { ...row,
    inputUsdPerMTok: Math.max(floor.inputUsdPerMTok, row.inputUsdPerMTok),
    outputUsdPerMTok: Math.max(floor.outputUsdPerMTok, row.outputUsdPerMTok),
  }
}

export function setPricing(db: DatabaseSync, pricing: ModelPricing): void {
  db.prepare(
    `INSERT INTO ai_model_pricing (provider, model, input_usd_per_mtok, output_usd_per_mtok) VALUES (?, ?, ?, ?)
     ON CONFLICT(provider, model) DO UPDATE SET input_usd_per_mtok = excluded.input_usd_per_mtok, output_usd_per_mtok = excluded.output_usd_per_mtok`
  ).run(pricing.provider, pricing.model, pricing.inputUsdPerMTok, pricing.outputUsdPerMTok)
}

export function estimateCostUsd(pricing: ModelPricing, inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * pricing.inputUsdPerMTok + (outputTokens / 1_000_000) * pricing.outputUsdPerMTok
}

export function getSetting(db: DatabaseSync, key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM ai_settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? fallback
}

export function setSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO ai_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  ).run(key, value)
}

export function getWeeklyBudgetKrw(db: DatabaseSync): number {
  return Math.min(config.weeklyBudgetKrw, Number(getSetting(db, 'weekly_budget_krw', String(config.weeklyBudgetKrw))))
}

export function getMonthlyBudgetKrw(db: DatabaseSync): number {
  return Math.min(config.monthlyBudgetKrw, Number(getSetting(db, 'monthly_budget_krw', String(config.monthlyBudgetKrw))))
}

export function getSafetyMargin(db: DatabaseSync): number {
  return Math.max(config.budgetSafetyMargin, Number(getSetting(db, 'budget_safety_margin', String(config.budgetSafetyMargin))))
}

export function getUsdToKrwRate(db: DatabaseSync): number {
  return Math.max(config.usdToKrwRate, Number(getSetting(db, 'usd_to_krw_rate', String(config.usdToKrwRate))))
}

// A prepaid allowance never resets with the week/month. Counts all locally recorded paid calls.
export function getPrepaidBudget(db: DatabaseSync) {
  const row = db.prepare('SELECT COALESCE(SUM(reserved_usd + settled_usd), 0) AS committed FROM ai_monthly_budgets').get() as { committed: number }
  const limitUsd = config.prepaidBudgetUsd
  const thresholdUsd = limitUsd === null ? null : limitUsd * (1 - getSafetyMargin(db))
  return { limitUsd, thresholdUsd, committedUsd: row.committed, remainingUsd: thresholdUsd === null ? null : Math.max(0, thresholdUsd - row.committed) }
}

interface WeeklyLedgerRow {
  week_key: string
  reserved_krw: number
  settled_krw: number
  reserved_usd: number
  settled_usd: number
  openai_settled_krw: number
  anthropic_settled_krw: number
}

function ensureWeekRow(db: DatabaseSync, weekKey: string): void {
  db.prepare('INSERT OR IGNORE INTO ai_weekly_budgets (week_key) VALUES (?)').run(weekKey)
}

export function getWeeklyLedger(db: DatabaseSync, weekKey: string = getCurrentWeekKey()): WeeklyLedgerRow {
  ensureWeekRow(db, weekKey)
  return db.prepare('SELECT * FROM ai_weekly_budgets WHERE week_key = ?').get(weekKey) as unknown as WeeklyLedgerRow
}

export function getMonthlyLedger(db: DatabaseSync, monthKey = getCurrentMonthKey()) {
  db.prepare('INSERT OR IGNORE INTO ai_monthly_budgets (month_key) VALUES (?)').run(monthKey)
  return db.prepare('SELECT * FROM ai_monthly_budgets WHERE month_key = ?').get(monthKey) as unknown as
    Omit<WeeklyLedgerRow, 'week_key'> & { month_key: string }
}

export interface BudgetCheck {
  allowed: boolean
  weekKey: string
  budgetKrw: number
  thresholdKrw: number
  committedKrw: number
  remainingKrw: number
  monthKey: string
  monthlyBudgetKrw: number
  monthlyThresholdKrw: number
  monthlyCommittedKrw: number
  monthlyRemainingKrw: number
}

// budgetKrw * (1 - safetyMargin) is the hard ceiling: at 10,000 KRW budget and 10% margin, new calls
// stop once committed spend (settled + already-reserved) would reach 9,000 KRW.
export function checkBudget(db: DatabaseSync, estimatedMaxKrw: number, now = new Date()): BudgetCheck {
  const weekKey = getCurrentWeekKey(now)
  const monthKey = getCurrentMonthKey(now)
  const ledger = getWeeklyLedger(db, weekKey)
  const budgetKrw = getWeeklyBudgetKrw(db)
  const margin = getSafetyMargin(db)
  const thresholdKrw = budgetKrw * (1 - margin)
  const committedKrw = ledger.reserved_krw + ledger.settled_krw
  const remainingKrw = thresholdKrw - committedKrw
  const monthly = getMonthlyLedger(db, monthKey)
  const monthlyBudgetKrw = getMonthlyBudgetKrw(db)
  const monthlyThresholdKrw = monthlyBudgetKrw * (1 - margin)
  const monthlyCommittedKrw = monthly.reserved_krw + monthly.settled_krw
  const prepaid = getPrepaidBudget(db)
  return {
    allowed: Number.isFinite(estimatedMaxKrw) && estimatedMaxKrw >= 0 &&
      committedKrw + estimatedMaxKrw <= thresholdKrw &&
      (prepaid.thresholdUsd === null || prepaid.committedUsd + estimatedMaxKrw / getUsdToKrwRate(db) <= prepaid.thresholdUsd) &&
      monthlyCommittedKrw + estimatedMaxKrw <= monthlyThresholdKrw,
    weekKey,
    budgetKrw,
    thresholdKrw,
    committedKrw,
    remainingKrw,
    monthKey,
    monthlyBudgetKrw,
    monthlyThresholdKrw,
    monthlyCommittedKrw,
    monthlyRemainingKrw: monthlyThresholdKrw - monthlyCommittedKrw,
  }
}

// Reserve the worst-case cost before calling a provider. Must be paired with settleReservation
// (success) or releaseReservation (failure) so reserved_krw never leaks.
export function reserveBudget(db: DatabaseSync, weekKey: string, reserveKrw: number, reserveUsd: number, monthKey = getCurrentMonthKey()): void {
  updateBothLedgers(db, weekKey, monthKey, (table, column, key) => {
    db.prepare(`UPDATE ${table} SET reserved_krw = reserved_krw + ?, reserved_usd = reserved_usd + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE ${column} = ?`)
      .run(reserveKrw, reserveUsd, key)
  })
}

export function settleReservation(
  db: DatabaseSync,
  weekKey: string,
  reservedKrw: number,
  reservedUsd: number,
  actualKrw: number,
  actualUsd: number,
  provider: Provider,
  monthKey = getCurrentMonthKey()
): void {
  const providerColumn = provider === 'openai' ? 'openai_settled_krw' : 'anthropic_settled_krw'
  updateBothLedgers(db, weekKey, monthKey, (table, column, key) => {
  db.prepare(
    `UPDATE ${table}
     SET reserved_krw = MAX(0, reserved_krw - ?),
         reserved_usd = MAX(0, reserved_usd - ?),
         settled_krw = settled_krw + ?,
         settled_usd = settled_usd + ?,
         ${providerColumn} = ${providerColumn} + ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE ${column} = ?`
  ).run(reservedKrw, reservedUsd, actualKrw, actualUsd, actualKrw, key)
  })
}

export function releaseReservation(db: DatabaseSync, weekKey: string, reservedKrw: number, reservedUsd: number, monthKey = getCurrentMonthKey()): void {
  updateBothLedgers(db, weekKey, monthKey, (table, column, key) => {
    db.prepare(`UPDATE ${table} SET reserved_krw = MAX(0, reserved_krw - ?), reserved_usd = MAX(0, reserved_usd - ?), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE ${column} = ?`)
      .run(reservedKrw, reservedUsd, key)
  })
}

function updateBothLedgers(db: DatabaseSync, weekKey: string, monthKey: string,
  update: (table: string, column: string, key: string) => void): void {
  db.exec('SAVEPOINT budget_ledgers')
  try {
    ensureWeekRow(db, weekKey)
    getMonthlyLedger(db, monthKey)
    update('ai_weekly_budgets', 'week_key', weekKey)
    update('ai_monthly_budgets', 'month_key', monthKey)
    db.exec('RELEASE budget_ledgers')
  } catch (error) {
    db.exec('ROLLBACK TO budget_ledgers; RELEASE budget_ledgers')
    throw error
  }
}
