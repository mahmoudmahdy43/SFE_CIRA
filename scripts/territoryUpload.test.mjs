// Run: npm run test:territory
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseGpsFile, parseCoords } from '../src/features/uploads/visits/gpsParse.ts'
import { parseDroppedFile, parseTerritoryReport } from '../src/features/uploads/visits/territoryParse.ts'
import { buildTerritoryPlan } from '../src/features/uploads/visits/territoryPlan.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }

const CAP = '<caption>Actual Visits Report From 2026-10-01 To 2026-10-20</caption>'
const link = (id) => `onclick=location.href='user.visit.php?action=view&id=${id}';`
const gpsRow = (id, dev) => `<tr align='center' valign='top'><td><input name='actual_${id}'><td>1<td>${id}<td>T 1<td>S<td>A<td ${link(id)}>Acc<td>Doc<td>x<td>y<td>2026-10-02<br/>10:00<td>p<td>m<td>n<td>addr<td><nobr><span onclick=window.open('map.php?ll=1&lg=2');>img</span></nobr><br/><nobr><span>${dev}</span></nobr><td>00:00:10<td>10:00:00<td>10:01:00`
const gpsFile = (rows) => `<html><table>${CAP}<fieldset><legend>Visits</legend><table><tr><th>&nbsp;<th>#<th>ID<th>Territory<th>Device Deviation<th>Duration${rows.join('')}</table></fieldset><fieldset><legend>Pharmacies Visits</legend><table><tr><th>#${gpsRow(9, '1 m. (1--2--3--4)')}</table></fieldset>`

t('coordinates: "--" is a separator, not a minus sign', () => {
  assert.deepEqual(parseCoords('31.2178401--31.353627--31.2172774--31.352434'), [31.2178401, 31.353627, 31.2172774, 31.352434])
  assert.deepEqual(parseCoords('-31.5---2.5--3--4'), [-31.5, -2.5, 3, 4])
  assert.equal(parseCoords('1--2--3'), null)
  assert.equal(parseCoords('a--b--c--d'), null)
})
t('GPS file: Visits section only, id from the link, thousands separator, nan and missing coordinates', () => {
  const g = parseGpsFile('g.xls', gpsFile([
    gpsRow(257979, '129.55 m. (31.2178401--31.353627--31.2172774--31.352434) '),
    gpsRow(1, '1,004.51 m. (29.98--31.27--29.99--31.28)'),
    gpsRow(2, 'nan m. (31.1--29.8--31.1--29.8)'),
    gpsRow(3, ''),
    gpsRow(257979, '5 m. (1--2--3--4)'),
  ]))
  assert.equal(g.fatal, null); assert.equal(g.visitRows, 5); assert.equal(g.noCoords, 1); assert.equal(g.nanDeviation, 1); assert.equal(g.duplicates, 1)
  assert.deepEqual(g.titleRange, { from: '2026-10-01', to: '2026-10-20' })
  assert.deepEqual(g.rows[0], { crm_id: '257979', dev_lat: 31.2178401, dev_lng: 31.353627, acc_lat: 31.2172774, acc_lng: 31.352434, deviation_m: 129.55 })
  assert.equal(g.rows[1].deviation_m, 1004.51)
  assert.equal(g.rows[2].deviation_m, null); assert.equal(g.rows[2].dev_lat, 31.1)
  assert.equal(g.rows.length, 3)
})
t('GPS file: not a GPS report / not a CRM report', () => {
  assert.match(parseGpsFile('x', '<caption>Vacations</caption>').fatal, /not a CRM Actual Visits Report/)
  assert.match(parseGpsFile('x', `<table>${CAP}<fieldset><legend>Visits</legend><table><tr><th>#</table>`).fatal, /Device Deviation/)
})

const clinic = (id) => `<tr align='center' valign='top'><td><input name='actual_${id}'><td>1<td><nobr>Maadi 1</nobr><br/><span><nobr>El Maadi</nobr></span><td>S<td>AM<td>Acc<td>Doc<td>GP<td><td><nobr>2026-10-02</nobr><br/><nobr>10:25</nobr><td><nobr>-Irovast</nobr><br/><td>0<br/><td><nobr>Ann Lee</nobr><br/><td>-<td>Direct<td>1<td>App`
const pharm = (id) => `<tr align='center' valign='top'><td><td ${link(id)}>5010<td><nobr>Imbaba 2</nobr><br/><span><nobr>Imbaba</nobr></span><td>S<td>P<td>Pharm<td>Dr<td>x<td>y<td>2026-10-03<br/>11:00<td>-Irovast<br/><td>-<td>-<td>-<td><nobr>Bob Ray</nobr><td>-`
const crmRow = (id, type, member, day = '2026-10-04') => `<tr align='center' valign='top' ${link(id)}><td>1<td>${id}<td><td><nobr>${type}</nobr><td>AM<td>${day}<td>00:00<td>${member}<td>note`
const report = ({ owHead = '<th>Members', owRows = [crmRow(9, 'Admin Work', '-Ann Lee<br/>')], events = true } = {}) =>
  `<html><table>${CAP}<fieldset><legend>Visits</legend><table><tr><th>&nbsp;<th>#<th>Territory<th>Samples<th>Members${clinic(100)}${clinic(101)}</table></fieldset>` +
  `<fieldset><legend>Pharmacies Visits</legend><table><tr><th>#<th>Last Order${pharm(200)}</table></fieldset>` +
  `<fieldset><legend>Office Work</legend><table><tr><th>#<th>ID<th>Type${owHead}${owRows.join('')}</table></fieldset>` +
  `<fieldset><legend>Activities</legend><table><tr><th>#<th>ID<th>Members${crmRow(300, 'Av &amp; Conference', '-Bob Ray<br/>')}</table></fieldset>` +
  (events ? `<fieldset><legend>Events</legend><table><tr><th>#${crmRow(400, 'Ev', '-x')}</table></fieldset>` : '')

t('Territory report: every section is recognised and read with its own parser; Events ignored', () => {
  const r = parseTerritoryReport('r.xls', report())
  assert.equal(r.clinic.rows.length, 2); assert.equal(r.clinic.pharmacy, false); assert.equal(r.clinic.rows[0].crm_id, 100)
  assert.equal(r.pharmacy.rows.length, 1); assert.equal(r.pharmacy.pharmacy, true); assert.equal(r.pharmacy.rows[0].crm_id, 200)
  assert.equal(r.officeWork.rows.length, 1); assert.equal(r.officeWork.rows[0].members, 'Ann Lee')
  assert.equal(r.activities.rows.length, 1); assert.equal(r.activities.rows[0].act_type, 'Av & Conference')
  assert.deepEqual(r.ignored, ['Events: not needed — ignored.'])
  assert.deepEqual(r.titleRange, { from: '2026-10-01', to: '2026-10-20' })
})
t('Office Work without a Members column is ignored with the reason', () => {
  const r = parseTerritoryReport('r.xls', report({ owHead: '<th>Comments', events: false }))
  assert.equal(r.officeWork, null)
  assert.equal(r.ignored.length, 1); assert.match(r.ignored[0], /Office Work: no Members column/)
  assert.equal(r.clinic.rows.length, 2)
})
t('dropped files are told apart: Territory report, GPS report, anything else', () => {
  assert.equal(parseDroppedFile('a', report()).kind, 'territory')
  assert.equal(parseDroppedFile('b', gpsFile([gpsRow(1, '1 m. (1--2--3--4)')])).kind, 'gps')
  assert.equal(parseDroppedFile('c', '<caption>Vacations</caption>').kind, 'unknown')
  assert.equal(parseDroppedFile('d', `<table>${CAP}</table>`).kind, 'unknown')
})

const map = new Map([['2026-10-01', new Map([['ann lee', 1], ['bob ray', 2]])]])
t('plan: a chosen line takes every section; one replace range per line and section', () => {
  const r = parseTerritoryReport('r.xls', report())
  const p = buildTerritoryPlan([r], 3, null)
  assert.deepEqual(p.visits.files.map((f) => [f.line, !!f.pharmacy, f.file.rows.length]), [[3, false, 2], [3, true, 1]])
  assert.deepEqual(p.visits.plan.perLine.map((c) => [c.line, c.pharmacy, c.from, c.to]), [[3, false, '2026-10-01', '2026-10-20'], [3, true, '2026-10-01', '2026-10-20']])
  assert.deepEqual(p.officeWork.plan.perLine.map((c) => [c.line, c.rows]), [[3, 1]])
  assert.deepEqual(p.activities.plan.perLine.map((c) => [c.line, c.rows]), [[3, 1]])
  assert.equal(p.unresolved.length, 0)
})
t('plan: auto splits every section by owner / member and reports the people without a line', () => {
  const r = parseTerritoryReport('r.xls', report())
  const p = buildTerritoryPlan([r], 'auto', map)
  assert.deepEqual(p.visits.files.map((f) => [f.line, !!f.pharmacy, f.file.rows.length]), [[1, false, 2], [2, true, 1]])
  assert.deepEqual(p.officeWork.files.map((f) => f.line), [1]); assert.deepEqual(p.activities.files.map((f) => f.line), [2])
  const none = buildTerritoryPlan([r], 'auto', new Map())
  assert.equal(none.visits, null); assert.equal(none.officeWork, null)
  assert.deepEqual(none.unresolved.map((u) => [u.section, u.owner, u.rows]).sort(), [['activities', 'Bob Ray', 1], ['office_work', 'Ann Lee', 1], ['pharmacy', 'Bob Ray', 1], ['visits', 'Ann Lee', 2]])
})

// The real CRM exports (kept outside the repo): checked only when they are on this machine.
const D = 'C:/Users/DELL/OneDrive/Desktop/'
if (fs.existsSync(D + 'visits__2026-10-01 (2).xls') && fs.existsSync(D + 'visits__2026-10-01 (3).xls')) {
  t('real files: Territory report sections and GPS report', () => {
    const tr = parseDroppedFile('t', fs.readFileSync(D + 'visits__2026-10-01 (2).xls', 'utf8'))
    assert.equal(tr.kind, 'territory')
    assert.deepEqual([tr.report.clinic.rows.length, tr.report.pharmacy.rows.length, tr.report.officeWork.rows.length, tr.report.activities.rows.length], [5009, 1416, 66, 19])
    const g = parseDroppedFile('g', fs.readFileSync(D + 'visits__2026-10-01 (3).xls', 'utf8'))
    assert.equal(g.kind, 'gps')
    assert.equal(g.gps.visitRows, 5009); assert.equal(g.gps.rows.length, 5003); assert.equal(g.gps.rows.filter((r) => r.deviation_m !== null).length, 4996)
    const ids = new Set(g.gps.rows.map((r) => r.crm_id)); const clinicIds = new Set(tr.report.clinic.rows.map((r) => String(r.crm_id)))
    assert.equal([...ids].filter((i) => clinicIds.has(i)).length, 5003)
  })
}
console.log(`${n} tests passed`)
