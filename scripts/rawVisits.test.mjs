// Run: npm run test:visits-raw
import assert from 'node:assert/strict'
import { parseRawVisitsFile, guessLineNumber, planRawUpload, shiftOfAccType, splitMembers, monthsBetween } from '../src/features/uploads/visits/rawVisitsParse.ts'
import { normalizeSummary, splitOwnerRejections } from '../src/features/uploads/visits/rawVisitsResult.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }

const cell = (inner, pre = '') => `<td ${pre}>${inner}</td>`
function tr({ id = 1, terr = 'T-1', brick = 'Nasr', vt = 'S', type = 'C', acc = 'Clinic &amp; Co', doc = 'Dr A', when = '2026-10-03 10:30', products = '-Biotin +4<br/>-Vit C', samples = '2<br/>0', members = '- <nobr>Samar Samir</nobr><br/>-Ahmed AbdelSalam<br/><nobr>-Ahmed AbdelSalam</nobr>', notes = '-<br/>-', root = 'Planned', cells = 17 } = {}) {
  const c = [
    cell(`<input id='actual_${id}'>`), cell('1'), cell(`${terr}<br/><nobr>${brick}</nobr>`), cell(vt), cell(type), cell(acc), cell(doc),
    cell('Spec'), cell('A'), cell(when), cell(products), cell(samples), cell(members), cell(notes), cell(root), cell('3'), cell('CRM'),
  ].slice(0, cells)
  return `<tr align='center' valign='top' class='x'>${c.join('')}</tr>`
}
const file = (...rows) => `<html><table><caption>Actual Visits Report <b>From 2026-10-01 To 2026-10-15</b></caption><tr><th>#</th></tr>${rows.join('\n')}`

t('title range without AM/PM; shift is always null', () => {
  const f = parseRawVisitsFile('c_1_10.xls', file(tr()))
  assert.deepEqual(f.titleRange, { from: '2026-10-01', to: '2026-10-15' })
  assert.equal(f.rows[0].shift, null)
})
t('owner = first nobr, members = other distinct names', () => {
  const f = parseRawVisitsFile('x', file(tr()))
  assert.equal(f.rows[0].owner, 'Samar Samir')
  assert.equal(f.rows[0].members, 'Ahmed AbdelSalam')
  assert.deepEqual(splitMembers('- <nobr>Samar Samir</nobr>'), { owner: 'Samar Samir', members: null })
})
t('fields, entities, time, products paired with samples, dash-only notes ignored', () => {
  const r = parseRawVisitsFile('x', file(tr({ id: 77 }))).rows[0]
  assert.equal(r.crm_id, 77); assert.equal(r.territory, 'T-1'); assert.equal(r.brick, 'Nasr')
  assert.equal(r.acc_name, 'Clinic & Co'); assert.equal(r.visit_date, '2026-10-03'); assert.equal(r.visit_time, '10:30')
  assert.deepEqual(r.products, [{ n: 'Biotin +4', s: 2 }, { n: 'Vit C', s: 0 }])
  assert.equal(r.notes, null); assert.equal(r.visit_root, 'Planned')
})
t('double visits stay as two rows; S/D counts; short rows skipped; bad dates reported', () => {
  const f = parseRawVisitsFile('x', file(tr({ vt: 'D' }), tr({ vt: 'D', members: '<nobr>Manager M</nobr>' }), tr(), tr({ cells: 10 }), tr({ when: '' })))
  assert.equal(f.rows.length, 3); assert.equal(f.double, 2); assert.equal(f.single, 1)
  assert.equal(f.shortRows, 1); assert.equal(f.errors.length, 1); assert.equal(f.owners, 2)
  assert.deepEqual(f.rowNumbers, [1, 2, 3])
})
t('acc type -> shift and per-file table', () => {
  assert.deepEqual(['A', 'H', 'AM', 'PC', 'C', 'P', 'X'].map(shiftOfAccType), ['AM', 'AM', 'AM', 'PM', 'PM', 'Pharmacy', null])
  const f = parseRawVisitsFile('x', file(tr({ type: 'C' }), tr({ type: 'C' }), tr({ type: 'P' }), tr({ type: 'Z' })))
  assert.deepEqual(f.accTypes.map((a) => [a.type, a.rows, a.shift]), [['C', 2, 'PM'], ['P', 1, 'Pharmacy'], ['Z', 1, null]])
})
t('line guess from file name', () => {
  assert.deepEqual(['c_1_10.xls', 'c-2-3', 'C 3 11', 'p_2_10.xls', 'c_4_1', 'foo'].map(guessLineNumber), [1, 2, 3, 2, null, null])
})
t('plan: range, months, duplicate warning', () => {
  const a = { file: parseRawVisitsFile('a.xls', file(tr())), line: 1 }
  const b = { file: parseRawVisitsFile('b.xls', file(tr({ when: '2026-11-02 09:00' }))), line: 1 }
  const p = planRawUpload([a, b])
  assert.equal(p.rows, 2); assert.equal(p.from, '2026-10-01'); assert.equal(p.to, '2026-11-02')
  assert.deepEqual(p.months, ['2026-10-01', '2026-11-01']); assert.equal(p.overlaps.length, 1)
  assert.equal(planRawUpload([a, { ...b, line: 2 }]).overlaps.length, 0)
  assert.deepEqual(monthsBetween('2025-12-20', '2026-01-02'), ['2025-12-01', '2026-01-01'])
})
t('owner rejections are split and counted per distinct owner', () => {
  const rej = (reason) => ({ excelRow: 1, reason, context: '' })
  const s = splitOwnerRejections([rej('unknown owner Ali'), rej('unknown owner Ali'), rej('owner has no CODE: Mona'), rej('unknown account type Z')])
  assert.deepEqual(s.owners.map((o) => [o.owner, o.kind, o.count]), [['Ali', 'unknown owner', 2], ['Mona', 'owner has no CODE', 1]])
  assert.equal(s.other.length, 1)
})
t('summary normalizer accepts map and array shapes', () => {
  const a = normalizeSummary({ link_methods: { name: 8, not_found: 2 }, unknown_products: ['X'], unlinked_samples: [{ acc_type: 'C', acc_name: 'A', doctor_name: 'D', why: 'not_found', visits: 3 }] })
  assert.equal(a.linkMethods.find((m) => m.key === 'name').pct, 0.8)
  assert.equal(a.unlinked[0].visits, 3); assert.equal(a.unknownProducts[0].name, 'X')
  const b = normalizeSummary([{ link_methods: [{ method: 'name', n: 1 }] }])
  assert.equal(b.linkMethods.find((m) => m.key === 'name').count, 1)
})
console.log(`\n${n} tests passed`)
