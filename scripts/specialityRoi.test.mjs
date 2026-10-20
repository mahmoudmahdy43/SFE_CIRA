// Run: npm run test:roi
import assert from 'node:assert/strict'
import * as r from '../src/features/roi/roiMath.ts'
import * as p from '../src/features/dashboard/periodMath.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }

t('period -> p_from (first day) and p_to (last day) for every mode', () => {
  const q = p.resolvePeriod(p.normalizePeriod({ mode: 'quarter', fromYM: '2026-08', toYM: '2026-08' }))
  assert.deepEqual([q.from, q.to], ['2026-07-01', '2026-09-30'])
  const s = p.resolvePeriod(p.normalizePeriod({ mode: 'semester', fromYM: '2026-02', toYM: '2026-02' }))
  assert.deepEqual([s.from, s.to], ['2026-01-01', '2026-06-30'])
  const m = p.resolvePeriod(p.normalizePeriod({ mode: 'month', fromYM: '2028-02', toYM: '2028-02' }))
  assert.deepEqual([m.from, m.to], ['2028-02-01', '2028-02-29'])
  const c = p.resolvePeriod({ mode: 'custom', fromYM: '2026-03', toYM: '2026-11' })
  assert.deepEqual([c.from, c.to], ['2026-03-01', '2026-11-30'])
})
t('top-bar day range -> whole months for the RPC (Jan..Sep and a mid-month range)', () => {
  const m = (from, to) => [p.firstDay(from.slice(0, 7)), p.lastDay(to.slice(0, 7))]
  assert.deepEqual(m('2026-01-01', '2026-09-30'), ['2026-01-01', '2026-09-30'])
  assert.deepEqual(m('2026-02-10', '2026-09-05'), ['2026-02-01', '2026-09-30'])
  assert.deepEqual(m('2026-09-01', '2026-09-30'), ['2026-09-01', '2026-09-30'])
})
t('URL: shift and line parsing, period + line query', () => {
  assert.equal(r.parseShift('PM'), 'PM'); assert.equal(r.parseShift('x'), 'ALL'); assert.equal(r.parseShift(null), 'ALL')
  assert.equal(r.parseLine('2'), 2); assert.equal(r.parseLine('0'), null); assert.equal(r.parseLine(null), null); assert.equal(r.parseLine('abc'), null)
  assert.equal(p.periodQuery({ mode: 'quarter', fromYM: '2026-07', toYM: '2026-09' }, 3), 'mode=quarter&pfrom=2026-07&pto=2026-09&line=3')
})
t('cost per visit: default, latest entry on or before the month, earlier months keep their value', () => {
  const h = [{ month_from: '2026-01-01', cost: 600 }, { month_from: '2026-07-01', cost: 700 }, { month_from: '2026-10-01', cost: 650 }]
  assert.equal(r.costFor([], '2026-05'), 600)
  assert.equal(r.costFor(h, '2025-12'), 600) // before the first entry: default
  assert.equal(r.costFor(h, '2026-06'), 600)
  assert.equal(r.costFor(h, '2026-07'), 700)
  assert.equal(r.costFor(h, '2026-09'), 700)
  assert.equal(r.costFor(h.slice().reverse(), '2026-12'), 650) // order does not matter
})
t('cost input parsing', () => {
  assert.equal(r.parseCost(' 650 '), 650); assert.equal(r.parseCost('1,250.5'), 1250.5); assert.equal(r.parseCost('0'), 0)
  assert.equal(r.parseCost(''), null); assert.equal(r.parseCost('-5'), null); assert.equal(r.parseCost('abc'), null)
})
t('ROI colour thresholds (<1 red, 1-2 amber, >=2 green) and text', () => {
  assert.deepEqual([null, 0.99, 1, 1.99, 2, 5].map(r.roiTone), ['none', 'red', 'amber', 'amber', 'green', 'green'])
  assert.equal(r.fmtRoi(3.24), '3.2x'); assert.equal(r.fmtRoi(null), '—')
})
t('link words', () => {
  assert.deepEqual([null, 0.1, -0.19, 0.2, -0.39, 0.4, 0.59, 0.6, -0.9].map(r.corrWord),
    ['not enough data', 'no clear link', 'no clear link', 'weak', 'weak', 'moderate', 'moderate', 'strong', 'strong'])
})
t('quality banner: shares of all doctor visits, warning under 80%', () => {
  const rows = [
    { line_name: 'CIRA 1', doctor_visits: 1000, no_doctor: 100, no_speciality: 100, in_groups: 700, classified_pct: 0.7 },
    { line_name: 'CIRA 2', doctor_visits: 1000, no_doctor: 0, no_speciality: 0, in_groups: 950, classified_pct: 0.95 },
  ]
  const s = r.summariseQuality(rows)
  assert.equal(s.classified, 0.825); assert.equal(s.warn, false)
  assert.equal(r.summariseQuality(rows.slice(0, 1)).warn, true)
  assert.equal(r.summariseQuality([]).classified, null)
  assert.equal(r.qualityText(r.summariseQuality(rows.slice(0, 1))), '70.0% of doctor visits are inside a mapped group; 10.0% have no speciality; 10.0% are not linked to a doctor.')
})
t('sorting: nulls last in both directions, stable, strings', () => {
  const rows = [{ a: 2 }, { a: null }, { a: 5 }, { a: 2 }, { a: 1 }]
  assert.deepEqual(r.sortRows(rows, (x) => x.a, 'asc').map((x) => x.a), [1, 2, 2, 5, null])
  assert.deepEqual(r.sortRows(rows, (x) => x.a, 'desc').map((x) => x.a), [5, 2, 2, 1, null])
  assert.deepEqual(r.sortRows([{ s: 'b' }, { s: 'a' }], (x) => x.s, 'asc').map((x) => x.s), ['a', 'b'])
})
t('speciality match: exact words first, "Surg" never matches Plastic / Vascular Surg', () => {
  const names = ['Surg', 'Plastic Surg', 'Vascular Surg', 'Gynecology', 'Ophthalmology', 'Dermatology', 'Orthopedic', 'Dentist', 'Andrology', 'Nutrition']
  assert.deepEqual(r.matchSpeciality('Surg', names), { name: 'Surg', how: 'exact' })
  assert.deepEqual(r.matchSpeciality('plastic surg', names), { name: 'Plastic Surg', how: 'exact' })
  assert.deepEqual(r.matchSpeciality('Gyna', names), { name: 'Gynecology', how: 'close' })
  assert.deepEqual(r.matchSpeciality('Ophtha', names), { name: 'Ophthalmology', how: 'close' })
  assert.deepEqual(r.matchSpeciality('Derma', names), { name: 'Dermatology', how: 'close' })
  assert.deepEqual(r.matchSpeciality('Ortho', names), { name: 'Orthopedic', how: 'close' })
  // no plain "Surg" in the database: it must stay unmatched, not grab Plastic / Vascular Surg
  assert.deepEqual(r.matchSpeciality('Surg', names.filter((x) => x !== 'Surg')), { name: null, how: 'none' })
  assert.deepEqual(r.matchSpeciality('Cardio', names), { name: null, how: 'none' })
})
t('product match: same line first, dashes / spaces ignored, Heya alias', () => {
  const prods = [
    { name: 'Q Afta', line: 'CIRA 3' }, { name: 'Q-SaniHex', line: 'CIRA 3' }, { name: 'Irovast', line: 'CIRA 1' }, { name: 'Irovast Plus', line: 'CIRA 2' },
    { name: 'NEO-MUM', line: 'CIRA 2' }, { name: 'Mamimilk 200', line: 'CIRA 2' }, { name: 'Servilight', line: null },
  ]
  assert.deepEqual(r.matchProduct('Q-Afta', prods, 'CIRA 3'), { name: 'Q Afta', how: 'exact' })
  assert.deepEqual(r.matchProduct('Irovast', prods, 'CIRA 1'), { name: 'Irovast', how: 'exact' })
  assert.deepEqual(r.matchProduct('Irovast', prods, 'CIRA 2'), { name: 'Irovast Plus', how: 'close' })
  assert.deepEqual(r.matchProduct('Heya', prods, 'CIRA 2'), { name: 'NEO-MUM', how: 'exact' })
  assert.deepEqual(r.matchProduct('Mamimilk', prods, 'CIRA 2'), { name: 'Mamimilk 200', how: 'close' })
  assert.deepEqual(r.matchProduct('Servilight', prods, 'CIRA 3'), { name: 'Servilight', how: 'exact' })
  assert.deepEqual(r.matchProduct('Axal', prods, 'CIRA 1'), { name: null, how: 'none' })
})
t('strategy map suggestion: 7 groups, unmatched stay visible', () => {
  const sug = r.suggestMap(r.STRATEGY_MAP, ['Gyna', 'Derma'], [{ name: 'Irovast', line: 'CIRA 1' }])
  assert.equal(sug.length, 7)
  assert.equal(sug[0].specialities[0].how, 'exact'); assert.equal(sug[0].products[0].how, 'exact'); assert.equal(sug[0].products[1].how, 'none')
  assert.equal(sug[1].specialities.find((s) => s.wanted === 'Surg').matched, null)
})

t('scope picks the function and the parameters (chart)', () => {
  const F = '2026-01-01', T = '2026-09-30'
  // a selected group keeps the old function, one group
  assert.deepEqual(r.monthlyCall({ group: 7, line: 2, products: [5] }, F, T, 'PM'), { fn: 'speciality_roi_monthly', args: { p_group: 7, p_from: F, p_to: T, p_shift: 'PM' } })
  // nothing chosen = the whole company: line and products both null
  assert.deepEqual(r.monthlyCall({ group: null, line: null, products: [] }, F, T, 'ALL'), { fn: 'speciality_roi_scope_monthly', args: { p_from: F, p_to: T, p_line: null, p_products: null, p_shift: 'ALL' } })
  // a line only (no product chosen = all products = null)
  assert.deepEqual(r.monthlyCall({ group: null, line: 3, products: [] }, F, T, 'AM').args, { p_from: F, p_to: T, p_line: 3, p_products: null, p_shift: 'AM' })
  // several products inside a line: an array, sorted, no duplicates
  assert.deepEqual(r.monthlyCall({ group: null, line: 3, products: [41, 9, 41] }, F, T, 'ALL').args, { p_from: F, p_to: T, p_line: 3, p_products: [9, 41], p_shift: 'ALL' })
  // products without a line are ignored (they only exist inside a line)
  assert.equal(r.monthlyCall({ group: null, line: null, products: [41] }, F, T, 'ALL').args.p_products, null)
})
t('scope picks the function and the parameters (territories, min visits)', () => {
  const F = '2026-01-01', T = '2026-09-30'
  assert.deepEqual(r.territoriesCall({ group: 7, line: 2, products: [] }, F, T, 'ALL', 25), { fn: 'speciality_roi_territories', args: { p_group: 7, p_from: F, p_to: T, p_shift: 'ALL' } })
  const c = r.territoriesCall({ group: null, line: 2, products: [9, 4] }, F, T, 'PM', 25)
  assert.equal(c.fn, 'speciality_roi_territories_scope')
  assert.deepEqual(c.args, { p_from: F, p_to: T, p_line: 2, p_products: [4, 9], p_shift: 'PM', p_min_visits: 25 })
  assert.equal(r.territoriesCall({ group: null, line: null, products: [] }, F, T, 'ALL', 10).args.p_min_visits, 10)
})
t('a different scope is a different cache key; the same choice in another order is the same key', () => {
  const k = (products, shift = 'ALL') => r.callKey(r.monthlyCall({ group: null, line: 1, products }, '2026-01-01', '2026-09-30', shift))
  assert.equal(new Set([k([]), k([4]), k([4, 5]), k([], 'PM')]).size, 4)
  assert.equal(k([5, 4]), k([4, 5]))
})
t('products in the URL and in titles', () => {
  assert.deepEqual(r.parseIds('12,5,5,x,-1,0,2.5'), [5, 12]); assert.deepEqual(r.parseIds(null), []); assert.deepEqual(r.parseIds(''), [])
  assert.equal(r.productsLabel(['Irovast']), 'Irovast'); assert.equal(r.productsLabel(['Irovast', 'Axal']), 'Irovast + Axal')
  assert.equal(r.productsLabel(['A', 'B', 'C']), '3 products'); assert.equal(r.productsLabel([]), '')
})
t('Value / Units and Min visits parsing', () => {
  assert.equal(r.parseMeasure('units'), 'units'); assert.equal(r.parseMeasure('x'), 'value'); assert.equal(r.parseMeasure(null), 'value')
  assert.equal(r.parseMinVisits(null), 10); assert.equal(r.parseMinVisits(''), 10); assert.equal(r.parseMinVisits('25'), 25); assert.equal(r.parseMinVisits('0'), 0)
  assert.equal(r.parseMinVisits('-3'), 10); assert.equal(r.parseMinVisits('2.5'), 10); assert.equal(r.parseMinVisits('abc'), 10)
})
t('coverage / PCF colours: <70 red, 70-<85 amber, >=85 green; no KPI doctors = dash', () => {
  assert.deepEqual([null, 0.69, 0.7, 0.849, 0.85, 1].map(r.ratioTone), ['none', 'red', 'amber', 'amber', 'green', 'green'])
  assert.equal(r.kpiRatio(0, 0.9), null); assert.equal(r.kpiRatio(12, 0.9), 0.9)
  assert.equal(r.fmtPct1(0.8512), '85.1%'); assert.equal(r.fmtPct1(null), '—')
})
t('low_sample rows go last, in their order, whatever the sort', () => {
  const rows = [{ n: 'a', low: true }, { n: 'b', low: false }, { n: 'c', low: true }, { n: 'd', low: false }]
  assert.deepEqual(r.lastWhen(rows, (x) => x.low).map((x) => x.n), ['b', 'd', 'a', 'c'])
  const sorted = r.sortRows([{ n: 'x', v: 1, low: false }, { n: 'y', v: 99, low: true }, { n: 'z', v: 5, low: false }], (x) => x.v, 'desc')
  assert.deepEqual(r.lastWhen(sorted, (x) => x.low).map((x) => x.n), ['z', 'x', 'y'])
})
t('Excel total row: sums, ROI = total sales / total cost, coverage and PCF from raw sums', () => {
  const rows = [
    { visits: 100, s_value: 600000, s_units: 100, cost: 60000, list_doctors: 20, kpi_doctors: 10, covered_doctors: 9, valid_visits: 90, target_visits: 100 },
    { visits: 50, s_value: 30000, s_units: 10, cost: 30000, list_doctors: 10, kpi_doctors: 30, covered_doctors: 3, valid_visits: 30, target_visits: 100 },
  ]
  const t1 = r.scopeTotals(rows)
  assert.deepEqual([t1.visits, t1.s_value, t1.s_units, t1.cost, t1.list_doctors], [150, 630000, 110, 90000, 30])
  assert.equal(t1.roi, 7) // 630000 / 90000, not the average of the two ROIs
  assert.equal(t1.coverage, 0.3) // 12 / 40, not the average of 90% and 10%
  assert.equal(t1.pcf, 0.6) // 120 / 200, not the average of 90% and 30%
  assert.equal(t1.sales_per_visit, 4200)
  assert.equal(r.scopeTotals([]).roi, null); assert.equal(r.scopeTotals([]).coverage, null); assert.equal(r.scopeTotals([]).pcf, null)
  assert.match(r.DOCTORS_TIP, /PM = Clinic \+ Poly Clinic, AM = other doctor types/)
  assert.match(r.KPI_TIP, /valid visits \/ target visits \(sum of Freq\)/)
})

console.log(`\n${n} tests passed`)
