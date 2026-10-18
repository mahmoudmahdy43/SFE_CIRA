// Run: npm run test:office-work-raw
import assert from 'node:assert/strict'
import { parseRawOfficeWorkFile, guessOfficeWorkLine, planRawOfficeWork } from '../src/features/uploads/absence/rawOfficeWorkParse.ts'
import { parseRawActivitiesFile } from '../src/features/uploads/absence/rawActivitiesParse.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }

const ow = ({ id, type, shift = 'AM', day = '2026-10-04', time = '00:00', members, comments = '-' }) =>
  `<tr align='center' valign='top' class='x' onclick=location.href='user.visit.php?action=view&id=${id}';><td>1</td><td>${id}</td><td></td><td><nobr>${type}</nobr></td><td>${shift}</td><td>${day}</td><td>${time}</td><td>${members}</td><td>${comments}</td></tr>`
const visit = () => `<tr align='center' valign='top' onclick=location.href='x';>${'<td>v</td>'.repeat(17)}</tr>`
const file = ({ visits = [], rows = [], legend = 'Office Work', caption = 'Actual Visits Report From 2026-10-01 To 2026-10-15' } = {}) =>
  `<html><table><caption>${caption}</caption></table><fieldset><legend>Visits</legend><table><tr><th>#</th></tr>${visits.join('')}</table></fieldset><fieldset><legend>${legend}</legend><table><tr><th>#</th><th>ID</th></tr>${rows.join('')}</table></fieldset>`

// 3 rows: two names in one; a PM sibling of the same person and day
const ROWS = [
  ow({ id: 601, type: 'Weekly Meeting', members: '-Samar Samir<br/>-Ahmed AbdelSalam<br/>- Samar Samir<br/>' }),
  ow({ id: 602, type: 'Weekly Meeting', shift: 'PM', members: '-Samar Samir', comments: 'Q4 &amp; plan' }),
  ow({ id: 603, type: 'Busniess Travel', day: '2026-10-12', time: '09:15', members: '<nobr>-Omar Said</nobr>' }),
]

t('3 rows: fields, members (distinct, joined with " | "), Time not kept', () => {
  const f = parseRawOfficeWorkFile('o_1_10.xls', file({ rows: ROWS, visits: [visit()] }))
  assert.equal(f.fatal, null); assert.equal(f.rows.length, 3); assert.equal(f.visitRows, 1)
  assert.deepEqual(f.titleRange, { from: '2026-10-01', to: '2026-10-15' })
  assert.deepEqual(f.rows[0], { crm_id: 601, ow_type: 'Weekly Meeting', shift: 'AM', day: '2026-10-04', members: 'Samar Samir | Ahmed AbdelSalam', comments: null })
  assert.deepEqual(f.rows[1], { crm_id: 602, ow_type: 'Weekly Meeting', shift: 'PM', day: '2026-10-04', members: 'Samar Samir', comments: 'Q4 & plan' })
  assert.equal(f.rows[2].ow_type, 'Busniess Travel'); assert.equal(f.rows[2].members, 'Omar Said')
  assert.ok(!('at_time' in f.rows[0]))
})
t('tallies and distinct people (same person on AM and PM counted once)', () => {
  const f = parseRawOfficeWorkFile('x', file({ rows: ROWS }))
  assert.equal(f.people, 3)
  assert.deepEqual(f.byShift, [{ key: 'AM', rows: 2 }, { key: 'PM', rows: 1 }])
  assert.deepEqual(f.byType, [{ key: 'Weekly Meeting', rows: 2 }, { key: 'Busniess Travel', rows: 1 }])
})
t('Visits section ignored; visits-only and empty files; other kind and non-reports are refused', () => {
  assert.match(parseRawOfficeWorkFile('v', file({ visits: [visit(), visit()] })).fatal, /visits file.*Visits upload/)
  assert.match(parseRawOfficeWorkFile('e', file()).fatal, /no office work in this file/)
  assert.match(parseRawOfficeWorkFile('a', file({ legend: 'Activities', rows: ROWS })).fatal, /Activities file.*Activities upload/)
  assert.match(parseRawActivitiesFile('o', file({ rows: ROWS })).fatal, /Office Work file.*Office Work upload/)
  assert.match(parseRawOfficeWorkFile('z', '<html><caption>Vacations Report</caption>').fatal, /not a CRM Actual Visits Report/)
})
t('short rows and bad dates are counted, not loaded', () => {
  const bad = ow({ id: 9, type: 'Training', day: 'n/a', members: '-X' })
  const short = `<tr align='center' valign='top'><td>1</td><td>2</td></tr>`
  const f = parseRawOfficeWorkFile('b', file({ rows: [ROWS[0], bad, short] }))
  assert.equal(f.rows.length, 1); assert.equal(f.shortRows, 1); assert.equal(f.errors.length, 1)
})
t('line guess from file name', () => {
  assert.deepEqual(['ow_1_10.xls', 'c-2-3', 'office.xls', 'x_0_1'].map(guessOfficeWorkLine), [1, 2, null, null])
})
t('replace range per line (From/To widened to row days), months, overlaps', () => {
  const a = { file: parseRawOfficeWorkFile('a', file({ rows: ROWS })), line: 1 }
  const b = { file: parseRawOfficeWorkFile('b', file({ caption: 'Actual Visits Report From 2026-10-20 To 2026-11-05', rows: [ow({ id: 9, type: 'Training', day: '2026-11-07', members: '-Z' })] })), line: 1 }
  const c = { file: parseRawOfficeWorkFile('c', file({ rows: [ow({ id: 10, type: 'Training', members: '-Y' })] })), line: 2 }
  const p = planRawOfficeWork([a, b, c])
  assert.deepEqual(p.perLine.map((x) => [x.line, x.from, x.to, x.rows]), [[1, '2026-10-01', '2026-11-07', 4], [2, '2026-10-01', '2026-10-15', 1]])
  assert.deepEqual(p.months, ['2026-10-01', '2026-11-01']); assert.equal(p.rows, 5)
  assert.equal(planRawOfficeWork([a, { ...c, line: 1 }]).overlaps.length, 1)
  assert.equal(planRawOfficeWork([a, c]).overlaps.length, 0)
})
console.log(`\n${n} tests passed`)
