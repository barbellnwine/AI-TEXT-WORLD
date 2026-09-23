import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { config } from '../server/config.ts'
import { getPrepaidBudget } from '../server/domain/budget.ts'
import { migrate } from '../server/db/connection.ts'
import { seedAgents } from '../server/domain/agentsSeed.ts'
import {
  checkBudget, getCurrentMonthKey, getCurrentWeekKey, getMonthlyLedger,
  getWeeklyLedger, reserveBudget, settleReservation, releaseReservation, setSetting,
} from '../server/domain/budget.ts'

function freshDb() {
  config.prepaidBudgetUsd = null
  const db = new DatabaseSync(':memory:')
  migrate(db)
  setSetting(db, 'monthly_budget_krw', '40000')
  setSetting(db, 'weekly_budget_krw', '10000')
  setSetting(db, 'budget_safety_margin', '0.2')
  return db
}

test('monthly ledger rolls at midnight in Seoul, including December', () => {
  assert.equal(getCurrentMonthKey(new Date('2026-09-30T14:59:59.999Z')), '2026-09')
  assert.equal(getCurrentMonthKey(new Date('2026-09-30T15:00:00.000Z')), '2026-10')
  assert.equal(getCurrentMonthKey(new Date('2026-12-31T15:00:00.000Z')), '2027-01')
})

test('fifth week is blocked by monthly cap even with fresh weekly allowance', () => {
  const db = freshDb()
  try {
    for (const date of ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23']) {
      const now = new Date(`${date}T03:00:00Z`)
      const budget = checkBudget(db, 8000, now)
      assert.equal(budget.allowed, true)
      reserveBudget(db, budget.weekKey, 8000, 5, budget.monthKey)
      settleReservation(db, budget.weekKey, 8000, 5, 8000, 5, 'openai', budget.monthKey)
    }
    const blocked = checkBudget(db, 1, new Date('2026-03-30T03:00:00Z'))
    assert.equal(blocked.remainingKrw, 8000)
    assert.equal(blocked.monthlyRemainingKrw, 0)
    assert.equal(blocked.allowed, false)
    assert.equal(checkBudget(db, 1, new Date('2026-04-01T03:00:00Z')).allowed, true)
  } finally { db.close() }
})

test('reservations settle against their start month across midnight and release both ledgers', () => {
  const db = freshDb()
  try {
    const budget = checkBudget(db, 100, new Date('2026-09-30T14:59:59Z'))
    reserveBudget(db, budget.weekKey, 100, 1, budget.monthKey)
    assert.equal(getMonthlyLedger(db, '2026-09').reserved_krw, 100)
    settleReservation(db, budget.weekKey, 100, 1, 70, 0.7, 'anthropic', budget.monthKey)
    assert.equal(getMonthlyLedger(db, '2026-09').settled_krw, 70)
    assert.equal(getMonthlyLedger(db, '2026-09').anthropic_settled_krw, 70)
    assert.equal(getMonthlyLedger(db, '2026-10').settled_krw, 0)
    assert.equal(getWeeklyLedger(db, budget.weekKey).reserved_krw, 0)
    reserveBudget(db, budget.weekKey, 100, 1, budget.monthKey)
    releaseReservation(db, budget.weekKey, 100, 1, budget.monthKey)
    assert.equal(getMonthlyLedger(db, '2026-09').reserved_krw, 0)
    assert.equal(getWeeklyLedger(db, budget.weekKey).settled_krw, 70)
  } finally { db.close() }
})

test('weekly limit still applies and invalid estimates fail closed', () => {
  const db = freshDb()
  try {
    assert.equal(checkBudget(db, 8001).allowed, false)
    for (const estimate of [-1, NaN, Infinity]) assert.equal(checkBudget(db, estimate).allowed, false)
    const week = getCurrentWeekKey()
    reserveBudget(db, week, 7999, 5)
    assert.equal(checkBudget(db, 2).allowed, false)
    assert.equal(checkBudget(db, 1).allowed, true)
  } finally { db.close() }
})

test('migration imports historical paid logs by Korean month exactly once', () => {
  const db = freshDb()
  try {
    seedAgents(db)
    db.prepare(`INSERT INTO ai_action_logs
      (id, agent_id, provider, model, action, called, status, est_krw, est_usd, created_at)
      VALUES ('legacy', 'yebin-seoul', 'openai', 'test', 'CREATE_POST', 1, 'SUCCESS', 100, 0.1, '2026-09-30T15:00:00Z')`).run()
    migrate(db)
    assert.equal(getMonthlyLedger(db, '2026-10').settled_krw, 100)
    reserveBudget(db, '2026-09-28', 20, 0.02, '2026-10')
    migrate(db)
    assert.equal(getMonthlyLedger(db, '2026-10').settled_krw, 100)
    assert.equal(getMonthlyLedger(db, '2026-10').reserved_krw, 20)
  } finally { db.close() }
})


test('prepaid USD allowance survives month rollover and applies the existing safety margin', () => {
  const db = freshDb()
  const prior = config.prepaidBudgetUsd
  try {
    config.prepaidBudgetUsd = 20
    db.prepare('INSERT INTO ai_monthly_budgets (month_key, settled_usd, settled_krw) VALUES (?, ?, ?)').run('2026-01', 15.99, 22386)
    assert.equal(getPrepaidBudget(db).thresholdUsd, 16)
    assert.equal(checkBudget(db, 28, new Date('2026-02-01T03:00:00Z')).allowed, false)
    assert.equal(checkBudget(db, 1, new Date('2026-02-01T03:00:00Z')).allowed, true)
    config.prepaidBudgetUsd = 0
    assert.equal(checkBudget(db, 1).allowed, false)
  } finally { config.prepaidBudgetUsd = prior; db.close() }
})
