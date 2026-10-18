// Run: npm run test:profile   (Node >= 22.18 strips TypeScript types natively)
import assert from 'node:assert/strict'
import { profileHref, parseProfileParams, toSearchHits, groupSearchHits } from '../src/features/profile/profileLinks.ts'
import { salesByMonth, salesByProduct } from '../src/features/profile/salesFold.ts'
import { toRepPeriods, boxSegments, vacancyGaps, daysInclusive } from '../src/features/profile/boxHistory.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }

t('search results are grouped Reps, Managers, Staff, Boxes; empty groups dropped; order kept', () => {
  const hits = toSearchHits([
    { kind: 'box', id: 3, name: 'Nasr 1', code: null, line: 'CIRA 1', extra: 'East' },
    { kind: 'rep', id: 7, name: 'Samar', code: 'R7', line: 'CIRA 2', extra: null },
    { kind: 'rep', id: 2, name: 'Ali', code: 'R2', line: 'CIRA 1', extra: null },
    { kind: 'manager', id: 9, name: 'Dr Hany', code: 'M9', line: 'CIRA 1', extra: null },
    { kind: 'alien', id: 1, name: 'x' }, // unknown kind dropped
    { kind: 'rep', name: 'no id' }, // no id dropped
    null,
  ])
  assert.equal(hits.length, 4)
  const g = groupSearchHits(hits)
  assert.deepEqual(g.map((x) => [x.label, x.hits.map((h) => h.id)]), [['Reps', [7, 2]], ['Managers', [9]], ['Boxes', [3]]])
  assert.deepEqual(groupSearchHits([]), [])
  assert.deepEqual(toSearchHits(null), [])
})

t('link builder: /360?type=..&id=..', () => {
  assert.equal(profileHref('rep', 12), '/360?type=rep&id=12')
  assert.equal(profileHref('box', '5'), '/360?type=box&id=5')
  assert.equal(profileHref('staff', 1), '/360?type=staff&id=1')
  assert.equal(profileHref('manager', null), '/360')
  assert.deepEqual(parseProfileParams('?type=manager&id=4'), { type: 'manager', id: 4 })
  assert.equal(parseProfileParams('?type=nope&id=4'), null)
  assert.equal(parseProfileParams('?type=rep'), null)
  assert.equal(parseProfileParams(''), null)
  // round trip
  assert.deepEqual(parseProfileParams(profileHref('box', 88).split('?')[1] ? '?' + profileHref('box', 88).split('?')[1] : ''), { type: 'box', id: 88 })
})

const per = (rep_id, from, to) => ({ rep_id, rep_name: `R${rep_id}`, rep_code: `C${rep_id}`, valid_from: from, valid_to: to })

t('vacancy gaps between periods, with length in days', () => {
  const p = toRepPeriods([per(2, '2026-04-01', '2026-06-30'), per(1, '2026-01-01', '2026-02-28'), per(3, '2026-07-01', null)])
  assert.deepEqual(p.map((x) => x.repId), [1, 2, 3]) // oldest first
  const gaps = vacancyGaps(p, '2026-10-18')
  assert.deepEqual(gaps, [{ from: '2026-03-01', to: '2026-03-31', days: 31 }]) // Mar = 31 days; 06-30 -> 07-01 has no gap
  const seg = boxSegments(p, '2026-10-18')
  assert.deepEqual(seg.map((s) => s.type), ['rep', 'vacant', 'rep', 'rep'])
})

t('a box whose last rep left is vacant until today (open gap)', () => {
  const g = vacancyGaps(toRepPeriods([per(1, '2026-01-01', '2026-09-30')]), '2026-10-18')
  assert.deepEqual(g, [{ from: '2026-10-01', to: null, days: 18 }])
})

t('back-to-back periods and overlaps give no gap; leap-year arithmetic is exact', () => {
  assert.deepEqual(vacancyGaps(toRepPeriods([per(1, '2026-01-01', '2026-03-31'), per(2, '2026-04-01', null)]), '2026-10-18'), [])
  assert.deepEqual(vacancyGaps(toRepPeriods([per(1, '2026-01-01', '2026-05-31'), per(2, '2026-04-01', '2026-06-30'), per(3, '2026-07-01', null)]), '2026-10-18'), [])
  assert.equal(daysInclusive('2024-02-28', '2024-03-01'), 3)
  assert.deepEqual(vacancyGaps(toRepPeriods([per(1, '2024-01-01', '2024-02-28'), per(2, '2024-03-05', null)]), '2024-06-01'), [{ from: '2024-02-29', to: '2024-03-04', days: 5 }])
})

t('history rows read tolerantly; empty / junk input gives an empty timeline', () => {
  const p = toRepPeriods([{ id: 5, name: 'Mona', code: 'M', from: '2026-02-01T00:00:00', to: '2026-02-10' }, { rep_name: 'no date' }])
  assert.deepEqual(p, [{ repId: 5, name: 'Mona', code: 'M', from: '2026-02-01', to: '2026-02-10' }])
  assert.deepEqual(boxSegments([], '2026-10-18'), [])
  assert.deepEqual(toRepPeriods(null), [])
})

t('sales aggregation: sums per month and product, ratios from sums, vacant months marked', () => {
  const rows = [
    { month: '2026-01-01', product: 'A', sales: 100, target: 200, units: 1, vacant: false },
    { month: '2026-01-01', product: 'B', sales: 100, target: 0, units: 1, vacant: false },
    { month: '2026-02-01', product: 'A', sales: 50, target: 50, units: 1, vacant: true },
  ]
  const m = salesByMonth(rows, ['2026-01-01', '2026-02-01', '2026-03-01'])
  assert.deepEqual(m.map((x) => [x.sales, x.target, x.ach, x.vacant, x.hasData]), [[200, 200, 1, false, true], [50, 50, 1, true, true], [0, 0, null, false, false]])
  const p = salesByProduct(rows, ['2026-01-01'])
  assert.deepEqual(p.map((x) => [x.product, x.ach, x.gap]), [['A', 0.5, 100], ['B', null, -100]])
})

console.log(`\n${n} tests passed`)
