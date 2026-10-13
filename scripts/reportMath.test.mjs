// Run: npm run test:reports   (Node >= 22.18 strips TypeScript types natively)
import assert from 'node:assert/strict'
import * as m from '../src/features/reports/reportMath.ts'
import * as a from '../src/features/reports/absenceMath.ts'
import * as k from '../src/features/reports/kpiRepMath.ts'

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
const kr = (o) => k.toKpiRepRow({ month: '2026-09-01', rep_id: 1, line_id: 1, manager_id: 1, rep_name: 'R', rep_code: 'C', line: 'CIRA 1', manager: 'M1', ...o })
t('KPI by rep: totals come from sums, exclusion changes them and clearing restores them exactly', () => {
  const a = kr({ rep_id: 1, list_doctors: 100, covered_doctors: 80, total_visits: 200, target_visits: 180, valid_visits: 150, days_pm: 20, expected_visits: 220, call_rate_pm: 10 })
  const b = kr({ rep_id: 2, list_doctors: 50, covered_doctors: 10, total_visits: 40, target_visits: 50, valid_visits: 40, days_pm: 20, expected_visits: 220, call_rate_pm: 2 })
  const all = k.aggregate([a, b])
  assert.equal(all.coverage, 90 / 150); assert.equal(all.pcf, 190 / 230); assert.equal(all.ach_cr, 240 / 440); assert.equal(all.call_rate_pm, 240 / 40)
  assert.ok(Math.abs(all.total_kpi - (all.pcf * 0.5 + all.coverage * 0.35 + all.ach_cr * 0.15)) < 1e-12)
  const split = k.splitExcluded([a, b], new Set([2]))
  assert.deepEqual(split.included.map((r) => r.rep_id), [1])
  const without = k.aggregate(split.included)
  assert.equal(without.coverage, 0.8); assert.notEqual(without.total_kpi, all.total_kpi); assert.equal(without.reps, 1)
  assert.deepEqual(k.aggregate(k.splitExcluded([a, b], new Set()).included), all)
})
t('KPI by rep: expected_visits = 0 -> Total KPI = PCF*50% + Coverage*35% (missing Ach CR counts as 0), cells keep their dash', () => {
  const r = kr({ rep_id: 1, list_doctors: 100, covered_doctors: 80, total_visits: 40, target_visits: 40, valid_visits: 30, days_pm: 10, expected_visits: 0, coverage: 0.8, ach_cr: null, total_kpi: null })
  assert.ok(Math.abs(r.total_kpi - (0.75 * 0.5 + 0.8 * 0.35)) < 1e-12) // rep row, DB value missing
  const t = k.aggregate([r])
  assert.equal(t.ach_cr, null); assert.equal(k.fmtPct(t.ach_cr), '—')
  assert.ok(Math.abs(t.total_kpi - (0.75 * 0.5 + 0.8 * 0.35)) < 1e-12)
  assert.equal(k.byManager([r])[0].total_kpi, t.total_kpi)
  assert.equal(r.pcf, 0.75); assert.equal(k.exportReps([r], t, [], false)[0]['Target Visits'], 40)
  assert.ok(Math.abs(kr({ list_doctors: 10, total_visits: 5, target_visits: 10, valid_visits: 5, expected_visits: 0, total_kpi: 0.42 }).total_kpi - 0.25) < 1e-12) // DB total_kpi ignored (old PCF)
  assert.equal(kr({ list_doctors: 0, total_visits: 0, expected_visits: 0, total_kpi: 0 }).total_kpi, null) // no data at all -> dash
})
t('KPI by rep: empty denominators give null (dash), never 0 or NaN; roll-ups group by DM and line', () => {
  const z = k.aggregate([kr({ list_doctors: 0, total_visits: 0, expected_visits: 0, days_pm: 0 })])
  assert.equal(z.coverage, null); assert.equal(z.pcf, null); assert.equal(z.ach_cr, null); assert.equal(z.call_rate_pm, null); assert.equal(z.total_kpi, null) // no data at all
  assert.equal(k.fmtPct(null), '—'); assert.equal(k.fmtRate(0.5), '0.50'); assert.equal(k.fmtPct(0.8512), '85.1%')
  const rows = [kr({ rep_id: 1, manager_id: 1, manager: 'M1', total_visits: 10, visits_pm: 10, days_pm: 5 }), kr({ rep_id: 2, manager_id: 2, manager: 'M2', total_visits: 30, visits_pm: 30, days_pm: 10 }), kr({ rep_id: 3, manager_id: 2, manager: 'M2', total_visits: 10, days_pm: 10 })]
  const dm = k.byManager(rows)
  assert.equal(dm.length, 2); assert.equal(dm.find((g) => g.label === 'M2').call_rate_pm, 40 / 20)
  assert.equal(k.byLine(rows).length, 1)
  assert.deepEqual(k.parseIds('[1,2,"x"]'), [1, 2]); assert.deepEqual(k.parseIds('nope'), []); assert.deepEqual(k.parseIds(null), [])
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
t('leaves: AM-only 0.5 + full day 1 -> 0.5 / 1 / 1.5, totals are sums, zero is a dash', () => {
  const r = a.toLeaveRow({ month: '2026-09-01', rep_id: 1, line: 'L1', line_id: 1, direct_manager: 'M', rep_name: 'R', vacation_am: 0.5, vacation_pm: 0, full_days: 1, total_days: 1.5 })
  assert.equal(a.fmtDaysUpTo1(r.vacation_am), '0.5'); assert.equal(a.fmtDaysUpTo1(r.full_days), '1'); assert.equal(a.fmtDaysUpTo1(r.total_days), '1.5'); assert.equal(a.fmtDaysUpTo1(r.vacation_pm), '—')
  assert.equal(a.totalLeaves([r, r]).total_days, 3); assert.equal(a.leavesByManager([r, r])[0].reps, 2)
})
t('missing: detail rows from missing_dates + missing_dates_list, shift from suffix', () => {
  const r = a.toMissingRow({ month: '2026-09-01', rep_id: 1, line: 'L1', direct_manager: 'M', rep_name: 'R', rep_code: 'C', missing_am: 1.5, missing_pm: 1, missing_total: 2.5, missing_dates: '02 Sep, 07 Sep AM, 09 Sep PM', missing_dates_list: ['2026-09-02', '2026-09-07', '2026-09-09'] })
  const d = a.missingDetail([r])
  assert.deepEqual(d.map((x) => x.shift), ['Both', 'AM', 'PM']); assert.deepEqual(d.map((x) => x.date.getDate()), [2, 7, 9]); assert.equal(d[0].date.getMonth(), 8)
  assert.equal(a.exportMissing([r], a.totalMissing([r]))[0].Dates, '02 Sep, 07 Sep AM, 09 Sep PM'); assert.equal(a.fmtDays1(r.missing_total), '2.5')
})
console.log(`\n${n} tests passed`)
