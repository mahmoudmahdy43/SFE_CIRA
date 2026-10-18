// Run: npm run test:list   (Node >= 22.18 strips TypeScript types natively)
// Target List upload: CRM exports (main list + Speciality file) and the old single-file format.
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { parseListSheet } from '../src/features/uploads/list/listSheet.ts'
import { combineListFiles, finalizeList, lineDivisionStats, noSpecialityExport } from '../src/features/uploads/list/listJoin.ts'
import { groupRejectedByReason } from '../src/features/uploads/rejected.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }

/** aoa -> xlsx bytes -> dense worksheet, exactly how the worker reads a file. */
function sheet(aoa) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'S')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return XLSX.read(buf, { type: 'array', dense: true, cellNF: true, sheets: 'S' }).Sheets.S
}

const A_HEAD = ['#', 'Line', 'District', 'Division', 'Brick', 'Account Type', 'Account ID', 'Account Name', 'Doctor Id', 'Doctor Name', 'Class', 'Emp. Code', 'Emp. Name', 'Active From', 'DM', 'No of Visits', 'Freq.']
const aRow = (i, line, type, acc, doc, name, emp, extra = {}) => [
  i, line, 'D1', 'div' in extra ? extra.div : 'Div', extra.brick ?? 'B1', type, acc, 'Acc ' + acc, doc, name, extra.cls ?? 'A', emp, 'Rep ' + emp, extra.from ?? '2026-01-01 03:00:09', 'DM1', 5, extra.freq ?? 4,
]
// CRM main list: the first row is empty, the header is on row 2.
const mainSheet = (rows) => sheet([[], A_HEAD, ...rows])

const B_HEAD = ['#', 'Type', 'Acc.ID', 'HR Code', 'Employee', 'Manager', 'Territory', 'Name', 'Active From', 'Doctor Name', 'Doctor ID', 'Class', 'Specialty', 'Brick', 'Address']
const bRow = (i, type, acc, doc, spec) => [i, type, acc, 'H1', 'E', 'M', 'T', 'N', '2026-01-01', 'Doc', doc, 'A', spec, 'B1', 'Addr']
const specSheet = (rows) => sheet([[], B_HEAD, ...rows])

const parse = (ws) => parseListSheet(ws)

// ---------- parsing the main list ----------
t('main list: header found on row 2, no Month column, date-time -> YYYY-MM-DD, IDs as plain integers', () => {
  const p = parse(mainSheet([aRow(1, 'CIRA 1', 'Clinic', 1350, 77, 'Dr A', 9001), aRow(2, 'CIRA 1', 'Clinic', '1351.0', '78.0', 'Dr B', 9001, { from: 46023.13 })]))
  assert.equal(p.missing.length, 0)
  assert.equal(p.fileKind, 'main')
  assert.equal(p.needsMonth, true)
  assert.equal(p.rows.length, 2)
  assert.equal(p.rows[0].month, '')
  assert.equal(p.rows[0].account_id, '1350'); assert.equal(p.rows[0].doctor_id, '77'); assert.equal(p.rows[1].account_id, '1351'); assert.equal(p.rows[1].doctor_id, '78')
  assert.equal(p.rows[0].active_from, '2026-01-01'); assert.equal(p.rows[1].active_from, '2026-01-01')
  assert.equal(p.rows[0].speciality, null)
  assert.deepEqual(p.excelRows, [3, 4])
})
t('main list: ignored columns (#, District, DM, Emp. Name, No of Visits) never reach the rows', () => {
  const p = parse(mainSheet([aRow(1, 'CIRA 1', 'Clinic', 1, 2, 'Dr', 9001)]))
  const keys = Object.keys(p.rows[0]).sort()
  assert.deepEqual(keys, ['account_id', 'account_name', 'account_type', 'active_from', 'brick', 'class', 'division', 'doctor_id', 'doctor_name', 'emp_code', 'freq', 'line', 'month', 'speciality'].sort())
})
t('header row is searched in the first 10 rows only', () => {
  const late = sheet([[], [], [], [], [], [], [], [], [], [], [], A_HEAD, aRow(1, 'CIRA 1', 'Clinic', 1, 2, 'Dr', 9001)])
  assert.ok(parse(late).missing.length > 0) // header on row 12 -> not found -> usual "missing columns"
  const ok = sheet([[], [], [], [], [], [], [], [], [], A_HEAD, aRow(1, 'CIRA 1', 'Clinic', 1, 2, 'Dr', 9001)])
  assert.equal(parse(ok).rows.length, 1) // header on row 10 -> found
})

// ---------- parsing the Speciality file ----------
t('speciality file: recognised from its headers, keys built from Type|Acc.ID|Doctor ID, text kept as is', () => {
  const p = parse(specSheet([bRow(1, 'Clinic', 1350, 77, 'Gyn'), bRow(2, 'Hospital', '1351.0', '78', 'PLASTIC SURGERY'), bRow(3, 'Pharmacy', 5, 6, null)]))
  assert.equal(p.fileKind, 'speciality'); assert.equal(p.missing.length, 0)
  assert.deepEqual(p.specs, [{ key: 'Clinic|1350|77', specialty: 'Gyn' }, { key: 'Hospital|1351|78', specialty: 'PLASTIC SURGERY' }, { key: 'Pharmacy|5|6', specialty: null }])
})
t('speciality file: rows without Acc.ID / Doctor ID are skipped and counted', () => {
  const p = parse(specSheet([bRow(1, 'Clinic', 1, 2, 'Gyn'), bRow(2, 'Clinic', null, 3, 'Derma')]))
  assert.equal(p.specs.length, 1); assert.equal(p.specSkipped, 1)
})

// ---------- join ----------
const L1 = mainSheet([
  aRow(1, 'CIRA 1', 'Clinic', 1, 10, 'Dr One', 9001),
  aRow(2, 'CIRA 1', 'Hospital', 2, 20, 'Dr Two', 9001),
  aRow(3, 'CIRA 1', 'Clinic', 3, 30, 'Dr Three', 9002), // no match in B
  aRow(4, 'CIRA 1', 'Clinic', 4, 40, 'Dr Four', 9002), // B has it with a blank specialty
])
const L2 = mainSheet([aRow(1, 'CIRA 2', 'Pharmacy', 5, 50, 'Dr Five', 9101)])
const B1 = specSheet([bRow(1, 'Clinic', 1, 10, 'Gyn'), bRow(2, 'Hospital', '2.0', 20, 'Derma'), bRow(3, 'Clinic', 4, 40, null), bRow(4, 'Clinic', 99, 99, 'Orphan')])
const B2 = specSheet([bRow(1, 'Pharmacy', 5, 50, 'Pharmacy')])
const files = (...x) => x.map(([name, ws]) => ({ name, parsed: parse(ws) }))

t('join fills speciality by Account Type + Account ID + Doctor Id; Month picker value applies to every row', () => {
  const c = combineListFiles(files(['cira_2_october.xlsx', L2], ['cira_1_october.xlsx', L1], ['cira_1_october.xlsx', B1], ['cira_2_october.xlsx', B2]))
  assert.equal(c.needsMonth, true); assert.equal(c.fatal, undefined)
  const p = finalizeList(c, '2026-10-01')
  assert.equal(p.rows.length, 5)
  assert.ok(p.rows.every((r) => r.month === '2026-10-01'))
  const by = Object.fromEntries(p.rows.map((r) => [r.doctor_name, r.speciality]))
  assert.deepEqual(by, { 'Dr One': 'Gyn', 'Dr Two': 'Derma', 'Dr Three': null, 'Dr Four': null, 'Dr Five': 'Pharmacy' })
  assert.deepEqual(p.rows.map((r) => r.line), ['CIRA 1', 'CIRA 1', 'CIRA 1', 'CIRA 1', 'CIRA 2']) // files ordered by line, not drop order
})
t('stats: no speciality per line, no match both ways, files recognised', () => {
  const p = finalizeList(combineListFiles(files(['m1', L1], ['m2', L2], ['b1', B1], ['b2', B2])), '2026-10-01')
  const c = p.crm
  assert.equal(c.show, true); assert.equal(c.specFiles, 2)
  assert.deepEqual(c.lines, [{ line: 'CIRA 1', rows: 4, noSpeciality: 2, noMatch: 1 }, { line: 'CIRA 2', rows: 1, noSpeciality: 0, noMatch: 0 }])
  assert.equal(c.noSpecRows.length, 2)
  assert.equal(c.mainNoMatch, 1)
  assert.equal(c.specNoMatch, 1) // the "Orphan" row
  const b1 = c.files.find((f) => f.name === 'b1')
  assert.equal(b1.kind, 'speciality'); assert.equal(b1.unmatched, 1); assert.equal(b1.line, 'CIRA 1')
  assert.equal(c.files.find((f) => f.name === 'm2').line, 'CIRA 2')
})
t('"Download list" rows', () => {
  const p = finalizeList(combineListFiles(files(['m1', L1], ['b1', B1])), '2026-10-01')
  const ex = noSpecialityExport(p.crm.noSpecRows)
  assert.deepEqual(ex.map((r) => r['Doctor Name']), ['Dr Three', 'Dr Four'])
  assert.equal(ex[0].Month, '2026-10-01'); assert.equal(ex[0].Line, 'CIRA 1')
})
t('a speciality already in the main list is kept; the join only fills blanks', () => {
  const withSpec = sheet([[], [...A_HEAD, 'Speciality'], [...aRow(1, 'CIRA 1', 'Clinic', 1, 10, 'Dr One', 9001), 'Cardio'], [...aRow(2, 'CIRA 1', 'Hospital', 2, 20, 'Dr Two', 9001), null]])
  const p = finalizeList(combineListFiles(files(['m', withSpec], ['b', B1])), '2026-10-01')
  assert.deepEqual(p.rows.map((r) => r.speciality), ['Cardio', 'Derma'])
})
t('Month picker changes the rows without touching the parsed input (can be re-applied)', () => {
  const c = combineListFiles(files(['m1', L1], ['b1', B1]))
  const oct = finalizeList(c, '2026-10-01')
  const nov = finalizeList(c, '2026-11-01')
  assert.ok(oct.rows.every((r) => r.month === '2026-10-01')); assert.ok(nov.rows.every((r) => r.month === '2026-11-01'))
  assert.ok(c.rows.every((r) => r.month === '' && r.speciality === null))
})
t('same doctor in two files, same month: duplicates counted, last (in line order) wins', () => {
  const dup1 = mainSheet([aRow(1, 'CIRA 1', 'Clinic', 1, 10, 'Dr One', 9001)])
  const dup2 = mainSheet([aRow(1, 'CIRA 2', 'Clinic', 1, 10, 'Dr One', 9101)])
  const p = finalizeList(combineListFiles(files(['x2', dup2], ['x1', dup1])), '2026-10-01')
  assert.equal(p.rows.length, 1); assert.equal(p.duplicates, 1); assert.equal(p.rows[0].emp_code, '9101')
})
t('rows sent to load_list_chunk keep exactly today\'s keys', () => {
  const p = finalizeList(combineListFiles(files(['m1', L1], ['b1', B1])), '2026-10-01')
  assert.deepEqual(Object.keys(p.rows[0]), ['month', 'line', 'emp_code', 'account_id', 'doctor_id', 'account_name', 'doctor_name', 'account_type', 'speciality', 'class', 'brick', 'division', 'freq', 'active_from'])
})
t('a main list alone (no Speciality file) still loads: all rows without speciality, panel shown', () => {
  const p = finalizeList(combineListFiles(files(['m1', L1])), '2026-10-01')
  assert.equal(p.crm.show, true); assert.equal(p.crm.specFiles, 0)
  assert.equal(p.crm.noSpecRows.length, 4); assert.equal(p.crm.mainNoMatch, 0)
})

// ---------- old single-file format ----------
const LEGACY_HEAD = ['Month', 'Line', 'Emp. Code', 'Account ID', 'Doctor Id', 'Doctor Name', 'Freq.', 'Account Name', 'Account Type', 'Speciality', 'Class', 'Brick', 'Division', 'Active From']
const legacy = () => sheet([LEGACY_HEAD, ['2026-10-01', 'CIRA 1', 9001, 1, 10, 'Dr One', 4, 'Acc', 'Clinic', 'Gyn', 'A', 'B1', 'Div', '2026-01-05']])
t('old format: one file with a Month column is returned exactly as parsed, no month picker, no new panel', () => {
  const parsed = parse(legacy())
  assert.equal(parsed.needsMonth, false)
  const c = combineListFiles([{ name: 'old.xlsx', parsed }])
  assert.equal(c, parsed)
  assert.equal(finalizeList(c, '2030-01-01'), parsed)
  assert.equal(c.rows[0].month, '2026-10-01'); assert.equal(c.rows[0].speciality, 'Gyn'); assert.equal(c.rows[0].active_from, '2026-01-05')
  assert.equal(c.crm, undefined)
})
t('old format: blank / invalid Month still excludes the row', () => {
  const ws = sheet([LEGACY_HEAD, [null, 'CIRA 1', 9001, 1, 10, 'Dr', 4], ['nonsense', 'CIRA 1', 9001, 2, 11, 'Dr', 4]])
  const p = parse(ws)
  assert.equal(p.rows.length, 0); assert.deepEqual(p.errors.map((e) => e.reason), ['Month is blank', 'Month is not a valid date'])
})
t('old format: wrong file keeps the usual missing-columns result', () => {
  const p = parse(sheet([['Foo', 'Bar'], [1, 2]]))
  assert.ok(p.missing.includes('Line')); assert.ok(!p.missing.includes('Month'))
  const c = combineListFiles([{ name: 'x.xlsx', parsed: p }])
  assert.equal(c, p) // single file: the wizard shows its usual "Missing required column(s)" message
})

// ---------- the list belongs to the Box: Emp. Code optional, Division is the key ----------
t('a row with an empty Emp Code and a valid Division is accepted (CRM main list)', () => {
  const p = parse(mainSheet([aRow(1, 'CIRA 2', 'Clinic', 1, 10, 'Dr One', null, { div: 'Nasr City' })]))
  assert.equal(p.errors.length, 0)
  assert.equal(p.rows.length, 1)
  assert.equal(p.rows[0].emp_code, ''); assert.equal(p.rows[0].division, 'Nasr City')
  const f = finalizeList(combineListFiles(files(['m', mainSheet([aRow(1, 'CIRA 2', 'Clinic', 1, 10, 'Dr One', null, { div: 'Nasr City' })])])), '2026-10-01')
  assert.equal(f.rows.length, 1); assert.equal(f.rows[0].emp_code, ''); assert.equal(f.rows[0].division, 'Nasr City')
})
t('a row with an empty Emp Code and a valid Division is accepted (old single-file format)', () => {
  const ws = sheet([LEGACY_HEAD, ['2026-10-01', 'CIRA 1', null, 1, 10, 'Dr One', 4, 'Acc', 'Clinic', 'Gyn', 'A', 'B1', 'Zamalek', '2026-01-05']])
  const p = parse(ws)
  assert.equal(p.errors.length, 0); assert.equal(p.rows.length, 1)
  assert.equal(p.rows[0].emp_code, ''); assert.equal(p.rows[0].division, 'Zamalek')
})
t('Emp. Code column may be missing from the file altogether', () => {
  const head = A_HEAD.filter((h) => h !== 'Emp. Code')
  const row = aRow(1, 'CIRA 1', 'Clinic', 1, 10, 'Dr', 9001); row.splice(A_HEAD.indexOf('Emp. Code'), 1)
  const p = parse(sheet([[], head, row]))
  assert.equal(p.missing.length, 0); assert.equal(p.rows.length, 1); assert.equal(p.rows[0].emp_code, '')
})
t('Division is always part of the row; an empty Division is kept (null) and counted, not an error', () => {
  const p = parse(mainSheet([aRow(1, 'CIRA 1', 'Clinic', 1, 10, 'A', 1, { div: null }), aRow(2, 'CIRA 1', 'Clinic', 2, 20, 'B', 1, { div: '   ' }), aRow(3, 'CIRA 1', 'Clinic', 3, 30, 'C', 1, { div: 'Giza' })]))
  assert.equal(p.errors.length, 0); assert.equal(p.rows.length, 3)
  assert.deepEqual(p.rows.map((r) => r.division), [null, null, 'Giza'])
  assert.ok(p.rows.every((r) => 'division' in r))
})
t('a file without a Division column is reported as missing it (Division finds the Box)', () => {
  const head = A_HEAD.filter((h) => h !== 'Division')
  const row = aRow(1, 'CIRA 1', 'Clinic', 1, 10, 'Dr', 9001); row.splice(A_HEAD.indexOf('Division'), 1)
  assert.deepEqual(parse(sheet([[], head, row])).missing, ['Division'])
})
t('per line: rows, distinct Divisions, rows with empty Division', () => {
  const p = finalizeList(combineListFiles(files(['m1', mainSheet([
    aRow(1, 'CIRA 1', 'Clinic', 1, 10, 'A', 1, { div: 'Giza' }), aRow(2, 'CIRA 1', 'Clinic', 2, 20, 'B', 1, { div: 'Giza' }),
    aRow(3, 'CIRA 1', 'Clinic', 3, 30, 'C', 1, { div: 'Nasr' }), aRow(4, 'CIRA 1', 'Clinic', 4, 40, 'D', 1, { div: null }),
  ])], ['m2', mainSheet([aRow(1, 'CIRA 2', 'Clinic', 5, 50, 'E', null, { div: 'Giza' })])])), '2026-10-01')
  assert.deepEqual(lineDivisionStats(p.rows), [
    { line: 'CIRA 1', rows: 4, divisions: 2, noDivision: 1 },
    { line: 'CIRA 2', rows: 1, divisions: 1, noDivision: 0 },
  ])
})

// ---------- Speciality file: its Division column is wrong and must be ignored completely ----------
t('speciality file: a (wrong) Division column is never read and never changes the join or the rows', () => {
  const head = [...B_HEAD, 'Division']
  const withDiv = (rows, div) => sheet([[], head, ...rows.map((r) => [...r, div])])
  const rowsB = [bRow(1, 'Clinic', 1, 10, 'Gyn'), bRow(2, 'Hospital', 2, 20, 'Derma')]
  const clean = parse(specSheet(rowsB))
  const noisy = parse(withDiv(rowsB, 'WRONG TERRITORY'))
  assert.deepEqual(noisy.specs, clean.specs)
  assert.deepEqual(noisy.missing, []); assert.equal(noisy.errors.length, 0)
  const main = [aRow(1, 'CIRA 1', 'Clinic', 1, 10, 'Dr One', 9001, { div: 'Nasr City' }), aRow(2, 'CIRA 1', 'Hospital', 2, 20, 'Dr Two', 9001, { div: 'Giza' })]
  const joined = finalizeList(combineListFiles([{ name: 'm', parsed: parse(mainSheet(main)) }, { name: 'b', parsed: noisy }]), '2026-10-01')
  assert.deepEqual(joined.rows.map((r) => [r.division, r.speciality]), [['Nasr City', 'Gyn'], ['Giza', 'Derma']]) // Division stays the main list's; speciality joined on type + account + doctor only
  assert.deepEqual(joined.crm.noSpecRows, [])
})
t('speciality file without any Division column works the same', () => {
  const p = parse(specSheet([bRow(1, 'Clinic', 1, 10, 'Gyn')]))
  assert.equal(p.missing.length, 0); assert.equal(p.specs.length, 1)
})

// ---------- rejected rows grouped by reason ----------
t('rejected rows are grouped by reason: counts, biggest first, first 20 rows kept', () => {
  const rej = []
  for (let i = 0; i < 25; i++) rej.push({ excelRow: 10 + i, reason: 'unknown territory Nasr (CIRA 2)', context: `ctx${i}` })
  for (let i = 0; i < 3; i++) rej.push({ excelRow: 100 + i, reason: 'unknown territory Giza (CIRA 1)', context: `g${i}` })
  rej.push({ excelRow: undefined, reason: 'unknown territory Giza (CIRA 1)', context: 'g3' })
  const g = groupRejectedByReason(rej)
  assert.deepEqual(g.map((x) => [x.reason, x.count, x.rows.length]), [['unknown territory Nasr (CIRA 2)', 25, 20], ['unknown territory Giza (CIRA 1)', 4, 4]])
  assert.deepEqual(g[0].rows.map((r) => r.excelRow), Array.from({ length: 20 }, (_, i) => 10 + i)) // the first 20, in reported order
  assert.deepEqual(groupRejectedByReason([]), [])
})

// ---------- bad drops ----------
t('only a Speciality file -> clear error', () => {
  const c = combineListFiles(files(['b1', B1]))
  assert.match(c.fatal, /main list/)
})
t('unrecognised file among several -> error names the file', () => {
  const c = combineListFiles(files(['m1', L1], ['junk.xlsx', sheet([['Foo'], [1]])]))
  assert.match(c.fatal, /junk\.xlsx/)
})
t('invalid rows are listed with their file name when several files are dropped', () => {
  const bad = mainSheet([aRow(1, 'CIRA 1', 'Clinic', 1, 10, '', 9001)])
  const c = combineListFiles(files(['bad.xlsx', bad], ['m2', L2]))
  assert.equal(c.errors.length, 1); assert.match(c.errors[0].reason, /^bad\.xlsx: Doctor Name is blank/)
})

console.log(`\n${n} tests passed`)
