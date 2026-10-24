// Run: npm run test:planner
import assert from 'node:assert/strict'
import * as pl from '../src/features/plan/planner.ts'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok -', name) }

/* ------------------------------ fixtures: November 2026 (Nov 1 is a Sunday, Thu + Fri off, 22 open days) ------------------------------ */
const MONTH = '2026-11-01'
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() || 7
const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const min = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
function days(closed = []) {
  const out = []
  for (let d = 1; d <= 30; d++) {
    const iso = `2026-11-${String(d).padStart(2, '0')}`
    const w = dow(iso)
    if (w === 4 || w === 5) continue
    out.push({ day: iso, isodow: w, closed: closed.includes(iso), reason: closed.includes(iso) ? 'leave' : null })
  }
  return out
}
const OPEN = days().length
/**
 * A synthetic rep. spec = { BRICK: { n doctors, freq, dows: weekdays the Brick was visited on in May-Oct 2026, t0 + span: visit times t0..t0+span minutes,
 * every: each doctor is visited on one of `every` eligible dates, noTime: every k-th doctor has visits without a time } }
 */
function build(spec, o = {}) {
  const docs = []
  let id = 1
  Object.entries(spec).forEach(([brick, s], k) => {
    for (let i = 0; i < s.n; i++) {
      docs.push({ doctor_id: id, name: `Dr ${brick}${i}`, account: `Acc ${id}`, account_type: 'Clinics', freq: s.freq, brick, division: 'D', lat: 30 + k * 0.05 + (i % 4) * 0.002, lng: 31 + k * 0.01 + Math.floor(i / 4) * 0.002, pos_source: 'device', usual_isodow: null, usual_hour: null, n_visits: 0 })
      id++
    }
  })
  const hist = []
  for (let ms = Date.UTC(2026, 4, 1); ms < Date.UTC(2026, 10, 1); ms += 86400000) {
    const iso = new Date(ms).toISOString().slice(0, 10)
    const w = dow(iso)
    const dn = Math.round(ms / 86400000)
    for (const d of docs) {
      const s = spec[d.brick]
      if (!s.dows.includes(w) || (d.doctor_id * 7 + dn) % (s.every ?? 3) !== 0) continue
      const time = s.noTime && d.doctor_id % s.noTime === 0 ? null : hh(s.t0 + ((d.doctor_id * 37 + dn * 53) % s.span))
      hist.push({ day: iso, doctor_id: d.doctor_id, visit_time: time, by_rep: o.by ?? 1 })
    }
  }
  return { docs, hist }
}
const allPairs = (names, pm = 5) => { const out = []; for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) out.push({ a: names[i], b: names[j], pm_days: pm, any_days: pm, last_day: '2026-10-20' }); return out }
const input = (docs, hist, target = 9, closed = [], extra = {}) => ({ rep: { id: 1, name: 'R', code: 'C' }, month: MONTH, list_month: MONTH, box_id: 1, daily_target: target, days: days(closed), doctors: docs, history: hist, brickPairs: allPairs([...new Set(docs.map((d) => d.brick))]), brickRepeats: [], ...extra })
const perDay = (res) => { const m = {}; for (const r of res.rows) (m[r.day] ??= []).push(r); return m }
const brickOfRow = (docs) => { const m = new Map(docs.map((d) => [d.doctor_id, d.brick])); return (r) => m.get(r.doctor_id) }
const EVE = { t0: 17 * 60, span: 270 } // evening visits 17:00-21:30

const SCENARIO = {
  M: { n: 14, freq: 2, dows: [1], ...EVE }, T: { n: 14, freq: 2, dows: [2], ...EVE }, S: { n: 14, freq: 2, dows: [6], ...EVE }, W: { n: 14, freq: 2, dows: [3], ...EVE },
  F: { n: 30, freq: 2, dows: [6, 7, 1, 2, 3], ...EVE },
}
const FREPEAT = [{ brick: 'F', repeat_days: 10, brick_days: 20, last_repeat: '2026-10-14' }]
const scenario = () => { const { docs, hist } = build(SCENARIO); return { docs, hist, res: pl.generatePlan(input(docs, hist, 9, [], { brickRepeats: FREPEAT })) } }

/* ------------------------------ v6 tests (a)-(j) ------------------------------ */
t('the calendar has 22 open days in November 2026', () => assert.equal(OPEN, 22))

t('(a) a Brick visited only on Mondays is planned only on Mondays; the same for Tuesday, Saturday and Wednesday-only Bricks; the targets are met at step A', () => {
  const { docs, res } = scenario()
  const bo = brickOfRow(docs)
  const only = { M: 1, T: 2, S: 6, W: 3 }
  for (const r of res.rows) if (only[bo(r)]) assert.equal(dow(r.day), only[bo(r)], `${bo(r)} on ${r.day}`)
  for (const b of Object.keys(only)) assert.ok(res.rows.some((r) => bo(r) === b), `${b} is planned`)
  assert.equal(res.summary.step, 'A')
  assert.equal(res.summary.targetsMet, true)
  assert.ok(res.summary.pcf.pct >= 0.9 && res.summary.cov15.pct >= 0.9)
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
  // the history template: 4 restricted Bricks, 1 free Brick, the rep's own visits were used
  assert.deepEqual([res.summary.template.restrictedBricks, res.summary.template.freeBricks], [4, 1])
  assert.equal(res.summary.template.source, 'own')
  assert.ok(Object.values(res.summary.dayReasons).some((x) => /Mondays in his history: [0-9]+ days/.test(x)))
})

t('(b) a free Brick (all five weekdays) fills the empty days and may repeat on consecutive days when its history repeats', () => {
  const { docs, res } = scenario()
  const bo = brickOfRow(docs)
  const per = perDay(res)
  const sundays = Object.keys(per).filter((d) => dow(d) === 7)
  assert.ok(sundays.length === 5 && sundays.every((d) => per[d].every((r) => bo(r) === 'F')), 'no restricted Brick is visited on Sundays: F fills them')
  assert.ok(res.summary.repeats.some((r) => r.brick === 'F'), 'F repeats on consecutive days (Sunday 29 -> Monday 30)')
  // only a free Brick, repeating in his history: every open day is a day of that Brick
  const only = build({ F: { n: 60, freq: 3, dows: [6, 7, 1, 2, 3], ...EVE } })
  const r2 = pl.generatePlan(input(only.docs, only.hist, 9, [], { brickRepeats: [{ brick: 'F', repeat_days: 12, brick_days: 20, last_repeat: null }] }))
  assert.equal(r2.summary.emptyDays.length, 0)
  assert.equal(r2.summary.step, 'A')
  assert.ok(r2.summary.repeats.length >= 10)
  // no repeat history: step A cannot repeat the Brick on consecutive days, step C does and says why
  const r3 = pl.generatePlan(input(only.docs, only.hist, 9, [], { brickRepeats: [{ brick: 'F', repeat_days: 0, brick_days: 20, last_repeat: null }] }))
  assert.equal(r3.summary.step, 'C')
  assert.ok(Object.values(r3.summary.dayReasons).some((x) => x.includes('Same brick as yesterday: needed to reach the target')))
  assert.equal(r3.validation.ok, true, r3.validation.failures.join('; '))
})

t('(c) a one-weekday doctor with freq 2 gets two visits at least 10 days apart (weeks 1 and 3, or 2 and 4)', () => {
  const { docs, res } = scenario()
  for (const d of docs.filter((x) => x.brick === 'M' || x.brick === 'T')) {
    const ds = res.rows.filter((r) => r.doctor_id === d.doctor_id).map((r) => r.day).sort()
    assert.equal(ds.length, 2, d.name)
    const gap = (Date.parse(ds[1]) - Date.parse(ds[0])) / 86400000
    assert.ok(gap >= 10, `${d.name}: ${ds.join(' ')}`)
    assert.ok(gap === 14 || gap === 21, `${d.name} ${gap}`)
  }
})

t('(d) all first visits are done by day 15 when the capacity allows', () => {
  const { docs, res } = scenario()
  const first = new Map()
  for (const r of [...res.rows].sort((a, b) => a.day.localeCompare(b.day))) if (!first.has(r.doctor_id)) first.set(r.doctor_id, r.day)
  assert.equal(first.size, docs.length)
  assert.ok([...first.values()].every((d) => d <= '2026-11-15'), [...first].filter(([, d]) => d > '2026-11-15').join(' '))
  assert.equal(res.summary.cov15.pct, 1)
})

t('(e) doctors with midday history (11:30-15:45) are scheduled at midday, not moved to the evening', () => {
  const { docs, hist } = build({ H: { n: 40, freq: 2, dows: [6, 7, 1, 2, 3], t0: 11 * 60 + 30, span: 255 }, E: { n: 40, freq: 2, dows: [6, 7, 1, 2, 3], ...EVE } })
  const res = pl.generatePlan(input(docs, hist))
  const bo = brickOfRow(docs)
  const mid = res.rows.filter((r) => bo(r) === 'H')
  assert.ok(mid.length >= 70, String(mid.length))
  for (const r of mid) assert.ok(min(r.planned_time) >= 11 * 60 && min(r.planned_time) <= 16 * 60, `${r.day} ${r.planned_time}`)
  assert.ok(res.rows.filter((r) => bo(r) === 'E').every((r) => min(r.planned_time) >= 16 * 60 + 30))
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
})

t('(f) doctors without time data take the typical hours of their Brick, not the window start', () => {
  const { docs, hist } = build({ X: { n: 24, freq: 2, dows: [6, 7, 1, 2, 3], t0: 19 * 60, span: 180, noTime: 3 } })
  const noTime = new Set(docs.filter((d) => d.doctor_id % 3 === 0).map((d) => d.doctor_id))
  const res = pl.generatePlan(input(docs, hist))
  const mine = res.rows.filter((r) => noTime.has(r.doctor_id))
  assert.equal(res.summary.step, 'A')
  assert.ok(mine.length > 0)
  for (const r of mine) {
    assert.ok(min(r.planned_time) >= 19 * 60 + 20 && min(r.planned_time) <= 21 * 60 + 20, `${r.day} ${r.planned_time}`)
    assert.equal(r.grade, 'C')
    assert.match(r.note, /Hours of X/)
  }
  assert.ok(res.rows.some((r) => r.grade === 'B' || r.grade === 'A'))
})

t('(g) no empty day while visits remain and capacity exists (a big list gives a visit-day on every open day)', () => {
  const { docs, hist } = build({ F: { n: 40, freq: 3, dows: [6, 7, 1, 2, 3], ...EVE }, G: { n: 40, freq: 3, dows: [6, 7, 1, 2, 3], ...EVE }, H: { n: 40, freq: 3, dows: [6, 7, 1, 2, 3], ...EVE } })
  const rp = ['F', 'G', 'H'].map((brick) => ({ brick, repeat_days: 8, brick_days: 20, last_repeat: null }))
  const res = pl.generatePlan(input(docs, hist, 9, [], { brickRepeats: rp }))
  assert.equal(res.summary.emptyDays.length, 0, res.summary.emptyDays.join(','))
  assert.ok(Object.values(perDay(res)).every((l) => l.length >= 6 && l.length <= 12))
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
})

t('(h) a free doctor with timed visits gets grade A or B, never C because of the weekday', () => {
  const { docs, hist } = build({ F: { n: 30, freq: 2, dows: [6, 7, 1, 2, 3], ...EVE } })
  const res = pl.generatePlan(input(docs, hist))
  const prof = pl.doctorTimesFromHistory(hist, docs)
  const free = new Set(prof.filter((d) => d.free_any_day && d.n_timed >= 5).map((d) => d.doctor_id))
  assert.ok(free.size > 10)
  const mine = res.rows.filter((r) => free.has(r.doctor_id))
  assert.ok(mine.length > 0 && mine.every((r) => r.grade === 'A' || r.grade === 'B'), mine.filter((r) => r.grade === 'C').map((r) => r.note).join('|'))
  // the same in the grade function: free doctor on any weekday, time inside P20-P80
  const d = prof.find((x) => free.has(x.doctor_id))
  for (const w of [6, 7, 1, 2, 3]) assert.equal(pl.gradeVisit(d, w, Math.round((d.win_start + d.win_end) / 2)).grade, 'A')
})

t('(i) a new rep with no own visits but with the doctor history of another rep gets a plan from that history', () => {
  const { docs, hist } = build(SCENARIO, { by: 2 })
  const res = pl.generatePlan(input(docs, hist, 9, [], { brickRepeats: FREPEAT }))
  assert.equal(res.summary.template.source, 'any')
  assert.equal(res.summary.template.ownVisits, 0)
  assert.ok(res.rows.length > 150)
  const bo = brickOfRow(docs)
  for (const r of res.rows) if (bo(r) === 'M') assert.equal(dow(r.day), 1)
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
})

t('(j) the same inputs give the same plan and summary', () => {
  const a = scenario().res
  const b = scenario().res
  assert.deepEqual(a.rows, b.rows)
  assert.deepEqual(a.summary, b.summary)
})

/* ------------------------------ grades ------------------------------ */
const mk = (docs, hist) => pl.doctorTimesFromHistory(hist, docs)
const oneDoc = (freq = 2) => [{ doctor_id: 1, name: 'Dr', account: 'a', account_type: 'Clinics', freq, brick: 'A', division: 'D', lat: 30, lng: 31, pos_source: 'device', usual_isodow: null, usual_hour: null, n_visits: 0 }]
const visitsOn = (id, dates, time) => dates.map((day, k) => ({ day, doctor_id: id, visit_time: typeof time === 'function' ? time(k) : time }))

t('grades: A needs 5+ timed visits, an allowed weekday and a time inside P20-P80; B partial data; C no time data or a weekday not in his history', () => {
  const mondays = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-09-28', '2026-09-21', '2026-09-14', '2026-09-07']
  const d8 = mk(oneDoc(), visitsOn(1, mondays, (k) => `${19 + (k % 3)}:00`))[0]
  assert.equal(d8.n_timed, 8)
  const mid = Math.round((d8.win_start + d8.win_end) / 2)
  assert.equal(pl.gradeVisit(d8, 1, mid).grade, 'A')
  assert.equal(pl.gradeVisit(d8, 1, mid, false).grade, 'B', 'a Brick with unknown history is at best B')
  assert.equal(pl.gradeVisit(d8, 2, mid).grade, 'C', 'Tuesday is not in his history')
  assert.equal(pl.gradeVisit(d8, 1, d8.win_hi + 10).grade, 'C', 'after P95')
  // a weekday seen once: B
  const mixed = mk(oneDoc(), [...visitsOn(1, mondays.slice(0, 5), '20:00'), ...visitsOn(1, ['2026-10-07'], '20:00')])[0]
  assert.equal(pl.gradeVisit(mixed, 3, 20 * 60).grade, 'B')
  // 1-4 visits: B
  const few = mk(oneDoc(), visitsOn(1, mondays.slice(0, 3), '20:00'))[0]
  assert.equal(pl.gradeVisit(few, 1, 20 * 60).grade, 'B')
  // no time data: C
  assert.equal(pl.gradeVisit(mk(oneDoc(), [])[0], 1, 20 * 60).grade, 'C')
  // waiting: 40 min for a doctor certain to be present is B, the same on a weekday he is not certain on is C
  const g = pl.gradeVisit(d8, 1, d8.win_lo - 40)
  assert.deepEqual([g.grade, g.wait, g.certain], ['B', 40, true])
  assert.equal(pl.gradeVisit({ ...d8, dow_n: [0, 1, 1, 0, 0, 0, 0, 0] }, 1, d8.win_lo - 40).grade, 'C')
})

/* ------------------------------ not reached ------------------------------ */
t('270 visits in 18 open days: "Impossible for this rep: capacity 216 < required 243" with the exact gap and what would fix it', () => {
  const sp = {}
  for (const b of 'ABCDEF') sp[b] = { n: 15, freq: 3, dows: [6, 7, 1, 2, 3], ...EVE }
  const { docs, hist } = build(sp)
  const closed = days().map((d) => d.day).slice(0, 4)
  const res = pl.generatePlan(input(docs, hist, 9, closed))
  const nr = res.summary.notReachable
  assert.equal(res.summary.targetsMet, false)
  assert.ok(nr)
  assert.deepEqual([nr.targetVisits, nr.requiredVisits, nr.capacity, nr.capacityEnough], [270, 243, 216, false])
  assert.ok(nr.reasons.some((r) => r.startsWith('capacity: 12 x 18 open days = 216 is below the 243 visits needed')), nr.reasons.join(' | '))
  assert.deepEqual({ ...nr.impossible, message: undefined }, { capacity: 216, required: 243, gap: 27, addDays: 3, removeVisits: 30, firstNeeded: 243 > 0 ? 6 * 0 + Math.ceil(0.9 * 90) : 0, message: undefined })
  assert.equal(nr.impossible.message, 'Impossible for this rep: capacity 216 < required 243')
  assert.ok(res.summary.warnings[0].startsWith('Impossible for this rep: capacity 216 < required 243 (short by 27: add 3 open days or remove 30 visits'), res.summary.warnings[0])
  assert.equal(pl.approvalState(res.summary).allowed, false)
  assert.ok(res.rows.length > 0 && res.validation.ok, res.validation.failures.join('; '))
})

/* ------------------------------ validator: hard rules only ------------------------------ */
const docs3 = (freq = 2) => {
  const out = []
  let id = 1
  for (const [k, b] of ['A', 'B', 'C'].entries()) for (let i = 0; i < 12; i++) out.push({ doctor_id: id++, name: `Dr ${b}${i}`, account: 'a', account_type: 'Clinics', freq, brick: b, division: 'D', lat: 30 + k * 0.05 + i * 0.001, lng: 31, pos_source: 'device', usual_isodow: null, usual_hour: null, n_visits: 0, dow_n: [0, 3, 3, 3, 0, 0, 3, 3] })
  return out
}
t('the validator rejects a broken plan and lists what is wrong (hard rules only)', () => {
  const docs = docs3()
  const inp = input(docs, undefined, 9, ['2026-11-09'], { brickPairs: [{ a: 'A', b: 'B', pm_days: 3, any_days: 3, last_day: null }] })
  const row = (day, doctor_id, time, seq) => ({ day, seq, doctor_id, planned_time: time, fixed: false, visit_no: 1, note: null })
  const mkr = (day, ids, start = 17 * 60) => ids.map((id, i) => row(day, id, hh(start + i * 17), i + 1))
  const a = (i) => docs.filter((d) => d.brick === 'A')[i].doctor_id
  const b = (i) => docs.filter((d) => d.brick === 'B')[i].doctor_id
  const c = (i) => docs.filter((d) => d.brick === 'C')[i].doctor_id
  const fails = (rows, declared = []) => pl.validatePlan(inp, rows, {}, declared).failures.join(' | ')
  const six = [0, 1, 2, 3, 4, 5].map(a)
  assert.equal(pl.validatePlan(inp, mkr('2026-11-07', six)).ok, true)
  assert.match(fails(mkr('2026-11-07', [...Array(12)].map((_, i) => a(i)).concat([b(0)]), 15 * 60)), /above the maximum of 12/)
  assert.match(fails(mkr('2026-11-07', [0, 1, 2].map(a))), /under the minimum of 6/)
  assert.match(fails(mkr('2026-11-07', [0, 1, 2, 3, 4].map(a))), /5 visits, under the minimum of 6/)
  assert.match(fails(mkr('2026-11-07', [a(0), a(1), a(2), b(0), b(1), b(2), c(0), c(1)])), /3 bricks/)
  assert.match(fails(mkr('2026-11-07', [a(0), a(1), a(2), b(0), b(1), b(2), a(3)])), /not in blocks/)
  assert.match(fails(mkr('2026-11-07', [a(0), a(1), a(2), c(0), c(1), c(2)])), /never worked together/)
  assert.match(fails(mkr('2026-11-07', [a(0), a(1), a(2), a(3), a(4), b(0)])), /a Brick in a multi-Brick day needs 3/)
  assert.match(fails(mkr('2026-11-09', six)), /closed day/)
  assert.match(fails(mkr('2026-11-07', six, 6 * 60)), /outside the PM window/)
  assert.equal(pl.validatePlan(inp, mkr('2026-11-07', six, 11 * 60 + 30)).ok, true, 'midday visits are fine: only 08:00-23:59 is a bound')
  assert.match(fails([...mkr('2026-11-07', six), ...mkr('2026-11-14', six), ...mkr('2026-11-21', six)]), /3 planned visits, only 2 left/)
  assert.match(fails([...mkr('2026-11-07', six), ...mkr('2026-11-10', six)]), /3 calendar days apart \(minimum 10\)/)
  assert.match(fails([row('2026-11-07', a(0), '17:00', 1), row('2026-11-07', a(1), '17:00', 2), ...mkr('2026-11-07', [2, 3, 4, 5].map(a), 17 * 60 + 40)]), /two visits at 17:00/)
  // never failures: a Brick on consecutive days, a doctor on a weekday he was never seen on
  const rep = pl.validatePlan(input(docs3(), undefined, 9, []), [...mkr('2026-11-07', six), ...mkr('2026-11-08', [6, 7, 8, 9, 10, 11].map(a))])
  assert.equal(rep.ok, true, rep.failures.join('; '))
  assert.ok(rep.warnings.some((w) => w.includes('on two working days in a row')))
})

t('gap in calendar days: 2 visits -> 10, 3 -> 7, 4+ -> 5, one visit none; a visit already done counts in a re-plan', () => {
  assert.deepEqual([1, 2, 3, 4, 6].map((f) => pl.gapDaysFor(f)), [0, 10, 7, 5, 5])
  const { docs, hist } = build({ A: { n: 30, freq: 4, dows: [6, 7, 1, 2, 3], ...EVE }, B: { n: 30, freq: 3, dows: [6, 7, 1, 2, 3], ...EVE } })
  const res = pl.generatePlan(input(docs, hist))
  const per = new Map()
  for (const r of res.rows) per.set(r.doctor_id, [...(per.get(r.doctor_id) ?? []), pl.dayNum(r.day)])
  for (const [id, ds] of per) { const f = docs.find((d) => d.doctor_id === id).freq; ds.sort((x, y) => x - y); for (let i = 1; i < ds.length; i++) assert.ok(ds[i] - ds[i - 1] >= pl.gapDaysFor(f), `freq ${f}: ${ds.join(',')}`) }
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
  const bad = pl.validatePlan(input(oneDoc(2), undefined, 9, [], { lastDone: { 1: '2026-11-05' }, done: { 1: 1 } }), [{ day: '2026-11-08', seq: 1, doctor_id: 1, planned_time: '19:00', fixed: false, visit_no: 2, note: null }])
  assert.match(bad.failures.join('|'), /3 calendar days apart \(minimum 10\)/)
})

/* ------------------------------ modes, re-plan, backtest, helpers ------------------------------ */
const info = (listDoctors, withTime, withGps, withAny = withTime, own = 0) => ({ list_doctors: listDoctors, doctors_with_any: withAny, doctors_with_time_any: withTime, visits_own: own, doctors_with_own: 0, doctors_with_gps: withGps })

t('Geography mode (no history, GPS >= 70%): one Brick a day, low confidence, no repeats, grade C; No plan when nothing is known', () => {
  const sp = {}
  for (const b of 'ABCD') sp[b] = { n: 14, freq: 2, dows: [], ...EVE }
  const { docs } = build(sp)
  const gdocs = docs.map((d, i) => (i % 14 === 0 ? { ...d, lat: null, lng: null } : d))
  const res = pl.generatePlan(input(gdocs, [], 9, [], { historyInfo: info(56, 4, 52), brickRepeats: [{ brick: 'A', repeat_days: 9, brick_days: 20, last_repeat: null }] }))
  assert.equal(res.summary.mode, 'geography')
  assert.equal(res.summary.confidence, 'Low confidence - geography only')
  assert.equal(res.summary.twoBrickDays.length, 0)
  const bo = brickOfRow(gdocs)
  for (const list of Object.values(perDay(res))) assert.equal(new Set(list.map(bo)).size, 1)
  assert.ok(res.rows.length > 0 && res.rows.every((r) => r.grade === 'C'))
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
  const none = pl.generatePlan(input(docs, [], 9, [], { historyInfo: info(30, 3, 5, 6) }))
  assert.equal(none.summary.mode, 'none')
  assert.equal(none.rows.length, 0)
  assert.ok(none.summary.warnings[0].includes('3 of 30 doctors have a visit with a time'))
  assert.ok(pl.generatePlan(input([], [], 9, [], { historyInfo: info(0, 0, 0) })).summary.warnings[0].includes('no PM list'))
})

t('re-plan from a date: earlier days untouched, visits already done subtracted, the gap counts from the last done visit', () => {
  const { docs, hist } = build({ A: { n: 20, freq: 2, dows: [6, 7, 1, 2, 3], ...EVE }, B: { n: 20, freq: 2, dows: [6, 7, 1, 2, 3], ...EVE } })
  const done = {}
  const lastDone = {}
  for (const d of docs.slice(0, 12)) { done[d.doctor_id] = 1; lastDone[d.doctor_id] = '2026-11-02' }
  const res = pl.generatePlan(input(docs, hist, 9, [], { fromDay: '2026-11-08', done, lastDone }))
  assert.ok(res.rows.every((r) => r.day >= '2026-11-08'))
  const per = new Map()
  for (const r of res.rows) per.set(r.doctor_id, (per.get(r.doctor_id) ?? 0) + 1)
  for (const d of docs) assert.ok((per.get(d.doctor_id) ?? 0) <= d.freq - (done[d.doctor_id] ?? 0))
  assert.ok(res.rows.filter((r) => r.doctor_id <= 12).every((r) => r.visit_no === 2 && r.day >= '2026-11-12'))
  assert.equal(res.summary.fromDay, '2026-11-08')
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
})

t('no open day: empty plan with a message; the summary has 1/2-Brick days, stay, waiting', () => {
  const { docs, hist } = build({ A: { n: 10, freq: 1, dows: [6], ...EVE } })
  const res = pl.generatePlan(input(docs, hist, 9, days().map((d) => d.day)))
  assert.equal(res.rows.length, 0)
  assert.ok(res.summary.warnings.some((w) => w.includes('No open PM day')))
  const ok = scenario().res.summary
  assert.ok(ok.peak >= ok.lowest && ok.lowest >= 6 && ok.avgStayMin > 0 && ok.waitTotalMin >= 0)
  assert.equal(ok.oneBrickDays + ok.twoBrickDays.length, ok.dayCounts.filter((d) => d.count > 0).length)
})

t('backtest: same metrics for the plan and what was done, the plan is validated, grades and the step are reported', () => {
  const { docs, hist } = build(SCENARIO)
  const actual = docs.slice(0, 10).map((d) => ({ day: '2026-11-01', doctor_id: d.doctor_id, visit_time: '15:00' }))
  const b = pl.backtest(input(docs, hist, 9, [], { brickRepeats: FREPEAT }), actual)
  assert.equal(b.actual.maxDay, 10)
  assert.ok(b.plan.maxDay <= 12 && b.valid)
  assert.ok(b.plan.cov15 >= b.actual.cov15 && b.plan.pcf >= b.actual.pcf)
  assert.equal(b.step, 'A')
  assert.ok(b.grades.A + b.grades.B + b.grades.C > 100)
})

t('PM window from the rep history (P5-P95 plus P99), doctor profile (visits per weekday, timed visits, P20-P80 / P5-P95), usual busiest day', () => {
  const times = [...Array.from({ length: 100 }, (_, i) => `${String(14 + Math.floor(i / 15)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`), '03:00', '23:59']
  const w = pl.windowFromTimes(times)
  assert.ok(w.start >= 14 * 60 && w.end <= 21 * 60 + 40 && w.end > w.start && w.end99 >= w.end)
  assert.equal(pl.windowFromTimes(['15:00', '16:00']), null)
  const v = (day, time, id = 1) => ({ day, doctor_id: id, visit_time: time })
  const many = [v('2026-08-02', '16:00'), v('2026-08-09', '17:00'), v('2026-08-16', '18:00'), v('2026-08-23', '19:00'), v('2026-08-26', '20:00'), v('2026-07-05', '16:30')]
  const [d1, d2, d3] = pl.doctorTimesFromHistory([...many, v('2026-08-02', '18:00', 2)], [1, 2, 3].map((id) => ({ ...oneDoc()[0], doctor_id: id })))
  assert.equal(d1.dow_n[7], 5)
  assert.equal(d1.n_timed, 6)
  assert.ok(d1.win_start >= 16 * 60 && d1.win_end <= 20 * 60 && d1.win_lo <= d1.win_start && d1.win_hi >= d1.win_end)
  assert.equal(d2.win_start, 18 * 60 - 90)
  assert.equal(d3.win_start, null)
  const hist = []
  for (let d = 1; d <= 20; d++) for (let k = 0; k < (d <= 18 ? 6 : 9); k++) hist.push({ day: `2026-08-${String(d).padStart(2, '0')}`, doctor_id: k + 1, visit_time: '18:00' })
  assert.equal(pl.usualMaxDayFromHistory(hist), 6)
  assert.equal(pl.usualMaxDayFromHistory(hist.slice(0, 20)), null)
})

/* ------------------------------ v7: non-negotiable targets, more than two Bricks ------------------------------ */
/** A list of small free Bricks (3 doctors each) over the given open days: with wide hours every day can hold 12 visits. */
function smallBricks(nBricks, openDays, freq = 2) {
  const docs = []
  let id = 1
  for (let b = 0; b < nBricks; b++) for (let i = 0; i < 3; i++) { docs.push({ doctor_id: id, name: `Dr B${b}-${i}`, account: 'a', account_type: 'Clinics', freq, brick: `B${b}`, division: 'D', lat: 30 + b * 0.02 + i * 0.001, lng: 31, pos_source: 'device', usual_isodow: null, usual_hour: null, n_visits: 0 }); id++ }
  const hist = []
  for (let ms = Date.UTC(2026, 4, 1); ms < Date.UTC(2026, 10, 1); ms += 86400000) {
    const iso = new Date(ms).toISOString().slice(0, 10)
    if ([4, 5].includes(dow(iso))) continue
    const dn = Math.round(ms / 86400000)
    for (const d of docs) if ((d.doctor_id * 7 + dn) % 3 === 0) hist.push({ day: iso, doctor_id: d.doctor_id, visit_time: hh(12 * 60 + ((d.doctor_id * 37 + dn * 53) % 600)), by_rep: 1 })
  }
  const closed = days().filter((d) => !openDays.includes(d.day)).map((d) => d.day)
  return { docs, hist, closed }
}
const OPEN9 = ['01', '02', '03', '04', '07', '08', '09', '10', '11'].map((d) => `2026-11-${d}`)

t('(c) a plan that misses 90% at steps A-C reaches it at step D by reducing the gap and using 4 Bricks; the affected visits are marked', () => {
  const { docs, hist, closed } = smallBricks(14, OPEN9)
  const inp = input(docs, hist, 9, closed)
  for (const step of ['A', 'B', 'C']) assert.ok(pl.generatePlan(inp, {}, { step }).summary.pcf.pct < 0.9, step)
  const res = pl.generatePlan(inp)
  assert.equal(res.summary.step, 'D')
  assert.equal(res.summary.targetsMet, true)
  assert.ok(res.summary.pcf.pct >= 0.9 && res.summary.covEnd.pct >= 0.9)
  assert.equal(res.summary.endTargets.bothMet, true)
  const marked = res.rows.filter((r) => /Gap reduced/.test(r.note ?? ''))
  assert.ok(marked.length > 0 && marked.length === res.summary.gapReducedVisits)
  const bo = brickOfRow(docs)
  const per = perDay(res)
  assert.ok(Object.values(per).some((l) => new Set(l.map(bo)).size === 4), 'a day with 4 Bricks')
  assert.ok(Object.values(per).every((l) => new Set(l.map(bo)).size <= 4 && l.length >= 6 && l.length <= 12))
  // every visit is at least 7 / 5 / 4 days after the previous one of the same doctor, and the ones closer than the normal gap are exactly the marked ones
  const byDoc = new Map()
  for (const r of res.rows) byDoc.set(r.doctor_id, [...(byDoc.get(r.doctor_id) ?? []), r])
  let closer = 0
  for (const list of byDoc.values()) { list.sort((a, b) => a.day.localeCompare(b.day)); for (let i = 1; i < list.length; i++) { const g = pl.dayNum(list[i].day) - pl.dayNum(list[i - 1].day); assert.ok(g >= pl.gapDaysFor(2, true)); if (g < pl.gapDaysFor(2)) closer++ } }
  assert.equal(closer, marked.length)
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
  assert.ok(res.summary.warnings.some((w) => w.startsWith('Step D2')))
})

t('(a) three Bricks together in a day only when the history shows the combination (2+ days) or the doctors have 2+ visits on that weekday', () => {
  const mkRep = (visitDays) => {
    const docs = []
    let id = 1
    for (const b of ['P', 'Q', 'R']) for (let i = 0; i < 3; i++) docs.push({ doctor_id: id++, name: `Dr ${b}${i}`, account: 'a', account_type: 'Clinics', freq: 1, brick: b, division: 'D', lat: 30 + (b === 'P' ? 0 : b === 'Q' ? 0.01 : 0.02), lng: 31, pos_source: 'device', usual_isodow: null, usual_hour: null, n_visits: 0 })
    const hist = []
    for (const [b, ds] of Object.entries(visitDays)) for (const day of ds) for (const d of docs.filter((x) => x.brick === b)) hist.push({ day, doctor_id: d.doctor_id, visit_time: '19:00', by_rep: 1 })
    return { docs, hist }
  }
  // minDay 8: two Bricks of 3 doctors give 6 visits, a third Brick is needed (the minimum is raised for the test only)
  const together = mkRep({ P: ['2026-10-03', '2026-10-10'], Q: ['2026-10-03', '2026-10-10'], R: ['2026-10-03', '2026-10-10'] })
  const yes = pl.generatePlan(input(together.docs, together.hist, 9, [], { brickPairs: [] }), { minDay: 8 }, { step: 'A' })
  const bo = brickOfRow(together.docs)
  const three = Object.entries(perDay(yes)).filter(([, l]) => new Set(l.map(bo)).size === 3)
  assert.equal(three.length, 1, yes.summary.warnings.join('|'))
  assert.match(yes.summary.dayReasons[three[0][0]], /combination seen 2 days before/)
  assert.ok(yes.rows.some((r) => /Third brick/.test(r.note ?? '')))
  assert.equal(yes.validation.ok, true, yes.validation.failures.join('; '))
  // the same Bricks on different days (and on different weekdays for their doctors): no day with three Bricks before step D
  const apart = mkRep({ P: ['2026-10-03', '2026-10-11'], Q: ['2026-10-04', '2026-10-12'], R: ['2026-10-05', '2026-10-13'] })
  for (const step of ['A', 'B', 'C']) {
    const no = pl.generatePlan(input(apart.docs, apart.hist, 9, [], { brickPairs: allPairs(['P', 'Q', 'R']) }), { minDay: 8 }, { step })
    const bo2 = brickOfRow(apart.docs)
    assert.ok(Object.values(perDay(no)).every((l) => new Set(l.map(bo2)).size <= 2), step)
  }
  // the validator rejects a three-Brick day with no reason and accepts it with the combination history
  const row = (doctor_id, i) => ({ day: '2026-11-07', seq: i + 1, doctor_id, planned_time: hh(17 * 60 + i * 17), fixed: false, visit_no: 1, note: null })
  const rows = together.docs.map((d, i) => row(d.doctor_id, i))
  const v1 = pl.validatePlan(input(apart.docs, apart.hist, 9, [], { brickPairs: allPairs(['P', 'Q', 'R']) }), rows, { minDay: 8 })
  assert.match(v1.failures.join('|'), /3 bricks \(P, Q, R\) without a reason/)
  assert.equal(pl.validatePlan(input(together.docs, together.hist, 9, [], { brickPairs: [] }), rows, { minDay: 8 }).ok, true)
  // reason (b): every doctor of the other Bricks has 2+ visits on that weekday, 3+ doctors
  const byWeekday = together.docs.map((d) => ({ ...d, dow_n: [0, 0, 0, 0, 0, 0, 2, 0], hist_dows: [6] })) // Saturday
  assert.equal(pl.validatePlan(input(byWeekday, [], 9, [], { brickPairs: allPairs(['P', 'Q', 'R']) }), rows, { minDay: 8 }).ok, true)
  // more Bricks than the maximum fail; step D allows 4
  const four = smallBricks(4, OPEN9)
  const rows4 = four.docs.map((d, i) => ({ day: '2026-11-07', seq: i + 1, doctor_id: d.doctor_id, planned_time: hh(17 * 60 + i * 17), fixed: false, visit_no: 1, note: null }))
  const v4 = pl.validatePlan(input(four.docs, four.hist, 9, []), rows4, { maxBricksPerDay: 3 })
  assert.match(v4.failures.join('|'), /4 bricks in one day \(maximum 3\)/)
  assert.equal(pl.validatePlan(input(four.docs, four.hist, 9, []), rows4, { maxBricksPerDay: 4 }, [], { stepD: true }).failures.some((f) => /maximum/.test(f)), false)
})

t('(b) with the same Bricks available the plan picks the nearer Brick and the fewer Brick changes', () => {
  const docs = []
  let id = 1
  const put = (brick, n, lat) => { for (let i = 0; i < n; i++) docs.push({ doctor_id: id++, name: `Dr ${brick}${i}`, account: 'a', account_type: 'Clinics', freq: 1, brick, division: 'D', lat: lat + i * 0.001, lng: 31, pos_source: 'device', usual_isodow: null, usual_hour: null, n_visits: 0 }) }
  put('X', 4, 30)
  put('FAR', 3, 30.5)
  put('NEAR', 3, 30.01)
  const hist = []
  for (const d of docs) ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25', '2026-10-05'].forEach((day, k) => hist.push({ day, doctor_id: d.doctor_id, visit_time: hh(17 * 60 + ((d.doctor_id * 37 + k * 91) % 270)), by_rep: 1 }))
  const res = pl.generatePlan(input(docs, hist, 9, [], { brickPairs: allPairs(['X', 'FAR', 'NEAR']) }), {}, { step: 'A' })
  const bo = brickOfRow(docs)
  const day = Object.values(perDay(res))[0]
  assert.deepEqual([...new Set(day.map(bo))].sort(), ['NEAR', 'X'])
  assert.equal(res.summary.brickChanges, 1)
  assert.deepEqual(res.summary.brickDays, { one: 0, two: 1, threePlus: 0 })
  assert.ok(res.summary.avgBlockKm > 0 && res.summary.avgBlockKm < 5)
  assert.match(res.summary.dayReasons[Object.keys(perDay(res))[0]], /Brick changes: 1/)
})

t('(d)(e) Approve needs PCF >= 90% and end-of-month Coverage >= 90%, with the numbers in the message; Save draft is not affected', () => {
  const ok = scenario().res.summary
  assert.deepEqual(pl.approvalState(ok), { allowed: true, message: null })
  const lowPcf = { ...ok, pcf: { ...ok.pcf, pct: 0.841 } }
  assert.deepEqual(pl.approvalState(lowPcf), { allowed: false, message: 'Approve is disabled: PCF 84.1% < 90%.' })
  const lowCov = { ...ok, covEnd: { ...ok.covEnd, pct: 0.88 } }
  assert.equal(pl.approvalState(lowCov).message, 'Approve is disabled: end-of-month Coverage 88.0% < 90%.')
  assert.equal(pl.approvalState({ ...lowPcf, covEnd: lowCov.covEnd }).message, 'Approve is disabled: PCF 84.1% < 90% · end-of-month Coverage 88.0% < 90%.')
  assert.equal(pl.approvalState(null).allowed, false)
  // a plan that cannot reach the targets says so, and the summary agrees with the gate
  const sp = {}
  for (const b of 'ABCDEF') sp[b] = { n: 15, freq: 3, dows: [6, 7, 1, 2, 3], ...EVE }
  const { docs, hist } = build(sp)
  const res = pl.generatePlan(input(docs, hist, 9, days().map((d) => d.day).slice(0, 4)))
  assert.equal(res.summary.targetsMet, false)
  assert.equal(pl.approvalState(res.summary).allowed, false)
  assert.equal(res.summary.endTargets.bothMet, false)
})

t('(f) no day above 12 or between 1 and 5 visits in any step (A, B, C, D1, D2, D3), on several shapes', () => {
  const shapes = []
  shapes.push(() => { const { docs, hist } = build(SCENARIO); return input(docs, hist, 9, [], { brickRepeats: FREPEAT }) })
  shapes.push(() => { const sp = {}; for (const b of 'ABCDEFGH') sp[b] = { n: 12, freq: 3, dows: [6, 7, 1, 2, 3], ...EVE }; const { docs, hist } = build(sp); return input(docs, hist, 9, days().map((d) => d.day).slice(0, 5)) })
  shapes.push(() => { const { docs, hist, closed } = smallBricks(14, OPEN9); return input(docs, hist, 9, closed) })
  shapes.push(() => { const { docs, hist } = build({ A: { n: 9, freq: 2, dows: [1], ...EVE }, B: { n: 5, freq: 1, dows: [2, 3], ...EVE }, C: { n: 4, freq: 2, dows: [6], ...EVE } }); return input(docs, hist) })
  for (const mkInput of shapes) {
    for (const [step, dSub] of [['A'], ['B'], ['C'], ['D', 1], ['D', 2], ['D', 3]]) {
      const res = pl.generatePlan(mkInput(), {}, { step, dSub })
      for (const [d, l] of Object.entries(perDay(res))) assert.ok(l.length >= 6 && l.length <= 12, `${step}${dSub ?? ''} ${d}: ${l.length}`)
      assert.equal(res.validation.ok, true, `${step}${dSub ?? ''}: ${res.validation.failures.join('; ')}`)
      const per = new Map()
      for (const r of res.rows) per.set(r.doctor_id, (per.get(r.doctor_id) ?? 0) + 1)
      for (const d of mkInput().doctors) assert.ok((per.get(d.doctor_id) ?? 0) <= d.freq)
    }
  }
})

t('summary: days with 1, 2 and 3+ Bricks add up, Brick changes and the km between blocks are reported', () => {
  const sm = scenario().res.summary
  assert.equal(sm.brickDays.one + sm.brickDays.two + sm.brickDays.threePlus, sm.dayCounts.filter((d) => d.count > 0).length)
  assert.equal(sm.brickChanges, sm.brickDays.two + 2 * sm.brickDays.threePlus)
  assert.ok(sm.avgBlockKm >= 0)
})

console.log(`${n} tests passed`)
