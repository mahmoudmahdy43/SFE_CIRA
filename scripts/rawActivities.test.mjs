// Run: npm run test:activities-raw
import assert from 'node:assert/strict'
import { parseRawActivitiesFile, splitPeople, guessActivityLine, planRawActivities } from '../src/features/uploads/absence/rawActivitiesParse.ts'
import { splitEmployeeRejections } from '../src/features/uploads/absence/rawLeavesParse.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }

const act = ({ id, type, shift = 'AM', day = '2026-10-04', time = '10:30', members, comments = '-' }) =>
  `<tr align='center' valign='top' class='x' onclick=location.href='user.visit.php?action=view&id=${id}';><td>1</td><td>${id}</td><td>Activity</td><td><nobr>${type}</nobr></td><td>${shift}</td><td>${day}</td><td>${time}</td><td>${members}</td><td>${comments}</td></tr>`
const visit = (id) => `<tr align='center' valign='top' onclick=location.href='x';>${'<td>v</td>'.repeat(17)}</tr>`
const file = ({ visits = [], acts = [], caption = 'Actual Visits Report From 2026-10-01 To 2026-10-15' } = {}) =>
  `<html><table><caption>${caption}</caption></table><fieldset><legend>Visits</legend><table><tr><th>#</th></tr>${visits.join('')}</table></fieldset><fieldset><legend>Activities</legend><table><tr><th>#</th><th>ID</th></tr>${acts.join('')}</table></fieldset>`

const ROWS = [
  act({ id: 501, type: 'Group Meeting', members: '-Samar Samir<br/>-Ahmed AbdelSalam<br/>- Samar Samir<br/>' }),
  act({ id: 502, type: 'RTD', shift: 'PM', day: '2026-10-09', members: '-Mona Ali', comments: 'Healthy &amp; fit' }),
  act({ id: 503, type: 'Av &amp; Conference', day: '2026-10-12', time: '', members: '<nobr>-Omar Said</nobr>' }),
]

t('3 rows: fields, members (prefix, tags, empties, duplicates stripped; joined with " | ")', () => {
  const f = parseRawActivitiesFile('a_1_10.xls', file({ acts: ROWS, visits: [visit(1)] }))
  assert.equal(f.fatal, null); assert.equal(f.rows.length, 3); assert.equal(f.visitRows, 1)
  assert.deepEqual(f.titleRange, { from: '2026-10-01', to: '2026-10-15' })
  assert.deepEqual(f.rows[0], { crm_id: 501, act_type: 'Group Meeting', shift: 'AM', day: '2026-10-04', at_time: '10:30', members: 'Samar Samir | Ahmed AbdelSalam', comments: null })
  assert.deepEqual(f.rows[1], { crm_id: 502, act_type: 'RTD', shift: 'PM', day: '2026-10-09', at_time: '10:30', members: 'Mona Ali', comments: 'Healthy & fit' })
  assert.equal(f.rows[2].act_type, 'Av & Conference'); assert.equal(f.rows[2].at_time, null); assert.equal(f.rows[2].members, 'Omar Said')
})
t('tallies and distinct people', () => {
  const f = parseRawActivitiesFile('x', file({ acts: ROWS }))
  assert.equal(f.people, 4)
  assert.deepEqual(f.byShift, [{ key: 'AM', rows: 2 }, { key: 'PM', rows: 1 }])
  assert.equal(f.byType.length, 3)
})
t('the Visits section is ignored; a visits-only file says to use the Visits upload; an empty file says no activities', () => {
  assert.match(parseRawActivitiesFile('v.xls', file({ visits: [visit(1), visit(2)] })).fatal, /visits file.*Visits upload/)
  assert.match(parseRawActivitiesFile('e.xls', file()).fatal, /no activities in this file/)
  assert.match(parseRawActivitiesFile('o.xls', `<html><caption>Vacations Report From 2026-10-01 To 2026-10-15</caption>`).fatal, /not a CRM Actual Visits Report/)
})
t('splitPeople', () => {
  assert.deepEqual(splitPeople('-A B<br/>-<br/> -C D<br/>-A B'), ['A B', 'C D'])
  assert.deepEqual(splitPeople(''), [])
})
t('line guess from file name', () => {
  assert.deepEqual(['act_1_10.xls', 'c-2-3', 'activities.xls', 'x_0_1'].map(guessActivityLine), [1, 2, null, null])
})
t('replace range per line = From/To widened to the rows\' dates; months span the range; duplicates warn', () => {
  const a = { file: parseRawActivitiesFile('a', file({ acts: ROWS })), line: 1 }
  const b = { file: parseRawActivitiesFile('b', file({ caption: 'Actual Visits Report From 2026-10-20 To 2026-11-05', acts: [act({ id: 9, type: 'RTD', day: '2026-11-07', members: '-Z' })] })), line: 1 }
  const c = { file: parseRawActivitiesFile('c', file({ acts: [act({ id: 10, type: 'RTD', members: '-Y' })] })), line: 2 }
  const p = planRawActivities([a, b, c])
  assert.deepEqual(p.perLine.map((x) => [x.line, x.from, x.to, x.rows]), [[1, '2026-10-01', '2026-11-07', 4], [2, '2026-10-01', '2026-10-15', 1]])
  assert.deepEqual(p.months, ['2026-10-01', '2026-11-01']); assert.equal(p.rows, 5)
  assert.equal(planRawActivities([a, { ...c, line: 1 }]).overlaps.length, 1)
  assert.equal(planRawActivities([a, c]).overlaps.length, 0)
})
t('unknown employees are grouped by distinct name', () => {
  const s = splitEmployeeRejections([{ reason: 'unknown employee Ali' }, { reason: 'unknown employee Ali' }, { reason: 'employee has no CODE: Mona' }, { reason: 'bad shift X' }])
  assert.deepEqual(s.employees.map((x) => [x.employee, x.count]), [['Ali', 2], ['Mona', 1]]); assert.equal(s.other.length, 1)
})
console.log(`\n${n} tests passed`)
