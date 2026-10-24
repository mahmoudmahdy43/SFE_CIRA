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
/** doctors by brick: sizes = { A: 10, B: 8 }; each brick is a small cluster, bricks 6-8 km apart */
function bricked(sizes, freq = 1, o = {}) {
  const out = []
  let id = 1
  Object.entries(sizes).forEach(([brick, count], k) => {
    for (let i = 0; i < count; i++) {
      out.push({
        doctor_id: id, name: `Dr ${brick}${i}`, account: `Acc ${id}`, account_type: 'Clinics', freq: typeof freq === 'function' ? freq(id - 1) : freq,
        brick, division: 'D', lat: 30 + k * 0.06 + (i % 4) * 0.002, lng: 31 + k * 0.01 + Math.floor(i / 4) * 0.002, pos_source: 'device',
        usual_isodow: null, usual_hour: null, n_visits: 0, pref_isodow: null, win_start: null, win_end: null, n_hist: 0, ...(typeof o === 'function' ? o(id - 1) : o),
      })
      id++
    }
  })
  return out
}
const allPairs = (names, pm = 5) => { const out = []; for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) out.push({ a: names[i], b: names[j], pm_days: pm, any_days: pm, last_day: '2026-08-20' }); return out }
const input = (docs, target = 9, closed = [], extra = {}) => ({ rep: { id: 1, name: 'R', code: 'C' }, month: MONTH, list_month: MONTH, box_id: 1, daily_target: target, days: days(closed), doctors: docs, brickPairs: [], ...extra })
const perDay = (res) => { const m = {}; for (const r of res.rows) (m[r.day] ??= []).push(r); return m }
const min = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const brickOfRow = (docs) => { const m = new Map(docs.map((d) => [d.doctor_id, d.brick])); return (r) => m.get(r.doctor_id) }
const SIX = { A: 10, B: 10, C: 10, D: 10, E: 10, F: 10 }
const NAMES = Object.keys(SIX)

t('a list that fills the month: every open day has 6-12 visits, all planned, validator passes', () => {
  const docs = bricked(SIX, 3)
  const res = pl.generatePlan(input(docs, 9, [], { brickPairs: allPairs(NAMES) }))
  assert.equal(res.summary.plannedVisits, res.summary.targetVisits)
  const counts = days().map((d) => (perDay(res)[d.day] ?? []).length)
  assert.ok(counts.every((c) => c >= 6 && c <= 12), counts.join(','))
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
  assert.ok(res.summary.cov15.ok && res.summary.pcf.ok)
})

t('(e) deterministic: same inputs, same plan and summary', () => {
  const mk = () => pl.generatePlan(input(bricked(SIX, (i) => 1 + (i % 3)), 9, [], { brickPairs: allPairs(NAMES, 2) }))
  const a = mk()
  const b = mk()
  assert.deepEqual(a.rows, b.rows)
  assert.deepEqual(a.summary, b.summary)
})

t('one brick a day is the rule: with no brick history no day mixes bricks', () => {
  const docs = bricked(SIX, 3)
  const res = pl.generatePlan(input(docs, 9, [], { brickPairs: [] }))
  const bo = brickOfRow(docs)
  for (const list of Object.values(perDay(res))) assert.equal(new Set(list.map(bo)).size, 1)
  assert.equal(res.summary.twoBrickDays.length, 0)
  assert.ok(res.summary.oneBrickDays > 0)
})

t('(c) bricks never worked together before are never put in the same day', () => {
  const docs = bricked({ A: 8, B: 8, C: 8, D: 8, E: 8, F: 8 }, 3)
  const allowed = [{ a: 'A', b: 'B', pm_days: 4, any_days: 4, last_day: '2026-08-01' }]
  const res = pl.generatePlan(input(docs, 9, [], { brickPairs: allowed }))
  const bo = brickOfRow(docs)
  for (const list of Object.values(perDay(res))) {
    const bs = [...new Set(list.map(bo))].sort()
    assert.ok(bs.length === 1 || (bs.length === 2 && bs[0] === 'A' && bs[1] === 'B'), bs.join('+'))
  }
  assert.deepEqual(res.validation.failures.filter((f) => f.includes('never worked together')), [])
})

t('a second brick is allowed by AM+PM history too (any_days) and the day gets contiguous blocks with 3+ doctors each', () => {
  const sizes = Object.fromEntries('ABCDEFGHIJKL'.split('').map((b) => [b, 5]))
  const docs = bricked(sizes, 3)
  const pairs = allPairs(Object.keys(sizes), 0).map((p) => ({ ...p, any_days: 3 }))
  const res = pl.generatePlan(input(docs, 9, [], { brickPairs: pairs }))
  const bo = brickOfRow(docs)
  assert.ok(res.summary.twoBrickDays.length > 0, 'bricks of 5 cannot fill days of 8-9 alone')
  for (const [day, list] of Object.entries(perDay(res))) {
    const ordered = [...list].sort((a, b) => min(a.planned_time) - min(b.planned_time))
    const seq = []
    for (const r of ordered) if (seq[seq.length - 1] !== bo(r)) seq.push(bo(r)) // (d) blocks: no A,B,A
    assert.equal(seq.length, new Set(seq).size, `${day}: ${seq.join('>')}`)
    assert.ok(seq.length <= 2)
    if (seq.length === 2) for (const b of seq) assert.ok(list.filter((r) => bo(r) === b).length >= 3, `${day}: ${b}`)
  }
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
  assert.ok(res.summary.twoBrickDays.every((d) => d.why.includes('before')))
})

t('(b) a second brick with a single doctor is never added to a day', () => {
  const docs = bricked({ A: 12, B: 12, C: 12, Z: 1 }, 2)
  const res = pl.generatePlan(input(docs, 9, [], { brickPairs: allPairs(['A', 'B', 'C', 'Z']) }))
  const bo = brickOfRow(docs)
  for (const [day, list] of Object.entries(perDay(res))) {
    const bs = new Set(list.map(bo))
    if (bs.has('Z')) assert.equal(bs.size, 1, `${day}: Z shares the day with ${[...bs].join(',')}`)
  }
  assert.equal(res.validation.failures.filter((f) => f.includes('second brick needs')).length, 0)
})

t('a day never has more than 2 bricks, whatever the list looks like', () => {
  const sizes = { A: 5, B: 4, C: 4, D: 5, E: 3, F: 4, G: 5, H: 3 }
  const docs = bricked(sizes, 3)
  const res = pl.generatePlan(input(docs, 8, [], { brickPairs: allPairs(Object.keys(sizes)) }))
  const bo = brickOfRow(docs)
  for (const list of Object.values(perDay(res))) assert.ok(new Set(list.map(bo)).size <= 2)
})

t('a list bigger than the target capacity: fewest days above target, never above 12, unified capacity names', () => {
  const docs = bricked({ A: 20, B: 20, C: 20, D: 20, E: 20 }, 2)
  const res = pl.generatePlan(input(docs, 9, [], { brickPairs: allPairs(['A', 'B', 'C', 'D', 'E']) }))
  assert.equal(res.summary.listTooBig, true)
  assert.ok(res.summary.peak <= 12)
  const w = res.summary.warnings.find((x) => x.includes('bigger than the visit capacity'))
  assert.ok(w.includes('Capacity at target (Target x open days)') && w.includes('Capacity at max (12 x open days)'))
  assert.equal(res.summary.capacityAtTarget, 9 * OPEN)
  assert.equal(res.summary.capacityAtMax, 12 * OPEN)
})

t('an impossible list: the shortfall is reported with doctors, visit numbers and its effect, never crammed in', () => {
  const docs = bricked({ A: 50, B: 50, C: 50, D: 50, E: 50 }, 3)
  const res = pl.generatePlan(input(docs, 8, [], { brickPairs: allPairs(['A', 'B', 'C', 'D', 'E']) }))
  assert.ok(res.summary.plannedVisits < res.summary.targetVisits)
  assert.ok(res.summary.peak <= 12)
  assert.ok(res.summary.dropped.length > 0 && res.summary.shortfall.pcfLossPts > 0)
  assert.match(res.summary.dropped[0].visits[0], /^[0-9]+[/][0-9]+$/)
})

t('(f) the first two days of the month closed: no visits there, real open-day count in the warnings', () => {
  const closed = ['2026-09-01', '2026-09-02']
  const docs = bricked({ A: 25, B: 25, C: 25, D: 25 }, 2)
  const res = pl.generatePlan(input(docs, 9, closed, { brickPairs: allPairs(['A', 'B', 'C', 'D']) }))
  assert.equal(res.summary.closedDays, 2)
  assert.equal(res.summary.openDays, OPEN - 2)
  for (const r of res.rows) assert.ok(!closed.includes(r.day))
  const w = res.summary.warnings.find((x) => x.includes('bigger than the visit capacity'))
  assert.ok(w.includes(`9 x ${OPEN - 2} = ${9 * (OPEN - 2)}`), w)
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
})

t('(a) 40 doctors who all prefer the same weekday: every day <= 12 (the weekday is only a preference)', () => {
  const docs = bricked({ A: 10, B: 10, C: 10, D: 10 }, 1, () => ({ pref_isodow: 7 }))
  const res = pl.generatePlan(input(docs, 9, [], { brickPairs: allPairs(['A', 'B', 'C', 'D']) }))
  assert.ok(Object.values(perDay(res)).every((l) => l.length <= 12))
  assert.equal(res.summary.plannedVisits, 40)
})

t('the weekday preference orders the visits inside a brick (doctors who prefer the day go first)', () => {
  const base = pl.generatePlan(input(bricked({ A: 24 }, 1), 9))
  const firstDay = Object.keys(perDay(base)).sort()[0]
  const want = dow(firstDay)
  const docs = bricked({ A: 24 }, 1, (i) => ({ pref_isodow: i >= 12 ? want : want === 7 ? 6 : 7 }))
  const res = pl.generatePlan(input(docs, 9))
  const onFirst = perDay(res)[firstDay].map((r) => docs.find((d) => d.doctor_id === r.doctor_id))
  assert.ok(onFirst.filter((d) => d.pref_isodow === want).length >= onFirst.length - 1, firstDay)
})

t('times: inside the rep PM window, whole minutes, 15-25 minutes apart inside a brick, nobody at the same minute', () => {
  const win = { start: 15 * 60 + 7, end: 21 * 60 + 40 }
  const docs = bricked(SIX, 3)
  const res = pl.generatePlan(input(docs, 9, [], { window: win, brickPairs: allPairs(NAMES) }))
  const bo = brickOfRow(docs)
  for (const list of Object.values(perDay(res))) {
    const ordered = [...list].sort((a, b) => min(a.planned_time) - min(b.planned_time))
    ordered.forEach((r, i) => {
      assert.match(r.planned_time, /^[0-2][0-9]:[0-5][0-9]$/)
      const m = min(r.planned_time)
      assert.ok(m >= win.start && m <= win.end, r.planned_time)
      if (i > 0) {
        const gap = m - min(ordered[i - 1].planned_time)
        assert.ok(gap >= 15, `${gap}`)
        if (bo(r) === bo(ordered[i - 1])) assert.ok(gap <= 25, `${gap}`)
      }
    })
  }
  assert.ok(res.rows.some((r) => !r.planned_time.endsWith(':00')))
})

t('the day starts when its doctors are usually visited: 11 doctors with hours 18:00-20:30 start around 18:00, not 15:22', () => {
  const docs = bricked({ A: 11 }, 1, () => ({ win_start: 18 * 60, win_end: 20 * 60 + 30 }))
  const res = pl.generatePlan(input(docs, 11, [], { window: { start: 15 * 60 + 22, end: 22 * 60 } }))
  const day = Object.values(perDay(res))[0]
  const ts = day.map((r) => min(r.planned_time)).sort((x, y) => x - y)
  assert.ok(ts[0] >= 17 * 60 + 30 && ts[0] <= 18 * 60 + 10, pl.fromMin(ts[0]))
  assert.ok(ts[0] > 15 * 60 + 22)
  assert.ok(ts[ts.length - 1] <= 20 * 60 + 30, pl.fromMin(ts[ts.length - 1]))
  const gaps = ts.slice(1).map((x, i) => x - ts[i])
  assert.ok(gaps.every((g) => g >= 15 && g <= 25))
  assert.equal(res.summary.avgStayMin > 0, true)
})

t('doctors are ordered inside the brick by the start of their usual hours', () => {
  const docs = bricked({ A: 8 }, 1, (i) => ({ win_start: 18 * 60 + (7 - i) * 15, win_end: 20 * 60 + 30 }))
  const res = pl.generatePlan(input(docs, 8, [], { window: { start: 14 * 60, end: 22 * 60 } }))
  const day = [...Object.values(perDay(res))[0]].sort((x, y) => min(x.planned_time) - min(y.planned_time))
  const starts = day.map((r) => docs.find((d) => d.doctor_id === r.doctor_id).win_start)
  assert.deepEqual(starts, [...starts].sort((x, y) => x - y))
})

t('doctors whose hours are more than 90 minutes apart do not share a day', () => {
  const docs = bricked({ A: 24 }, 1, (i) => (i < 12 ? { win_start: 15 * 60, win_end: 15 * 60 + 30 } : { win_start: 20 * 60, win_end: 20 * 60 + 30 }))
  const res = pl.generatePlan(input(docs, 8, [], { window: { start: 14 * 60, end: 22 * 60 } }))
  for (const [day, list] of Object.entries(perDay(res))) {
    const starts = new Set(list.map((r) => docs.find((d) => d.doctor_id === r.doctor_id).win_start))
    assert.equal(starts.size, 1, day)
  }
})

t('a day that would run past the window is shifted earlier, never beyond the 95th percentile', () => {
  const docs = bricked({ A: 12 }, 1)
  const res = pl.generatePlan(input(docs, 12, [], { window: { start: 14 * 60, end: 19 * 60 } }))
  for (const r of res.rows) assert.ok(min(r.planned_time) <= 19 * 60)
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
})

t('an early arrival is shown as "Arrives early" / "Waits" with the minutes, and the validator warns above 45 minutes', () => {
  const docs = bricked({ A: 8 }, 1, () => ({ win_start: 21 * 60, win_end: 21 * 60 + 20 }))
  const res = pl.generatePlan(input(docs, 8, [], { window: { start: 14 * 60, end: 22 * 60 } }))
  const noted = res.rows.filter((r) => r.note && /^(Waits|Arrives early) [0-9]+ min/.test(r.note))
  assert.ok(noted.length > 0)
  assert.ok(res.summary.waitTotalMin > 0)
  assert.ok(res.summary.waits.length > 0 && res.rows.some((r) => r.note && r.note.startsWith('Waits')))
  assert.ok(res.validation.warnings.some((w) => w.includes('minutes before his usual hours')))
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
})

t('distance is an estimate: straight line x 1.35, labelled as such', () => {
  const a = { lat: 30, lng: 31 }
  const b = { lat: 30.1, lng: 31 }
  assert.ok(Math.abs(pl.estKm(a, b, 1.35) - pl.haversineKm(a, b) * 1.35) < 1e-9)
  const res = pl.generatePlan(input(bricked(SIX, 3)))
  assert.ok(res.summary.avgEstKmPerDay > 0)
  assert.equal(res.params.detourFactor, 1.35)
})

t('a small list is merged into fewer days of 6+ visits spread over the month with a warning', () => {
  const docs = bricked({ A: 10, B: 10, C: 10 }, (i) => (i % 3 === 0 ? 2 : 1))
  const res = pl.generatePlan(input(docs, 9, [], { brickPairs: allPairs(['A', 'B', 'C']) }))
  const per = perDay(res)
  assert.ok(Object.values(per).every((l) => l.length <= 12))
  for (const [day, l] of Object.entries(per)) assert.ok(l.length >= 6 || res.summary.underMin.some((u) => u.day === day), `${day}: ${l.length}`)
  assert.ok(res.summary.plannedVisits >= res.summary.targetVisits - 3)
  assert.ok(res.summary.emptyDays.length > 0)
  assert.ok(res.summary.warnings.some((w) => w.includes('no visits')))
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
})

t('a day that cannot reach 6 is flagged "under the minimum" and declared to the validator', () => {
  const docs = bricked({ A: 4, B: 4, C: 4 }, 1)
  const res = pl.generatePlan(input(docs, 9, [], { brickPairs: [] }))
  assert.ok(res.summary.underMin.length > 0)
  assert.ok(res.summary.warnings.some((w) => w.includes('under the minimum')))
  assert.equal(res.validation.ok, true)
})

t('re-plan from a date: earlier days are untouched, the visits already done are subtracted, coverage counts them', () => {
  const docs = bricked({ A: 10, B: 10, C: 10, D: 10 }, 2)
  const done = {}
  for (const d of docs.slice(0, 15)) done[d.doctor_id] = 1
  const res = pl.generatePlan(input(docs, 9, [], { fromDay: '2026-09-13', done, brickPairs: allPairs(['A', 'B', 'C', 'D']) }))
  assert.ok(res.rows.every((r) => r.day >= '2026-09-13'))
  const per = new Map()
  for (const r of res.rows) per.set(r.doctor_id, (per.get(r.doctor_id) ?? 0) + 1)
  for (const d of docs) assert.ok((per.get(d.doctor_id) ?? 0) <= d.freq - (done[d.doctor_id] ?? 0))
  assert.equal(res.rows.length, 80 - 15)
  assert.equal(res.summary.fromDay, '2026-09-13')
  assert.ok(res.rows.filter((r) => r.doctor_id <= 15).every((r) => r.visit_no === 2))
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
})

const consecutiveShare = (docs, res, openDays) => {
  const bo = brickOfRow(docs)
  const per = perDay(res)
  const out = []
  for (let i = 1; i < openDays.length; i++) {
    const a = new Set((per[openDays[i - 1]] ?? []).map(bo))
    for (const r of per[openDays[i]] ?? []) if (a.has(bo(r))) out.push(`${openDays[i]}:${bo(r)}`)
  }
  return [...new Set(out)]
}
const openList = days().map((d) => d.day)

t('(a) 3 big bricks alternate day after day: the same brick is never on two working days in a row', () => {
  const docs = bricked({ A: 30, B: 30, C: 30 }, 2)
  const res = pl.generatePlan(input(docs, 9, [], { brickPairs: [], brickRepeats: [] }))
  assert.deepEqual(consecutiveShare(docs, res, openList), [])
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
  assert.equal(res.summary.repeats.length, 0)
  assert.ok(res.summary.plannedVisits >= 150, String(res.summary.plannedVisits))
})

t('consecutive means consecutive WORKING days: a closed day between two open days does not break the rule', () => {
  const docs = bricked({ A: 30, B: 30, C: 30 }, 2)
  const closed = ['2026-09-07']
  const res = pl.generatePlan(input(docs, 9, closed, { brickPairs: [], brickRepeats: [] }))
  const open = openList.filter((d) => !closed.includes(d))
  assert.deepEqual(consecutiveShare(docs, res, open), [])
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
})

t('(b) only one brick and no history: the rule is not broken silently, the shortfall is shown with numbers', () => {
  const docs = bricked({ A: 100 }, 2)
  const res = pl.generatePlan(input(docs, 9, [], { brickPairs: [], brickRepeats: [] }))
  assert.deepEqual(consecutiveShare(docs, res, openList), [])
  assert.ok(res.summary.blockedDays.length > 0)
  const w = res.summary.warnings.find((x) => x.includes('no-repeat brick rule blocks finishing'))
  assert.ok(w && w.includes('only 1 brick') && /[0-9]+ visits? not placed/.test(w), String(w))
  assert.ok(res.summary.plannedVisits < res.summary.targetVisits && res.summary.shortfall.visits > 0)
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
})

t('(c) a brick repeated twice in his history may be repeated once, as a last resort, and the reason is shown', () => {
  const docs = bricked({ A: 100 }, 2)
  const res = pl.generatePlan(input(docs, 9, [], { brickPairs: [], brickRepeats: [{ brick: 'A', repeat_days: 2, brick_days: 20, last_repeat: '2026-08-10' }] }))
  assert.equal(res.summary.repeats.length, 1)
  assert.ok(res.summary.repeats[0].why.includes('repeated 2 times in his history'))
  assert.equal(consecutiveShare(docs, res, openList).length, 1)
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
})

t('a brick repeated 4 times in his history can be repeated at most 3 times (the monthly limit), never more', () => {
  const docs = bricked({ A: 150 }, 2)
  const res = pl.generatePlan(input(docs, 9, [], { brickPairs: [], brickRepeats: [{ brick: 'A', repeat_days: 4, brick_days: 20, last_repeat: '2026-08-10' }] }))
  assert.equal(res.summary.repeats.length, 3)
  assert.equal(res.summary.repeatLimit, 3)
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
})

t('no repeat is used when waiting a day is enough to finish (it is only the last resort)', () => {
  const docs = bricked({ A: 12 }, 1)
  const res = pl.generatePlan(input(docs, 9, [], { brickPairs: [], brickRepeats: [{ brick: 'A', repeat_days: 5, brick_days: 20, last_repeat: '2026-08-10' }] }))
  assert.equal(res.summary.repeats.length, 0)
})

t('(d) the validator rejects two consecutive working days with the same brick, unless history allows it (and only that often)', () => {
  const docs = bricked({ A: 14, B: 14 }, 1)
  const row = (day, doctor_id, time, seq) => ({ day, seq, doctor_id, planned_time: time, fixed: false, visit_no: 1, note: null })
  const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const mk = (day, ids, start = 17 * 60) => ids.map((id, i) => row(day, id, hh(start + i * 17), i + 1))
  const a = (i) => docs.filter((d) => d.brick === 'A')[i].doctor_id
  const b = (i) => docs.filter((d) => d.brick === 'B')[i].doctor_id
  const rowsFor = (d1, d2) => [...mk(d1, [0, 1, 2, 3, 4, 5].map(a)), ...mk(d2, [6, 7, 8, 9, 10, 11].map(a))]
  const base = input(docs, 9, [], { brickPairs: [] })
  const bad = pl.validatePlan({ ...base, brickRepeats: [] }, rowsFor('2026-09-06', '2026-09-07'))
  assert.equal(bad.ok, false)
  assert.match(bad.failures.join('|'), /A on two working days in a row \(his history has no such repeat\)/)
  const okHistory = pl.validatePlan({ ...base, brickRepeats: [{ brick: 'A', repeat_days: 3, brick_days: 9, last_repeat: null }] }, rowsFor('2026-09-06', '2026-09-07'))
  assert.equal(okHistory.ok, true, okHistory.failures.join('; '))
  const alt = pl.validatePlan({ ...base, brickRepeats: [] }, [...mk('2026-09-06', [0, 1, 2, 3, 4, 5].map(a)), ...mk('2026-09-07', [0, 1, 2, 3, 4, 5].map(b))])
  assert.equal(alt.ok, true, alt.failures.join('; '))
  const limit = pl.validatePlan({ ...base, brickRepeats: [{ brick: 'A', repeat_days: 9, brick_days: 20, last_repeat: null }] }, [])
  assert.equal(limit.ok, true)
})

t('zero waiting first: a day that would make the rep arrive early is cut, the doctors with the latest hours move to another date', () => {
  // 12 doctors of one brick, hours from 19:07, PM window ends 21:36: 12 visits (about 4 hours) would force a start near 18:00
  const docs = bricked({ A: 12 }, 2, (i) => ({ win_start: 19 * 60 + 7 + Math.floor(i / 2) * 6, win_end: 21 * 60 + 50 }))
  const res = pl.generatePlan(input(docs, 12, [], { window: { start: 15 * 60, end: 21 * 60 + 36 }, brickRepeats: [], brickPairs: [] }))
  const per = perDay(res)
  for (const [day, list] of Object.entries(per)) {
    for (const r of list) {
      const d = docs.find((x) => x.doctor_id === r.doctor_id)
      assert.ok(d.win_start - min(r.planned_time) <= 20, `${day} ${r.planned_time} vs ${d.win_start}`)
      assert.ok(!r.note || !r.note.startsWith('Waits'))
    }
    assert.ok(list.length >= 6 && list.length <= 12)
  }
  const first = Object.values(per)[0]
  assert.ok(first.length < 12, 'the 12-visit day was cut')
  assert.ok(res.summary.plannedVisits >= 22, String(res.summary.plannedVisits))
  assert.equal(res.summary.waits.length, 0)
  assert.equal(res.validation.ok, true, res.validation.failures.join('; '))
})

t('doctors with close hours are chosen for the same day and the early ones come first', () => {
  const docs = bricked({ A: 24 }, 1, (i) => ({ win_start: i % 2 === 0 ? 16 * 60 : 19 * 60 + 15, win_end: i % 2 === 0 ? 17 * 60 : 20 * 60 + 15 }))
  const res = pl.generatePlan(input(docs, 8, [], { window: { start: 14 * 60, end: 22 * 60 } }))
  for (const list of Object.values(perDay(res))) {
    const sorted = [...list].sort((x, y) => min(x.planned_time) - min(y.planned_time))
    const starts = sorted.map((r) => docs.find((d) => d.doctor_id === r.doctor_id).win_start)
    assert.deepEqual(starts, [...starts].sort((x, y) => x - y))
    assert.equal(new Set(starts).size, 1)
  }
})

t('his usual busiest day (P90 of his days) is a soft reference: a warning above it by more than 3, the hard 12 untouched', () => {
  const hist = []
  for (let d = 1; d <= 20; d++) for (let k = 0; k < (d <= 18 ? 6 : 9); k++) hist.push({ day: `2026-08-${String(d).padStart(2, '0')}`, doctor_id: k + 1, visit_time: '18:00' })
  const u = pl.usualMaxDayFromHistory(hist)
  assert.equal(u, 6)
  assert.equal(pl.usualMaxDayFromHistory(hist.slice(0, 20)), null)
  const docs = bricked({ A: 30, B: 30, C: 30, D: 30 }, 2)
  const res = pl.generatePlan(input(docs, 9, [], { usualMaxDay: 4, brickPairs: [], brickRepeats: [] }))
  assert.equal(res.summary.usualMaxDay, 4)
  assert.ok(res.summary.aboveUsual.length > 0 && res.summary.aboveUsual.every((d) => d.count > 7))
  assert.ok(res.summary.warnings.some((w) => w.includes('more than 3 visits above his usual busiest day (4)')))
  assert.ok(res.summary.peak <= 12)
  const none = pl.generatePlan(input(docs, 9, [], { usualMaxDay: 12, brickPairs: [], brickRepeats: [] }))
  assert.equal(none.summary.aboveUsual.length, 0)
})

t('the coverage warning says why: closed days, the 12 maximum, doctors moved to avoid waiting', () => {
  const docs = bricked({ A: 20, B: 20, C: 20, D: 20, E: 20, F: 20 }, 1)
  const closed = days().filter((d) => d.day <= '2026-09-12').map((d) => d.day)
  const res = pl.generatePlan(input(docs, 9, closed, { brickPairs: allPairs(['A', 'B', 'C', 'D', 'E', 'F']), brickRepeats: [] }))
  assert.equal(res.summary.cov15.ok, false)
  const w = res.summary.warnings.find((x) => x.startsWith('Coverage by day 15'))
  assert.ok(w && w.includes('Why:') && w.includes('closed'), String(w))
  assert.ok(res.summary.cov15Why.some((x) => x.includes('closed')))
  const wait = pl.generatePlan(input(bricked({ A: 12 }, 1, (i) => ({ win_start: 19 * 60 + 7 + i * 4, win_end: 21 * 60 + 50 })), 12, [], { window: { start: 15 * 60, end: 21 * 60 + 36 }, brickPairs: [], brickRepeats: [] }))
  assert.ok(Array.isArray(wait.summary.cov15Why))
})

t('(g) the validator rejects a broken plan and lists what is wrong', () => {
  const docs = bricked({ A: 12, B: 12, C: 12 }, 2)
  const inp = input(docs, 9, ['2026-09-07'], { brickPairs: [{ a: 'A', b: 'B', pm_days: 3, any_days: 3, last_day: null }], window: { start: 15 * 60, end: 21 * 60 } })
  const row = (day, doctor_id, time, seq) => ({ day, seq, doctor_id, planned_time: time, fixed: false, visit_no: 1, note: null })
  const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const mk = (day, ids, start = 17 * 60) => ids.map((id, i) => row(day, id, hh(start + i * 17), i + 1))
  const a = (i) => docs.filter((d) => d.brick === 'A')[i].doctor_id
  const b = (i) => docs.filter((d) => d.brick === 'B')[i].doctor_id
  const c = (i) => docs.filter((d) => d.brick === 'C')[i].doctor_id
  const fails = (rows, declared = []) => pl.validatePlan(inp, rows, {}, declared).failures.join(' | ')
  const six = [0, 1, 2, 3, 4, 5].map(a)

  assert.equal(pl.validatePlan(inp, mk('2026-09-06', six)).ok, true)
  assert.match(fails(mk('2026-09-06', [...Array(12)].map((_, i) => a(i)).concat([b(0)]), 15 * 60)), /above the maximum of 12/)
  assert.match(fails(mk('2026-09-06', [0, 1, 2].map(a))), /under the minimum of 6/)
  assert.equal(pl.validatePlan(inp, mk('2026-09-06', [0, 1, 2].map(a)), {}, ['2026-09-06']).ok, true)
  assert.match(fails(mk('2026-09-06', [a(0), a(1), a(2), b(0), b(1), b(2), c(0), c(1)])), /3 bricks/)
  assert.match(fails(mk('2026-09-06', [a(0), a(1), a(2), b(0), b(1), b(2), a(3)])), /not in blocks/)
  assert.match(fails(mk('2026-09-06', [a(0), a(1), a(2), c(0), c(1), c(2)])), /never worked together/)
  assert.match(fails(mk('2026-09-06', [a(0), a(1), a(2), a(3), a(4), b(0)])), /second brick needs 3/)
  assert.match(fails(mk('2026-09-07', six)), /closed day/)
  assert.match(fails(mk('2026-09-06', six, 20 * 60 + 30)), /outside the PM window/)
  assert.match(fails([...mk('2026-09-06', six), ...mk('2026-09-13', six), ...mk('2026-09-20', six)]), /3 planned visits, only 2 left/)
  assert.match(fails([...mk('2026-09-06', six), ...mk('2026-09-08', six)]), /apart \(minimum 5\)/)
  assert.match(fails([row('2026-09-06', a(0), '17:00', 1), row('2026-09-06', a(1), '17:00', 2), ...mk('2026-09-06', [2, 3, 4, 5].map(a), 17 * 60 + 40)]), /two visits at 17:00/)
})

t('a plan from the generator never fails the validator, over many shapes', () => {
  for (const [sizes, freq, target] of [[{ A: 12, B: 12, C: 12 }, 2, 9], [{ A: 30, B: 5, C: 4, D: 3 }, 2, 8], [{ A: 9, B: 9, C: 9, D: 9, E: 9, F: 9, G: 9 }, 3, 10], [{ A: 40, B: 40, C: 40 }, 3, 9]]) {
    const docs = bricked(sizes, freq)
    const res = pl.generatePlan(input(docs, target, [], { brickPairs: allPairs(Object.keys(sizes), 2) }))
    assert.equal(res.validation.ok, true, `${JSON.stringify(sizes)}: ${res.validation.failures.join('; ')}`)
    assert.ok(Object.values(perDay(res)).every((l) => l.length <= 12))
  }
})

t('no open day: empty plan with a message', () => {
  const res = pl.generatePlan(input(bricked({ A: 5 }, 1), 9, days().map((d) => d.day)))
  assert.equal(res.rows.length, 0)
  assert.ok(res.summary.warnings.some((w) => w.includes('No open PM day')))
})

t('summary: highest and lowest day, one-brick and two-brick days, stay, wait and the window', () => {
  const res = pl.generatePlan(input(bricked(SIX, 3), 9, [], { brickPairs: allPairs(NAMES) }))
  assert.ok(res.summary.peak >= res.summary.lowest && res.summary.lowest >= 6)
  assert.equal(res.summary.oneBrickDays + res.summary.twoBrickDays.length, Object.keys(perDay(res)).length)
  assert.ok(res.summary.avgStayMin > 0 && res.summary.waitTotalMin >= 0)
  assert.deepEqual(res.summary.window, { start: '14:00', end: '22:00', own: false })
})

t('doctorTimesFromHistory: usual weekday, hours P20-P80 (or +-90 min around the median with few visits)', () => {
  const v = (day, time, id = 1) => ({ day, doctor_id: id, visit_time: time })
  const many = [v('2026-08-02', '16:00'), v('2026-08-09', '17:00'), v('2026-08-16', '18:00'), v('2026-08-23', '19:00'), v('2026-08-26', '20:00'), v('2026-07-05', '16:30')]
  const few = [v('2026-08-02', '18:00', 2)]
  const [d1, d2, d3] = pl.doctorTimesFromHistory([...many, ...few], bricked({ A: 3 }, 1))
  assert.equal(d1.pref_isodow, 7)
  assert.ok(d1.win_start >= 16 * 60 && d1.win_end <= 20 * 60)
  assert.equal(d2.win_start, 18 * 60 - 90)
  assert.equal(d2.win_end, 18 * 60 + 90)
  assert.equal(d3.win_start, null)
})

t('PM window comes from the rep history: 5th-95th percentile, outliers ignored, null when too few visits', () => {
  const times = [...Array.from({ length: 100 }, (_, i) => `${String(14 + Math.floor(i / 15)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`), '03:00', '23:59']
  const w = pl.windowFromTimes(times)
  assert.ok(w.start >= 14 * 60 && w.end <= 21 * 60 + 40 && w.end > w.start)
  assert.equal(pl.windowFromTimes(['15:00', '16:00']), null)
})

t('backtest: a day with no visits stays open, the plan is validated, same metrics for both sides', () => {
  const docs = bricked(SIX, 3)
  const actual = docs.slice(0, 10).map((d) => ({ day: '2026-09-06', doctor_id: d.doctor_id, visit_time: '15:00' }))
  const b = pl.backtest(input(docs, 9, [], { brickPairs: allPairs(NAMES) }), actual)
  assert.ok(b.plan.days > 15)
  assert.equal(b.actual.maxDay, 10)
  assert.ok(b.plan.maxDay <= 12)
  assert.equal(b.valid, true)
  assert.ok(b.plan.cov15 >= b.actual.cov15 && b.plan.pcf >= b.actual.pcf)
})

console.log(`${n} tests passed`)
