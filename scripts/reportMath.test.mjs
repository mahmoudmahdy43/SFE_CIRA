// Run: npm run test:reports   (Node >= 22.18 strips TypeScript types natively)
import assert from 'node:assert/strict'
import * as m from '../src/features/reports/reportMath.ts'
import * as a from '../src/features/reports/absenceMath.ts'
import * as k from '../src/features/reports/kpiRepMath.ts'
import * as mg from '../src/features/reports/managerMath.ts'

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
  assert.equal(r.hire_date, null); assert.equal(a.fmtHire(null), '—'); assert.equal(a.fmtHire('2026-08-15'), '15-Aug-2026'); assert.equal(a.exportLeaves([r], a.totalLeaves([r]))[0]['Hire Date'], null)
  assert.equal(a.hireDateValue('2026-08-15').getDate(), 15)
  assert.equal(a.totalLeaves([r, r]).total_days, 3); assert.equal(a.leavesByManager([r, r])[0].reps, 2)
})
t('missing: detail rows from missing_dates + missing_dates_list, shift from suffix', () => {
  const r = a.toMissingRow({ month: '2026-09-01', rep_id: 1, line: 'L1', direct_manager: 'M', rep_name: 'R', rep_code: 'C', hire_date: '2024-03-05', missing_am: 1.5, missing_pm: 1, missing_total: 2.5, missing_dates: '02 Sep, 07 Sep AM, 09 Sep PM', missing_dates_list: ['2026-09-02', '2026-09-07', '2026-09-09'] })
  const d = a.missingDetail([r])
  assert.deepEqual(d.map((x) => x.shift), ['Both', 'AM', 'PM']); assert.deepEqual(d.map((x) => x.date.getDate()), [2, 7, 9]); assert.equal(d[0].date.getMonth(), 8); assert.equal(a.exportMissingDetail([r], [r])[0]['Hire Date'].getFullYear(), 2024)
  assert.equal(a.fmtDays1(r.missing_total), '2.5')
})
t('month range: rep summed across months, AM / PM dates joined in month order, swap, detail per rep-month', () => {
  const mk = (month, o) => a.toMissingRow({ month, rep_id: 1, line: 'L1', line_id: 1, direct_manager: 'M', rep_name: 'R', rep_code: 'C', hire_date: null, ...o })
  const oct = mk('2026-10-01', { hire_date: '2024-03-05', missing_am: 0.5, missing_pm: 0, missing_total: 0.5, missing_dates: '02 Oct AM', missing_dates_list: ['2026-10-02'], missing_dates_am: '02 Oct', missing_dates_pm: '' })
  const sep = mk('2026-09-01', { missing_am: 1.5, missing_pm: 1, missing_total: 2.5, missing_dates: '03 Sep, 07 Sep AM, 09 Sep PM', missing_dates_list: ['2026-09-03', '2026-09-07', '2026-09-09'], missing_dates_am: '03 Sep, 07 Sep', missing_dates_pm: '03 Sep, 09 Sep' })
  const [x] = a.mergeMissing([oct, sep]) // out of order on purpose
  assert.equal(x.missing_total, 3); assert.equal(x.missing_am, 2); assert.equal(x.missing_dates_am, '03 Sep, 07 Sep, 02 Oct'); assert.equal(x.missing_dates_pm, '03 Sep, 09 Sep'); assert.equal(x.hire_date, '2024-03-05')
  const ex = a.exportMissing([x], a.totalMissing([x])); assert.equal(ex[0]['AM Dates'], '03 Sep, 07 Sep, 02 Oct'); assert.ok(!('Dates' in ex[0]))
  assert.equal(a.exportMissingDetail([x], [oct, sep]).length, 4)
  const l = (month, o) => a.toLeaveRow({ month, rep_id: 1, line: 'L1', direct_manager: 'M', rep_name: 'R', ...o })
  const [lv] = a.mergeLeaves([l('2026-09-01', { vacation_am: 0.5, full_days: 1, total_days: 1.5 }), l('2026-10-01', { vacation_pm: 0.5, total_days: 0.5 })])
  assert.equal(lv.total_days, 2); assert.equal(lv.vacation_am, 0.5); assert.equal(lv.vacation_pm, 0.5)
  assert.deepEqual(a.orderRange('2026-11-01', '2026-09-01'), { from: '2026-09-01', to: '2026-11-01' })
  assert.equal(a.rangeSlug('2026-09-01', '2026-09-01'), '2026-09'); assert.equal(a.rangeSlug('2026-09-01', '2026-11-01'), '2026-09_to_2026-11'); assert.equal(a.rangeLabel('2026-09-01', '2026-11-01'), 'Sep 2026 – Nov 2026')
})
const mrow = (o) => mg.toManagerRow({
  month: '2026-09-01', manager_id: 1, name: 'M', role_type: 'DM', working_days: 10, field_days: 8, leave_days: 1, office_work_days: 0.5, activity_days: 0.5, missing_days: 0,
  working_am: 12, working_pm: 8, field_am: 10, field_pm: 6, leave_am: 1, leave_pm: 1, ow_am: 1, ow_pm: 0, act_am: 0, act_pm: 1, missing_am: 0, missing_pm: 0,
  single_am: 3, single_pm: 2, single_pharmacy: 1, double_am: 4, double_pm: 1, double_pharmacy: 0, single_visits: 6, double_visits: 5,
  visits_am: 7, visits_pm: 3, visits_pharmacy: 1, call_rate_am: 0.7, call_rate_pm: 0.5, call_rate_pharmacy: null, ...o,
})
t('manager shift filter: All keeps day columns, AM / PM use shift days, Pharmacy keeps days with pharmacy visits', () => {
  const r = [mrow({})]
  assert.equal(mg.applyShift(r, 'ALL')[0].working_days, 10)
  const am = mg.applyShift(r, 'AM')[0]
  assert.deepEqual([am.working_days, am.field_days, am.leave_days, am.office_work_days, am.activity_days, am.single_visits, am.double_visits], [12, 10, 1, 1, 0, 3, 4])
  const pm = mg.applyShift(r, 'PM')[0]
  assert.deepEqual([pm.working_days, pm.activity_days, pm.single_visits, pm.double_visits], [8, 1, 2, 1])
  const ph = mg.applyShift(r, 'PHARMACY')[0]
  assert.deepEqual([ph.working_days, ph.field_days, ph.single_visits, ph.double_visits], [10, 8, 1, 0])
  assert.deepEqual(mg.shiftRates('ALL'), ['am', 'pm', 'pharmacy'])
  assert.deepEqual(mg.shiftRates('PM'), ['pm'])
  assert.equal(mg.shiftUnit('AM'), 'shift days')
  assert.equal(mg.shiftUnit('PHARMACY'), 'days')
})
t('manager totals follow the shift; null rates are dashes; export columns follow the shift', () => {
  const rows = mg.applyShift([mrow({ manager_id: 1 }), mrow({ manager_id: 2, call_rate_am: null })], 'AM')
  const tot = mg.totalManagers(rows)
  assert.equal(tot.working_days, 24)
  assert.equal(tot.single_visits, 6)
  assert.equal(mg.fmtRate(null), a.DASH)
  assert.equal(mg.fmtRate(0.5), '0.50')
  const ex = mg.exportManagers(rows, tot, false, 'AM')
  assert.ok('Call Rate AM' in ex[0])
  assert.ok(!('Call Rate PM' in ex[0]) && !('Call Rate Pharmacy' in ex[0]))
  assert.equal(ex[ex.length - 1]['Working Days'], 24)
})
t('manager missing dates: shift columns, export text, detail sheet with real dates', () => {
  const rows = [mrow({ manager_id: 1, name: 'A', line: 'CIRA 1', missing_dates_am: '03 Sep, 07 Sep', missing_dates_pm: '07 Sep' }), mrow({ manager_id: 2, name: 'B', missing_dates_am: null, missing_dates_pm: null })]
  assert.deepEqual(mg.shiftDateCols('ALL'), ['am', 'pm'])
  assert.deepEqual(mg.shiftDateCols('PM'), ['pm'])
  assert.deepEqual(mg.shiftDateCols('PHARMACY'), [])
  assert.equal(rows[1].missing_dates_am, '')
  const exp = (shift) => mg.exportManagers(rows, mg.totalManagers(rows), false, shift)[0]
  assert.equal(exp('ALL')['AM Missing Dates'], '03 Sep, 07 Sep')
  const keys = Object.keys(exp('ALL'))
  assert.deepEqual(keys.slice(keys.indexOf('Missing Days'), keys.indexOf('Missing Days') + 3), ['Missing Days', 'AM Missing Dates', 'PM Missing Dates'])
  assert.ok(!('AM Missing Dates' in exp('PHARMACY')))
  assert.ok(!('AM Missing Dates' in exp('PM')) && 'PM Missing Dates' in exp('PM'))
  const d = mg.exportMissingDetail(rows, 'ALL', '2026-09-01')
  assert.deepEqual(d.map((x) => x.Shift), ['AM', 'AM', 'PM'])
  assert.equal(d[0].Date.getTime(), new Date(2026, 8, 3).getTime())
  assert.equal(mg.exportMissingDetail(rows, 'PM', '2026-09-01').length, 1)
  assert.equal(mg.exportMissingDetail(rows, 'PHARMACY', '2026-09-01').length, 0)
  assert.deepEqual(mg.parseMissingDates('', 2026), [])
})
console.log(`\n${n} tests passed`)
