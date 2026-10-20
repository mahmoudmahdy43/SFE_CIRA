// Run: npm run test:dashboard
import assert from 'node:assert/strict'
import * as p from '../src/features/dashboard/periodMath.ts'
import * as k from '../src/features/dashboard/rangeKpi.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }
const row = (month, o = {}) => ({ month, reps: 10, list_doctors: 100, covered_doctors: 80, total_visits: 500, valid_visits: 400, planned_visits: 300, direct_visits: 100,
  visits_am: 100, visits_pm: 400, pharmacy_visits: 20, days_am: 50, days_pm: 100, missing_am: 1, missing_pm: 2, leave_days: 3, ow_days: 4, activity_days: 5, expected_visits: 600, ...o })

t('quarter snaps to its boundary and derives day range + previous quarter', () => {
  const q = p.normalizePeriod({ mode: 'quarter', fromYM: '2026-08', toYM: '2026-08' })
  assert.deepEqual([q.fromYM, q.toYM], ['2026-07', '2026-09'])
  const r = p.resolvePeriod(q)
  assert.deepEqual([r.from, r.to, r.prevFrom, r.prevTo, r.n], ['2026-07-01', '2026-09-30', '2026-04-01', '2026-06-30', 3])
})
t('semester and month and custom', () => {
  assert.deepEqual(p.normalizePeriod({ mode: 'semester', fromYM: '2026-09', toYM: '2026-09' }), { mode: 'semester', fromYM: '2026-07', toYM: '2026-12' })
  const m = p.resolvePeriod(p.normalizePeriod({ mode: 'month', fromYM: '2026-02', toYM: '2026-02' }))
  assert.deepEqual([m.from, m.to, m.prevFrom, m.prevTo], ['2026-02-01', '2026-02-28', '2026-01-01', '2026-01-31'])
  assert.deepEqual(p.normalizePeriod({ mode: 'custom', fromYM: '2026-05', toYM: '2026-03' }), { mode: 'custom', fromYM: '2026-03', toYM: '2026-05' })
  const c = p.resolvePeriod({ mode: 'custom', fromYM: '2026-01', toYM: '2026-02' })
  assert.deepEqual([c.prevFrom, c.prevTo], ['2025-11-01', '2025-12-31'])
})
t('URL parsing: defaults and invalid values', () => {
  const get = (o) => (key) => o[key] ?? null
  assert.deepEqual(p.parsePeriod(get({}), '2026-09'), { mode: 'month', fromYM: '2026-09', toYM: '2026-09' })
  assert.deepEqual(p.parsePeriod(get({ mode: 'quarter', from: '2026-07', to: '2026-09' }), '2026-01'), { mode: 'quarter', fromYM: '2026-07', toYM: '2026-09' })
  assert.deepEqual(p.parsePeriod(get({ mode: 'bogus', from: 'x', to: 'y' }), '2026-03'), { mode: 'month', fromYM: '2026-03', toYM: '2026-03' })
  assert.equal(p.periodQuery({ mode: 'quarter', fromYM: '2026-07', toYM: '2026-09' }, 1), 'mode=quarter&from=2026-07&to=2026-09&line=1')
  assert.equal(p.periodLabel({ mode: 'quarter', fromYM: '2026-07', toYM: '2026-09' }), 'Q3 2026')
})
t('range KPIs are sums over totals, not averages of monthly ratios', () => {
  const rows = [row('2026-07-01', { list_doctors: 100, covered_doctors: 90 }), row('2026-08-01', { list_doctors: 300, covered_doctors: 150 }), row('2026-09-01')]
  const a = k.aggregate(rows)
  assert.equal(a.coverage, (90 + 150 + 80) / (100 + 300 + 100))
  const avg = (0.9 + 0.5 + 0.8) / 3
  assert.notEqual(a.coverage, avg)
  assert.equal(a.pcf, 1200 / 1500); assert.equal(a.ach_cr, 1500 / 1800)
  assert.equal(a.call_rate_pm, 1200 / 300); assert.equal(a.call_rate_am, 300 / 150)
  assert.equal(a.planned_share, 900 / 1200); assert.equal(a.missing_days, 9)
  assert.ok(Math.abs(a.total_kpi - (a.pcf * 0.5 + a.coverage * 0.35 + a.ach_cr * 0.15)) < 1e-12)
})
t('empty / zero denominators give null, previous period comparability', () => {
  assert.equal(k.aggregate([]).coverage, null)
  assert.equal(k.aggregate([row('2026-07-01', { expected_visits: 0 })]).total_kpi, null)
  assert.equal(k.comparable([row('2026-04-01'), row('2026-05-01')], 3), false)
  assert.equal(k.comparable([row('2026-04-01'), row('2026-05-01'), row('2026-06-01')], 3), true)
})
t('money format', () => {
  assert.deepEqual([k.fmtMoney(1234), k.fmtMoney(12400), k.fmtMoney(3200000), k.fmtMoney(-1200000), k.fmtSigned(-1200000)], ['1,234', '12.4K', '3.2M', '-1.2M', '−1.2M'])
})
console.log(`\n${n} tests passed`)
