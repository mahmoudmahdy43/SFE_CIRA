// Run: npm run test:planner
import assert from 'node:assert/strict'
import * as pl from '../src/features/plan/planner.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }

const MONTH = '2026-09-01'
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() || 7
/** Sat-Wed days of the month (Thu, Fri off for PM); `closed` lists days to close. */
function days(closed = []) {
  const out = []
  for (let d = 1; d <= 30; d++) {
    const iso = `2026-09-${String(d).padStart(2, '0')}`
    const isodow = dow(iso)
    if (isodow === 4 || isodow === 5) continue
    out.push({ day: iso, isodow, closed: closed.includes(iso), reason: closed.includes(iso) ? 'leave' : null })
  }
  return out
}
const OPEN = days().length
/** doctors on 3 neighbourhoods; freq per doctor; `o` = extra fields (object or function of the index) */
function doctors(count, freq, o = {}) {
  return Array.from({ length: count }, (_, i) => {
    const hood = i % 3
    return {
      doctor_id: i + 1, name: `Dr ${i + 1}`, account: `Acc ${i + 1}`, account_type: 'Clinics', freq: typeof freq === 'function' ? freq(i) : freq,
      brick: `B${hood}`, division: 'D', lat: 30 + hood * 0.1 + (i % 7) * 0.003, lng: 31 + hood * 0.1 + (Math.floor(i / 7) % 7) * 0.003,
      pos_source: 'device', usual_isodow: null, usual_hour: null, n_visits: 0, usual_share: null, ...(typeof o === 'function' ? o(i) : o),
    }
  })
}
const confirmed = (isodow, hour) => ({ usual_isodow: isodow, usual_hour: hour, n_visits: 8, usual_share: 0.9 })
const input = (docs, target = 9, closed = [], extra = {}) => ({ rep: { id: 1, name: 'R', code: 'C' }, month: MONTH, list_month: MONTH, box_id: 1, daily_target: target, days: days(closed), doctors: docs, ...extra })
const perDay = (res) => { const m = {}; for (const r of res.rows) m[r.day] = (m[r.day] ?? 0) + 1; return m }
const min = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

t('a list that fills the month: every open day has 6-12 visits, all visits planned, nobody twice a day', () => {
  const res = pl.generatePlan(input(doctors(60, 3)))
  assert.equal(res.summary.plannedVisits, res.summary.targetVisits)
  const counts = days().map((d) => perDay(res)[d.day] ?? 0)
  assert.ok(counts.every((c) => c >= 6 && c <= 12), counts.join(','))
  const seen = new Set()
  for (const r of res.rows) { const k = `${r.day}|${r.doctor_id}`; assert.ok(!seen.has(k)); seen.add(k) }
  assert.ok(res.summary.cov15.ok && res.summary.pcf.ok)
  assert.equal(res.summary.underMin.length, 0)
  assert.equal(res.summary.emptyDays.length, 0)
})

t('(c) deterministic: same inputs, same plan and summary', () => {
  const a = pl.generatePlan(input(doctors(60, (i) => 1 + (i % 3))))
  const b = pl.generatePlan(input(doctors(60, (i) => 1 + (i % 3))))
  assert.deepEqual(a.rows, b.rows)
  assert.deepEqual(a.summary, b.summary)
})

t('a small list is merged into fewer days of 6+ visits, spread over the month, with a clear warning', () => {
  const res = pl.generatePlan(input(doctors(40, (i) => (i % 4 === 0 ? 2 : 1))))
  assert.equal(res.summary.plannedVisits, res.summary.targetVisits)
  const counts = Object.values(perDay(res))
  assert.ok(counts.every((c) => c >= 6 && c <= 12), counts.join(','))
  assert.ok(res.summary.emptyDays.length > 0)
  assert.ok(res.summary.warnings.some((w) => w.includes('no visits')))
  assert.ok(res.summary.cov15.ok)
  const used = Object.keys(perDay(res)).sort()
  assert.ok(used[used.length - 1] >= '2026-09-20', 'the plan reaches the end of the month')
})

t('first visit of everyone comes before the second round (only the boundary day mixes)', () => {
  const res = pl.generatePlan(input(doctors(50, 2)))
  const last1 = res.rows.filter((r) => r.visit_no === 1).map((r) => r.day).sort().pop()
  const early2 = res.rows.filter((r) => r.visit_no === 2 && r.day < last1)
  assert.ok(early2.length <= 12, `${early2.length} second visits before the last first visit`)
})

t('a day is geographically compact (one neighbourhood most days)', () => {
  const docs = doctors(130, 1)
  const res = pl.generatePlan(input(docs))
  const byDoc = new Map(docs.map((d) => [d.doctor_id, d]))
  const per = {}
  for (const r of res.rows) (per[r.day] ??= []).push(byDoc.get(r.doctor_id).brick)
  const mixed = Object.values(per).filter((b) => new Set(b).size > 1).length
  assert.ok(mixed <= 4, `mixed days: ${mixed}`)
  assert.ok(res.summary.avgBricksPerDay <= 1.5)
})

t('list bigger than the target capacity: fewest days above target, never above 12, early, warning with the unified names', () => {
  const res = pl.generatePlan(input(doctors(100, 2), 9))
  assert.equal(res.summary.listTooBig, true)
  assert.ok(res.summary.peak <= 12 && res.summary.peak > 9)
  const over = Object.entries(perDay(res)).filter(([, c]) => c > 9).map(([d]) => d)
  assert.ok(over.length > 0 && over[0] <= '2026-09-10', 'over days start early in the month')
  const w = res.summary.warnings.find((x) => x.includes('bigger than the visit capacity'))
  assert.ok(w.includes('Capacity at target (Target x open days)') && w.includes('Capacity at max (12 x open days)'))
  assert.equal(res.summary.capacityAtTarget, 9 * OPEN)
  assert.equal(res.summary.capacityAtMax, 12 * OPEN)
})

t('impossible list: shortfall is reported with doctors and visit numbers, nothing is crammed in', () => {
  const res = pl.generatePlan(input(doctors(250, 3), 8))
  assert.ok(res.summary.plannedVisits < res.summary.targetVisits)
  assert.ok(res.summary.peak <= 12)
  assert.ok(res.summary.dropped.length > 0)
  assert.match(res.summary.dropped[0].visits[0], /^[0-9]+[/][0-9]+$/)
  assert.ok(res.summary.shortfall.pcfLossPts > 0)
  assert.ok(res.summary.warnings.some((w) => /short by|cannot be placed/.test(w)))
})

t('(d) the first two days of the month closed: no visits there, open days and capacity warnings use the real count', () => {
  const closed = ['2026-09-01', '2026-09-02']
  const res = pl.generatePlan(input(doctors(100, 2), 9, closed))
  assert.equal(res.summary.closedDays, 2)
  assert.equal(res.summary.openDays, OPEN - 2)
  for (const r of res.rows) assert.ok(!closed.includes(r.day))
  assert.ok(Math.min(...res.rows.map((r) => r.day)) >= '2026-09-05' || res.rows.every((r) => r.day > '2026-09-02'))
  const w = res.summary.warnings.find((x) => x.includes('bigger than the visit capacity'))
  assert.ok(w.includes(`9 x ${OPEN - 2} = ${9 * (OPEN - 2)}`), w)
  assert.equal(res.summary.capacityAtTarget, 9 * (OPEN - 2))
})

t('(a) 40 confirmed doctors on the same weekday: every day <= 12, only that weekday, within +-60 min of the usual time', () => {
  const docs = doctors(40, 1, (i) => confirmed(7, `${15 + (i % 6)}:00`))
  const res = pl.generatePlan(input(docs))
  assert.equal(res.rows.length, 40)
  assert.ok(Math.max(...Object.values(perDay(res))) <= 12)
  for (const r of res.rows) {
    const usual = (15 + ((r.doctor_id - 1) % 6)) * 60
    assert.equal(dow(r.day), 7)
    assert.equal(r.fixed, true)
    assert.ok(Math.abs(min(r.planned_time) - usual) <= 60, r.planned_time)
  }
  assert.doesNotThrow(() => pl.assertWithinCap(res.rows))
})

t('(a) 40 confirmed doctors with the SAME usual hour: the +-60 min window cannot hold them all, so the rest is a reported shortfall, never above 12', () => {
  const res = pl.generatePlan(input(doctors(40, 1, () => confirmed(7, '17:00'))))
  assert.ok(Math.max(...Object.values(perDay(res))) <= 12)
  assert.equal(res.rows.length + res.summary.shortfall.visits, 40)
  for (const r of res.rows) assert.ok(Math.abs(min(r.planned_time) - 17 * 60) <= 60)
  const per = {}
  for (const r of res.rows) (per[r.day] ??= []).push(min(r.planned_time))
  for (const list of Object.values(per)) assert.equal(new Set(list).size, list.length)
})

t('confirmed doctors are spread over the dates of their weekday, earliest first, and are never given another weekday', () => {
  const docs = doctors(8, 3, () => confirmed(6, '16:00'))
  const res = pl.generatePlan(input(docs))
  for (const r of res.rows) assert.equal(dow(r.day), 6)
  const dates = [...new Set(res.rows.map((r) => r.day))]
  assert.ok(dates.length >= 3, dates.join(','))
  assert.ok(res.rows.filter((r) => r.day === dates[0]).length >= 5, 'the first date is filled first')
})

t('a doctor is "confirmed" only with >= 3 visits and >= 60% on one weekday; otherwise he is flexible', () => {
  const docs = doctors(30, 1, (i) => (i === 0 ? { usual_isodow: 7, usual_hour: '17:00', n_visits: 8, usual_share: 0.5 } : i === 1 ? { usual_isodow: 7, usual_hour: '17:00', n_visits: 2, usual_share: 1 } : i === 2 ? { usual_isodow: 7, usual_hour: '17:00', n_visits: 8 } : {}))
  const res = pl.generatePlan(input(docs))
  assert.equal(res.rows.filter((r) => r.fixed).length, 0)
})

t('confirmed visit with no free date on his weekday is not placed and is reported', () => {
  const docs = doctors(60, 1, (i) => confirmed(7, `${15 + (i % 6)}:00`))
  const onlyOneSunday = days().filter((d) => d.isodow === 7).slice(1).map((d) => d.day)
  const res = pl.generatePlan(input(docs, 9, onlyOneSunday))
  assert.ok(Math.max(...Object.values(perDay(res))) <= 12)
  assert.ok(res.rows.length >= 9 && res.rows.length <= 12, String(res.rows.length))
  assert.equal(res.summary.shortfall.visits, 60 - res.rows.length)
  assert.ok(res.summary.dropped.every((d) => d.reason.includes('weekday')))
})

t('(b) a day that would hold only a few visits is merged into another day', () => {
  // 3 confirmed doctors on one weekday plus 3 flexible ones: the flexible ones would sit alone on a day of 3, so they join the Sunday
  const docs = doctors(6, 1, (i) => (i < 3 ? confirmed(7, '16:00') : {}))
  const res = pl.generatePlan(input(docs))
  assert.equal(Object.keys(perDay(res)).length, 1)
  assert.equal(res.rows.length, 6)
  assert.equal(res.summary.underMin.length, 0)
})

t('(b) a day that cannot be merged (pinned doctors on two weekdays) is flagged "under the minimum"', () => {
  const docs = doctors(6, 1, (i) => (i < 3 ? confirmed(7, '16:00') : confirmed(6, '16:00')))
  const res = pl.generatePlan(input(docs))
  const counts = perDay(res)
  assert.ok(Object.values(counts).every((c) => c === 3))
  assert.equal(res.summary.underMin.length, 2)
  assert.ok(res.summary.warnings.some((w) => w.includes('under the minimum of 6')))
})

t('no day is ever below 6 unless flagged, and none above 12, over many shapes', () => {
  for (const [count, freq, target, conf] of [[30, 1, 8, 0], [80, 2, 9, 0], [140, 3, 10, 12], [200, 4, 8, 20], [300, 2, 9, 30], [64, 3, 9, 5]]) {
    const docs = doctors(count, freq, (i) => (i < conf ? confirmed(1 + (i % 7 === 4 || i % 7 === 5 ? 0 : i % 7), `${15 + (i % 5)}:00`) : {}))
    const res = pl.generatePlan(input(docs, target))
    for (const [day, c] of Object.entries(perDay(res))) {
      assert.ok(c <= 12, `${count}x${freq}: ${day} has ${c}`)
      assert.ok(c >= 6 || res.summary.underMin.some((u) => u.day === day), `${count}x${freq}: ${day} has ${c}, not flagged`)
    }
  }
})

t('times: whole minutes, inside the PM window, 15-25 minutes apart, never two doctors in the same minute', () => {
  const win = { start: 15 * 60 + 7, end: 21 * 60 + 40 }
  const res = pl.generatePlan(input(doctors(120, 2), 9, [], { window: win }))
  const per = {}
  for (const r of res.rows) {
    assert.match(r.planned_time, /^[0-2][0-9]:[0-5][0-9]$/)
    const m = min(r.planned_time)
    assert.ok(m >= win.start && m <= win.end, r.planned_time)
    ;(per[r.day] ??= []).push(m)
  }
  for (const list of Object.values(per)) {
    list.sort((a, b) => a - b)
    for (let i = 1; i < list.length; i++) assert.ok(list[i] - list[i - 1] >= 15, `${list[i - 1]} -> ${list[i]}`)
    assert.equal(new Set(list).size, list.length)
  }
  assert.ok(res.rows.some((r) => !r.planned_time.endsWith(':00')), 'times are not only whole hours')
})

t('doctors without GPS are planned, flagged, and placed near their brick', () => {
  const docs = doctors(66, 3, (i) => (i % 10 === 0 ? { lat: null, lng: null, pos_source: null } : {}))
  const res = pl.generatePlan(input(docs))
  assert.equal(res.summary.plannedVisits, 198)
  assert.equal(res.summary.noGps.length, 7)
  assert.equal(res.summary.noTime.length, 66)
})

t('no open day: empty plan with a message', () => {
  const res = pl.generatePlan(input(doctors(5, 1), 9, days().map((d) => d.day)))
  assert.equal(res.rows.length, 0)
  assert.ok(res.summary.warnings.some((w) => w.includes('No open PM day')))
})

t('summary gives the highest and lowest day, bricks a day and the window used', () => {
  const res = pl.generatePlan(input(doctors(60, 3)))
  assert.ok(res.summary.peak >= res.summary.lowest && res.summary.lowest >= 6)
  assert.ok(res.summary.maxBricksPerDay >= 1 && res.summary.avgDailyKm > 0)
  assert.deepEqual(res.summary.window, { start: '14:00', end: '22:00', own: false })
})

t('usualFromHistory: weekday, share and the most frequent hour of the rep own visits', () => {
  const v = (day, time) => ({ day, doctor_id: 1, visit_time: time })
  const hist = [v('2026-08-02', '16:10'), v('2026-08-09', '16:30'), v('2026-08-16', '16:20'), v('2026-08-23', '19:00'), v('2026-08-26', '15:00'), v('2026-07-05', '16:45')]
  const [d, other] = pl.usualFromHistory(hist, doctors(2, 1))
  assert.equal(d.usual_isodow, 7)
  assert.ok(Math.abs(d.usual_share - 5 / 6) < 1e-9)
  assert.equal(d.usual_hour.slice(0, 2), '16')
  assert.equal(d.n_visits, 6)
  assert.equal(other.usual_share, null)
})

t('PM window comes from the rep history: 5th-95th percentile, outliers ignored, null when too few visits', () => {
  const times = [...Array.from({ length: 100 }, (_, i) => `${String(14 + Math.floor(i / 15)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`), '03:00', '23:59']
  const w = pl.windowFromTimes(times)
  assert.ok(w.start >= 14 * 60 && w.end <= 21 * 60 + 40 && w.end > w.start)
  assert.equal(pl.windowFromTimes(['15:00', '16:00']), null)
})

t('hard cap validation throws for a plan above 12', () => {
  const rows = Array.from({ length: 13 }, (_, i) => ({ day: '2026-09-06', seq: i + 1 }))
  assert.throws(() => pl.assertWithinCap(rows), /above the daily cap of 12/)
})

t('backtest keeps a day with no visits open and compares with the same metrics', () => {
  const docs = doctors(60, 3)
  const actual = docs.slice(0, 10).map((d) => ({ day: '2026-09-06', doctor_id: d.doctor_id, visit_time: '15:00' }))
  const b = pl.backtest(input(docs), actual)
  assert.ok(b.plan.days > 15, 'the plan uses the days the rep did not work')
  assert.equal(b.actual.maxDay, 10)
  assert.ok(b.plan.maxDay <= 12)
  assert.ok(b.plan.cov15 >= b.actual.cov15 && b.plan.pcf >= b.actual.pcf)
})

t('haversine: one degree of latitude is about 111 km', () => {
  assert.ok(Math.abs(pl.haversineKm({ lat: 30, lng: 31 }, { lat: 31, lng: 31 }) - 111.2) < 0.5)
})

console.log(`${n} tests passed`)
