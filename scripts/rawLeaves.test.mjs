// Run: npm run test:leaves-raw
import assert from 'node:assert/strict'
import { parseRawLeavesFile, statusOfSteps, planRawLeaves, duplicateIds, splitEmployeeRejections } from '../src/features/uploads/absence/rawLeavesParse.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }

const flow = (...steps) => `<table border='1'><tr><th>#</th><th>Approver</th><th>Status</th><th>Date</th></tr>${steps.map(([a, s], i) => `<tr align='center' class='x'><td>${i + 1}</td><td>${a}</td><td class='st'>${s}</td><td>2026-10-02</td></tr>`).join('')}</table>`
const row = ({ id = 1001, line = 'CIRA 1', emp = 'Samar Samir', type = 'Annual Leave', shift = 'Full', s = '2026-10-05', e = '2026-10-06', notes = '', steps = [['Mgr A', 'Approved'], ['HR B', 'Approved']] } = {}) =>
  `<tr valign='top' align='center' class='r'><td>1</td><td class='link' onclick='x'>${id}</td><td>${line}</td><td>${emp}</td><td>${type}</td><td>${shift}</td><td>${s}</td><td>${e}</td><td>${notes}</td><td>${flow(...steps)}</td><td>2026-10-01 09:00</td></tr>`
const file = (...rows) => `<html><table><caption>Vacations Report <b>From 2026-10-01 To 2026-10-15</b></caption><tr><th>#</th><th>ID</th></tr>${rows.join('\n')}`

t('rows parse; Flow with two approvals is Approved; nested table rows do not become leaves', () => {
  const f = parseRawLeavesFile('v.xls', file(row()))
  assert.equal(f.fatal, null)
  assert.deepEqual(f.titleRange, { from: '2026-10-01', to: '2026-10-15' })
  assert.equal(f.rows.length, 1)
  assert.deepEqual(f.rows[0], { crm_id: 1001, line: 'CIRA 1', employee: 'Samar Samir', leave_type: 'Annual Leave', shift: 'Full', start_date: '2026-10-05', end_date: '2026-10-06', status: 'Approved', approver: 'HR B', notes: null })
})
t('a Rejected step makes the leave Rejected (approver = the rejecting step)', () => {
  const f = parseRawLeavesFile('v.xls', file(row({ id: 2, steps: [['Mgr A', 'Approved'], ['HR B', 'Rejected']], notes: 'no cover &amp; late' })))
  assert.equal(f.rows[0].status, 'Rejected'); assert.equal(f.rows[0].approver, 'HR B'); assert.equal(f.rows[0].notes, 'no cover & late')
})
t('status rule', () => {
  assert.equal(statusOfSteps(['Approved', 'Approved']), 'Approved')
  assert.equal(statusOfSteps(['Approved', 'Pending']), 'Pending')
  assert.equal(statusOfSteps(['Pending', 'Rejected']), 'Rejected')
  assert.equal(statusOfSteps([]), 'Pending') // no steps is never Approved
  assert.equal(statusOfSteps(['approved ', 'APPROVED']), 'Approved')
})
t('no flow / pending flow; shifts kept as in the file; tallies; short rows and bad dates', () => {
  const f = parseRawLeavesFile('v.xls', file(row({ id: 3, steps: [] }), row({ id: 4, shift: 'AM', steps: [['M', 'Approved'], ['H', 'Pending']], line: 'CIRA 2', type: 'Sick Leave' }), `<tr valign='top' align='center'><td>1</td></tr>`, row({ id: 5, s: 'n/a', e: '' })))
  assert.deepEqual(f.rows.map((r) => [r.crm_id, r.status, r.shift, r.approver]), [[3, 'Pending', 'Full', null], [4, 'Pending', 'AM', 'H']])
  assert.equal(f.shortRows, 1); assert.equal(f.errors.length, 1)
  assert.deepEqual(f.byLine.map((x) => [x.key, x.rows]), [['CIRA 1', 1], ['CIRA 2', 1]])
  assert.deepEqual(f.byStatus, [{ key: 'Pending', rows: 2 }])
})
t('an unclosed Flow table does not break the row', () => {
  const html = file(`<tr valign='top' align='center'><td>1</td><td class='link'>77</td><td>CIRA 3</td><td>Ali</td><td>Unpaid Leave</td><td>PM</td><td>2026-10-02</td><td>2026-10-02</td><td></td><td><table><tr align='center'><td>1</td><td>M</td><td>Approved</td><td>2026-10-01</td></tr>`)
  const f = parseRawLeavesFile('v.xls', html)
  assert.equal(f.rows.length, 1); assert.equal(f.rows[0].status, 'Approved')
})
t('a file that is not a Vacations Report is rejected with a clear error', () => {
  const f = parseRawLeavesFile('c_1_10.xls', `<html><table><caption>Actual Visits Report From 2026-10-01 To 2026-10-15</caption></table>`)
  assert.match(f.fatal, /not a CRM .Vacations Report/); assert.equal(f.rows.length, 0)
})
t('duplicate IDs inside the files are reported', () => {
  const a = parseRawLeavesFile('a', file(row({ id: 9 }), row({ id: 10 })))
  const b = parseRawLeavesFile('b', file(row({ id: 9 })))
  assert.deepEqual(duplicateIds([a, b]), [{ id: '9', count: 2 }])
})
t('replace range per line = file From/To widened by that line\'s start dates; months span first start to last end', () => {
  const f = parseRawLeavesFile('v', file(
    row({ id: 1, line: 'CIRA 1', s: '2026-09-28', e: '2026-10-02' }),
    row({ id: 2, line: 'CIRA 1', s: '2026-10-14', e: '2026-11-03' }),
    row({ id: 3, line: 'CIRA 2', s: '2026-10-05', e: '2026-10-06' }),
  ))
  const p = planRawLeaves([f])
  assert.deepEqual(p.perLine.map((x) => [x.line, x.from, x.to, x.rows]), [['CIRA 1', '2026-09-28', '2026-10-15', 2], ['CIRA 2', '2026-10-01', '2026-10-15', 1]])
  assert.deepEqual(p.months, ['2026-09-01', '2026-10-01', '2026-11-01']) // 28 Sep .. 3 Nov
  assert.equal(p.rows, 3)
})
t('a second file of the same line widens that line\'s range; not-approved leaves are counted', () => {
  const a = parseRawLeavesFile('a', file(row({ id: 1, s: '2026-10-05' })))
  const b = parseRawLeavesFile('b', `<html><table><caption>Vacations Report From 2026-11-01 To 2026-11-15</caption></table>${row({ id: 2, s: '2026-11-04', e: '2026-12-02', steps: [['M', 'Pending']] })}`)
  const p = planRawLeaves([a, b])
  assert.deepEqual(p.perLine.map((x) => [x.from, x.to]), [['2026-10-01', '2026-11-15']])
  assert.equal(p.notApproved, 1); assert.equal(p.months.at(-1), '2026-12-01')
})
t('employee rejections are grouped by distinct name', () => {
  const rej = (reason) => ({ reason })
  const s = splitEmployeeRejections([rej('unknown employee Ali'), rej('unknown employee Ali'), rej('employee has no CODE: Mona'), rej('bad shift X')])
  assert.deepEqual(s.employees.map((x) => [x.employee, x.kind, x.count]), [['Ali', 'unknown employee', 2], ['Mona', 'employee has no CODE', 1]])
  assert.equal(s.other.length, 1)
})
console.log(`\n${n} tests passed`)
