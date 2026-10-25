// Run: npm run test:suspicious
import assert from 'node:assert/strict'
import * as s from '../src/features/reports/suspiciousMath.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }

const cluster = (o = {}) => ({
  rep_id: 61, rep_name: 'Rep One', rep_code: '1C0001', rep_status: 'Active', resign_date: null, line_id: 2, manager_id: 5, cell_lat: 30.123, cell_lng: 31.456,
  clinics: 26, visits: 130, visit_days: 20, pct_of_rep_pm_visits: 38.5, clinics_registered_here: 22, clinics_far: 4, visits_far: 12, night_visits: 3, other_reps_at_cell: 0,
  first_visit: '2026-09-02', last_visit: '2026-09-28', severity: 'High', ...o,
})
const clinic = (o = {}) => ({ account: 'Clinic A', acc_type_code: 'C', visits: 5, first_visit: '2026-09-02', last_visit: '2026-09-20', avg_deviation_m: 20, acc_lat: 30.1231, acc_lng: 31.4562, pattern: 'registered_here', visit_log: [{ d: '2026-09-02', t: '19:10' }], ...o })
const names = { month: '2026-09', line: 'CIRA 1', manager: 'Mona Ali' }

t('month: the latest closed month, and the range with an exclusive end', () => {
  assert.equal(s.latestClosedMonth(new Date(2026, 9, 25)), '2026-09')
  assert.equal(s.latestClosedMonth(new Date(2026, 0, 3)), '2025-12')
  assert.deepEqual(s.monthRange('2026-09'), { from: '2026-09-01', to: '2026-10-01' })
  assert.deepEqual(s.monthRange('2026-12'), { from: '2026-12-01', to: '2027-01-01' })
  assert.deepEqual(s.monthRange('2026-02'), { from: '2026-02-01', to: '2026-03-01' })
  assert.equal(s.monthLabel('2026-09'), 'September 2026')
  assert.equal(s.daysOf(...Object.values(s.monthRange('2026-09'))).length, 30)
  assert.equal(s.MIN_CLINICS, 10)
})

t('month list: only months with visits, newest first, the running month labelled with the data date', () => {
  assert.equal(s.shiftMonth('2026-01', -1), '2025-12')
  assert.equal(s.shiftMonth('2026-11', 3), '2027-02')
  assert.deepEqual(s.monthsBetween('2026-08', '2026-10'), ['2026-08', '2026-09', '2026-10'])
  assert.deepEqual(s.monthsBetween('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02'])
  const opts = s.buildMonthOptions({ '2026-08': '2026-08-31', '2026-09': null, '2026-10': '2026-10-24', '2026-07': '2026-07-30' }, new Date(2026, 9, 26))
  assert.deepEqual(opts.map((o) => o.month), ['2026-10', '2026-08', '2026-07'])
  assert.equal(opts[0].inProgress, true)
  assert.equal(opts[0].label, 'October 2026 — In progress (data to 24 Oct 2026)')
  assert.equal(opts[1].label, 'August 2026')
  assert.equal(opts[1].inProgress, false)
  assert.equal(s.pickMonth(opts, null), '2026-10')
  assert.equal(s.pickMonth(opts, '2026-08'), '2026-08')
  assert.equal(s.pickMonth(opts, '2026-09'), '2026-10', 'a month without visits falls back to the latest')
  assert.equal(s.pickMonth([], '2026-09'), null)
  assert.deepEqual([s.isMonth('2026-10'), s.isMonth('2026-13'), s.isMonth(null), s.isMonth('x')], [true, false, false, false])
  assert.deepEqual(s.monthRange('2026-10'), { from: '2026-10-01', to: '2026-11-01' })
})

t('changes: New, Repeated (consecutive months, up to 3 back) and Gone; no comparison without last month', () => {
  const at = (rep, severity) => cluster({ rep_id: rep, severity })
  const cur = [at(36, 'High'), at(61, 'High'), at(50, 'Medium'), at(7, 'Low'), at(8, 'High')]
  const m1 = [at(61, 'Medium'), at(50, 'High'), at(7, 'High'), at(99, 'High'), at(98, 'Low')]
  const m2 = [at(61, 'High'), at(50, 'Low'), at(99, 'High')]
  const m3 = [at(61, 'High'), at(8, 'Medium')]
  const c = s.classifyChanges(cur, [m1, m2, m3])
  assert.deepEqual(c.byRep.get(36), { kind: 'new' })
  assert.deepEqual(c.byRep.get(8), { kind: 'new' }, 'flagged only 3 months ago: the streak is broken, so it is new')
  assert.deepEqual(c.byRep.get(61), { kind: 'repeated', months: 4, capped: true })
  assert.deepEqual(c.byRep.get(50), { kind: 'repeated', months: 2, capped: false }, 'Low two months ago does not extend the streak')
  assert.equal(c.byRep.has(7), false, 'a Low case is not compared')
  assert.deepEqual([c.newCount, c.repeatedCount, c.goneCount], [2, 2, 2])
  assert.deepEqual(c.gone.map((r) => r.rep_id).sort((a, b) => a - b), [7, 99])
  assert.equal(s.changeLabel(c.byRep.get(36)), 'New')
  assert.equal(s.changeLabel(c.byRep.get(61)), 'Repeated · 4+ months')
  assert.equal(s.changeLabel(c.byRep.get(50)), 'Repeated · 2 months')
  assert.deepEqual([...s.newReps(c)].sort((a, b) => a - b), [8, 36])
  assert.equal(s.classifyChanges(cur, [null, m2, m3]), null)
  assert.equal(s.classifyChanges(cur, []), null)
  const c2 = s.classifyChanges(cur, [m1, null, null])
  assert.deepEqual(c2.byRep.get(61), { kind: 'repeated', months: 2, capped: false })
  const two = s.classifyChanges([cluster({ rep_id: 5, severity: 'High' }), cluster({ rep_id: 5, cell_lat: 31, severity: 'Medium' })], [[at(5, 'High')]])
  assert.equal(two.repeatedCount, 1, 'a rep with two points counts once')
  const base = { severities: ['High', 'Medium', 'Low'], search: '', lineId: null, managerId: null }
  assert.deepEqual(s.filterClusters(cur, { ...base, onlyReps: s.newReps(c) }).map((r) => r.rep_id), [8, 36])
  assert.equal(s.summaryRow(cluster(), { ...names, change: 'New' })['Vs previous month'], 'New')
  assert.equal('Vs previous month' in s.summaryRow(cluster(), names), false)
})

t('severity chip: colors, the left-border color of the expanded card, and the reason on hover', () => {
  assert.match(s.severityChip('High').classes, /red/)
  assert.match(s.severityChip('Medium').classes, /amber/)
  assert.match(s.severityChip('Low').classes, /gray/)
  assert.match(s.severityChip('High').border, /red/)
  assert.match(s.severityChip('Medium').border, /amber/)
  assert.equal(s.severityChip('Other').label, 'Low')
  assert.equal(s.severityReason(cluster()), "26 clinics at the point · 38.5% of the rep's PM visits · 3 night visits · 12 visits logged from far · 0 other reps at the point")
  assert.equal(s.severityReason(cluster({ night_visits: 1, visits_far: 1, other_reps_at_cell: 1 })), "26 clinics at the point · 38.5% of the rep's PM visits · 1 night visit · 1 visit logged from far · 1 other rep at the point")
})

t('pattern chip: 300 m is still "registered at this point"; above it the visit was logged from far, with the distance', () => {
  assert.equal(s.DEVIATION_THRESHOLD_M, 300)
  assert.equal(s.patternOf(300), 'registered_here')
  assert.equal(s.patternOf(300.5), 'visit_far')
  assert.equal(s.patternOf(null), 'unknown')
  assert.deepEqual(s.patternChip(42), { label: 'Clinic registered at this point', tone: 'red' })
  assert.deepEqual(s.patternChip(7400), { label: 'Visit logged here, clinic ~7.4 km away', tone: 'amber' })
  assert.equal(s.patternChip(850).label, 'Visit logged here, clinic ~850 m away')
  assert.equal(s.patternChip(23500).label, 'Visit logged here, clinic ~24 km away')
  assert.equal(s.patternChip(undefined).tone, 'grey')
})

t('visit dates: ascending by date then time, chips "07 Sep 19:40", the Excel cell "07/09 19:40; ..."', () => {
  const log = [{ d: '2026-09-12', t: '20:00' }, { d: '2026-09-07', t: '19:40' }, { d: '2026-09-07', t: '09:05' }, { d: '2026-09-07', t: null }, { d: '2026-09-30', t: '23:15' }]
  const o = s.orderedVisits(log)
  assert.deepEqual(o.map((v) => `${v.d} ${v.t}`), ['2026-09-07 null', '2026-09-07 09:05', '2026-09-07 19:40', '2026-09-12 20:00', '2026-09-30 23:15'])
  assert.equal(s.visitChip({ d: '2026-09-07', t: '19:40' }), '07 Sep 19:40')
  assert.equal(s.visitChip({ d: '2026-09-07', t: null }), '07 Sep')
  assert.equal(s.visitDatesCell(log), '07/09; 07/09 09:05; 07/09 19:40; 12/09 20:00; 30/09 23:15')
  assert.equal(s.visitDatesCell(null), '')
  assert.deepEqual(log[0], { d: '2026-09-12', t: '20:00' }, 'the input is not reordered')
  assert.equal(s.CHIPS_BEFORE_TOGGLE, 12)
})

t('rows: severity first (High, Medium, Low), then clinics descending; filters by severity, line, manager and rep', () => {
  const rows = [
    cluster({ rep_id: 1, clinics: 40, severity: 'Medium', rep_name: 'Aly' }), cluster({ rep_id: 2, clinics: 26, severity: 'High', rep_name: 'Basma', manager_id: 6, line_id: 3 }),
    cluster({ rep_id: 3, clinics: 55, severity: 'Low', rep_name: 'Chadi' }), cluster({ rep_id: 4, clinics: 30, severity: 'High', rep_name: 'Dina' }),
  ]
  const base = { severities: s.DEFAULT_SEVERITIES, search: '', lineId: null, managerId: null }
  assert.deepEqual(s.filterClusters(rows, base).map((r) => r.rep_id), [4, 2, 1])
  assert.deepEqual(s.filterClusters(rows, { ...base, severities: ['Low', 'Medium', 'High'] }).map((r) => r.rep_id), [4, 2, 1, 3])
  assert.deepEqual(s.filterClusters(rows, { ...base, lineId: 3 }).map((r) => r.rep_id), [2])
  assert.deepEqual(s.filterClusters(rows, { ...base, managerId: 6 }).map((r) => r.rep_id), [2])
  assert.deepEqual(s.filterClusters(rows, { ...base, search: 'ali' }).map((r) => r.rep_id), [])
  assert.deepEqual(s.filterClusters(rows, { ...base, search: 'aly' }).map((r) => r.rep_id), [1])
  assert.deepEqual(s.filterClusters(rows, { ...base, search: '1c0001' }).map((r) => r.rep_id), [4, 2, 1])
  assert.deepEqual(s.sortClusters(rows).map((r) => r.rep_id), [4, 2, 1, 3])
})

t('line and manager names: the id is shown when the name cannot be resolved; the row is never hidden', () => {
  const m = new Map([[5, 'Mona Ali']])
  assert.equal(s.nameOrId(5, m), 'Mona Ali')
  assert.equal(s.nameOrId(9, m), '#9')
  assert.equal(s.nameOrId(null, m), '')
  const rows = s.filterClusters([cluster({ line_id: 99, manager_id: 98 })], { severities: ['High'], search: '', lineId: null, managerId: null })
  assert.equal(rows.length, 1)
})

t('Resigned badge, night visits, KPI cards, Maps link', () => {
  assert.deepEqual(s.resignedBadge('Resigned', '2026-08-12'), { show: true, text: 'Resigned 12 Aug 2026' })
  assert.deepEqual(s.resignedBadge('Resigned', null), { show: true, text: 'Resigned' })
  assert.equal(s.resignedBadge('Active', '2026-08-12').show, false)
  for (const [t0, want] of [['23:00', true], ['22:59', false], ['05:59', true], ['06:00', false], [null, false]]) assert.equal(s.isNight(t0), want)
  const k = s.summarize([cluster({ rep_id: 1, clinics: 20, visits: 100, pct_of_rep_pm_visits: 50 }), cluster({ rep_id: 1, cell_lat: 30.2, clinics: 10, visits: 40, pct_of_rep_pm_visits: 20 }), cluster({ rep_id: 2, clinics: 15, visits: 60, pct_of_rep_pm_visits: 30 })])
  assert.deepEqual([k.reps, k.clinics, k.visits], [2, 45, 200])
  assert.equal(s.fmtPct(k.shareOfPmVisits), '50.0%')
  assert.equal(s.mapsUrl(30.123, 31.456), 'https://www.google.com/maps?q=30.123,31.456')
  assert.equal(s.clusterKey(cluster()), '61|30.123|31.456')
})

t('reading note: clinics, registered at the point, visited from far and the distance', () => {
  const c = cluster({ clinics: 24, clinics_registered_here: 20, clinics_far: 4 })
  const detail = [clinic(), clinic({ account: 'B', avg_deviation_m: 6000 }), clinic({ account: 'C', avg_deviation_m: 8000 })]
  assert.equal(s.readingNote(c, detail), '24 different PM clinics share one ~110 m location, 20 of them registered at the point and 4 visited from about 7.0 km away.')
  assert.equal(s.readingNote({ clinics: 12, clinics_registered_here: 12, clinics_far: 0 }, []), '12 different PM clinics share one ~110 m location, 12 of them registered at the point.')
})

t('day strip: only the days of the selected month, weekday columns (Saturday first), busy days (> 8) and night visits', () => {
  const log = (day, times) => times.map((t0) => ({ d: day, t: t0 }))
  const detail = [clinic({ account: 'A', visit_log: [...log('2026-09-02', ['19:10', '19:40']), ...log('2026-09-03', ['23:30'])] }), clinic({ account: 'B', visit_log: [...log('2026-09-02', ['20:00', '20:20', '20:40', '21:00', '21:20', '21:40', '22:00']), ...log('2026-09-04', ['05:10']), ...log('2026-10-01', ['19:00'])] })]
  const { from, to } = s.monthRange('2026-09')
  const strip = s.buildDayStrip(detail, from, to)
  assert.equal(strip.length, 30)
  assert.equal(strip[1].count, 9)
  assert.equal(strip[1].busy, true)
  assert.equal(strip[0].busy, false)
  assert.deepEqual([strip[2].night, strip[3].night], [1, 1])
  assert.equal(strip.reduce((a, d) => a + d.count, 0), 11, 'a visit of October is not in the September strip')
  assert.deepEqual(strip[1].visits[0], { t: '19:10', clinic: 'A' })
  // 2026-09-01 is a Tuesday: Sat, Sun, Mon are blank, then 1 under Tue
  assert.deepEqual(s.STRIP_WEEKDAYS, ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
  assert.deepEqual([s.stripColumn('2026-09-05'), s.stripColumn('2026-09-06'), s.stripColumn('2026-09-01'), s.stripColumn('2026-09-04')], [0, 1, 3, 6])
  const weeks = s.stripWeeks(strip)
  assert.deepEqual(weeks[0].map((d) => (d ? Number(d.day.slice(8, 10)) : null)), [null, null, null, 1, 2, 3, 4])
  assert.ok(weeks.every((w) => w.length === 7))
  assert.equal(weeks.flat().filter(Boolean).length, 30)
})

t('Excel rows: Summary has month, line, manager and the resigned text; Detail has one row per account with ascending visit dates', () => {
  const c = cluster({ rep_status: 'Resigned', resign_date: '2026-09-10' })
  const sr = s.summaryRow(c, names)
  assert.deepEqual([sr.Month, sr.Severity, sr.Line, sr.Manager, sr['Medical Rep'], sr['Rep code'], sr.Status], ['2026-09', 'High', 'CIRA 1', 'Mona Ali', 'Rep One', '1C0001', 'Resigned 10 Sep 2026'])
  assert.deepEqual([sr.Clinics, sr.Visits, sr['Visit days'], sr['% of rep PM visits']], [26, 130, 20, 38.5])
  assert.deepEqual([sr['Clinics registered at the point'], sr['Visits registered at the point'], sr['Clinics visited from far'], sr['Visits from far']], [22, 118, 4, 12])
  assert.deepEqual([sr['Point latitude'], sr['Point longitude']], [30.123, 31.456])
  assert.deepEqual(Object.keys(sr).slice(0, 5), ['Month', 'Severity', 'Line', 'Manager', 'Medical Rep'])
  const dr = s.detailRows(cluster(), names, [
    clinic({ account: 'Few', visits: 2 }),
    clinic({ account: 'Many', visits: 9, visit_log: [{ d: '2026-09-12', t: '20:00' }, { d: '2026-09-07', t: '19:40' }], avg_deviation_m: 5200 }),
  ])
  assert.deepEqual(dr.map((r) => r['Account name']), ['Many', 'Few'])
  assert.deepEqual(Object.keys(dr[0]), ['Month', 'Severity', 'Line', 'Manager', 'Medical Rep', 'Rep code', 'Account name', 'Type', 'Visits', 'Visit dates', 'First visit', 'Last visit', 'Avg deviation (m)', 'Pattern', 'Clinic latitude', 'Clinic longitude', 'Point latitude', 'Point longitude'])
  assert.equal(dr[0]['Visit dates'], '07/09 19:40; 12/09 20:00')
  assert.equal(dr[0].Pattern, 'Visit logged here, clinic ~5.2 km away')
  assert.equal(dr[1].Pattern, 'Clinic registered at this point')
  assert.deepEqual([dr[1]['Clinic latitude'], dr[1]['Point longitude']], [30.1231, 31.456])
  assert.equal(s.exportFileName('2026-09'), 'Suspicious_Cases_2026-09.xlsx')
})

t('the disclaimer, the empty state and the wording', () => {
  assert.equal(s.DISCLAIMER, 'This report shows data patterns, not proof. Confirm with the line manager before any action.')
  assert.equal(s.NO_CASES, 'No suspicious cases in this period')
  const all = [s.DISCLAIMER, s.NO_CASES, s.patternChip(10).label, s.patternChip(9000).label, ...['High', 'Medium', 'Low'].map((x) => s.severityChip(x).label), s.severityReason(cluster())].join(' ').toLowerCase()
  assert.ok(!/fraud|cheat/.test(all))
})

console.log(`${n} tests passed`)
