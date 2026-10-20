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

console.log(`\n${n} tests passed`)
