// Run: npm run test:suspicious
import assert from 'node:assert/strict'
import * as s from '../src/features/reports/suspiciousMath.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }

const cluster = (o = {}) => ({
  rep_id: 61, rep_name: 'Rep One', rep_code: '1C0001', rep_status: 'Active', resign_date: null, manager_id: 5, cell_lat: 30.123, cell_lng: 31.456,
  clinics: 24, visits: 130, visit_days: 40, pct_of_rep_pm_visits: 38.5, clinics_registered_here: 20, clinics_far: 4, visits_far: 12, night_visits: 3, other_reps_at_cell: 0,
  first_visit: '2026-07-02', last_visit: '2026-09-28', severity: 'High', ...o,
})
const clinic = (o = {}) => ({ account: 'Clinic A', acc_type_code: 'C', visits: 5, first_visit: '2026-07-02', last_visit: '2026-09-20', avg_deviation_m: 20, acc_lat: 30.1231, acc_lng: 31.4562, pattern: 'registered_here', visit_log: [{ d: '2026-07-02', t: '19:10' }], ...o })

t('pattern thresholds: 300 m is still "registered here", above it the visit was logged from far', () => {
  assert.equal(s.DEVIATION_THRESHOLD_M, 300)
  assert.equal(s.patternOf(0), 'registered_here')
  assert.equal(s.patternOf(300), 'registered_here')
  assert.equal(s.patternOf(300.5), 'visit_far')
  assert.equal(s.patternOf(null), 'unknown')
  assert.deepEqual(s.patternChip(42), { label: 'Clinic registered at this point', tone: 'red' })
  assert.deepEqual(s.patternChip(7400), { label: 'Visit logged here, clinic ~7.4 km away', tone: 'amber' })
  assert.equal(s.patternChip(850).label, 'Visit logged here, clinic ~850 m away')
  assert.equal(s.patternChip(23500).label, 'Visit logged here, clinic ~24 km away')
  assert.equal(s.patternChip(undefined).tone, 'grey')
})

t('severity chip colors and the Resigned badge', () => {
  assert.match(s.severityChip('High').classes, /red/)
  assert.match(s.severityChip('Medium').classes, /amber/)
  assert.match(s.severityChip('Low').classes, /gray/)
  assert.equal(s.severityChip('Something').label, 'Low')
  assert.deepEqual(s.resignedBadge('Resigned', '2026-08-12'), { show: true, text: 'Resigned 12 Aug 2026' })
  assert.deepEqual(s.resignedBadge('Resigned', null), { show: true, text: 'Resigned' })
  assert.deepEqual(s.resignedBadge('Active', '2026-08-12'), { show: false, text: '' })
  assert.equal(s.resignedBadge(null, null).show, false)
})

t('night visits are after 23:00 or before 06:00', () => {
  for (const [t0, want] of [['23:00', true], ['22:59', false], ['05:59', true], ['06:00', false], ['00:30', true], ['19:15', false], [null, false]]) assert.equal(s.isNight(t0), want, String(t0))
})

t('dates: the default range is the last 3 closed months with an exclusive end; month inputs map to the RPC range', () => {
  assert.deepEqual(s.defaultRange(new Date(2026, 9, 25)), { from: '2026-07-01', to: '2026-10-01' })
  assert.deepEqual(s.defaultRange(new Date(2026, 0, 3)), { from: '2025-10-01', to: '2026-01-01' })
  assert.deepEqual(s.rangeFromMonths('2026-07', '2026-09'), { from: '2026-07-01', to: '2026-10-01' })
  assert.deepEqual(s.rangeFromMonths('2026-11', '2026-12'), { from: '2026-11-01', to: '2027-01-01' })
  assert.equal(s.rangeLabel('2026-07-01', '2026-10-01'), '1 Jul 2026 - 30 Sep 2026')
  assert.equal(s.daysOf('2026-07-01', '2026-10-01').length, 92)
  assert.deepEqual(s.monthsOf('2026-07-01', '2026-10-01'), ['2026-07-01', '2026-08-01', '2026-09-01'])
})

t('filters: severity (default High + Medium), minimum clinics, manager, line, search; sorted by clinics descending', () => {
  const rows = [cluster({ rep_id: 1, clinics: 12, severity: 'Medium', rep_name: 'Aly' }), cluster({ rep_id: 2, clinics: 30, severity: 'High', rep_name: 'Basma', manager_id: 6 }), cluster({ rep_id: 3, clinics: 11, severity: 'Low', rep_name: 'Chadi' }), cluster({ rep_id: 4, clinics: 8, severity: 'High', rep_name: 'Dina' })]
  const lines = new Map([[1, 10], [2, 10], [3, 11], [4, 10]])
  const base = { severities: s.DEFAULT_SEVERITIES, minClinics: 10, search: '', lineId: null, managerId: null }
  assert.deepEqual(s.filterClusters(rows, base, lines).map((r) => r.rep_id), [2, 1])
  assert.deepEqual(s.filterClusters(rows, { ...base, severities: ['Low'] }, lines).map((r) => r.rep_id), [3])
  assert.deepEqual(s.filterClusters(rows, { ...base, minClinics: 5 }, lines).map((r) => r.rep_id), [2, 1, 4])
  assert.deepEqual(s.filterClusters(rows, { ...base, managerId: 6 }, lines).map((r) => r.rep_id), [2])
  assert.deepEqual(s.filterClusters(rows, { ...base, severities: ['High', 'Medium', 'Low'], lineId: 11 }, lines).map((r) => r.rep_id), [3])
  assert.deepEqual(s.filterClusters(rows, { ...base, search: 'bas' }, lines).map((r) => r.rep_id), [2])
  assert.deepEqual(s.filterClusters(rows, { ...base, search: '1c0001' }, lines).map((r) => r.rep_id), [2, 1])
})

t('KPI cards: reps, clinics, visits and the share of those reps\' PM visits', () => {
  const rows = [cluster({ rep_id: 1, clinics: 20, visits: 100, pct_of_rep_pm_visits: 50 }), cluster({ rep_id: 1, cell_lat: 30.2, clinics: 10, visits: 40, pct_of_rep_pm_visits: 20 }), cluster({ rep_id: 2, clinics: 15, visits: 60, pct_of_rep_pm_visits: 30 })]
  const k = s.summarize(rows)
  assert.deepEqual([k.reps, k.clinics, k.visits], [2, 45, 200])
  assert.ok(Math.abs(k.shareOfPmVisits - 200 / 400) < 1e-9, String(k.shareOfPmVisits))
  assert.equal(s.fmtPct(k.shareOfPmVisits), '50.0%')
  assert.deepEqual(s.summarize([]), { reps: 0, clinics: 0, visits: 0, shareOfPmVisits: 0 })
})

t('the reading note: clinics, registered at the point, visited from far and the distance', () => {
  const c = cluster({ clinics: 24, clinics_registered_here: 20, clinics_far: 4 })
  const detail = [clinic(), clinic({ account: 'B', avg_deviation_m: 6000 }), clinic({ account: 'C', avg_deviation_m: 8000 })]
  assert.equal(s.readingNote(c, detail), '24 different PM clinics share one ~110 m location, 20 of them registered at the point and 4 visited from about 7.0 km away.')
  assert.equal(s.readingNote({ clinics: 12, clinics_registered_here: 12, clinics_far: 0 }, []), '12 different PM clinics share one ~110 m location, 12 of them registered at the point.')
  assert.match(s.readingNote(c, null), /4 visited from far away/)
})

t('timeline: a cell per day of the range with the visits, busy days (> 8) and night visits flagged', () => {
  const log = (day, times) => times.map((t0) => ({ d: day, t: t0 }))
  const detail = [
    clinic({ account: 'A', visit_log: [...log('2026-07-02', ['19:10', '19:40']), ...log('2026-07-03', ['23:30'])] }),
    clinic({ account: 'B', visit_log: [...log('2026-07-02', ['20:00', '20:20', '20:40', '21:00', '21:20', '21:40', '22:00']), ...log('2026-07-04', ['05:10'])] }),
  ]
  const tl = s.buildTimeline(detail, '2026-07-01', '2026-07-06')
  assert.equal(tl.length, 5)
  assert.deepEqual(tl.map((d) => d.count), [0, 9, 1, 1, 0])
  assert.deepEqual(tl.map((d) => d.busy), [false, true, false, false, false])
  assert.deepEqual(tl.map((d) => d.night), [0, 0, 1, 1, 0])
  assert.deepEqual(tl[1].visits[0], { t: '19:10', clinic: 'A' })
  assert.deepEqual(tl[1].visits.map((v) => v.t), [...tl[1].visits.map((v) => v.t)].sort())
  assert.equal(s.BUSY_DAY_VISITS, 8)
})

t('Excel rows: Summary has the manager name and the resigned text; Detail has every clinic with its visit dates', () => {
  const c = cluster({ rep_status: 'Resigned', resign_date: '2026-09-10' })
  const sr = s.summaryRow(c, 'Mona Ali')
  assert.equal(sr.Manager, 'Mona Ali')
  assert.equal(sr.Status, 'Resigned 10 Sep 2026')
  assert.equal(sr.Severity, 'High')
  assert.equal(sr.Clinics, 24)
  assert.equal(sr['% of rep PM visits'], 38.5)
  assert.equal(s.summaryRow(cluster(), '').Status, 'Active')
  const dr = s.detailRows(cluster(), 'Mona Ali', [clinic({ visit_log: [{ d: '2026-07-02', t: '19:10' }, { d: '2026-07-09', t: null }] }), clinic({ account: 'Far', avg_deviation_m: 5200 })])
  assert.equal(dr.length, 2)
  assert.equal(dr[0].Pattern, 'Clinic registered at this point')
  assert.equal(dr[0]['Visit dates'], '2026-07-02 19:10; 2026-07-09')
  assert.equal(dr[1].Pattern, 'Visit logged here, clinic ~5.2 km away')
  assert.equal(dr[0].Manager, 'Mona Ali')
})

t('Google Maps link, the key of a row, the disclaimer and the wording', () => {
  assert.equal(s.mapsUrl(30.123, 31.456), 'https://www.google.com/maps?q=30.123,31.456')
  assert.equal(s.clusterKey(cluster()), '61|30.123|31.456')
  assert.ok(s.DISCLAIMER.startsWith('This report shows data patterns, not proof.'))
  assert.equal(s.NO_CASES, 'No suspicious cases in this period')
  const all = [s.DISCLAIMER, s.NO_CASES, s.patternChip(10).label, s.patternChip(9000).label, ...['High', 'Medium', 'Low'].map((x) => s.severityChip(x).label)].join(' ').toLowerCase()
  assert.ok(!/fraud|cheat/.test(all))
})

console.log(`${n} tests passed`)
