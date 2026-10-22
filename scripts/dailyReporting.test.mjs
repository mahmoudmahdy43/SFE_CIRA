// Run: npm run test:daily
import assert from 'node:assert/strict'
import * as d from '../src/features/daily/dailyMath.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }
const row = (type, terr, emp, vac, off, act, visits) => [type, terr, emp, '|', 1, 10, vac, off, act, 1, 1, 0, 10, visits, 0, 0, '|', visits]
const HEAD = [[], ['', 'Territory Name', 'Employee'], [], []]

t('file reading keeps only T rows and ignores D, A and Test names', () => {
  const p = d.parseReportRows([...HEAD, row('T', '', 'Ann  Lee', 0, 0, 0, 8), row('D', 'Cairo', 'Boss', 0, 0, 0, 7), row('A', 'CIRA 2', 'Line', 0, 0, 0, 4),
    row('T', '', 'Test Medical Rep', 0, 0, 0, 3), row('T', '', 'Bob', 1, 0, 0, 0.5)])
  assert.deepEqual(p.reps.map((r) => r.name), ['Ann Lee', 'Bob'])
  assert.equal(p.reps[1].visits, 0.5); assert.equal(p.reps[1].vacations, 1)
  assert.equal(p.lineFromRows, 2)
})
t('file name detection: shift and line', () => {
  assert.deepEqual(d.detectFromName('PM 1.xlsx'), { shift: 'PM', line: 1 })
  assert.deepEqual(d.detectFromName('PHARMA_3.xlsx'), { shift: 'PHARMA', line: 3 })
  assert.deepEqual(d.detectFromName('C:/x/pharma 2 (1).xlsx'), { shift: 'PHARMA', line: 2 })
  assert.deepEqual(d.detectFromName('report.xlsx'), { shift: null, line: null })
})
t('four-step status rule', () => {
  assert.equal(d.reportingStatus(5, 1, 0, 0), 'Reported Day') // 5 visits + vacation
  assert.equal(d.reportingStatus(0, 0, 1, 0), 'Reported Day')
  assert.equal(d.reportingStatus(0, 0, 0, 0), 'Unreported Day')
  assert.equal(d.reportingStatus(5, 0, 0, 0), 'Follow Up Required')
  assert.equal(d.reportingStatus(5.5, 0, 0, 0), 'Follow Up Required')
  assert.equal(d.reportingStatus(6, 0, 0, 0), 'Reported Day')
})
const f = (name, visits, vac = 0, off = 0, act = 0) => ({ name, norm: d.normName(name), visits, vacations: vac, office: off, activities: act })
const sys = (name, dm, line = 1, status = 'Active') => ({ line_id: line, line_name: `CIRA ${line}`, rep_id: 1, rep_name: name, rep_norm: d.normName(name), rep_code: null, status, district: 'X', district_manager: dm, box_name: null })

t('join PM + Pharmacy by normalised name, system match, ordering', () => {
  const rows = d.buildLineRows(1, [f('Zed  Ali', 8), f('amy lee', 0), f('Ghost', 7)], [f('Zed Ali', 3), f('Amy Lee ', 2)], [sys('Zed Ali', 'Mona'), sys('Amy Lee', 'Mona', 1, 'On Leave'), sys('Other', 'Vacant Delta West CIRA 1')])
  const by = Object.fromEntries(rows.map((r) => [r.norm, r]))
  assert.equal(by['zed ali'].pharmacy, 3); assert.equal(by['zed ali'].districtManager, 'Mona'); assert.equal(by['amy lee'].status, 'On Leave')
  assert.equal(by['ghost'].districtManager, 'Unassigned'); assert.equal(by['ghost'].status, 'Not in system'); assert.equal(by['ghost'].inSystem, false)
  assert.equal(by['ghost'].pharmacy, 0) // no Pharmacy row -> 0
  assert.deepEqual(rows.map((r) => r.districtManager), ['Mona', 'Mona', 'Unassigned'])
})
t('same name in another line only matches when unique', () => {
  const s = [sys('Sam', 'A', 2), sys('Sam', 'B', 3)]
  assert.equal(d.matchSystemRep(s, 1, 'sam'), null)
  assert.equal(d.matchSystemRep(s, 3, 'sam').district_manager, 'B')
  assert.equal(d.matchSystemRep([sys('Sam', 'A', 2)], 1, 'sam').district_manager, 'A')
})
t('cards: W = (nRep - V - O - A) + nUn + nFol, averages on W', () => {
  // 3 reported-on-visits, 1 vacation, 1 office, 1 activity, 1 unreported, 2 follow-up
  const rows = [
    ...[10, 8, 7].map((v, i) => ({ reporting: 'Reported Day', pm: v, pharmacy: 2, vacations: 0, office: 0, activities: 0, key: 'a' + i })),
    { reporting: 'Reported Day', pm: 0, pharmacy: 0, vacations: 1, office: 0, activities: 0 },
    { reporting: 'Reported Day', pm: 0, pharmacy: 0, vacations: 0, office: 1, activities: 0 },
    { reporting: 'Reported Day', pm: 0, pharmacy: 0, vacations: 0, office: 0, activities: 1 },
    { reporting: 'Unreported Day', pm: 0, pharmacy: 0, vacations: 0, office: 0, activities: 0 },
    { reporting: 'Follow Up Required', pm: 5, pharmacy: 1, vacations: 0, office: 0, activities: 0 },
    { reporting: 'Follow Up Required', pm: 4, pharmacy: 0, vacations: 0, office: 0, activities: 0 },
  ]
  const c = d.computeCards(rows)
  assert.equal(c.active, 9); assert.equal(c.reported, 8); assert.equal(c.unreported, 1); assert.equal(c.followUp, 2)
  assert.equal(c.working, 6) // (6 - 1 - 1 - 1) + 1 + 2
  assert.equal(c.avgPm, 34 / 6); assert.equal(c.avgPharmacy, 7 / 6)
  assert.equal(d.fmtAvg(c.avgPm), '5.7')
  assert.equal(c.vacations, 1); assert.equal(c.office, 1); assert.equal(c.activities, 1)
})
t('W = 0 shows a dash', () => {
  const c = d.computeCards([])
  assert.equal(c.avgPm, null); assert.equal(d.fmtAvg(c.avgPharmacy), '—')
})
t('numbers keep halves; yesterday; comment key', () => {
  assert.equal(d.fmtNum(0.5), '0.5'); assert.equal(d.fmtNum(8), '8')
  assert.equal(d.yesterdayIso(new Date(2026, 10, 1)), '2026-10-31')
  assert.equal(d.commentKey('2026-10-19', 2, 'sam lee'), 'daily-reporting:2026-10-19:2:sam lee')
})
console.log(`${n} tests passed`)

const pros = new Set(['ali new'])
t('Prospection rep: zero visits => Reported Day, comment filled, other reps unchanged', () => {
  const rows = d.buildLineRows(1, [f('Ali  New', 0), f('Bob', 0), f('Cy', 3)], [], [], pros)
  const by = Object.fromEntries(rows.map((r) => [r.norm, r]))
  assert.equal(by['ali new'].reporting, 'Reported Day'); assert.equal(by['ali new'].prospection, true)
  assert.equal(d.defaultComment(by['ali new']), 'Prospection Phase')
  assert.equal(d.defaultComment(by['bob']), ''); assert.equal(by['bob'].reporting, 'Unreported Day'); assert.equal(by['cy'].reporting, 'Follow Up Required')
})
t('Prospection beats the 6-visit rule, also under 6 visits and vacation counts normally', () => {
  const rows = d.buildLineRows(1, [f('Ali New', 4), f('Bob', 0, 1)], [], [], pros)
  assert.equal(rows.find((r) => r.norm === 'ali new').reporting, 'Reported Day')
  assert.equal(d.computeCards(rows).vacations, 1)
})
t('Prospection rep with zero visits counts as a working rep (lowers the averages)', () => {
  const rows = d.buildLineRows(1, [f('Ali New', 0), f('Bob', 10)], [], [], pros)
  const c = d.computeCards(rows)
  assert.equal(c.active, 2); assert.equal(c.reported, 2); assert.equal(c.working, 2); assert.equal(c.avgPm, 5)
})
t('names in the list but not in the files are counted as unseen', () => {
  const rows = d.buildLineRows(1, [f('Ali New', 0)], [], [], pros)
  assert.deepEqual(d.unseenProspection(['Ali  New', 'Gone Rep', 'Other'], rows), ['Gone Rep', 'Other'])
})
console.log(`${n} tests passed (incl. prospection)`)
