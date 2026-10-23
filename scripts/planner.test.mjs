// Run: npm run test:planner
import assert from 'node:assert/strict'
import * as pl from '../src/features/plan/planner.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }

const MONTH = '2026-09-01'
/** Sat-Wed days of the month; `closed` lists days to close. */
function days(closed = []) {
  const out = []
  for (let d = 1; d <= 30; d++) {
    const iso = `2026-09-${String(d).padStart(2, '0')}`
    const isodow = new Date(`${iso}T00:00:00Z`).getUTCDay() || 7
    if (isodow === 4 || isodow === 5) continue // Thu, Fri off for PM
    out.push({ day: iso, isodow, closed: closed.includes(iso), reason: closed.includes(iso) ? 'leave' : null })
  }
  return out
}
/** doctors on a grid of 3 neighbourhoods; freq per doctor */
function doctors(count, freq, o = {}) {
  return Array.from({ length: count }, (_, i) => {
    const hood = i % 3
    return {
      doctor_id: i + 1, name: `Dr ${i + 1}`, account: `Acc ${i + 1}`, account_type: 'Clinics', freq: typeof freq === 'function' ? freq(i) : freq,
      brick: `B${hood}`, division: 'D', lat: 30 + hood * 0.1 + (i % 7) * 0.003, lng: 31 + hood * 0.1 + (Math.floor(i / 7) % 7) * 0.003,
      pos_source: 'device', usual_isodow: null, usual_hour: null, n_visits: 0, ...(typeof o === 'function' ? o(i) : o),
    }
  })
}
const input = (docs, target = 9, closed = []) => ({ rep: { id: 1, name: 'R', code: 'C' }, month: MONTH, list_month: MONTH, box_id: 1, daily_target: target, days: days(closed), doctors: docs })
const perDay = (res) => { const m = {}; for (const r of res.rows) m[r.day] = (m[r.day] ?? 0) + 1; return m }

t('small list: every visit planned, nobody twice a day, never above target', () => {
  const res = pl.generatePlan(input(doctors(40, (i) => (i % 4 === 0 ? 2 : 1))))
  assert.equal(res.summary.plannedVisits, res.summary.targetVisits)
  assert.equal(res.summary.listTooBig, false)
  assert.ok(Math.max(...Object.values(perDay(res))) <= 9)
  const seen = new Set()
  for (const r of res.rows) { const k = `${r.day}|${r.doctor_id}`; assert.ok(!seen.has(k)); seen.add(k) }
  assert.ok(res.summary.cov15.ok && res.summary.pcf.ok)
  assert.equal(res.summary.warnings.length, 0)
})

t('deterministic: same inputs, same plan', () => {
  const a = pl.generatePlan(input(doctors(60, (i) => 1 + (i % 3))))
  const b = pl.generatePlan(input(doctors(60, (i) => 1 + (i % 3))))
  assert.deepEqual(a.rows, b.rows)
})

t('first visit of everyone comes before any second visit', () => {
  const res = pl.generatePlan(input(doctors(50, 2)))
  const last1 = res.rows.filter((r) => r.visit_no === 1).map((r) => r.day).sort().pop()
  const early2 = res.rows.filter((r) => r.visit_no === 2 && r.day < last1)
  assert.ok(early2.length <= 9, 'at most the boundary day mixes rounds')
})

t('a day is geographically compact (one neighbourhood most days)', () => {
  const res = pl.generatePlan(input(doctors(90, 1)))
  const byDoc = new Map(doctors(90, 1).map((d) => [d.doctor_id, d]))
  const days = {}
  for (const r of res.rows) (days[r.day] ??= []).push(byDoc.get(r.doctor_id).brick)
  const mixed = Object.values(days).filter((b) => new Set(b).size > 1).length
  assert.ok(mixed <= 3, `mixed days: ${mixed}`)
})

t('list bigger than capacity: fewest days above target, peak <= 13, early, warning raised', () => {
  const res = pl.generatePlan(input(doctors(100, 2), 9))
  assert.equal(res.summary.listTooBig, true)
  assert.ok(res.summary.peak <= 13)
  assert.ok(res.summary.overDays > 0)
  assert.ok(res.summary.warnings.some((w) => w.includes('bigger than the capacity')))
  const over = Object.entries(perDay(res)).filter(([, c]) => c > 9).map(([d]) => d)
  assert.ok(over[0] <= '2026-09-10', 'over days start early in the month')
})

t('impossible list: numbers are reported, nothing is invented', () => {
  const res = pl.generatePlan(input(doctors(250, 3), 8))
  assert.ok(res.summary.plannedVisits < res.summary.targetVisits)
  assert.ok(res.summary.peak <= 13)
  assert.ok(res.summary.warnings.some((w) => /short by|cannot be placed/.test(w)))
  assert.ok(res.summary.dropped.length > 0)
})

t('closed days get no visits and capacity shrinks', () => {
  const closed = ['2026-09-06', '2026-09-07', '2026-09-08']
  const res = pl.generatePlan(input(doctors(60, 2), 9, closed))
  for (const r of res.rows) assert.ok(!closed.includes(r.day))
  assert.equal(res.summary.closedDays, 3)
})

t('confirmed time: pinned to the usual weekday and hour, moved with a note when that day is closed', () => {
  const docs = doctors(30, 1, (i) => (i < 3 ? { usual_isodow: 7, usual_hour: '16:00', n_visits: 5 } : {})) // Sundays
  const free = pl.generatePlan(input(docs))
  for (const r of free.rows.filter((x) => x.doctor_id <= 3)) { assert.equal(r.fixed, true); assert.equal(r.planned_time, '16:00'); assert.equal(new Date(`${r.day}T00:00:00Z`).getUTCDay(), 0) }
  const firstSunday = '2026-09-06'
  const closed = pl.generatePlan(input(docs, 9, [firstSunday]))
  const moved = closed.rows.filter((x) => x.doctor_id <= 3)
  for (const r of moved) { assert.notEqual(r.day, firstSunday); assert.ok(r.note) }
  assert.equal(closed.summary.moved.length, 3)
})

t('doctors without GPS are planned, flagged, and placed near their brick', () => {
  const docs = doctors(30, 1, (i) => (i % 10 === 0 ? { lat: null, lng: null, pos_source: null } : {}))
  const res = pl.generatePlan(input(docs))
  assert.equal(res.summary.plannedVisits, 30)
  assert.equal(res.summary.noGps.length, 3)
  assert.equal(res.summary.noTime.length, 30)
})

t('no open day: empty plan with a message', () => {
  const res = pl.generatePlan(input(doctors(5, 1), 9, days().map((d) => d.day)))
  assert.equal(res.rows.length, 0)
  assert.ok(res.summary.warnings.some((w) => w.includes('No open PM day')))
})

t('backtest compares plan and actual with the same metrics', () => {
  const docs = doctors(40, 1)
  const actual = docs.slice(0, 30).map((d, i) => ({ day: `2026-09-${String(6 + (i % 10)).padStart(2, '0')}`, doctor_id: d.doctor_id, visit_time: '15:00' }))
  const b = pl.backtest(input(docs), actual)
  assert.ok(b.plan.cov15 >= b.actual.cov15)
  assert.ok(b.plan.pcf >= b.actual.pcf)
  assert.ok(b.plan.days > 0 && b.actual.days > 0)
})

t('haversine: one degree of latitude is about 111 km', () => {
  assert.ok(Math.abs(pl.haversineKm({ lat: 30, lng: 31 }, { lat: 31, lng: 31 }) - 111.2) < 0.5)
})

console.log(`${n} tests passed`)
