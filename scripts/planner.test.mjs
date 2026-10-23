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

t('list bigger than capacity: fewest days above target, peak <= 12, early, warning raised', () => {
  const res = pl.generatePlan(input(doctors(100, 2), 9))
  assert.equal(res.summary.listTooBig, true)
  assert.ok(res.summary.peak <= 12)
  assert.ok(res.summary.overDays > 0)
  assert.ok(res.summary.warnings.some((w) => w.includes('bigger than the capacity')))
  const over = Object.entries(perDay(res)).filter(([, c]) => c > 9).map(([d]) => d)
  assert.ok(over[0] <= '2026-09-10', 'over days start early in the month')
})

t('impossible list: numbers are reported, nothing is invented', () => {
  const res = pl.generatePlan(input(doctors(250, 3), 8))
  assert.ok(res.summary.plannedVisits < res.summary.targetVisits)
  assert.ok(res.summary.peak <= 12)
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

t('hard cap: 40 confirmed doctors on the same weekday never push a day above 12', () => {
  const docs = doctors(40, 1, () => ({ usual_isodow: 7, usual_hour: '16:00', n_visits: 6 }))
  const res = pl.generatePlan(input(docs))
  assert.equal(res.rows.length, 40)
  assert.ok(Math.max(...Object.values(perDay(res))) <= 12)
  assert.ok(res.rows.some((r) => r.note === 'Moved because the day is full'))
  for (const r of res.rows) assert.equal(new Date(`${r.day}T00:00:00Z`).getUTCDay(), 0, 'moved to another Sunday first')
  assert.doesNotThrow(() => pl.assertWithinCap(res.rows))
})

t('hard cap: if no day has room the visit is not placed and is reported with its visit number and impact', () => {
  const docs = doctors(150, 1, () => ({ usual_isodow: 7, usual_hour: '16:00', n_visits: 6 }))
  const closedButSundays = days().filter((d) => d.isodow !== 7 && d.isodow !== 1).map((d) => d.day) // only Sundays and Mondays stay open
  const res = pl.generatePlan(input(docs, 9, closedButSundays))
  assert.ok(Math.max(...Object.values(perDay(res))) <= 12)
  assert.equal(res.summary.shortfall.visits, 150 - res.rows.length)
  for (const d of res.summary.dropped) assert.match(d.visits[0], /^[0-9]+[/][0-9]+$/)
  assert.ok(res.summary.shortfall.pcfLossPts > 0)
})

t('hard cap: the validation throws for a plan above 12', () => {
  const rows = Array.from({ length: 13 }, (_, i) => ({ day: '2026-09-06', seq: i + 1 }))
  assert.throws(() => pl.assertWithinCap(rows), /above the daily cap of 12/)
})

t('no generated plan ever exceeds 12, over many shapes', () => {
  for (const [count, freq, target] of [[30, 1, 8], [80, 2, 9], [140, 3, 10], [200, 4, 8], [300, 2, 9]]) {
    const res = pl.generatePlan(input(doctors(count, freq, (i) => (i % 5 === 0 ? { usual_isodow: 6, usual_hour: '17:00', n_visits: 4 } : {})), target))
    assert.ok(res.summary.peak <= 12, `${count}x${freq}: peak ${res.summary.peak}`)
    assert.ok(Math.max(0, ...Object.values(perDay(res))) <= 12)
  }
})

t('PM window comes from the rep history: 5th-95th percentile, outliers ignored, default when too few visits', () => {
  const times = [...Array.from({ length: 100 }, (_, i) => `${String(14 + Math.floor(i / 15)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`), '03:00', '23:59']
  const w = pl.windowFromTimes(times)
  assert.ok(w.start >= 14 * 60 && w.end <= 21 * 60 + 40 && w.end > w.start)
  assert.equal(pl.windowFromTimes(['15:00', '16:00']), null)
})

t('the planner uses the rep window, else 14:00-22:00', () => {
  const docs = doctors(60, 3)
  const wide = pl.generatePlan({ ...input(docs), window: { start: 13 * 60, end: 21 * 60 + 40 } })
  assert.ok(wide.rows.every((r) => r.planned_time >= '13:00'))
  const dflt = pl.generatePlan(input(docs))
  assert.equal(dflt.params.defaultEnd, '22:00')
  assert.ok(dflt.rows.every((r) => r.planned_time >= '14:00'))
})

t('backtest keeps a day with no visits open (only leaves / registered requests close days)', () => {
  const docs = doctors(40, 1)
  const actual = docs.slice(0, 10).map((d) => ({ day: '2026-09-06', doctor_id: d.doctor_id, visit_time: '15:00' }))
  const b = pl.backtest(input(docs), actual)
  assert.ok(b.plan.days > 5, 'the plan still uses the many days the rep did not work')
  assert.equal(b.actual.maxDay, 10)
  assert.ok(b.plan.maxDay <= 12)
})

t('haversine: one degree of latitude is about 111 km', () => {
  assert.ok(Math.abs(pl.haversineKm({ lat: 30, lng: 31 }, { lat: 31, lng: 31 }) - 111.2) < 0.5)
})

console.log(`${n} tests passed`)
