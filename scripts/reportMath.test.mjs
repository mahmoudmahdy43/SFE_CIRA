// Run: npm run test:reports   (Node >= 22.18 strips TypeScript types natively)
import assert from 'node:assert/strict'
import * as m from '../src/features/reports/reportMath.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }

const base = { month: '2026-09-01', rep_id: 1, line_id: 1, box: 'B1', rep_code: 'R1', rep_name: 'Rep 1', manager: 'M1', hire_date: '2020-01-05' }
const cov = (o) => m.toCoverageRow({ ...base, list_doctors: 0, fully_covered: 0, partially_covered: 0, not_visited: 0, coverage: null, ...o })
const call = (o) => m.toCallRateRow({ ...base, ...o })

const covRows = [
  cov({ rep_id: 1, box: 'Box A + Box B', list_doctors: 100, fully_covered: 50, partially_covered: 30, not_visited: 20, coverage: 0.8 }), // rep in two boxes
  cov({ rep_id: 2, box: 'C', rep_name: 'Rep 2', hire_date: null, list_doctors: 10, fully_covered: 10, coverage: 1 }), // null hire date
]
const crRows = [
  call({ rep_id: 1, field_am: 10, field_pm: 10, field_total: 20, visits_am: 100, visits_pm: 50, visits_total: 150, working_am: 12, working_pm: 12, working_total: 24, call_rate_am: 10, call_rate_pm: 5, call_rate_total: 7.5 }),
  call({ rep_id: 2, box: 'C', rep_name: 'Rep 2', field_am: 0, field_pm: 5, field_total: 5, visits_am: 0, visits_pm: 5, visits_total: 5, call_rate_am: null, call_rate_pm: 1, call_rate_total: 1 }), // zero AM field days
]

t('coverage total sums counts and recomputes ratio (not the average of 0.8 and 1)', () => {
  const tot = m.totalCoverage(covRows)
  assert.equal(tot.list_doctors, 110); assert.equal(tot.fully_covered, 60); assert.equal(tot.partially_covered, 30)
  assert.equal(tot.coverage, 90 / 110)
  assert.notEqual(tot.coverage, 0.9)
})
t('rep in two boxes keeps "Box A + Box B"; null hire date -> dash', () => {
  assert.equal(covRows[0].box, 'Box A + Box B')
  assert.equal(m.fmtHireDate(covRows[1].hire_date), '—')
  assert.equal(m.fmtHireDate('2024-03-05'), '05-Mar-2024')
  const ex = m.exportCoverage(covRows, m.totalCoverage(covRows))
  assert.equal(ex[1]['Hiring date'], null); assert.equal(ex[0]['Hiring date'], '05-Jan-2020')
  assert.equal(ex[2]['Box'], 'Total'); assert.equal(ex[0]['Coverage %'], 80)
})
t('call rate total recomputed from summed visits / field days; zero field days -> null -> dash', () => {
  const tot = m.totalCallRate(crRows)
  assert.equal(tot.visits_am, 100); assert.equal(tot.field_am, 10); assert.equal(tot.call_rate_am, 10)
  assert.equal(tot.call_rate_pm, 55 / 15); assert.equal(tot.call_rate_total, 155 / 25)
  assert.equal(m.fmtCallRate(crRows[1].call_rate_am), '—')
  assert.equal(m.totalCallRate([crRows[1]]).call_rate_am, null)
  assert.equal(m.totalCallRate([]).call_rate_total, null)
})
t('mode column visibility', () => {
  assert.equal(m.callRateColumns('both', false).length, 7 * 3)
  assert.equal(m.callRateColumns('both', true).length, 8 * 3)
  assert.deepEqual(m.callRateColumns('am', false).map((c) => c.shift), Array(7).fill('am'))
  assert.ok(m.callRateColumns('pm', true).every((c) => c.shift === 'pm'))
})
t('AM-only export has only AM columns, same headers as the table', () => {
  const ex = m.exportCallRate(crRows, m.totalCallRate(crRows), 'am', false)
  const keys = Object.keys(ex[0])
  assert.ok(keys.includes('Working days AM') && keys.includes('Call rate AM'))
  assert.ok(!keys.some((k) => k.endsWith(' PM') || k.endsWith(' Total')))
  assert.equal(ex[1]['Call rate AM'], null); assert.equal(ex[0]['Call rate AM'], 10)
  assert.ok(!keys.includes('Missing days AM'))
  assert.ok(Object.keys(m.exportCallRate(crRows, m.totalCallRate(crRows), 'both', true)[0]).includes('Missing days Total'))
})
t('pharmacy: totals divide sums, null rate stays null, pharmacy mode has no AM/PM columns', () => {
  const a = call({ rep_id: 1, visits_pharmacy: 10, field_days: 4, call_rate_pharmacy: 2.5 })
  const b = call({ rep_id: 2, visits_pharmacy: 5, field_days: 0, call_rate_pharmacy: null })
  const tot = m.totalCallRate([a, b])
  assert.equal(tot.visits_pharmacy, 15); assert.equal(tot.field_days, 4); assert.equal(tot.call_rate_pharmacy, 15 / 4)
  assert.equal(m.totalCallRate([b]).call_rate_pharmacy, null)
  assert.equal(m.callRateColumns('pharmacy', true).length, 0)
  const ex = m.exportCallRate([a, b], tot, 'pharmacy', false)
  assert.equal(ex[0]['Pharmacy Call Rate'], 2.5); assert.equal(ex[1]['Pharmacy Call Rate'], null)
})
t('target dot thresholds and no-target', () => {
  assert.equal(m.targetTone(8, 8), 'success'); assert.equal(m.targetTone(6.4, 8), 'warning'); assert.equal(m.targetTone(6.3, 8), 'danger')
  assert.equal(m.targetTone(5, null), null); assert.equal(m.targetTone(null, 8), null)
})
t('default order Line -> Manager -> Box; filters', () => {
  const rows = [cov({ rep_id: 3, line_id: 2, manager: 'A', box: 'A1' }), cov({ rep_id: 2, line_id: 1, manager: 'B', box: 'Z' }), cov({ rep_id: 1, line_id: 1, manager: 'B', box: 'A' })]
  assert.deepEqual(m.defaultOrder(rows).map((r) => r.rep_id), [1, 2, 3])
  assert.equal(m.filterRows(rows, { lineId: 1, manager: '', search: '' }).length, 2)
  assert.equal(m.filterRows(rows, { lineId: null, manager: 'A', search: '' }).length, 1)
  assert.equal(m.filterRows(rows, { lineId: null, manager: '', search: 'r1' }).length, 3) // code R1
  assert.deepEqual(m.managerOptions(rows, 1), ['B'])
})
console.log(`\n${n} tests passed`)
