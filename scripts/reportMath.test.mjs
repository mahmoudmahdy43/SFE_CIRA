// Run: npm run test:reports   (Node >= 22.18 strips TypeScript types natively)
import assert from 'node:assert/strict'
import * as m from '../src/features/reports/reportMath.ts'
import * as a from '../src/features/reports/absenceMath.ts'
import * as k from '../src/features/reports/kpiRepMath.ts'
import * as mg from '../src/features/reports/managerMath.ts'
import * as c from '../src/features/reports/capacityMath.ts'
import * as sp from '../src/features/reports/specialityMath.ts'
import * as st from '../src/features/strategy/strategyMath.ts'
import * as jt from '../src/features/reports/jointMath.ts'
import * as cv from '../src/features/reports/coverageMath.ts'
import * as ch from '../src/features/reports/coachingMath.ts'
import * as cr from '../src/features/uploads/coaching/coachingResult.ts'
import * as sm from '../src/features/reports/salesMath.ts'
import * as sp2 from '../src/features/uploads/sales/salesParse.ts'
import * as sr from '../src/features/uploads/sales/salesResult.ts'

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
const cap = (o) => c.toCapacityRow({
  month: '2026-10-01', rep_id: 1, rep_code: 'R1', rep_name: 'Rep 1', line: 'CIRA 1', manager: 'M1', box: 'B1', call_rate_target_pm: 10, pm_working_days: 22,
  capacity_visits: 220, list_doctors: 120, list_visits: 230, excess_visits: 10, utilization: 230 / 220, status: 'Over capacity', remove_if_freq2: 5, remove_if_freq1: 10, spare_visits: 0, ...o,
})
const capRows = [
  cap({ rep_id: 1, rep_name: 'Over A', excess_visits: 10 }),
  cap({ rep_id: 2, rep_name: 'Over B', line: 'CIRA 2', manager: 'M2', excess_visits: 30, list_visits: 250, remove_if_freq2: 15, remove_if_freq1: 30 }),
  cap({ rep_id: 3, rep_name: 'Spare C', excess_visits: -20, list_visits: 200, status: 'Spare capacity', remove_if_freq2: 0, remove_if_freq1: 0, spare_visits: 20, utilization: 200 / 220 }),
  cap({ rep_id: 4, rep_name: 'Even D', excess_visits: 0, list_visits: 220, status: 'Balanced', remove_if_freq2: 0, remove_if_freq1: 0, utilization: 1 }),
]
t('capacity: view values pass through untouched; missing numbers -> 0 / null', () => {
  assert.equal(capRows[0].capacity_visits, 220); assert.equal(capRows[0].remove_if_freq2, 5); assert.equal(capRows[0].remove_if_freq1, 10)
  const blank = c.toCapacityRow({ rep_id: 9, rep_name: 'X', status: 'Balanced' })
  assert.equal(blank.capacity_visits, 0); assert.equal(blank.utilization, null); assert.equal(blank.call_rate_target_pm, null)
})
t('capacity: status filter defaults to Over capacity; line / manager / search narrow; cards ignore the status filter', () => {
  assert.equal(c.DEFAULT_STATUS_FILTER, 'Over capacity')
  const f = { line: null, manager: '', search: '', status: c.DEFAULT_STATUS_FILTER }
  assert.deepEqual(c.filterCapacity(capRows, f).map((r) => r.rep_id), [1, 2])
  assert.equal(c.filterCapacity(capRows, { ...f, status: 'all' }).length, 4)
  assert.deepEqual(c.filterCapacity(capRows, { ...f, line: 'CIRA 2' }).map((r) => r.rep_id), [2])
  assert.deepEqual(c.filterCapacity(capRows, { ...f, status: 'all', manager: 'M2' }).map((r) => r.rep_id), [2])
  assert.deepEqual(c.filterCapacity(capRows, { ...f, status: 'all', search: 'spare' }).map((r) => r.rep_id), [3])
  assert.equal(c.filterCapacityScope(capRows, { line: null, manager: '', search: '' }).length, 4)
  assert.deepEqual(c.capacityManagers(capRows, 'CIRA 1'), ['M1'])
})
t('capacity: summary cards sum the view columns by status', () => {
  const sm = c.summarizeCapacity(capRows)
  assert.equal(sm.overReps, 2); assert.equal(sm.excessVisits, 40); assert.equal(sm.removeDoctors, 20)
  assert.equal(sm.spareReps, 1); assert.equal(sm.spareVisits, 20); assert.equal(sm.reps, 4)
})
t('capacity: default order is excess desc; Total row sums only additive columns', () => {
  assert.deepEqual(c.capacityOrder(capRows).map((r) => r.rep_id), [2, 1, 4, 3])
  const tot = c.totalCapacity(capRows)
  assert.equal(tot.capacity_visits, 880); assert.equal(tot.list_visits, 900); assert.equal(tot.remove_if_freq2, 20)
  assert.equal(tot.utilization, null); assert.equal(tot.pm_working_days, null); assert.ok(c.isCapacityTotal(tot)); assert.ok(!c.isCapacityTotal(capRows[0]))
})
t('capacity: formatting, remove label + tooltip text, export columns', () => {
  assert.equal(c.fmtExcess(10), '+10'); assert.equal(c.fmtExcess(-20), '-20'); assert.equal(c.fmtExcess(0), '0')
  assert.equal(c.fmtUtilization(230 / 220), '104.5%'); assert.equal(c.fmtUtilization(null), '—')
  assert.equal(c.removeLabel(5), 'Remove ~5 doctors'); assert.equal(c.removeTip(10), 'if they have Freq 2; if Freq 1 remove 10')
  const ex = c.exportCapacity(capRows)
  assert.equal(ex.length, 4)
  assert.deepEqual(Object.keys(ex[0]), ['Medical Rep', 'Rep code', 'Line', 'Direct Manager', 'Box', 'Target PM', 'Working days', 'Capacity', 'List doctors', 'List visits', 'Excess', 'Utilization %', 'Remove (if Freq 2)', 'Remove (if Freq 1)'])
  assert.equal(ex[0]['Utilization %'], 104.5); assert.equal(ex[0]['Remove (if Freq 1)'], 10)
})

const mixRaw = (o) => ({ month: '2026-10-01', rep_id: 1, rep_code: 'R1', rep_name: 'Rep 1', line: 'CIRA 1', manager: 'M1', speciality: 'Gyn', doctors: 50, total_docs: 100, share_pct: 50, strategy_pct: 50, diff_points: 0, is_off: false, threshold_points: 15, ...o })
const mixRaws = [
  mixRaw({ speciality: 'Gyn', doctors: 42, share_pct: 42, strategy_pct: 50, diff_points: -8 }),
  mixRaw({ speciality: 'Dentist', doctors: 28, share_pct: 28, strategy_pct: 30, diff_points: -2 }),
  mixRaw({ speciality: 'Peds', doctors: 30, share_pct: 30, strategy_pct: 5, diff_points: 25, is_off: true }),
  mixRaw({ rep_id: 2, rep_code: 'R2', rep_name: 'Rep 2', manager: 'M2', line: 'CIRA 2', total_docs: 50, speciality: 'Gyn', doctors: 10, share_pct: 20, strategy_pct: 50, diff_points: -30, is_off: true }),
  mixRaw({ rep_id: 2, rep_code: 'R2', rep_name: 'Rep 2', manager: 'M2', line: 'CIRA 2', total_docs: 50, speciality: 'Dentist', doctors: 40, share_pct: 80, strategy_pct: 30, diff_points: 50, is_off: true }),
  mixRaw({ rep_id: 2, rep_code: 'R2', rep_name: 'Rep 2', manager: 'M2', line: 'CIRA 2', total_docs: 50, speciality: 'Derma', doctors: 0, share_pct: 0, strategy_pct: 20, diff_points: -20, is_off: true }),
  mixRaw({ rep_id: 2, rep_code: 'R2', rep_name: 'Rep 2', manager: 'M2', line: 'CIRA 2', total_docs: 50, speciality: 'Ortho', doctors: 0, share_pct: 0, strategy_pct: 0, diff_points: 0 }),
]
t('speciality mix: view rows grouped per rep; is_off and numbers pass through untouched', () => {
  const rows = sp.buildRepRows(mixRaws)
  assert.equal(rows.length, 2); assert.equal(rows[0].total_docs, 100); assert.equal(rows[1].total_docs, 50)
  assert.equal(rows[0].cells.get('Peds').is_off, true); assert.equal(rows[0].cells.get('Gyn').is_off, false)
  assert.equal(rows[0].cells.get('Gyn').doctors, 42); assert.equal(rows[0].cells.get('Gyn').diff_points, -8)
  assert.equal(sp.isOffRow(rows[0]), true)
})
t('speciality mix: columns ordered by doctors desc; no doctors + no strategy hidden; 0 doctors with strategy kept', () => {
  const rows = sp.buildRepRows(mixRaws)
  assert.deepEqual(sp.specialityColumns(rows), ['Dentist', 'Gyn', 'Peds', 'Derma'])
  assert.deepEqual(sp.specialityColumns([rows[0]]), ['Gyn', 'Peds', 'Dentist'])
})
t('speciality mix: filters (line, manager, search, only red) and manager list', () => {
  const rows = sp.buildRepRows(mixRaws)
  const f = { line: null, manager: '', search: '', onlyRed: false }
  assert.equal(sp.filterMixRows(rows, f).length, 2)
  assert.deepEqual(sp.filterMixRows(rows, { ...f, line: 'CIRA 2' }).map((r) => r.rep_id), [2])
  assert.deepEqual(sp.filterMixRows(rows, { ...f, manager: 'M1' }).map((r) => r.rep_id), [1])
  assert.deepEqual(sp.filterMixRows(rows, { ...f, search: 'r2' }).map((r) => r.rep_id), [2])
  const calm = sp.buildRepRows([mixRaw({ rep_id: 3, rep_name: 'Calm' })])
  assert.equal(sp.filterMixRows([...rows, ...calm], { ...f, onlyRed: true }).length, 2)
  assert.deepEqual(sp.mixManagers(rows, null), ['M1', 'M2']); assert.deepEqual(sp.mixManagers(rows, 'CIRA 1'), ['M1'])
})
t('speciality mix: strategy banner + threshold come from the data', () => {
  assert.equal(sp.hasStrategy(sp.buildRepRows(mixRaws)), true)
  assert.equal(sp.hasStrategy(sp.buildRepRows(mixRaws.map((r) => ({ ...r, strategy_pct: 0 })))), false)
  assert.equal(sp.mixThreshold(sp.buildRepRows(mixRaws)), 15)
  assert.equal(sp.thresholdText(15), 'Red when the share differs from the strategy by more than 15 points')
  assert.equal(sp.NO_STRATEGY_TEXT, 'No List Strategy entered yet - enter it in Settings > List Strategy')
})
t('speciality mix: tooltip text and formatting match the spec', () => {
  const rows = sp.buildRepRows([mixRaw({ speciality: 'Gyn', doctors: 50, share_pct: 42, strategy_pct: 50, diff_points: -8 })])
  assert.equal(sp.cellTip(rows[0].cells.get('Gyn')), 'Gyn: 50 doctors = 42% of the list, strategy 50%, -8 pts (threshold 15 pts)')
  assert.equal(sp.fmtMixPct(41.67), '41.7%'); assert.equal(sp.fmtMixPct(50), '50%'); assert.equal(sp.fmtMixPct(null), '—')
  assert.equal(sp.fmtMixPts(8), '+8 pts'); assert.equal(sp.fmtMixPts(0), '0 pts')
})
t('speciality mix: Total row sums doctors, share over all list doctors, strategy weighted by list size, red by the view threshold', () => {
  const rows = sp.buildRepRows(mixRaws)
  const specs = sp.specialityColumns(rows)
  const tot = sp.totalMixRow(rows, specs, 15, 'Total')
  assert.equal(tot.total_docs, 150)
  const gyn = tot.cells.get('Gyn')
  assert.equal(gyn.doctors, 52); assert.ok(Math.abs(gyn.share_pct - (52 / 150) * 100) < 1e-9); assert.equal(gyn.strategy_pct, 50); assert.equal(gyn.is_off, true) // 34.67% vs 50% = -15.33 pts > 15
  assert.equal(sp.totalMixRow(rows, specs, 20, 'T').cells.get('Gyn').is_off, false) // within a looser threshold
  const peds = tot.cells.get('Peds'); assert.equal(peds.doctors, 30); assert.ok(Math.abs(peds.strategy_pct - (5 * 100) / 150) < 1e-9); assert.equal(peds.is_off, true)
  assert.equal(tot.cells.get('Derma').doctors, 0)
  assert.equal(sp.totalMixRow(rows, specs, null, 'T').cells.get('Peds').is_off, false)
  assert.equal(sp.isMixTotal(tot), true); assert.equal(sp.isMixTotal(rows[0]), false)
})
t('speciality mix: line rows are one per line; export has two sheets with red cells from is_off', () => {
  const lineRaw = [
    { month: '2026-10-01', line: 'CIRA 2', speciality: 'Gyn', doctors: 10, total_docs: 50, share_pct: 20, strategy_pct: 50, diff_points: -30, is_off: true, threshold_points: 15 },
    { month: '2026-10-01', line: 'CIRA 1', speciality: 'Gyn', doctors: 42, total_docs: 100, share_pct: 42, strategy_pct: 50, diff_points: -8, is_off: false, threshold_points: 15 },
  ]
  const lr = sp.buildLineRows(lineRaw)
  assert.deepEqual(lr.map((r) => r.rep_name), ['CIRA 1', 'CIRA 2']); assert.deepEqual(lr.map((r) => r.rep_id), [1, 2])
  const ex = sp.exportMix(lr, ['Gyn'], sp.totalMixRow(lr, ['Gyn'], 15, 'Total'), 'line')
  assert.deepEqual(Object.keys(ex.doctors[0]), ['Line', 'Total doctors', 'Gyn'])
  assert.deepEqual(Object.keys(ex.shares[0]), ['Line', 'Total doctors', 'Gyn share %', 'Gyn strategy %'])
  assert.equal(ex.doctors[1].Gyn, 10); assert.equal(ex.shares[1]['Gyn share %'], 20)
  // row 1 (CIRA 2) is flagged by the view; row 2 is the Total row (52 of 150 = 34.7% vs 50%, over the 15-point threshold)
  assert.deepEqual([...ex.doctorsRed], ['1|Gyn', '2|Gyn']); assert.deepEqual([...ex.sharesRed].sort(), ['1|Gyn share %', '1|Gyn strategy %', '2|Gyn share %', '2|Gyn strategy %'])
  assert.ok(!ex.doctorsRed.has('0|Gyn'))
  const exRep = sp.exportMix(sp.buildRepRows(mixRaws), ['Gyn'], sp.totalMixRow(sp.buildRepRows(mixRaws), ['Gyn'], 15, 'T'), 'rep')
  assert.deepEqual(Object.keys(exRep.doctors[0]), ['Rep', 'Code', 'Line', 'Manager', 'Total doctors', 'Gyn'])
  assert.equal(exRep.doctors.length, 3)
})
t('list strategy: percentages parse to 0-100 with one decimal; empty is 0; running total + message', () => {
  assert.equal(st.parseShare(''), 0); assert.equal(st.parseShare('33.33'), 33.3); assert.equal(st.parseShare('100'), 100)
  assert.equal(st.parseShare('-1'), null); assert.equal(st.parseShare('100.1'), null); assert.equal(st.parseShare('abc'), null)
  const form = { 1: '50', 2: '30', 3: '', 4: '16' }
  assert.equal(st.formTotal(form), 96); assert.equal(st.isFullTotal(96), false); assert.equal(st.isFullTotal(100), true); assert.equal(st.isFullTotal(99.96), true)
  assert.equal(st.totalMessage(96), 'total 96% - the strategy should add up to 100%')
  assert.deepEqual(st.invalidIds({ 1: '50', 2: 'x', 3: '120' }), [2, 3])
})
t('list strategy: versions per line, exact form, previous version, upserts keep zeros', () => {
  const rows = [
    { line_id: 1, speciality_id: 10, effective_from: '2026-03-01', share_pct: 60 }, { line_id: 1, speciality_id: 11, effective_from: '2026-03-01', share_pct: 40 },
    { line_id: 1, speciality_id: 10, effective_from: '2026-07-01', share_pct: 50 }, { line_id: 2, speciality_id: 10, effective_from: '2026-05-01', share_pct: 100 },
  ]
  assert.deepEqual(st.versionsOf(rows, 1), ['2026-07-01', '2026-03-01']); assert.deepEqual(st.versionsOf(rows, 3), [])
  assert.deepEqual(st.formAt(rows, 1, '2026-03-01'), { 10: '60', 11: '40' }); assert.deepEqual(st.formAt(rows, 1, '2026-04-01'), {})
  assert.equal(st.previousVersion(rows, 1, '2026-10-01').effective_from, '2026-07-01'); assert.equal(st.previousVersion(rows, 1, '2026-03-01'), null)
  const up = st.buildUpserts(1, '2026-10-01', [10, 11, 12], { 10: '55', 11: '' })
  assert.deepEqual(up.map((r) => [r.speciality_id, r.share_pct]), [[10, 55], [11, 0], [12, 0]]); assert.equal(up[0].effective_from, '2026-10-01')
  assert.throws(() => st.buildUpserts(1, '2026-10-01', [10], { 10: '101' }))
})
t('list strategy: threshold 0-100 in steps of 0.5; month choices include history', () => {
  assert.equal(st.parseThreshold('15'), 15); assert.equal(st.parseThreshold('12.5'), 12.5); assert.equal(st.parseThreshold('12.3'), null)
  assert.equal(st.parseThreshold('101'), null); assert.equal(st.parseThreshold(''), null); assert.equal(st.parseThreshold('0'), 0)
  const m = st.monthChoices('2026-10-01', ['2020-01-01'])
  assert.ok(m.includes('2026-10-01') && m.includes('2020-01-01') && m.includes('2027-10-01')); assert.equal(m[0], '2020-01-01')
})

const jrow = (o) => jt.toJointRow({
  month: '2026-09-01', day: '2026-09-20', manager: 'Tarek', manager_id: 1, rep_name: 'Rep A', rep_code: 'A1', rep_id: 1, line: 'CIRA 1', box: 'Box 1',
  rep_am: 2, rep_pm: 10, rep_pharmacy: 5, rep_total: 17, joint_am: 1, joint_pm: 6, joint_pharmacy: 3, joint_total: 10,
  cover_am: 0.5, cover_pm: 0.6, cover_pharmacy: 0.6, cover_total: 10 / 17, ...o,
})
t('joint days: the spec example reads 1/2 AM, 6/10 PM, 3/5 pharmacy, 10/17 = 58.8% total', () => {
  const r = jrow({})
  const cols = jt.jointColumns('day', false)
  assert.deepEqual(cols.map((c) => c.id), ['rep', 'line', 'box', 'day', 'rep_am', 'with_am', 'rep_pm', 'with_pm', 'rep_pharmacy', 'with_pharmacy', 'total_rep', 'total_with', 'cover'])
  const txt = (id) => jt.jointText(cols.find((c) => c.id === id), r)
  assert.equal(txt('rep_am'), '2'); assert.equal(txt('with_am'), '1'); assert.equal(txt('rep_pm'), '10'); assert.equal(txt('with_pm'), '6')
  assert.equal(txt('rep_pharmacy'), '5'); assert.equal(txt('with_pharmacy'), '3'); assert.equal(txt('total_rep'), '17'); assert.equal(txt('total_with'), '10')
  assert.equal(txt('cover'), '58.8%'); assert.equal(txt('day'), '20-Sep-2026')
})
t('joint days: "-" only where the cover is null; a 0 stays 0; manager column added for All managers; Summary swaps the date', () => {
  const cols = jt.jointColumns('day', false)
  const r = jrow({ rep_am: 0, joint_am: 0, cover_am: null, rep_pm: 4, joint_pm: 0, cover_pm: 0 })
  const txt = (id) => jt.jointText(cols.find((c) => c.id === id), r)
  assert.equal(txt('rep_am'), '-'); assert.equal(txt('with_am'), '-')
  assert.equal(txt('rep_pm'), '4'); assert.equal(txt('with_pm'), '0')
  assert.equal(jt.jointText(cols.find((c) => c.id === 'cover'), jrow({ cover_total: null })), '-')
  assert.equal(jt.jointColumns('day', true)[0].id, 'manager')
  const sum = jt.jointColumns('month', false); assert.ok(sum.some((c) => c.id === 'days') && !sum.some((c) => c.id === 'day'))
  assert.equal(jt.jointText(sum.find((c) => c.id === 'days'), jrow({ joint_days: 3 })), '3')
})
t('joint days: Total row sums every column and coverage = SUM(joint) / SUM(rep), never an average of percentages', () => {
  const rows = [
    jrow({ rep_id: 1, day: '2026-09-01', rep_total: 2, joint_total: 2, cover_total: 1, rep_am: 2, joint_am: 2, cover_am: 1, rep_pm: 0, joint_pm: 0, cover_pm: null, rep_pharmacy: 0, joint_pharmacy: 0, cover_pharmacy: null }),
    jrow({ rep_id: 2, day: '2026-09-01', rep_total: 30, joint_total: 3, cover_total: 0.1, rep_am: 10, joint_am: 0, cover_am: 0, rep_pm: 20, joint_pm: 3, cover_pm: 0.15, rep_pharmacy: 0, joint_pharmacy: 0, cover_pharmacy: null }),
    jrow({ rep_id: 1, day: '2026-09-02' }),
  ]
  const tot = jt.totalJointRow(rows, jt.distinctDays(rows))
  assert.equal(tot.rep_total, 49); assert.equal(tot.joint_total, 15); assert.equal(tot.cover_total, 15 / 49); assert.notEqual(tot.cover_total, (1 + 0.1 + 10 / 17) / 3)
  assert.equal(tot.rep_name, 'TOTAL  (2 Days)'); assert.equal(jt.totalJointRow(rows.slice(0, 1), 1).rep_name, 'TOTAL  (1 Day)')
  assert.equal(tot.cover_am, (2 + 0 + 1) / (2 + 10 + 2)); assert.equal(jt.totalJointRow([], 0).cover_total, null)
  const cards = jt.jointCards(tot)
  assert.deepEqual(cards.map((c) => c.title), ['AM VISITS COVERAGE', 'PM VISITS COVERAGE', 'PHARMACY COVERAGE', 'TOTAL FIELD COVERAGE'])
  assert.equal(cards[3].value, '30.6%'); assert.equal(cards[3].caption, '15 of 49 visits joint-covered'); assert.equal(cards[0].head, '#1B7A45'); assert.equal(cards[1].body, '#FDEDED')
  assert.equal(jt.jointCards(jt.totalJointRow([], 0))[0].value, '—')
})
t('joint days: filters (line, manager, search, date range), order, default manager', () => {
  const rows = [
    jrow({ rep_id: 1, day: '2026-09-05', rep_name: 'Zed' }), jrow({ rep_id: 2, day: '2026-09-01', rep_name: 'Amr', manager: 'Basma', manager_id: 2, line: 'CIRA 2', joint_total: 0 }),
    jrow({ rep_id: 3, day: '2026-09-01', rep_name: 'Bahaa', rep_code: 'B7' }),
  ]
  const f = { line: null, manager: '', search: '', from: '', to: '' }
  assert.equal(jt.filterJoint(rows, f).length, 3)
  assert.deepEqual(jt.filterJoint(rows, { ...f, manager: 'Tarek' }).map((r) => r.rep_id), [1, 3])
  assert.deepEqual(jt.filterJoint(rows, { ...f, line: 'CIRA 2' }).map((r) => r.rep_id), [2])
  assert.deepEqual(jt.filterJoint(rows, { ...f, search: 'b7' }).map((r) => r.rep_id), [3])
  assert.deepEqual(jt.filterJoint(rows, { ...f, from: '2026-09-02' }).map((r) => r.rep_id), [1])
  assert.deepEqual(jt.filterJoint(rows, { ...f, to: '2026-09-01' }).map((r) => r.rep_id), [2, 3])
  assert.deepEqual(jt.orderJoint(rows, 'day').map((r) => r.rep_name), ['Amr', 'Bahaa', 'Zed'])
  assert.deepEqual(jt.jointManagers(rows), ['Basma', 'Tarek'])
  assert.equal(jt.defaultManager(rows), 'Tarek') // Basma only has a row with no joint visits
  assert.equal(jt.defaultManager([]), '')
  const monthRow = jt.toJointRow({ month: '2026-09-01', manager: 'M', rep_id: 1, joint_days: 4, joint_total: 1 })
  assert.equal(monthRow.day, null); assert.equal(jt.filterJoint([monthRow], { ...f, from: '2026-09-09' }).length, 1) // dates only apply to the day view
})
t('joint days: period label, date format and month bounds', () => {
  assert.equal(jt.periodLabel('2026-09-01'), 'PERIOD: 1 SEPTEMBER 2026 – 30 SEPTEMBER 2026')
  assert.equal(jt.periodLabel('2028-02-01'), 'PERIOD: 1 FEBRUARY 2028 – 29 FEBRUARY 2028')
  assert.equal(jt.fmtDate('2026-09-01'), '01-Sep-2026'); assert.equal(jt.fmtDate(null), '-')
  assert.deepEqual(jt.monthBounds('2026-02-01'), { first: '2026-02-01', last: '2026-02-28' })
})
t('joint days: Excel grid has the title band, KPI strip, grouped header in the group colours, zebra body and Total row', () => {
  const rows = [jrow({ day: '2026-09-01', rep_name: 'Amr' }), jrow({ day: '2026-09-02', rep_name: 'Bahaa', cover_am: null, rep_am: 0, joint_am: 0 }), jrow({ day: '2026-09-03', rep_name: 'Cairo' })]
  const cols = jt.jointColumns('day', false)
  const tot = jt.totalJointRow(rows, 3)
  const g = jt.buildJointGrid({ cols, rows, total: tot, month: '2026-09-01', managerLabel: 'Tarek Yousry' })
  const n = cols.length
  assert.ok(g.cells.every((r) => r.length === n))
  assert.equal(g.cells[0][0].v, 'MANAGER JOINT DAYS REPORT'); assert.equal(g.cells[0][0].s.fill.fgColor.rgb, '20293A')
  assert.equal(g.cells[2][0].v, 'PERIOD: 1 SEPTEMBER 2026 – 30 SEPTEMBER 2026   |   MANAGER: TAREK YOUSRY'); assert.equal(g.cells[2][0].s.fill.fgColor.rgb, '1B7A45')
  assert.ok(g.merges.some((m) => m.s.r === 0 && m.s.c === 0 && m.e.c === n - 1))
  const kpi = g.cells[4].filter((c) => c.v !== null).map((c) => c.v); assert.deepEqual(kpi, ['AM VISITS COVERAGE', 'PM VISITS COVERAGE', 'PHARMACY COVERAGE', 'TOTAL FIELD COVERAGE'])
  const gi = g.cells.findIndex((r) => r[0].v === 'REP / VISIT INFO')
  assert.ok(gi > 0); assert.deepEqual(g.cells[gi].filter((c) => c.v !== null).map((c) => c.v), ['REP / VISIT INFO', 'AM VISITS', 'PM VISITS', 'PHARMACY VISITS', 'DAY TOTALS'])
  assert.equal(g.cells[gi][4].s.fill.fgColor.rgb, '1B7A45'); assert.equal(g.cells[gi + 1][4].s.fill.fgColor.rgb, '229A57'); assert.equal(g.cells[gi + 1][6].s.fill.fgColor.rgb, 'DB3A3F'); assert.equal(g.cells[gi + 1][8].s.fill.fgColor.rgb, '39A088')
  assert.equal(g.cells[gi + 1][4].v, 'Rep\nTotal')
  const b0 = g.cells[gi + 2], b1 = g.cells[gi + 3]
  assert.equal(b0[0].v, 'Amr'); assert.equal(b0[0].s.fill, undefined); assert.equal(b1[0].s.fill.fgColor.rgb, 'F4F6F8') // zebra on every second row
  assert.equal(b1[4].v, '-'); assert.equal(b1[5].v, '-') // null AM cover
  assert.equal(b0[3].v, '01-Sep-2026'); assert.equal(b0[12].z, '0.0%'); assert.equal(b0[12].v, 10 / 17)
  const tr = g.cells[gi + 5]
  assert.equal(tr[0].v, 'TOTAL  (3 Days)'); assert.equal(tr[0].s.fill.fgColor.rgb, '20293A'); assert.equal(tr[4].s.fill.fgColor.rgb, '1B7A45'); assert.equal(tr[6].s.fill.fgColor.rgb, 'B81F27')
  assert.equal(tr[8].s.fill.fgColor.rgb, '2C7E6E'); assert.equal(tr[12].s.fill.fgColor.rgb, '39465C'); assert.equal(tr[12].v, tot.cover_total)
  assert.equal(g.widths.length, n); assert.equal(g.heights.length, g.cells.length)
})
t('joint days: flat CSV rows follow the table columns, coverage as a percentage number', () => {
  const rows = [jrow({ day: '2026-09-01' })]
  const cols = jt.jointColumns('day', false)
  const flat = jt.jointFlatRows(cols, rows, jt.totalJointRow(rows, 1))
  assert.equal(flat.length, 2); assert.deepEqual(Object.keys(flat[0]).slice(0, 5), ['Rep Name', 'Line', 'Territory (Box)', 'Visit Date', 'Rep Total'])
  assert.equal(flat[0]['Visit Date'], '01-Sep-2026'); assert.equal(flat[0]['Coverage %'], 58.8); assert.equal(flat[1]['Rep Name'], 'TOTAL  (1 Day)')
})

const crow = (o) => cv.toCoverRow({ manager_id: 1, manager: 'M1', rep_id: 1, rep_name: 'Rep 1', rep_code: 'R1', line: 'L1', box: 'B1', list_doctors: 0, covered_doctors: 0, coverage_pct: null, repeat_doctors: 0, joint_visits: 0, offlist_doctors: 0, offlist_visits: 0, ...o })

t('manager coverage: period range (month / quarter / semester / YTD) and label', () => {
  assert.deepEqual(cv.periodRange('month', '2026-09-01'), { from: '2026-09-01', to: '2026-09-01' })
  assert.deepEqual(cv.periodRange('quarter', '2026-09-01'), { from: '2026-07-01', to: '2026-09-01' })
  assert.deepEqual(cv.periodRange('quarter', '2026-10-01'), { from: '2026-10-01', to: '2026-10-01' })
  assert.deepEqual(cv.periodRange('semester', '2026-06-01'), { from: '2026-01-01', to: '2026-06-01' })
  assert.deepEqual(cv.periodRange('semester', '2026-09-01'), { from: '2026-07-01', to: '2026-09-01' })
  assert.deepEqual(cv.periodRange('ytd', '2026-09-01'), { from: '2026-01-01', to: '2026-09-01' })
  assert.equal(cv.periodText('2026-07-01', '2026-09-01'), 'Jul - Sep 2026'); assert.equal(cv.periodText('2026-09-01', '2026-09-01'), 'Sep 2026')
})

t('manager coverage: totals are SUM(covered)/SUM(list), null list shows "-", zero pairs counted', () => {
  const rows = [crow({ rep_id: 1, list_doctors: 100, covered_doctors: 50, coverage_pct: 0.5 }), crow({ rep_id: 2, list_doctors: 10, covered_doctors: 0, coverage_pct: 0 }), crow({ rep_id: 3 })]
  const tot = cv.sumCover(rows)
  assert.equal(tot.list_doctors, 110); assert.equal(tot.covered_doctors, 50); assert.ok(Math.abs(tot.coverage_pct - 50 / 110) < 1e-12)
  assert.equal(tot.zero_pairs, 1); assert.equal(cv.sumCover([crow({})]).coverage_pct, null)
  assert.equal(cv.fmtPct(null), '-'); assert.equal(cv.fmtPct(0.5), '50.0%')
})

t('manager coverage: groups Line -> Manager, sorts reps, null values last; top speciality = highest share', () => {
  const rows = [crow({ rep_id: 1, rep_name: 'B', list_doctors: 5 }), crow({ rep_id: 2, rep_name: 'A', list_doctors: 9 }), crow({ rep_id: 3, rep_name: 'C', list_doctors: 1, line: 'L0', manager: 'M0', manager_id: 0 })]
  const g = cv.groupCover(rows, new Map(), { id: 'list', desc: true })
  assert.deepEqual(g.map((l) => l.line), ['L0', 'L1']); assert.deepEqual(g[1].managers[0].reps.map((r) => r.rep_name), ['A', 'B'])
  assert.equal(g[1].total.list_doctors, 14)
  const spec = cv.groupSpec([{ manager_id: 1, rep_id: 1, speciality: 'X', covered_doctors: 1, share_pct: 0.2 }, { manager_id: 1, rep_id: 1, speciality: 'Y', covered_doctors: 2, share_pct: 0.8 }].map(cv.toSpecRow))
  assert.equal(cv.topSpeciality(spec.get('1|1')).speciality, 'Y')
})

t('manager coverage: shift tooltip explains the whole-list denominator under AM / PM only', () => {
  const pct = cv.COVER_COLS.find((c) => c.id === 'pct')
  assert.equal(cv.colTip(pct, 'ALL'), pct.tip)
  assert.match(cv.colTip(pct, 'AM'), /whole active list.*AM shift/); assert.equal(cv.shiftText('PM'), 'PM shift')
})

t('manager coverage: doctors order = not covered first, then class A/B/C; shares given as 0..100 are normalised', () => {
  const d = (o) => cv.toDocRow({ doctor_id: 1, doctor_name: 'N', covered: false, ...o })
  const o = cv.orderDoctors([d({ doctor_id: 1, covered: true, class: 'A' }), d({ doctor_id: 2, class: 'C' }), d({ doctor_id: 3, class: 'A' }), d({ doctor_id: 4, class: 'B' })])
  assert.deepEqual(o.map((x) => x.doctor_id), [3, 4, 2, 1])
  assert.equal(cv.normalizeShares([cv.toSpecRow({ share_pct: 40 }), cv.toSpecRow({ share_pct: 60 })])[0].share_pct, 0.4)
  assert.equal(cv.normalizeShares([cv.toSpecRow({ share_pct: 0.4 })])[0].share_pct, 0.4)
})

const rep = (o) => ch.toRepSummary({ rep_key: 'k1', rep_name: 'Rep', visits: 0, ...o })

t('coaching: KPIs weight by visits; % improving counts reps with >= 2 visits only; weakest company skill', () => {
  const reps = [rep({ rep_key: 'a', visits: 3, avg_score: 4, change: 0.5 }), rep({ rep_key: 'b', visits: 1, avg_score: 2, change: 1 }), rep({ rep_key: 'c', visits: 2, avg_score: 3, change: -0.2 }), rep({ rep_key: 'd', visits: 0 })]
  const k = ch.coachKpis(reps)
  assert.equal(k.visits, 6); assert.equal(k.repsCoached, 3); assert.ok(Math.abs(k.avg - (4 * 3 + 2 * 1 + 3 * 2) / 6) < 1e-12)
  assert.equal(k.eligible, 2); assert.equal(k.improving, 1); assert.equal(k.pctImproving, 0.5)
  const sk = [ch.toSkillRow({ scope_type: 'COMPANY', skill_code: 'Q1', skill_name: 'A', sort: 1, avg_score: 4 }), ch.toSkillRow({ scope_type: 'COMPANY', skill_code: 'Q2', skill_name: 'B', sort: 2, avg_score: 3.1 }), ch.toSkillRow({ scope_type: 'REP', scope_key: 'x', skill_code: 'Q3', avg_score: 1 })]
  assert.deepEqual(ch.weakestCompanySkill(sk), { name: 'B', score: 3.1 })
})

t('coaching: totals row is weighted by visits; reps without coaching sort last and show no values', () => {
  const reps = [rep({ rep_key: 'a', rep_name: 'A', visits: 3, avg_score: 4, training_visits: 3, training_avg: 4, manager_visits: 0 }), rep({ rep_key: 'b', rep_name: 'B', visits: 1, avg_score: 2, training_visits: 0, manager_visits: 1, manager_avg: 2 }), rep({ rep_key: 'z', rep_name: 'Z', visits: 0 })]
  const tot = ch.totalReps(reps)
  assert.equal(tot.visits, 4); assert.equal(tot.avg_score, 3.5); assert.equal(tot.training_avg, 4); assert.equal(tot.manager_avg, 2); assert.equal(tot.gap, 2)
  assert.deepEqual(ch.sortReps(reps, { id: 'visits', desc: false }).map((r) => r.rep_key), ['b', 'a', 'z'])
  assert.deepEqual(ch.sortReps(reps, { id: 'visits', desc: true }).map((r) => r.rep_key), ['a', 'b', 'z'])
})

t('coaching: weakest 5 per scope, bars ascending with bottom 5 flagged and company marker', () => {
  const rows = []
  for (let i = 1; i <= 7; i++) rows.push(ch.toSkillRow({ scope_type: 'COMPANY', scope_key: 'all', scope_name: 'Company', skill_code: `Q${i}`, skill_name: `S${i}`, sort: i, avg_score: i }))
  for (let i = 1; i <= 7; i++) rows.push(ch.toSkillRow({ scope_type: 'LINE', scope_key: 'L1', scope_name: 'Line 1', skill_code: `Q${i}`, skill_name: `S${i}`, sort: i, avg_score: 8 - i }))
  const w = ch.weakestByScope(rows, ['COMPANY', 'LINE'])
  assert.deepEqual(w[0].skills.map((s) => s.name), ['S1', 'S2', 'S3', 'S4', 'S5']); assert.deepEqual(w[1].skills.map((s) => s.name), ['S7', 'S6', 'S5', 'S4', 'S3'])
  const bars = ch.skillBars(rows, 'LINE', 'L1')
  assert.equal(bars[0].name, 'S7'); assert.equal(bars.filter((b) => b.weak).length, 5); assert.equal(bars[0].company, 7)
})

t('coaching: sparkline breaks at months without an evaluation; month grid marks them; periods', () => {
  const months = ch.monthsBetween('2026-01-01', '2026-05-01')
  assert.equal(months.length, 5)
  const by = new Map([['2026-01-01', 3], ['2026-02-01', 4], ['2026-04-01', 5]])
  const { runs, points } = ch.sparkRuns(months, by, 100, 20)
  assert.equal(points, 3); assert.deepEqual(runs.map((r) => r.length), [2, 1])
  const g = ch.monthGrid(months, [ch.toRepMonth({ rep_key: 'k', month: '2026-02-01', avg_score: 4, visits: 2 })])
  assert.deepEqual(g.map((x) => x.score), [null, 4, null, null, null])
  assert.deepEqual(ch.defaultPeriod([ch.toTrendRow({ month: '2026-03-01', visits: 5 }), ch.toTrendRow({ month: '2026-08-01', visits: 7 }), ch.toTrendRow({ month: '2026-09-01', visits: 0 })]), { from: '2026-01-01', to: '2026-08-01' })
})

t('coaching: conflict summary, scores json, effect shares and finalize result shapes', () => {
  const reps = [rep({ rep_key: 'a', training_visits: 1, manager_visits: 1, training_avg: 4, manager_avg: 3, gap: 1, conflict: true }), rep({ rep_key: 'b', training_visits: 2, manager_visits: 1, conflict: false }), rep({ rep_key: 'c', training_visits: 1, manager_visits: 0 })]
  assert.deepEqual(ch.conflictSummary(reps), { conflicts: 1, comparable: 2, pct: 0.5 }); assert.equal(ch.higherSide(reps[0]), 'Training')
  assert.deepEqual(ch.parseScores('{"Q1": 3, "Q2": "4"}'), { Q1: 3, Q2: 4 }); assert.deepEqual(ch.parseScores(null), {})
  assert.equal(ch.normalizeEffect([ch.toEffectRow({ band: 'a', pct_improved: 60 }), ch.toEffectRow({ band: 'b', pct_improved: 45 })])[0].pct_improved, 0.6)
  const f = cr.readFinalize({ visits: 120, unmatched_reps: ['Ali', { name: 'Sara', count: 4 }], unmatched_evaluators: [{ evaluator: 'X' }], incomplete_visits: [{ visit_id: 77 }, 78] })
  assert.equal(f.visits, 120); assert.deepEqual(f.unmatchedReps.map((x) => x.name), ['Ali', 'Sara']); assert.equal(f.unmatchedEvaluators[0].name, 'X'); assert.equal(f.incompleteCount, 2)
  const g = cr.readFinalize([{ visits: 5, incomplete_visits: 1 }, { visits: 7, incomplete_visits: 2 }])
  assert.equal(g.visits, 12); assert.equal(g.incompleteCount, 3)
})

/* ------------------------------------ sales ------------------------------------ */
const cells = (a, b, c, d, e, f) => `<table><tr><th>${a}<th>${b}<th>${c}<th>${d}<th>${e}<th>${f}</tr></table><table><tr><th>9<th>9<th>9<th>9<th>9<th>9</tr></table>`
const seg = (type, name, rep, six) => `<tr align='center' class=x><td>${type}<td>${name}<th class=a>&nbsp;</th>${rep === null ? '' : `<td><nobr>${rep}</nobr><th width='5'>|`}${six}`
const htmlFile = (year, mon, line, bodies) => `<html><caption>${year} Sales Analysis Report</caption><table><tr><th>${mon}<th>Units</tr></table>${bodies.join('\n')}</html>`
const goodHtml = htmlFile(2026, 'SEP', 1, [
  seg('C', 'CIRA 1', null, cells('30', '40', '75%', '1,500', '2,000', '75%')),
  seg('T', 'Box A', 'Ali &amp; Co', cells('', '', '', '', '', '')),
  seg('', 'Prod X', null, cells('10', '20', '50%', '1,000', '1,200', '83%')),
  seg('', 'Prod Y', null, cells('', '5', '', '500', '', '')),
  seg('T', 'Box B', 'Vacant', cells('', '', '', '', '', '')),
  seg('', 'Prod X', null, cells('0', '0', '', '0', '800', '0%')),
  seg('D', 'District 1', null, cells('1', '1', '', '9,999', '9,999', '')),
  seg('', 'Prod X', null, cells('1', '1', '', '9,999', '9,999', '')),
])
t('sales parser: rows, rep name, check row, unit cells and totals', () => {
  const f = sp2.parseSalesFile('9_1.xls', goodHtml)
  assert.deepEqual(f.errors, []); assert.equal(f.line, 'CIRA 1'); assert.equal(f.month, '2026-09')
  assert.equal(f.rows.length, 3); assert.equal(f.territories, 2); assert.equal(f.products, 2)
  assert.equal(f.rows[0].md, 'Ali & Co'); assert.equal(f.rows[2].md, 'Vacant'); assert.equal(f.rows[0].s_value, 1000); assert.equal(f.rows[1].t_value, null)
  assert.deepEqual(f.check, { line: 'CIRA 1', month: '2026-09', s_value: 1500, t_value: 2000 })
  assert.equal(f.sumValue, 1500); assert.equal(f.sumTarget, 2000); assert.ok(sp2.valueMatches(f)); assert.ok(sp2.targetMatches(f))
  assert.equal(f.rows.every((r) => r.line === 'CIRA 1' && r.month === '2026-09'), true)
})
t('sales parser: content decides, file name is only a warning; tolerance is max(5, 0.05%)', () => {
  assert.equal(sp2.parseSalesFile('8_1.xls', goodHtml).errors.length, 0)
  assert.equal(sp2.parseSalesFile('8_1.xls', goodHtml).warnings.length, 1)
  assert.equal(sp2.parseSalesFile('9_2.xls', goodHtml).warnings.length, 1)
  const ok = sp2.parseSalesFile('9 1.xls', goodHtml); assert.equal(ok.warnings.length, 0); assert.equal(ok.month, '2026-09')
  assert.equal(sp2.parseSalesFile('report.xls', goodHtml).warnings.length, 0); assert.equal(sp2.parseSalesFile('report.xls', goodHtml).line, 'CIRA 1')
  assert.equal(sp2.parseSalesFile('9_1.xls', goodHtml.replace('2026 Sales Analysis Report', 'Sales')).errors.length, 1)
  assert.deepEqual(sp2.parseFileName('12_3.XLS'), { month: 12, line: 3 }); assert.deepEqual(sp2.parseFileName('9-1.xls'), { month: 9, line: 1 }); assert.equal(sp2.parseFileName('13_1.xls'), null); assert.equal(sp2.parseFileName('1_4.xls'), null); assert.equal(sp2.parseFileName('abc.xls'), null)
  assert.equal(sp2.valueMatches(sp2.parseSalesFile('9_1.xls', goodHtml.replace('1,000', '1,050'))), false)
  assert.equal(sp2.tolerance(100), 5); assert.equal(sp2.tolerance(2700000), 1350)
  const big = sp2.parseSalesFile('9_1.xls', goodHtml.replace('1,500', '1,537'))
  assert.equal(sp2.valueMatches(big), false)
  assert.equal(sp2.valueMatches({ ...big, sumValue: 2699963, check: { ...big.check, s_value: 2700000 } }), true)
})
t('sales parser: months grouped, missing lines and duplicates', () => {
  const a = sp2.parseSalesFile('9_1.xls', goodHtml)
  const dup = sp2.parseSalesFile('9_1.xls', goodHtml)
  const g = sp2.groupByMonth([a, dup, sp2.parseSalesFile('x.xls', goodHtml)])
  assert.equal(g.groups.length, 1); assert.deepEqual(g.groups[0].missing, [2, 3]); assert.equal(g.duplicates.length, 2); assert.equal(g.groups[0].rows, 3)
  assert.deepEqual(sp2.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
})
t('sales result: tolerant finalize reading', () => {
  const f = sr.readSalesFinal([{ rows: 100, skipped_zero: 3, rejected: ['territory not found: Box Z', { reason: 'x', territory: 'Q' }], total_mismatch: [{ month: '2026-09', line: 'CIRA 1' }], rows_without_org: 4, territories_without_sales: [{ territory: 'T1' }], rep_name_differs: [{ month: 'm', territory: 't' }] }, { rows: 50 }])
  assert.equal(f.rows, 150); assert.equal(f.skippedZero, 3); assert.equal(f.mismatch.length, 1); assert.equal(f.rowsWithoutOrg.count, 4); assert.equal(f.territoriesWithoutSales.count, 1); assert.equal(f.repDiffers.length, 1)
  assert.deepEqual(sr.columnsOf([{ b: 1, a: 2 }], ['a']), ['a', 'b'])
})

const smrow = (month, line_id) => ({ month, line_id, line_name: `CIRA ${line_id}`, rows: 10, s_value: 1, t_value: 1 })
t('sales periods: options only for loaded months, quarter / semester ids', () => {
  const loaded = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-07-01', '2026-08-01', '2026-09-01']
  assert.deepEqual(sm.loadedMonths([smrow('2026-02-01', 1), smrow("2026-02-01", 2), smrow("2026-01-01", 1)]), ['2026-01-01', '2026-02-01'])
  const q = sm.periodOptions('quarter', loaded)
  assert.deepEqual(q.map((o) => o.id), ['2026-Q1', '2026-Q2', '2026-Q3']); assert.equal(q[1].months.length, 1); assert.equal(q[2].months.length, 3)
  const s = sm.periodOptions('semester', loaded); assert.deepEqual(s.map((o) => o.id), ['2026-S1', '2026-S2']); assert.equal(s[0].months.length, 4)
  assert.equal(sm.periodOptions('month', loaded).length, 7)
  assert.deepEqual(sm.calendarMonths('2026-S2')[0], '2026-07-01'); assert.equal(sm.calendarMonths('2026-Q4').length, 3)
  assert.deepEqual(sm.defaultPeriods(q), { sel: '2026-Q3', cmp: '2026-Q2' })
})
t('sales periods: like-for-like (Q3 of 3 months vs first 3 of S1), YTD without comparison', () => {
  const loaded = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']
  const sem = sm.periodOptions('semester', loaded)
  const r = sm.resolvePeriods('semester', sem, '2026-S2', '2026-S1')
  assert.equal(r.from, '2026-07-01'); assert.equal(r.to, '2026-09-01'); assert.equal(r.cmpFrom, '2026-01-01'); assert.equal(r.cmpTo, '2026-03-01')
  assert.equal(r.banner, 'Comparing 3 months vs 3 months (S2 vs first 3 months of S1)'); assert.equal(r.hasCmp, true)
  const qs = sm.periodOptions('quarter', loaded)
  const q = sm.resolvePeriods('quarter', qs, '2026-Q3', '2026-Q2')
  assert.equal(q.banner, null); assert.equal(q.cmpFrom, '2026-04-01'); assert.equal(q.cmpTo, '2026-06-01')
  const big = sm.resolvePeriods('semester', sem, '2026-S1', '2026-S2'); assert.match(big.banner, /not like-for-like/)
  const y = sm.resolvePeriods('ytd', sm.periodOptions('ytd', loaded), null, null)
  assert.equal(y.hasCmp, false); assert.equal(y.from, '2026-01-01'); assert.equal(y.to, '2026-09-01'); assert.equal(y.nSel, 9)
  assert.equal(sm.resolvePeriods('month', sm.periodOptions('month', loaded), '2026-09-01', 'none').hasCmp, false)
  assert.equal(sm.resolvePeriods('month', [], null, null), null)
})
t('sales: achievement, growth, tones and heat bands', () => {
  assert.equal(sm.achOf(80, 100), 0.8); assert.equal(sm.achOf(80, 0), null); assert.equal(sm.growthOf(110, 100), 0.1); assert.equal(sm.growthOf(5, 0), null)
  assert.equal(sm.achTone(0.79, 80), 'red'); assert.equal(sm.achTone(0.8, 80), 'amber'); assert.equal(sm.achTone(1, 80), 'green'); assert.equal(sm.achTone(null, 80), 'none')
  assert.deepEqual([0.59, 0.6, 0.79, 0.8, 0.99, 1, null].map(sm.heatTone), ['red', 'orange', 'orange', 'yellow', 'yellow', 'green', 'gray'])
  const k = sm.salesKpi(sm.toSummaryRow({ s_value: 1000, s_units: 10, t_value: 800, t_units: 8, s_value_tgt: 600, s_units_tgt: 6, c_value: 500, c_units: 5, vacant_value: 100, s_value_notgt: 40 }), 'value')
  assert.equal(k.ach, 0.75); assert.equal(k.gap, -200); assert.equal(k.growth, 1); assert.equal(k.vacantShare, 0.1); assert.equal(sm.salesKpi(sm.toSummaryRow({ s_value: 1000, s_units: 10, t_units: 8, s_units_tgt: 6 }), 'units').ach, 0.75)
})
t('sales: ABC classes and product totals use targeted rows for achievement', () => {
  assert.deepEqual(sm.abcClasses([50, 30, 10, 5, 5]), ['A', 'A', 'B', 'C', 'C'])
  assert.deepEqual(sm.abcClasses([100]), ['A']); assert.deepEqual(sm.abcClasses([0, 0]), ['C', 'C'])
  const rows = [
    sm.toProductRow({ product_id: 1, product_name: 'A', s_value: 700, s_units: 7, t_value: 1000, s_value_tgt: 700, c_value: 600, c_units: 6 }),
    sm.toProductRow({ product_id: 2, product_name: 'B', s_value: 300, s_units: 3, t_value: 0, s_value_tgt: 0, c_value: 300, c_units: 3 }),
  ]
  const v = sm.productViews(rows, 'value')
  assert.equal(v[1].noTarget, true); assert.equal(v[1].ach, null); assert.equal(v[0].ach, 0.7); assert.equal(v[0].avgPrice, 100); assert.equal(v[0].share, 0.7)
  const tot = sm.productTotal(rows, 'value'); assert.equal(tot.sales, 1000); assert.equal(tot.ach, 0.7); assert.equal(tot.gap, -300); assert.ok(Math.abs(tot.growth - 1 / 9) < 1e-12)
  assert.deepEqual(sm.sortProducts(v, 'ach', 'asc').map((x) => x.name), ['A', 'B'])
})
t('sales: price / volume / mix adds up exactly, new and discontinued land in mix', () => {
  const rows = [
    sm.toProductRow({ product_id: 1, c_units: 10, c_value: 1000, s_units: 12, s_value: 1320 }), // P0 100 -> P1 110
    sm.toProductRow({ product_id: 2, c_units: 5, c_value: 250, s_units: 4, s_value: 220 }), // P0 50 -> 55
    sm.toProductRow({ product_id: 3, c_units: 0, c_value: 0, s_units: 2, s_value: 300 }), // new
    sm.toProductRow({ product_id: 4, c_units: 3, c_value: 90, s_units: 0, s_value: 0 }), // discontinued
  ]
  const p = sm.pvmBridge(rows)
  assert.equal(p.v0, 1340); assert.equal(p.v1, 1840)
  assert.equal(p.price, (110 - 100) * 12 + (55 - 50) * 4)
  assert.ok(Math.abs(p.volume - (18 - 18) * (1340 / 18)) < 1e-9)
  assert.ok(Math.abs(p.volume + p.price + p.mix - (p.v1 - p.v0)) < 1e-9)
  assert.equal(sm.pvmBridge([]).mix, 0)
  const w = sm.waterfall([{ name: 'a', value: 100, total: true }, { name: 'x', value: -20 }, { name: 'y', value: 50 }, { name: 'b', value: 130, total: true }])
  assert.deepEqual(w.map((b) => [b.base, b.up, b.down, b.total]), [[0, 0, 0, 100], [80, 0, 20, 0], [80, 50, 0, 0], [0, 0, 0, 130]])
  assert.ok(sm.waterDomainMin(w) >= 0 && sm.waterDomainMin(w) <= 80)
  const d = sm.productDeltas([sm.toProductRow({ product_name: 'u', s_value: 10, c_value: 4 }), sm.toProductRow({ product_name: 'd', s_value: 1, c_value: 9 }), sm.toProductRow({ product_name: 'z', s_value: 3, c_value: 3 })], 1)
  assert.deepEqual(d.map((x) => x.name), ['u', 'd'])
  const many = Array.from({ length: 20 }, (_, i) => sm.toProductRow({ product_name: `p${i}`, s_value: i % 2 ? 10 + i : 1, c_value: i % 2 ? 1 : 10 + i }))
  assert.equal(sm.productDeltas(many, 3).length, 7)
})
t('sales: trend points, month-over-month and projection', () => {
  const mo = (month, line_id, s, t, st) => sm.toMonthlyRow({ month, line_id, s_value: s, t_value: t, s_value_tgt: st, s_units: s / 10, t_units: t / 10, vacant_value: 1 })
  const rows = [mo('2026-01-01', 1, 100, 200, 100), mo('2026-01-01', 2, 100, 0, 0), mo('2026-02-01', 1, 300, 200, 150), mo('2026-03-01', 1, 400, 400, 400)]
  const p = sm.trendPoints(rows, null, 'value')
  assert.deepEqual(p.map((x) => x.sales), [200, 300, 400]); assert.equal(p[0].ach, 0.5); assert.equal(p[1].mom, 0.5); assert.equal(p[0].mom, null); assert.equal(p[0].vacant, 2)
  assert.deepEqual(sm.trendPoints(rows, 1, 'units').map((x) => x.sales), [10, 30, 40])
  const pr = sm.projectYear(p)
  assert.equal(pr.remaining, 9); assert.equal(pr.perMonth, 300); assert.equal(pr.ytd, 900); assert.equal(pr.total, 900 + 300 * 9); assert.equal(pr.months[0], '2026-04-01'); assert.equal(pr.months[8], '2026-12-01')
  assert.equal(sm.projectYear([{ month: '2026-12-01', sales: 5, target: 0, ach: null, vacant: 0, mom: null }]), null); assert.equal(sm.projectYear([]), null)
})
t('sales: gap views, rep movers, heat map, company row fallback', () => {
  const g = sm.gapViews([sm.toGapRow({ key_id: 1, key_name: 'A', s_value_tgt: 50, t_value: 100, gap: -50 }), sm.toGapRow({ key_id: 2, key_name: 'Vacant', s_value_tgt: 10, t_value: 100, gap: -90 }), sm.toGapRow({ key_id: 3, key_name: 'C', s_value_tgt: 120, t_value: 100, gap: 20 })])
  assert.deepEqual(g.map((x) => x.key_name), ['Vacant', 'A', 'C']); assert.equal(g[0].isVacant, true); assert.equal(g[1].ach, 0.5)
  const cur = [sm.toGapRow({ key_id: 1, key_name: 'A', s_value: 150 }), sm.toGapRow({ key_id: 2, key_name: 'B', s_value: 40 })]
  const cmp = [sm.toGapRow({ key_id: 1, key_name: 'A', s_value: 100 }), sm.toGapRow({ key_id: 2, key_name: 'B', s_value: 90 }), sm.toGapRow({ key_id: 9, key_name: 'Gone', s_value: 30 })]
  const d = sm.repDeltas(cur, cmp)
  assert.deepEqual(sm.topMovers(d, 'up').map((x) => x.name), ['A']); assert.deepEqual(sm.topMovers(d, 'down').map((x) => x.name), ['B', 'Gone'])
  const h = sm.heatMap([
    sm.toRepProductRow({ rep_id: 1, rep_name: 'Good', product_id: 1, product_name: 'P1', s_value: 100, t_value: 100, s_value_tgt: 100 }),
    sm.toRepProductRow({ rep_id: 2, rep_name: 'Weak', product_id: 1, product_name: 'P1', s_value: 50, t_value: 100, s_value_tgt: 50 }),
    sm.toRepProductRow({ rep_id: 2, rep_name: 'Weak', product_id: 2, product_name: 'P2', s_value: 500, t_value: 0, s_value_tgt: 0 }),
  ])
  assert.deepEqual(h.reps.map((r) => r.rep), ['Weak', 'Good']); assert.equal(h.products[0].name, 'P2'); assert.equal(h.reps[0].cells.get(2).ach, null); assert.equal(h.reps[0].ach, 0.5)
  const co = sm.companyRow([sm.toSummaryRow({ line_id: 1, s_value: 10, vacant_value: 1 }), sm.toSummaryRow({ line_id: 2, s_value: 5, vacant_value: 2 })])
  assert.equal(co.s_value, 15); assert.equal(co.vacant_value, 3)
  assert.equal(sm.companyRow([sm.toSummaryRow({ line_id: null, s_value: 99 }), sm.toSummaryRow({ line_id: 1, s_value: 10 })]).s_value, 99)
})
t('sales: action list - reason text, percent scale detection, field join, ordering, medians', () => {
  const act = (o) => sm.toActionRow({ rep_id: 1, rep_name: 'R', s_value: 640, t_value: 1000, s_value_tgt: 640, ach: 64, last_ach: 50, decline_run: 4, below: true, declining: true, status: 'ACTION', shortfall: 360, top_gap_products: '[{"product":"P","shortfall":100,"ach":40}]', months: '[{"month":"2026-02-01","s":2,"t":3,"st":1},{"month":"2026-01-01","s":1,"t":3,"st":1}]', ...o })
  const a = act({})
  assert.equal(a.top_gap_products[0].shortfall, 100); assert.equal(a.months[0].month, '2026-01-01'); assert.equal(sm.achScale([a]), 100)
  assert.equal(sm.achScale([act({ ach: 0.64 })]), 1)
  const v = sm.actionViews([a, act({ rep_id: 2, rep_name: 'B', status: 'OK', below: false, declining: false, shortfall: 0 }), act({ rep_id: 3, rep_name: 'C', status: 'WATCH', below: true, declining: false, decline_run: 0, shortfall: 10, s_value_tgt: 900, ach: 90 })], new Map([[1, { rep_id: 1, visits: 20, coaching_visits: 1, coaching_avg: 3.5, months: 4 }]]), 80)
  assert.equal(v[0].reason, 'Ach 64% (< 80) and sales down 4 months in a row'); assert.equal(v[0].lastAchF, 0.5); assert.equal(v[0].visits, 20); assert.equal(v[0].avgVisits, 5); assert.equal(v[0].perVisit, 32); assert.equal(v[0].coachAvg, 3.5)
  assert.equal(v[1].reason, 'On track'); assert.equal(v[2].reason, 'Ach 90% (< 80)'); assert.equal(v[1].visits, null)
  assert.deepEqual(sm.sortActions(v).map((x) => x.status), ['ACTION', 'WATCH', 'OK']); assert.deepEqual(sm.actionCounts([a, act({ status: 'WATCH' }), act({ status: 'OK' })]), { action: 1, watch: 1, ok: 1 })
  assert.equal(sm.median([3, 1, 2]), 2); assert.equal(sm.median([4, 1, 2, 3]), 2.5); assert.equal(sm.median([]), null)
  const pts = sm.scatterPoints(v); assert.equal(pts.length, 1); assert.equal(pts[0].y, 64); assert.equal(pts[0].x, 5)
  const mf = sm.mergeField([[sm.toFieldRow({ rep_id: 1, visits: 30, coaching_visits: 1, coaching_avg: 4 }), sm.toFieldRow({ rep_id: 2, visits: 0 })], [sm.toFieldRow({ rep_id: 1, visits: 10 }), sm.toFieldRow({ rep_id: 2, visits: 6 })], [sm.toFieldRow({ rep_id: 1, visits: 0 })]])
  assert.deepEqual(mf.map((x) => [x.rep_id, x.visits, x.months]), [[1, 40, 2], [2, 6, 1]]); assert.equal(mf[0].coaching_avg, 4)
  assert.equal(sm.quadrantOf({ x: 30, y: 50 }, 20, 80), 'High activity / low result'); assert.equal(sm.quadrantOf({ x: 5, y: 50 }, 20, 80), 'Low activity / low result')
  assert.equal(sm.rangeText('2026-07-01', '2026-09-01'), 'Jul - Sep 2026'); assert.equal(sm.rangeText('2026-09-01', '2026-09-01'), 'Sep 2026')
  const x = sr.splitRejected(['territory not found: Box 1', 'territory not found: Box 1', 'bad month'])
  assert.deepEqual(x.notFound, [{ name: 'Box 1', count: 2 }]); assert.deepEqual(x.other, ['bad month'])
})
console.log(`\n${n} tests passed`)
