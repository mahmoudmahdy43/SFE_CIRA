/**
 * Monthly visit planner (PM, one rep). Pure and deterministic: the same inputs always give the same plan (no random, no I/O).
 *
 * Hard rules (checked again by validatePlan.ts): 6 to 12 visits on every open day (12 never exceeded), only closed days are skipped,
 * nobody outside the rep's own PM window, at most 2 bricks a day in one block each, a second brick only if the rep worked the two
 * together before and it has 3+ doctors that day, no doctor above his visits, a minimum gap between visits of one doctor.
 *
 * How a plan is built:
 *  1. Visits per open day (computeCaps): the box target, never below 6; a list too small for 6 a day is merged into fewer days; a list
 *     bigger than target x open days opens the fewest days above the target (11 then 12), early in the month and not back to back.
 *  2. A day is a brick: the primary brick is the one holding the lowest visit round (first visits before second ones) that can fill
 *     the day, preferring the brick next to where the previous day ended. A second brick joins only when the primary cannot fill the day.
 *  3. Times: the day starts when the doctors of that day are usually visited (each doctor's own window), visits follow without gaps
 *     (15 min + estimated travel, 15-25 inside a brick), the start is the earliest one that keeps everybody inside their windows.
 *  5. The same brick is never planned on two working days in a row, except the few repeats the rep's history allows, as a last resort.
 *  4. Doctors' own usual weekday and hours are preferences: they order the visits and show as "waiting" notes, they are never hard.
 */
import {
  brickOf, clamp, DEFAULT_PARAMS, estKm, fromMin, hasGps, haversineKm, isoDow, pairAllowed, pairLookup, pairWhy, routeKm, toMin,
  type ActualVisit, type Gps, type PlanDoctor, type PlanInputs, type PlanParams, type PlanResult, type PlanRow, type PlanSummary,
} from './planCore.ts'
import { validatePlan } from './validatePlan.ts'

export * from './planCore.ts'
export { validatePlan } from './validatePlan.ts'

/* ------------------------------------ route (stable order of doctors) ------------------------------------ */
type GpsDoc = PlanDoctor & Gps

/** Closed tour through the GPS doctors, cut at its longest edge so it reads as a path. Deterministic. */
function gpsRoute(docs: GpsDoc[]): GpsDoc[] {
  const n = docs.length
  if (n <= 2) return [...docs]
  const dist = new Float64Array(n * n)
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = haversineKm(docs[i], docs[j]); dist[i * n + j] = d; dist[j * n + i] = d }
  const cLat = docs.reduce((a, d) => a + d.lat, 0) / n
  const cLng = docs.reduce((a, d) => a + d.lng, 0) / n
  let start = 0
  let far = -1
  for (let i = 0; i < n; i++) {
    const d = haversineKm({ lat: cLat, lng: cLng }, docs[i])
    if (d > far + 1e-9 || (Math.abs(d - far) <= 1e-9 && docs[i].doctor_id < docs[start].doctor_id)) { far = d; start = i }
  }
  const used = new Uint8Array(n)
  const t: number[] = [start]
  used[start] = 1
  for (let k = 1; k < n; k++) {
    const cur = t[t.length - 1]
    let best = -1
    for (let j = 0; j < n; j++) {
      if (used[j]) continue
      if (best < 0 || dist[cur * n + j] < dist[cur * n + best] - 1e-12 || (Math.abs(dist[cur * n + j] - dist[cur * n + best]) <= 1e-12 && docs[j].doctor_id < docs[best].doctor_id)) best = j
    }
    used[best] = 1
    t.push(best)
  }
  for (let pass = 0; pass < 40; pass++) {
    let improved = false
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue
        const a = t[i], b = t[i + 1], c = t[j], d = t[(j + 1) % n]
        const delta = dist[a * n + b] + dist[c * n + d] - dist[a * n + c] - dist[b * n + d]
        if (delta > 1e-9) {
          for (let lo = i + 1, hi = j; lo < hi; lo++, hi--) { const x = t[lo]; t[lo] = t[hi]; t[hi] = x }
          improved = true
        }
      }
    }
    if (!improved) break
  }
  let cut = 0
  let longest = -1
  for (let i = 0; i < n; i++) {
    const d = dist[t[i] * n + t[(i + 1) % n]]
    if (d > longest + 1e-12) { longest = d; cut = i }
  }
  const out: GpsDoc[] = []
  for (let k = 1; k <= n; k++) out.push(docs[t[(cut + k) % n]])
  return out
}

/** One order of all doctors (GPS ones along the tour, the others next to a doctor of the same brick) used as a stable tie-break. */
function fullRoute(doctors: PlanDoctor[]): PlanDoctor[] {
  const route: PlanDoctor[] = gpsRoute(doctors.filter(hasGps) as GpsDoc[])
  const rest = doctors.filter((d) => !hasGps(d)).sort((a, b) => (a.brick ?? '').localeCompare(b.brick ?? '') || a.name.localeCompare(b.name) || a.doctor_id - b.doctor_id)
  for (const d of rest) {
    const at = d.brick ? route.findIndex((r) => r.brick === d.brick) : -1
    if (at < 0) route.push(d)
    else route.splice(at + 1, 0, d)
  }
  return route
}

/* ------------------------------------ visits per day ------------------------------------ */
interface OpenDay { day: string; isodow: number; early: boolean }

const evenPick = (idx: number[], a: number): number[] => Array.from({ length: a }, (_, k) => idx[Math.min(idx.length - 1, Math.floor(((k + 0.5) * idx.length) / a))])

/** Visits wanted per open day. Active days hold minDay..hard visits; days left at 0 were merged into the others. */
function computeCaps(open: OpenDay[], N: number, needFirst: number, T: number, hard: number, minDay: number, p: PlanParams): number[] {
  const W = open.length
  if (W === 0) return []
  const Tc = Math.min(hard, Math.max(minDay, T))
  const early = [...open.keys()].filter((i) => open[i].early)
  const late = [...open.keys()].filter((i) => !open[i].early)
  if (N < minDay * W) {
    const A = Math.max(1, Math.floor(N / minDay))
    const per = N / A
    let aE = Math.min(A, early.length, Math.max(Math.ceil(needFirst / per), Math.round((A * early.length) / W)))
    let aL = A - aE
    if (aL > late.length) { aL = late.length; aE = A - aL }
    const active = [...evenPick(early, aE), ...evenPick(late, aL)].sort((a, b) => a - b)
    const caps = open.map(() => 0)
    active.forEach((di, k) => { caps[di] = Math.min(hard, Math.floor(N / A) + (k < N % A ? 1 : 0)) })
    return caps
  }
  if (N > Tc * W) {
    const extra = N - Tc * W
    const levels = p.extraLevels.filter((l) => l > Tc && l <= hard)
    const caps = open.map(() => Tc)
    if (levels.length === 0) return caps
    let level = levels[levels.length - 1]
    for (const l of levels) { if (Math.ceil(extra / (l - Tc)) <= Math.ceil(W / 2)) { level = l; break } }
    const m = Math.min(W, Math.ceil(extra / (level - Tc)))
    const order = [...open.keys()].filter((i) => i % 2 === 0).concat([...open.keys()].filter((i) => i % 2 === 1))
    const chosen = order.slice(0, m).sort((a, b) => a - b)
    let left = extra
    for (const i of chosen) { const add = Math.min(level - Tc, left); caps[i] = Tc + add; left -= add }
    return caps
  }
  const needEarly = needFirst
  const ce = Math.min(Tc, Math.max(Math.floor(N / W), early.length > 0 ? Math.ceil(needEarly / early.length) : 0, minDay))
  const lateNeed = Math.max(0, N - ce * early.length)
  const lc = late.length > 0 ? Math.min(Tc, Math.max(minDay, Math.ceil(lateNeed / late.length))) : 0
  const caps = open.map((d) => (d.early ? ce : lc))
  let total = caps.reduce((a, b) => a + b, 0)
  while (total < N) {
    let at = -1
    for (let i = 0; i < W; i++) if (caps[i] < Tc && (at < 0 || caps[i] < caps[at])) at = i
    if (at < 0) break
    caps[at]++; total++
  }
  while (total > N) {
    let at = -1
    for (let i = W - 1; i >= 0; i--) if (caps[i] > minDay && (at < 0 || caps[i] > caps[at])) at = i
    if (at < 0) break
    caps[at]--; total--
  }
  return caps
}

/* ------------------------------------ history -> rep window, day start, doctor preferences ------------------------------------ */
const pct = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]

/** The rep's PM window from his visit start times (HH:MM): 5th to 95th percentile, so outliers are ignored. null when there are too few visits. */
export function windowFromTimes(times: (string | null)[], minVisits: number = DEFAULT_PARAMS.minHistory): { start: number; end: number } | null {
  const m = times.map((t) => toMin(t)).filter((x): x is number => x !== null).sort((a, b) => a - b)
  if (m.length < minVisits) return null
  const start = pct(m, 0.05)
  const end = pct(m, 0.95)
  return end > start ? { start, end } : null
}

/**
 * Each doctor's own preferences from the rep's visit history: his usual weekday and the hours he is visited in
 * (20th-80th percentile of the times; with fewer than 5 visits, 90 minutes around the median).
 */
export function doctorTimesFromHistory(history: ActualVisit[], doctors: PlanDoctor[]): PlanDoctor[] {
  const by = new Map<number, ActualVisit[]>()
  for (const v of history) { const a = by.get(v.doctor_id) ?? []; a.push(v); by.set(v.doctor_id, a) }
  return doctors.map((d) => {
    const list = by.get(d.doctor_id) ?? []
    if (list.length === 0) return { ...d, pref_isodow: null, win_start: null, win_end: null, n_hist: 0 }
    const dows = new Map<number, number>()
    for (const v of list) { const k = isoDow(v.day); dows.set(k, (dows.get(k) ?? 0) + 1) }
    const [dow, cnt] = [...dows].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
    const mins = list.map((v) => toMin(v.visit_time)).filter((m): m is number => m !== null).sort((a, b) => a - b)
    let ws: number | null = null
    let we: number | null = null
    if (mins.length >= 5) { ws = pct(mins, 0.2); we = pct(mins, 0.8) }
    else if (mins.length > 0) { const med = pct(mins, 0.5); ws = med - 90; we = med + 90 }
    return { ...d, pref_isodow: list.length >= 2 && cnt / list.length >= 0.4 ? dow : null, win_start: ws, win_end: we, n_hist: list.length }
  })
}

/* ------------------------------------ the planner ------------------------------------ */
interface Unit { doc: PlanDoctor; round: number; brick: string; pos: number }
interface Block { brick: string; units: Unit[] }
interface DayPlan { blocks: Block[]; why: string | null }

export function generatePlan(inputs: PlanInputs, over: Partial<PlanParams> = {}): PlanResult {
  const p: PlanParams = { ...DEFAULT_PARAMS, ...over }
  const T0 = inputs.daily_target
  const targetMissing = T0 === null || !(T0 > 0)
  const T = targetMissing ? p.fallbackTarget : Math.round(T0 as number)
  const fromDay = inputs.fromDay ?? null
  const docs = inputs.doctors.filter((d) => d.freq > 0)
  const done = inputs.done ?? {}
  const left = (d: PlanDoctor): number => Math.max(0, d.freq - (done[d.doctor_id] ?? 0))
  const open: OpenDay[] = inputs.days.filter((d) => !d.closed && (!fromDay || d.day >= fromDay)).map((d) => ({ day: d.day, isodow: d.isodow, early: Number(d.day.slice(8, 10)) <= p.coverageDay }))
  const W = open.length
  const D = docs.length
  const N = docs.reduce((a, d) => a + d.freq, 0)
  const Nrem = docs.reduce((a, d) => a + left(d), 0)

  // PM window (visit start times) and the usual start of the day: the rep's own history, else defaults
  const ws = inputs.window ? inputs.window.start : (toMin(p.defaultStart) as number)
  const we = inputs.window ? Math.max(inputs.window.end, ws) : (toMin(p.defaultEnd) as number)
  const geo = docs.filter(hasGps)
  let hopKm = 0.5
  if (geo.length > 1) {
    const nn = geo.map((a) => Math.min(...geo.filter((b) => b !== a).map((b) => estKm(a, b, p.detourFactor)))).sort((a, b) => a - b)
    hopKm = nn[nn.length >> 1]
  }
  const typicalGap = clamp(Math.ceil(p.visitMinutes + (hopKm / p.speedKmh) * 60), p.gapMin, p.gapMax)
  const hard = Math.max(1, Math.min(p.maxDay, Math.floor((we - ws) / typicalGap) + 1))
  const minDay = Math.min(p.minDay, hard)

  const route = fullRoute(docs)
  const routePos = new Map(route.map((d, i) => [d.doctor_id, i]))
  const pairs = pairLookup(inputs.brickPairs)

  // visits still to plan, by brick; round k = the k-th visit still owed to the doctor
  const pending = new Map<string, Unit[]>()
  for (const d of route) {
    const b = brickOf(d)
    for (let k = 1; k <= left(d); k++) pending.set(b, [...(pending.get(b) ?? []), { doc: d, round: k, brick: b, pos: routePos.get(d.doctor_id) as number }])
  }
  const centroid = (b: string): Gps | null => {
    const g = docs.filter((d) => brickOf(d) === b && hasGps(d))
    if (g.length === 0) return null
    return { lat: g.reduce((a, d) => a + (d.lat as number), 0) / g.length, lng: g.reduce((a, d) => a + (d.lng as number), 0) / g.length }
  }
  const cent = new Map([...pending.keys()].map((b) => [b, centroid(b)]))
  const distBricks = (a: string, b: string): number => { const x = cent.get(a); const y = cent.get(b); return x && y ? haversineKm(x, y) : 1e6 }

  const visitDays = new Map<number, number[]>()
  const spaced = (id: number, di: number, except = -1): boolean => (visitDays.get(id) ?? []).every((v) => v === except || Math.abs(v - di) >= p.minGapDays)
  const addVisit = (id: number, di: number) => { const a = visitDays.get(id) ?? []; a.push(di); visitDays.set(id, a) }
  const plans: DayPlan[] = open.map(() => ({ blocks: [], why: null }))
  const countOf = (di: number): number => plans[di].blocks.reduce((a, b) => a + b.units.length, 0)

  /* ---- 1. compose the days ---- */
  let prevBrick: string | null = null
  const repStats = new Map((inputs.brickRepeats ?? []).map((r) => [r.brick, r]))
  const repeatAllow = (b: string): number => Math.max(0, (repStats.get(b)?.repeat_days ?? 0) - 1)
  const repeatsUsedBy = new Map<string, number>()
  const repeats: PlanSummary['repeats'] = []
  const blockedDays: string[] = []
  const covered = new Set<number>(docs.filter((d) => (done[d.doctor_id] ?? 0) > 0).map((d) => d.doctor_id))
  for (let di = 0; di < W; di++) {
    // visits for today: the plan of the days that are left (recomputed every day, so a day that took more spreads the rest evenly)
    const remaining = [...pending.values()].reduce((a, l) => a + l.length, 0)
    if (remaining === 0) break
    const needFirst = Math.max(0, Math.ceil(p.minCoverage * D) - covered.size)
    const want = computeCaps(open.slice(di), remaining, needFirst, T, hard, minDay, p)[0]
    if (want === 0) continue
    const mismatch = (u: Unit): number => (u.doc.pref_isodow != null && u.doc.pref_isodow !== open[di].isodow ? 1 : 0)
    const eligs = new Map<string, Unit[]>()
    for (const [b, list] of pending) {
      // one visit per doctor per day: only his next owed visit (lowest round) is eligible
      const seenDoc = new Set<number>()
      let uS = Infinity
      let uE = -Infinity
      const e = list.filter((u) => spaced(u.doc.doctor_id, di)).sort((a, c) => a.round - c.round || mismatch(a) - mismatch(c) || a.pos - c.pos).filter((u) => (seenDoc.has(u.doc.doctor_id) ? false : (seenDoc.add(u.doc.doctor_id), true))).filter((u) => {
        // doctors whose usual hours are more than 90 minutes away from the others of the day wait for another date
        const a = u.doc.win_start
        const c = u.doc.win_end
        if (a == null || c == null) return true
        if (uE >= uS && Math.max(0, a - uE, uS - c) > p.windowGapMaxMin) return false
        uS = Math.min(uS, a)
        uE = Math.max(uE, c)
        return true
      })
      if (e.length > 0) eligs.set(b, e)
    }
    if (eligs.size === 0) continue
    // the same brick is never planned two working days in a row, unless history allows it and nothing else can be done
    const prevBricks = new Set(di > 0 ? plans[di - 1].blocks.map((b) => b.brick) : [])
    let repeatBrick: string | null = null
    {
      const all = new Map(eligs)
      eligs.clear()
      for (const [b, e] of all) if (!prevBricks.has(b)) eligs.set(b, e)
      if (eligs.size === 0) {
        const daysAfter = W - di - 1
        const canWait = remaining <= hard * Math.ceil(daysAfter / 2)
        const options = [...all.keys()].filter((b) => (repeatsUsedBy.get(b) ?? 0) < repeatAllow(b) && repeats.length < p.maxBrickRepeats)
          .sort((a, b) => (repStats.get(b)?.repeat_days ?? 0) - (repStats.get(a)?.repeat_days ?? 0) || (all.get(b) as Unit[]).length - (all.get(a) as Unit[]).length || a.localeCompare(b))
        if (!canWait && options.length > 0) { repeatBrick = options[0]; eligs.set(repeatBrick, all.get(repeatBrick) as Unit[]) }
        else { blockedDays.push(open[di].day); continue }
      }
    }
    const lowest = Math.min(...[...eligs.values()].map((e) => e[0].round))

    interface Cand { a: string; take: Unit[]; second: { brick: string; take: Unit[]; why: string } | null; reach: number }
    const build = (a: string): Cand => {
      const eA = eligs.get(a) as Unit[]
      let n = Math.min(eA.length, want)
      if (eA.length > want && eA.length <= hard && eA.length - want <= 2) n = eA.length // do not leave 1-2 visits of this brick alone
      const take = eA.slice(0, n)
      let second: Cand['second'] = null
      const r = want - take.length
      if (r >= p.minSecondBrickDoctors && take.length >= p.minSecondBrickDoctors && p.maxBricksPerDay >= 2) {
        let best: { b: string; tb: number; pm: number; dist: number; rest: number; pair: ReturnType<typeof pairs> } | null = null
        for (const [b, eB] of eligs) {
          if (b === a || eB.length < p.minSecondBrickDoctors) continue
          const pr = pairs(a, b)
          if (!pairAllowed(pr)) continue
          const tb = Math.min(r, eB.length)
          const cand = { b, tb, pm: (pr as NonNullable<typeof pr>).pm_days, dist: distBricks(a, b), rest: (pending.get(b) as Unit[]).length - tb, pair: pr }
          if (best === null || cand.pm > best.pm || (cand.pm === best.pm && (cand.dist < best.dist - 1e-9 || (Math.abs(cand.dist - best.dist) <= 1e-9 && (cand.rest < best.rest || (cand.rest === best.rest && cand.b < best.b)))))) best = cand
        }
        if (best) second = { brick: best.b, take: (eligs.get(best.b) as Unit[]).slice(0, best.tb), why: pairWhy(best.pair as NonNullable<typeof best.pair>) }
      }
      return { a, take, second, reach: take.length + (second ? second.take.length : 0) }
    }
    const cands = [...eligs.keys()].map(build)
    const near = (c: Cand): number => (prevBrick === null ? 0 : distBricks(prevBrick, c.a))
    const rank = (list: Cand[]): Cand => [...list].sort((x, y) => near(x) - near(y) || y.take.length - x.take.length || x.a.localeCompare(y.a))[0]
    const pool0 = cands.filter((c) => (eligs.get(c.a) as Unit[])[0].round === lowest)
    let pick: Cand
    const good0 = pool0.filter((c) => c.reach >= minDay)
    const goodAll = cands.filter((c) => c.reach >= minDay)
    if (good0.length > 0) pick = rank(good0)
    else if (goodAll.length > 0) pick = rank(goodAll)
    else pick = [...pool0].sort((x, y) => y.reach - x.reach || near(x) - near(y) || x.a.localeCompare(y.a))[0]

    const blocks: Block[] = [{ brick: pick.a, units: pick.take }]
    if (pick.second) blocks.push({ brick: pick.second.brick, units: pick.second.take })
    for (const bl of blocks) {
      const gone = new Set(bl.units)
      pending.set(bl.brick, (pending.get(bl.brick) as Unit[]).filter((u) => !gone.has(u)))
      for (const u of bl.units) addVisit(u.doc.doctor_id, di)
    }
    plans[di] = { blocks, why: pick.second ? pick.second.why : null }
    if (repeatBrick) {
      repeatsUsedBy.set(repeatBrick, (repeatsUsedBy.get(repeatBrick) ?? 0) + 1)
      repeats.push({ day: open[di].day, brick: repeatBrick, why: `${repeatBrick}: repeated ${repStats.get(repeatBrick)?.repeat_days ?? 0} times in his history` })
    }
    for (const bl of blocks) for (const u of bl.units) covered.add(u.doc.doctor_id)
    prevBrick = blocks[blocks.length - 1].brick
  }

  /* ---- 2. repair: a day under the minimum takes visits of its own bricks from fuller days, else is merged into other days ---- */
  const unitsOf = (di: number): Unit[] => plans[di].blocks.flatMap((b) => b.units)
  const moveUnit = (u: Unit, from: number, to: number) => {
    const fb = plans[from].blocks.find((b) => b.brick === u.brick) as Block
    fb.units.splice(fb.units.indexOf(u), 1)
    if (fb.units.length === 0) plans[from].blocks = plans[from].blocks.filter((b) => b !== fb)
    let tb = plans[to].blocks.find((b) => b.brick === u.brick)
    if (!tb) { tb = { brick: u.brick, units: [] }; plans[to].blocks.push(tb) }
    tb.units.push(u)
    const v = visitDays.get(u.doc.doctor_id) as number[]
    v[v.indexOf(from)] = to
  }
  const brickCount = (di: number, b: string): number => plans[di].blocks.find((x) => x.brick === b)?.units.length ?? 0
  const dupOn = (u: Unit, di: number): boolean => unitsOf(di).some((x) => x.doc.doctor_id === u.doc.doctor_id)
  for (let di = 0; di < W; di++) {
    const n0 = countOf(di)
    if (n0 === 0 || n0 >= minDay) continue
    const mine = new Set(plans[di].blocks.map((b) => b.brick))
    for (let guard = 0; guard < 60 && countOf(di) < minDay; guard++) {
      let best: { u: Unit; dj: number } | null = null
      for (let dj = 0; dj < W; dj++) {
        if (dj === di || countOf(dj) <= minDay) continue
        for (const u of unitsOf(dj)) {
          if (!mine.has(u.brick) || dupOn(u, di) || !spaced(u.doc.doctor_id, di, dj)) continue
          // moving it must not break the other day's rules: a second brick keeps its 3 doctors
          if (plans[dj].blocks.length === 2 && brickCount(dj, u.brick) - 1 < p.minSecondBrickDoctors) continue
          if (best === null || u.pos < best.u.pos) best = { u, dj }
        }
      }
      if (!best) break
      moveUnit(best.u, best.dj, di)
    }
    if (countOf(di) > 0 && countOf(di) < minDay) {
      const targets: { u: Unit; to: number }[] = []
      const counts = plans.map((_, i) => countOf(i))
      let ok = true
      for (const u of unitsOf(di)) {
        let to = -1
        for (let dj = 0; dj < W && to < 0; dj++) {
          if (dj === di || counts[dj] === 0 || counts[dj] >= hard || brickCount(dj, u.brick) === 0 || dupOn(u, dj) || targets.some((m) => m.to === dj && m.u.doc.doctor_id === u.doc.doctor_id) || !spaced(u.doc.doctor_id, dj, di)) continue
          to = dj
        }
        if (to < 0) { ok = false; break }
        counts[to]++
        targets.push({ u, to })
      }
      if (ok) for (const m of targets) moveUnit(m.u, di, m.to)
    }
  }

  /* ---- 3. order and times ---- */
  const rows: PlanRow[] = []
  const dayRows: { u: Unit; time: number }[][] = open.map(() => [])
  const unplaced: Unit[] = []
  const gapBetween = (a: Unit, b: Unit): number => {
    const km = hasGps(a.doc) && hasGps(b.doc) ? estKm(a.doc, b.doc, p.detourFactor) : 0
    const g = Math.ceil(p.visitMinutes + (km / p.speedKmh) * 60)
    return a.brick === b.brick ? clamp(g, p.gapMin, p.gapMax) : Math.max(p.gapMin, g)
  }
  /** Order of one brick block: by the start of each doctor's usual hours (doctors without hours sit in the middle), then by route. */
  const orderBlock = (units: Unit[]): Unit[] => {
    const known = units.map((u) => u.doc.win_start).filter((x): x is number => x != null).sort((a, b) => a - b)
    const mid = known.length > 0 ? known[known.length >> 1] : 0
    return [...units].sort((a, b) => (a.doc.win_start ?? mid) - (b.doc.win_start ?? mid) || a.pos - b.pos)
  }
  const blockKey = (b: Block): number => { const k = b.units.map((u) => u.doc.win_start).filter((x): x is number => x != null).sort((x, y) => x - y); return k.length > 0 ? k[k.length >> 1] : 0 }
  for (let di = 0; di < W; di++) {
    const blocks = plans[di].blocks.filter((b) => b.units.length > 0)
    if (blocks.length === 0) continue
    if (blocks.length === 2 && blockKey(blocks[1]) < blockKey(blocks[0])) blocks.reverse()
    let seq: Unit[] = []
    for (const b of blocks) seq = seq.concat(orderBlock(b.units))
    const offsets = (list: Unit[]): number[] => list.reduce<number[]>((a, u, i) => { a.push(i === 0 ? 0 : a[i - 1] + gapBetween(list[i - 1], u)); return a }, [])
    // the outer window must hold the whole day: drop the last visits (reported as shortfall) if it cannot
    let offs = offsets(seq)
    while (seq.length > 0 && ws + offs[offs.length - 1] > we) { unplaced.push(seq.pop() as Unit); offs = offsets(seq) }
    if (seq.length === 0) continue
    const dur = offs[offs.length - 1]
    // start: the earliest time at which every doctor arrives inside his own usual hours (not more than 20 min early, not late)
    const cost = (t0: number): number => seq.reduce((acc, u, i) => {
      const a = u.doc.win_start
      const c = u.doc.win_end
      if (a == null || c == null) return acc
      const at = t0 + offs[i]
      return acc + Math.max(0, a - p.earlyToleranceMin - at) + 3 * Math.max(0, at - c)
    }, 0)
    const lo = ws
    const hi = we - dur
    const cands = new Set<number>([lo, hi])
    seq.forEach((u, i) => {
      if (u.doc.win_start != null) cands.add(u.doc.win_start - p.earlyToleranceMin - offs[i])
      if (u.doc.win_end != null) cands.add(u.doc.win_end - offs[i])
    })
    let t0 = lo
    let best = Infinity
    for (const c of [...cands].map((x) => clamp(Math.round(x), lo, hi)).sort((a, b) => a - b)) {
      const k = cost(c)
      if (k < best - 1e-9) { best = k; t0 = c }
    }
    seq.forEach((u, i) => dayRows[di].push({ u, time: t0 + offs[i] }))
  }

  const waits: PlanSummary['waits'] = []
  let waitTotal = 0
  const counter = new Map<number, number>()
  for (let di = 0; di < W; di++) {
    dayRows[di].forEach(({ u, time }, i) => {
      const nth = (counter.get(u.doc.doctor_id) ?? 0) + 1
      counter.set(u.doc.doctor_id, nth)
      let note: string | null = null
      const ws2 = u.doc.win_start
      if (ws2 != null && time < ws2) {
        const w = Math.round(ws2 - time)
        waitTotal += w
        if (w > p.maxWaitMin) { note = `Waits ${w} min (his usual hours start ${fromMin(ws2)})`; waits.push({ id: u.doc.doctor_id, name: u.doc.name, day: open[di].day, minutes: w }) }
        else if (w > p.earlyToleranceMin) note = `Arrives early ${w} min (his usual hours start ${fromMin(ws2)})`
      }
      rows.push({ day: open[di].day, seq: i + 1, doctor_id: u.doc.doctor_id, planned_time: fromMin(time), fixed: false, visit_no: (done[u.doc.doctor_id] ?? 0) + nth, note })
    })
  }

  /* ---- 4. summary ---- */
  const planned = new Map<number, number>()
  const firstDay = new Map<number, string>()
  for (const r of rows) { planned.set(r.doctor_id, (planned.get(r.doctor_id) ?? 0) + 1); if (!firstDay.has(r.doctor_id)) firstDay.set(r.doctor_id, r.day) }
  const cutoff = `${inputs.month.slice(0, 8)}${String(p.coverageDay).padStart(2, '0')}`
  let cov15 = 0
  let covEnd = 0
  for (const d of docs) {
    const had = (done[d.doctor_id] ?? 0) > 0
    const fd = firstDay.get(d.doctor_id)
    if (had || fd !== undefined) covEnd++
    if (had || (fd !== undefined && fd <= cutoff)) cov15++
  }
  const required = Math.ceil(p.minCoverage * D)
  const pcfNum = docs.reduce((a, d) => a + Math.min((done[d.doctor_id] ?? 0) + (planned.get(d.doctor_id) ?? 0), d.freq), 0)
  const pcf = N > 0 ? pcfNum / N : 0
  const dayCounts = open.map((d, i) => ({ day: d.day, count: dayRows[i].length }))
  const counts = dayCounts.map((d) => d.count)
  const overDays = counts.filter((c) => c > T).length
  const used = dayRows.filter((l) => l.length > 0)
  const kms = used.map((l) => routeKm(l.map((x) => x.u.doc), p.detourFactor))
  const stays = used.map((l) => l[l.length - 1].time - l[0].time)
  const twoBrickDays: PlanSummary['twoBrickDays'] = []
  for (let di = 0; di < W; di++) {
    const bs = [...new Set(dayRows[di].map((x) => x.u.brick))]
    if (bs.length === 2) twoBrickDays.push({ day: open[di].day, a: bs[0], b: bs[1], why: plans[di].why ?? 'allowed' })
  }
  const noGps = docs.filter((d) => !hasGps(d)).map((d) => ({ id: d.doctor_id, name: d.name }))
  const noTime = docs.filter((d) => d.win_start == null).map((d) => ({ id: d.doctor_id, name: d.name }))
  const dropped: PlanSummary['dropped'] = []
  for (const d of docs) {
    const got = planned.get(d.doctor_id) ?? 0
    const miss = left(d) - got
    if (miss > 0) {
      const base = (done[d.doctor_id] ?? 0) + got
      dropped.push({ id: d.doctor_id, name: d.name, missing: miss, visits: Array.from({ length: miss }, (_, i) => `${base + i + 1}/${d.freq}`), reason: 'no room that respects the daily maximum, the brick rule and the minimum gap' })
    }
  }
  const missingVisits = dropped.reduce((a, d) => a + d.missing, 0)
  const missingFirst = dropped.filter((d) => (done[d.id] ?? 0) === 0 && !planned.has(d.id)).length
  const underMin = dayCounts.filter((d) => d.count > 0 && d.count < minDay)
  const emptyDays = dayCounts.filter((d) => d.count === 0).map((d) => d.day)
  const listTooBig = Nrem > T * W
  const covPct = D > 0 ? cov15 / D : 0
  const warnings: string[] = []
  if (W === 0) warnings.push('No open PM day in this month: nothing can be planned.')
  if (targetMissing) warnings.push(`The box has no PM call-rate target: ${p.fallbackTarget} a day was used.`)
  if (inputs.brickRepeats === undefined) warnings.push('Brick repeat history is not loaded (run 87_plan_brick_repeats.sql): the same brick is never repeated on consecutive days.')
  if (inputs.brickPairs === undefined) warnings.push('Brick history is not loaded (run 86_plan_brick_pairs.sql): every day has one brick only.')
  if (listTooBig) warnings.push(`The list (${Nrem} visits to plan) is bigger than the visit capacity. Capacity at target (Target x open days) = ${T} x ${W} = ${T * W}; Capacity at max (${p.maxDay} x open days) = ${p.maxDay} x ${W} = ${p.maxDay * W}. ${overDays} day${overDays === 1 ? '' : 's'} above the target, highest day ${Math.max(0, ...counts)}.`)
  if (covPct < p.minCoverage) warnings.push(`Coverage by day ${p.coverageDay} is ${cov15} of ${D} doctors; ${required} are required (${Math.round(p.minCoverage * 100)}%): short by ${required - cov15}.`)
  if (pcf < p.minPcf) warnings.push(`Expected PCF is ${(pcf * 100).toFixed(1)}%, below ${Math.round(p.minPcf * 100)}%: ${N - pcfNum} visits cannot be placed.`)
  if (underMin.length > 0) warnings.push(`${underMin.length} day${underMin.length === 1 ? ' is' : 's are'} under the minimum of ${minDay} visits: ${underMin.map((d) => `${d.day} (${d.count})`).join(', ')}.`)
  if (emptyDays.length > 0 && Nrem < minDay * W) warnings.push(`${emptyDays.length} open day${emptyDays.length === 1 ? ' has' : 's have'} no visits: the list has ${Nrem} visits to plan, ${minDay} a day needs ${minDay * W}.`)
  else if (emptyDays.length > 0) warnings.push(`${emptyDays.length} open day${emptyDays.length === 1 ? ' has' : 's have'} no visits (the brick and gap rules left no eligible visit): ${emptyDays.slice(0, 8).join(', ')}.`)
  if (counts.some((c) => c >= p.maxDay)) warnings.push(`${counts.filter((c) => c >= p.maxDay).length} day${counts.filter((c) => c >= p.maxDay).length === 1 ? ' is' : 's are'} at the maximum of ${p.maxDay}.`)
  if (waits.length > 0) warnings.push(`${waits.length} visit${waits.length === 1 ? '' : 's'} would wait more than ${p.maxWaitMin} minutes for the doctor's usual hours.`)
  const nBricks = new Set(docs.map((d) => brickOf(d))).size
  if (blockedDays.length > 0) warnings.push(`The no-repeat brick rule blocks finishing the visits: ${blockedDays.length} day${blockedDays.length === 1 ? '' : 's'} left empty because every brick with visits left was used the day before (the list has only ${nBricks} brick${nBricks === 1 ? '' : 's'}); ${missingVisits} visit${missingVisits === 1 ? '' : 's'} not placed.`)
  if (repeats.length > 0) warnings.push(`${repeats.length} brick repeat${repeats.length === 1 ? '' : 's'} on consecutive days, allowed only as a last resort: ${repeats.map((r) => `${r.day} ${r.why}`).join('; ')}.`)

  const summary: PlanSummary = {
    target: T, targetMissing, openDays: W, closedDays: inputs.days.length - W, capacityAtTarget: T * W, capacityAtMax: p.maxDay * W,
    targetVisits: N, plannedVisits: rows.length, doctors: D, listTooBig, overDays, peak: Math.max(0, ...counts), lowest: counts.length > 0 ? Math.min(...counts) : 0,
    daysAtMax: counts.filter((c) => c >= p.maxDay).length,
    cov15: { done: cov15, required, total: D, pct: covPct, ok: covPct >= p.minCoverage },
    covEnd: { done: covEnd, total: D, pct: D > 0 ? covEnd / D : 0 },
    pcf: { pct: pcf, ok: pcf >= p.minPcf },
    dayCounts, underMin, emptyDays, twoBrickDays, oneBrickDays: used.length - twoBrickDays.length, noGps, noTime, dropped,
    shortfall: { visits: missingVisits, firstVisits: missingFirst, covLossPts: D > 0 ? (missingFirst / D) * 100 : 0, pcfLossPts: N > 0 ? (missingVisits / N) * 100 : 0 },
    avgEstKmPerDay: kms.length > 0 ? kms.reduce((a, b) => a + b, 0) / kms.length : 0,
    avgStayMin: stays.length > 0 ? stays.reduce((a, b) => a + b, 0) / stays.length : 0,
    waitTotalMin: waitTotal, waits, repeats, repeatLimit: p.maxBrickRepeats, blockedDays,
    window: { start: fromMin(ws), end: fromMin(we), own: !!inputs.window },
    fromDay, warnings,
  }
  void unplaced
  const validation = validatePlan(inputs, rows, p, underMin.map((d) => d.day))
  return { rows, summary, params: p, validation }
}

/* ------------------------------------ backtest ------------------------------------ */
export interface Metrics { cov15: number; pcf: number; avgKm: number; daysOver: number; days: number; maxDay: number }
export interface Backtest { plan: Metrics; actual: Metrics; valid: boolean }

/** Plans the month with the days that were really closed (leaves and registered PM requests, as plan_inputs gives them) and compares with what he did. A day with no visits stays open. */
export function backtest(inputs: PlanInputs, actuals: ActualVisit[], over: Partial<PlanParams> = {}): Backtest {
  const p: PlanParams = { ...DEFAULT_PARAMS, ...over }
  const inList = new Set(inputs.doctors.map((d) => d.doctor_id))
  const act = actuals.filter((a) => inList.has(a.doctor_id))
  const res = generatePlan(inputs, over)
  const T = res.summary.target
  const byDoc = new Map(inputs.doctors.map((d) => [d.doctor_id, d]))
  const D = inputs.doctors.length
  const N = inputs.doctors.reduce((a, d) => a + d.freq, 0)
  const cutoff = `${inputs.month.slice(0, 8)}${String(p.coverageDay).padStart(2, '0')}`

  const metrics = (visits: { day: string; doctor_id: number; time: number }[]): Metrics => {
    const sorted = [...visits].sort((a, b) => a.day.localeCompare(b.day) || a.time - b.time)
    const first = new Map<number, string>()
    const cnt = new Map<number, number>()
    const perDay = new Map<string, number[]>()
    for (const v of sorted) {
      if (!first.has(v.doctor_id)) first.set(v.doctor_id, v.day)
      cnt.set(v.doctor_id, (cnt.get(v.doctor_id) ?? 0) + 1)
      const a = perDay.get(v.day) ?? []
      a.push(v.doctor_id)
      perDay.set(v.day, a)
    }
    const cov = [...first.values()].filter((d) => d <= cutoff).length
    const pcfNum = inputs.doctors.reduce((a, d) => a + Math.min(cnt.get(d.doctor_id) ?? 0, d.freq), 0)
    const kms = [...perDay.values()].map((ids) => routeKm(ids.map((id) => byDoc.get(id)), p.detourFactor))
    return {
      cov15: D > 0 ? cov / D : 0, pcf: N > 0 ? pcfNum / N : 0, avgKm: kms.length > 0 ? kms.reduce((a, b) => a + b, 0) / kms.length : 0,
      daysOver: [...perDay.values()].filter((ids) => ids.length > T).length, days: perDay.size, maxDay: Math.max(0, ...[...perDay.values()].map((ids) => ids.length)),
    }
  }
  return {
    plan: metrics(res.rows.map((r) => ({ day: r.day, doctor_id: r.doctor_id, time: toMin(r.planned_time) ?? 0 }))),
    actual: metrics(act.map((a) => ({ day: a.day, doctor_id: a.doctor_id, time: toMin(a.visit_time) ?? 0 }))),
    valid: res.validation.ok,
  }
}
