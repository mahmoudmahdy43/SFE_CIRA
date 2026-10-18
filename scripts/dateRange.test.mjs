// Run: npm run test:date-range
import assert from 'node:assert/strict'
import * as d from '../src/lib/dateRange.ts'
import * as k from '../src/features/reports/kpiRangeMath.ts'
import * as a from '../src/features/reports/absenceDaily.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }

/* ---- useDateRange(): the hook is resolveRange(URL params, month) + the setters' URL writes; tested through those ---- */
t('month: a plain month is its first to its last day', () => {
  const r = d.resolveRange({}, '2026-02-01')
  assert.deepEqual([r.from, r.to, r.month], ['2026-02-01', '2026-02-28', '2026-02-01'])
  assert.equal(r.isFullMonth, true); assert.equal(r.isSingleMonth, true); assert.equal(r.custom, false)
})
t('custom: partial range inside a month', () => {
  const r = d.resolveRange({ from: '2026-10-01', to: '2026-10-15' }, '2026-09-01')
  assert.deepEqual([r.from, r.to, r.month], ['2026-10-01', '2026-10-15', '2026-10-01'])
  assert.equal(r.isFullMonth, false); assert.equal(r.isSingleMonth, true); assert.equal(r.custom, true)
})
t('custom: crossing months uses the month of the To date', () => {
  const r = d.resolveRange({ from: '2026-09-20', to: '2026-10-05' }, '2026-01-01')
  assert.equal(r.month, '2026-10-01'); assert.equal(r.isSingleMonth, false); assert.equal(r.isFullMonth, false)
  assert.deepEqual(d.monthsSpan(r.from, r.to), ['2026-09-01', '2026-10-01'])
})
t('isFullMonth: only 1st..last of ONE month (also when picked as a custom range)', () => {
  assert.equal(d.resolveRange({ from: '2026-10-01', to: '2026-10-31' }, '2026-01-01').isFullMonth, true)
  assert.equal(d.resolveRange({ from: '2026-10-02', to: '2026-10-31' }, '2026-01-01').isFullMonth, false)
  assert.equal(d.resolveRange({ from: '2026-10-01', to: '2026-10-30' }, '2026-01-01').isFullMonth, false)
  assert.equal(d.resolveRange({ from: '2026-09-01', to: '2026-10-31' }, '2026-01-01').isFullMonth, false)
  assert.equal(d.isWholeMonths({ from: '2026-09-01', to: '2026-10-31' }), true)
  assert.equal(d.isWholeMonths({ from: '2026-09-02', to: '2026-10-31' }), false)
})
t('invalid parameters fall back to the month (From > To, outside 2026, bad dates, only one side)', () => {
  for (const p of [{ from: '2026-10-15', to: '2026-10-01' }, { from: '2025-12-31', to: '2026-01-05' }, { from: '2026-12-30', to: '2027-01-02' },
    { from: '2026-02-30', to: '2026-03-01' }, { from: 'x', to: '2026-03-01' }, { from: '2026-03-01', to: null }, {}]) {
    const r = d.resolveRange(p, '2026-05-01')
    assert.equal(r.custom, false); assert.deepEqual([r.from, r.to], ['2026-05-01', '2026-05-31'])
  }
})
t('URL round trip: write the range, read it back, resolve to the same range; other params are kept', () => {
  const search = d.withRangeParams('?type=rep&id=7', { from: '2026-10-01', to: '2026-10-15' })
  assert.equal(search, '?type=rep&id=7&from=2026-10-01&to=2026-10-15')
  const back = d.resolveRange(d.readRangeParams(search), '2026-01-01')
  assert.deepEqual([back.from, back.to, back.custom], ['2026-10-01', '2026-10-15', true])
  assert.equal(d.withRangeParams(search, null), '?type=rep&id=7') // picking a month removes them
  assert.equal(d.withRangeParams('?from=2026-10-01&to=2026-10-15', null), '')
})
t('quick chips are relative to the latest visit date', () => {
  const p = Object.fromEntries(d.presets('2026-10-18', '2026-10-16').map((x) => [x.id, [x.from, x.to]]))
  assert.deepEqual(p['this-month'], ['2026-10-01', '2026-10-31'])
  assert.deepEqual(p['last-month'], ['2026-09-01', '2026-09-30'])
  assert.deepEqual(p['last-7'], ['2026-10-10', '2026-10-16'])
  assert.deepEqual(p['last-15'], ['2026-10-02', '2026-10-16'])
  assert.deepEqual(p.mtd, ['2026-10-01', '2026-10-16'])
  assert.deepEqual(Object.fromEntries(d.presets('2026-10-18', null).map((x) => [x.id, x.to]))['last-7'], '2026-10-18') // no visits: today
  assert.equal(d.presets('2026-01-03', '2026-01-03').find((x) => x.id === 'last-15').from, '2026-01-01') // clamped to the data year
})
t('words, file names and the monthly note', () => {
  assert.equal(d.periodLabel('2026-10-01', '2026-10-15'), '1 Oct - 15 Oct 2026')
  assert.equal(d.rangeFileSlug('2026-10-01', '2026-10-15'), '2026-10-01_to_2026-10-15')
  assert.equal(d.monthlyNote(d.monthRange('2026-10-01')), null)
  assert.equal(d.monthlyNote(d.resolveRange({ from: '2026-09-20', to: '2026-10-05' }, '2026-01-01')), 'this report is monthly: showing Oct 2026')
})

/* ---- KPI by rep for a partial range ---- */
const raw = (o) => ({ rep_id: 1, rep_name: 'A', rep_code: 'C1', box_name: 'B1', line_id: 1, manager_id: 10, total_visits: 60, visits_pm: 60, days_pm: 10, missing_pm: 1, call_rate_pm: 6, target_pm: 8, ach_cr: 0.75, ...o })
const row = (o) => k.toRangeRepRow(raw(o), { line: 'CIRA 1', manager: 'M' }, '2026-10-01')
t('rule: Coverage / PCF / Total KPI (and the list numbers behind them) are null for a partial range, and the columns are flagged', () => {
  const r = row({})
  for (const f of ['coverage', 'pcf', 'total_kpi', 'list_doctors', 'covered_doctors', 'target_visits', 'valid_visits']) assert.equal(r[f], null, f)
  for (const id of ['coverage', 'pcf', 'kpi']) assert.ok(k.MONTHLY_ONLY_COLUMNS.has(id), id)
  for (const id of ['total', 'days', 'missing', 'cr', 'expected', 'ach']) assert.ok(!k.MONTHLY_ONLY_COLUMNS.has(id), id)
  assert.match(k.MONTHLY_ONLY_TIP, /monthly only \(Freq is a monthly target\)/)
  assert.equal(r.expected_visits, 80); assert.equal(r.total_visits, 60); assert.equal(r.ach_cr, 0.75)
  const g = k.aggregateRange([r])
  assert.equal(g.coverage, null); assert.equal(g.pcf, null); assert.equal(g.total_kpi, null)
})
t('roll-ups come from sums, never from averaging rates', () => {
  const a1 = row({ rep_id: 1, total_visits: 10, visits_pm: 10, days_pm: 2, target_pm: 10, ach_cr: 0.5 })   // expected 20, 50%
  const a2 = row({ rep_id: 2, total_visits: 90, visits_pm: 90, days_pm: 18, target_pm: 5, ach_cr: 1 })    // expected 90, 100%
  const t2 = k.aggregateRange([a1, a2])
  assert.equal(t2.total_visits, 100); assert.equal(t2.expected_visits, 110); assert.equal(t2.days_pm, 20)
  assert.equal(t2.ach_cr, 100 / 110)            // not (0.5 + 1) / 2 = 0.75
  assert.equal(t2.call_rate_pm, 100 / 20)       // not (5 + 5) / 2 .. 5 here, but from sums
  assert.notEqual(t2.ach_cr, (0.5 + 1) / 2)
  assert.equal(k.aggregateRange([]).ach_cr, null)
})
t('roll-ups by line and by manager add up to the total', () => {
  const rows = [row({ rep_id: 1, line_id: 1, manager_id: 10 }), row({ rep_id: 2, line_id: 1, manager_id: 11, total_visits: 30, visits_pm: 30 }), row({ rep_id: 3, line_id: 2, manager_id: 12 })]
  rows[0].line = rows[1].line = 'CIRA 1'; rows[2].line = 'CIRA 2'
  const byLine = k.rangeByLine(rows)
  assert.deepEqual(byLine.map((g) => [g.label, g.reps, g.total_visits]), [['CIRA 1', 2, 90], ['CIRA 2', 1, 60]])
  assert.equal(byLine.reduce((x, g) => x + g.total_visits, 0), k.aggregateRange(rows).total_visits)
  assert.equal(k.rangeByManager(rows).length, 3)
  assert.equal(byLine[0].coverage, null)
})

/* ---- Leaves / Missing rebuilt from daily slots ---- */
const ids = new Map([[1, { rep_id: 1, line_id: 1, manager_id: 10, line: 'CIRA 1', manager: 'M', rep_code: 'C1', rep_name: 'A', box: 'B', hire_date: null }]])
const slot = (day, shift, status, rep_id = 1) => ({ rep_id, day, shift, status })
t('leaves from slots: AM-only / PM-only = 0.5, both slots = 1; only the range\'s reps', () => {
  const rows = a.leavesFromSlots([
    slot('2026-10-04', 'AM', 'leave'), slot('2026-10-04', 'PM', 'leave'),   // full day
    slot('2026-10-05', 'AM', 'leave'), slot('2026-10-05', 'PM', 'worked'), // AM only
    slot('2026-10-06', 'PM', 'leave'),                                      // PM only
    slot('2026-10-06', 'AM', 'worked'), slot('2026-10-07', 'AM', 'missing'),
    slot('2026-10-04', 'AM', 'leave', 99),                                  // rep without identity: skipped
  ], ids, '2026-10-01')
  assert.equal(rows.length, 1)
  assert.deepEqual([rows[0].vacation_am, rows[0].vacation_pm, rows[0].full_days, rows[0].total_days], [0.5, 0.5, 1, 2])
})
t('missing from slots: 0.5 per slot, dates in the monthly view\'s format', () => {
  const rows = a.missingFromSlots([
    slot('2026-10-12', 'AM', 'missing'), slot('2026-10-12', 'PM', 'missing'),
    slot('2026-10-05', 'PM', 'missing'), slot('2026-10-06', 'AM', 'missing'), slot('2026-10-06', 'PM', 'worked'),
  ], ids, '2026-10-01')
  const r = rows[0]
  assert.deepEqual([r.missing_am, r.missing_pm, r.missing_total], [1, 1, 2])
  assert.equal(r.missing_dates, '05 Oct PM, 06 Oct AM, 12 Oct')
  assert.deepEqual(r.missing_dates_list, ['2026-10-05', '2026-10-06', '2026-10-12'])
  assert.equal(r.missing_dates_am, '06 Oct, 12 Oct'); assert.equal(r.missing_dates_pm, '05 Oct, 12 Oct')
})
console.log(`\n${n} tests passed`)
