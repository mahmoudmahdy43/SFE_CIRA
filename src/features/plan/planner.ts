/**
 * Monthly visit planner (PM, one rep). Pure and deterministic: the same inputs always give the same plan (no random, no I/O).
 *
 * How a plan is built:
 *  1. Capacity per open day: the box's PM target. When the list is bigger than target x open days, the fewest possible days are
 *     opened above the target (11, then 12, then at most 13), early in the month and not back to back when possible.
 *  2. Geography: the doctors with GPS are put on one closed route (nearest-neighbour + 2-opt) and the route is cut at its longest
 *     edge. A day is a consecutive chunk of that route, so a day is one compact area and the next day is the neighbouring area.
 *     Doctors without GPS are slotted next to a doctor of the same brick (then division) and flagged.
 *  3. Rounds: visit 1 of every doctor first, then visit 2 of those with freq >= 2, and so on, each round walking the route in the
 *     same direction, so the visits of one doctor are spread evenly through the month and always in his own area.
 *  4. Doctors with a confirmed usual weekday (usual_isodow and >= 3 past visits) are pinned first to that weekday at his usual hour.
 *  5. Inside a day the times follow the pinned hours and the usual hours; the others take evenly spaced slots along the route.
 */

export interface PlanDoctor {
  doctor_id: number; name: string; account: string | null; account_type: string | null
  freq: number; brick: string | null; division: string | null
  lat: number | null; lng: number | null; pos_source: string | null
  usual_isodow: number | null; usual_hour: string | null; n_visits: number
}
export interface PlanDay { day: string; isodow: number; closed: boolean; reason: string | null }
export interface PlanInputs {
  rep: { id: number; name: string; code: string } | null
  month: string; list_month: string | null; box_id: number | null
  daily_target: number | null; days: PlanDay[]; doctors: PlanDoctor[]
}
export interface PlanParams {
  coverageDay: number; minCoverage: number; minPcf: number; maxDay: number; extraLevels: number[]
  visitMinutes: number; speedKmh: number; fixedMinVisits: number; minGapDays: number
  defaultStart: string; defaultEnd: string; fallbackTarget: number
}
export const DEFAULT_PARAMS: PlanParams = {
  coverageDay: 15, minCoverage: 0.9, minPcf: 0.9, maxDay: 13, extraLevels: [11, 12, 13],
  visitMinutes: 15, speedKmh: 25, fixedMinVisits: 3, minGapDays: 5, defaultStart: '14:00', defaultEnd: '20:00', fallbackTarget: 8,
}

export interface PlanRow { day: string; seq: number; doctor_id: number; planned_time: string | null; fixed: boolean; visit_no: number; note: string | null }
interface Named { id: number; name: string }
export interface PlanSummary {
  target: number; targetMissing: boolean
  openDays: number; closedDays: number; capacity: number; targetVisits: number; plannedVisits: number; doctors: number
  listTooBig: boolean; overDays: number; peak: number; windowMinutes: number
  cov15: { done: number; required: number; total: number; pct: number; ok: boolean }
  covEnd: { done: number; total: number; pct: number }
  pcf: { pct: number; ok: boolean }
  dayCounts: { day: string; count: number }[]
  noGps: Named[]; noTime: Named[]
  moved: { id: number; name: string; from: string; to: string }[]
  dropped: { id: number; name: string; missing: number; reason: string }[]
  timeOverflow: string[]; avgDailyKm: number
  warnings: string[]
}
export interface PlanResult { rows: PlanRow[]; summary: PlanSummary; params: PlanParams }

/* ------------------------------------ geometry and time ------------------------------------ */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export const toMin = (hhmm: string | null | undefined): number | null => {
  if (!hhmm) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
export const fromMin = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`

const hasGps = (d: PlanDoctor): d is PlanDoctor & { lat: number; lng: number } => d.lat !== null && d.lng !== null && Number.isFinite(d.lat) && Number.isFinite(d.lng)
const dom = (iso: string): number => Number(iso.slice(8, 10))

/** Km walked through the doctors in the given order (only doctors with GPS count). */
export function routeKm(points: ({ lat: number | null; lng: number | null } | undefined)[]): number {
  let km = 0
  let prev: { lat: number; lng: number } | null = null
  for (const p of points) {
    if (!p || p.lat === null || p.lng === null) continue
    const cur = { lat: p.lat, lng: p.lng }
    if (prev) km += haversineKm(prev, cur)
    prev = cur
  }
  return km
}

/* ------------------------------------ route ------------------------------------ */
/** Closed tour through the GPS doctors, cut at its longest edge so it reads as a path. Deterministic. */
function gpsRoute(docs: (PlanDoctor & { lat: number; lng: number })[]): (PlanDoctor & { lat: number; lng: number })[] {
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
  // 2-opt on the closed tour
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
  // cut at the longest edge
  let cut = 0
  let longest = -1
  for (let i = 0; i < n; i++) {
    const d = dist[t[i] * n + t[(i + 1) % n]]
    if (d > longest + 1e-12) { longest = d; cut = i }
  }
  const out: (PlanDoctor & { lat: number; lng: number })[] = []
  for (let k = 1; k <= n; k++) out.push(docs[t[(cut + k) % n]])
  return out
}

/** The whole route: GPS doctors on the tour, the others next to a doctor of the same brick (then division), else at the end. */
function fullRoute(doctors: PlanDoctor[]): PlanDoctor[] {
  const route: PlanDoctor[] = gpsRoute(doctors.filter(hasGps))
  const rest = doctors.filter((d) => !hasGps(d)).sort((a, b) => (a.brick ?? '').localeCompare(b.brick ?? '') || a.name.localeCompare(b.name) || a.doctor_id - b.doctor_id)
  for (const d of rest) {
    let at = d.brick ? route.findIndex((r) => r.brick === d.brick) : -1
    if (at < 0 && d.division) at = route.findIndex((r) => r.division === d.division)
    if (at < 0) route.push(d)
    else route.splice(at + 1, 0, d)
  }
  return route
}

/* ------------------------------------ capacity ------------------------------------ */
interface OpenDay { day: string; isodow: number; early: boolean }

interface Caps { caps: number[]; over: number; peak: number }

function computeCaps(open: OpenDay[], N: number, D: number, T: number, maxCap: number, p: PlanParams): Caps {
  const W = open.length
  if (W === 0) return { caps: [], over: 0, peak: T }
  if (N > T * W) {
    const extra = N - T * W
    const levels = p.extraLevels.filter((l) => l > T && l <= maxCap)
    const caps = open.map(() => T)
    if (levels.length === 0) return { caps, over: 0, peak: T }
    let level = levels[levels.length - 1]
    for (const l of levels) { if (Math.ceil(extra / (l - T)) <= Math.ceil(W / 2)) { level = l; break } }
    const m = Math.min(W, Math.ceil(extra / (level - T)))
    // positions: every other day from the start of the month first, then the days in between
    const order = [...open.keys()].filter((i) => i % 2 === 0).concat([...open.keys()].filter((i) => i % 2 === 1))
    const chosen = order.slice(0, m).sort((a, b) => a - b)
    let left = extra
    for (const i of chosen) { const add = Math.min(level - T, left); caps[i] = T + add; left -= add }
    return { caps, over: chosen.length, peak: Math.max(T, ...caps) }
  }
  const nEarly = open.filter((d) => d.early).length
  const nLate = W - nEarly
  const needEarly = Math.ceil(p.minCoverage * D)
  const evenBase = Math.floor(N / W)
  const ce = Math.min(T, Math.max(evenBase, nEarly > 0 ? Math.ceil(needEarly / nEarly) : 0))
  const lateNeed = Math.max(0, N - ce * nEarly)
  const lc = nLate > 0 ? Math.min(T, Math.ceil(lateNeed / nLate)) : 0
  const caps = open.map((d) => (d.early ? ce : lc))
  let total = caps.reduce((a, b) => a + b, 0)
  while (total < N) {
    let at = -1
    for (let i = 0; i < W; i++) if (caps[i] < T && (at < 0 || caps[i] < caps[at])) at = i
    if (at < 0) break
    caps[at]++; total++
  }
  while (total > N) {
    let at = -1
    for (let i = W - 1; i >= 0; i--) if (caps[i] > 0 && (at < 0 || caps[i] > caps[at])) at = i
    if (at < 0) break
    caps[at]--; total--
  }
  return { caps, over: 0, peak: Math.max(0, ...caps) }
}

/* ------------------------------------ the planner ------------------------------------ */
interface Unit { doc: PlanDoctor; flexRound: number }

export function generatePlan(inputs: PlanInputs, over: Partial<PlanParams> = {}): PlanResult {
  const p: PlanParams = { ...DEFAULT_PARAMS, ...over }
  const T0 = inputs.daily_target
  const targetMissing = T0 === null || !(T0 > 0)
  const T = targetMissing ? p.fallbackTarget : Math.round(T0 as number)
  const docs = inputs.doctors.filter((d) => d.freq > 0)
  const open: OpenDay[] = inputs.days.filter((d) => !d.closed).map((d) => ({ day: d.day, isodow: d.isodow, early: dom(d.day) <= p.coverageDay }))
  const W = open.length
  const dayIdx = new Map(open.map((d, i) => [d.day, i]))
  const D = docs.length
  const N = docs.reduce((a, d) => a + d.freq, 0)

  // time window of the PM from the doctors' usual hours
  const hours = docs.map((d) => toMin(d.usual_hour)).filter((h): h is number => h !== null)
  const wStart = hours.length > 0 ? Math.max(12 * 60, Math.min(...hours)) : (toMin(p.defaultStart) as number)
  const wEnd = hours.length > 0 ? Math.min(23 * 60, Math.max(...hours) + 60) : (toMin(p.defaultEnd) as number)
  const windowMin = Math.max(60, wEnd - wStart)
  // average hop between neighbouring doctors -> time a visit really takes
  const geo = docs.filter(hasGps)
  let hopKm = 0.5
  if (geo.length > 1) {
    const nn = geo.map((a) => Math.min(...geo.filter((b) => b !== a).map((b) => haversineKm(a, b)))).sort((a, b) => a - b)
    hopKm = nn[nn.length >> 1] * 1.3
  }
  const perVisitMin = p.visitMinutes + (hopKm / p.speedKmh) * 60
  const timeCap = Math.max(1, Math.floor(windowMin / perVisitMin))
  const maxCap = Math.max(T, Math.min(p.maxDay, timeCap))

  const { caps, peak } = computeCaps(open, N, D, T, maxCap, p)
  const route = fullRoute(docs)
  const routePos = new Map(route.map((d, i) => [d.doctor_id, i]))

  /* ---- 1. pinned doctors ---- */
  interface Placed { doc: PlanDoctor; di: number; fixed: boolean; note: string | null; time: number | null; round: number }
  const dayItems: Placed[][] = open.map(() => [])
  const visitDays = new Map<number, number[]>()
  const addVisit = (id: number, di: number) => { const a = visitDays.get(id) ?? []; a.push(di); visitDays.set(id, a) }
  const flexLeft = new Map<number, number>() // visits of a doctor that are not pinned
  const moved: PlanSummary['moved'] = []
  const allDays = inputs.days
  for (const d of [...docs].sort((a, b) => a.doctor_id - b.doctor_id)) {
    flexLeft.set(d.doctor_id, d.freq)
    if (d.usual_isodow === null || d.n_visits < p.fixedMinVisits) continue
    const occ = allDays.filter((x) => x.isodow === d.usual_isodow)
    const openOcc = occ.filter((x) => !x.closed)
    if (occ.length === 0 || openOcc.length === 0) continue
    const k = Math.min(d.freq, occ.length)
    const step = Math.max(1, Math.floor(occ.length / d.freq))
    const taken = new Set<number>()
    let nFixed = 0
    for (let v = 0; v < k; v++) {
      let o = Math.min(v * step, occ.length - 1)
      let moveNote: string | null = null
      const wanted = occ[o].day
      const free = (i: number) => !occ[i].closed && !taken.has(i)
      let pick = -1
      for (let i = o; i < occ.length; i++) if (free(i)) { pick = i; break }
      if (pick < 0) for (let i = o - 1; i >= 0; i--) if (free(i)) { pick = i; break }
      if (pick < 0) break
      o = pick
      taken.add(o)
      if (occ[o].day !== wanted) { moveNote = `usual day ${wanted} is closed`; moved.push({ id: d.doctor_id, name: d.name, from: wanted, to: occ[o].day }) }
      const di = dayIdx.get(occ[o].day)
      if (di === undefined) continue
      dayItems[di].push({ doc: d, di, fixed: true, note: moveNote, time: toMin(d.usual_hour), round: v + 1 })
      addVisit(d.doctor_id, di)
      nFixed++
    }
    flexLeft.set(d.doctor_id, d.freq - nFixed)
  }
  for (let i = 0; i < open.length; i++) if (dayItems[i].length > caps[i]) caps[i] = Math.min(Math.max(caps[i], dayItems[i].length), Math.max(p.maxDay, dayItems[i].length))

  /* ---- 2. rounds over the route ---- */
  const maxFreq = docs.reduce((a, d) => Math.max(a, d.freq), 0)
  const pending: Unit[] = []
  for (let r = 1; r <= maxFreq; r++) for (const d of route) { if ((flexLeft.get(d.doctor_id) ?? 0) >= r) pending.push({ doc: d, flexRound: r }) }

  const spaced = (id: number, di: number): boolean => (visitDays.get(id) ?? []).every((v) => Math.abs(v - di) >= p.minGapDays)
  const onDay = (id: number, di: number): boolean => dayItems[di].some((x) => x.doc.doctor_id === id)
  for (let di = 0; di < W && pending.length > 0; di++) {
    const need = caps[di] - dayItems[di].length
    if (need <= 0) continue
    const take: number[] = []
    const seen = new Set<number>()
    const scan = (limit: number, strict: boolean) => {
      seen.clear()
      for (let i = 0; i < pending.length && i < limit && take.length < need; i++) {
        const id = pending[i].doc.doctor_id
        if (seen.has(id)) continue
        seen.add(id)
        if (take.includes(i)) continue
        if (onDay(id, di) || take.some((t) => pending[t].doc.doctor_id === id)) continue
        if (strict && !spaced(id, di)) continue
        take.push(i)
      }
    }
    scan(need * 3 + 6, true)
    if (take.length < need) { const had = [...take]; take.length = 0; scan(pending.length, false); for (const t of had) if (!take.includes(t)) take.push(t) ; take.length = Math.min(take.length, need) }
    for (const i of [...take].sort((a, b) => a - b)) {
      const u = pending[i]
      dayItems[di].push({ doc: u.doc, di, fixed: false, note: null, time: null, round: u.flexRound })
      addVisit(u.doc.doctor_id, di)
    }
    const drop = new Set(take)
    for (let i = pending.length - 1; i >= 0; i--) if (drop.has(i)) pending.splice(i, 1)
  }

  /* ---- 3. order and times inside each day ---- */
  const rows: PlanRow[] = []
  const timeOverflow: string[] = []
  const slotStep = (n: number): number => (n <= 1 ? 0 : Math.max(p.visitMinutes, Math.min(60, Math.floor((windowMin - p.visitMinutes) / (n - 1) / 5) * 5)))
  const dayOrder: Placed[][] = []
  for (let di = 0; di < W; di++) {
    const items = dayItems[di]
    const fixedItems = items.filter((x) => x.fixed && x.time !== null).sort((a, b) => (a.time as number) - (b.time as number) || a.doc.doctor_id - b.doc.doctor_id)
    const flex = items.filter((x) => !(x.fixed && x.time !== null)).sort((a, b) => (routePos.get(a.doc.doctor_id) ?? 0) - (routePos.get(b.doc.doctor_id) ?? 0))
    const step = slotStep(items.length)
    const slots: number[] = []
    for (let k = 0; slots.length < flex.length && k < 80; k++) {
      const t = wStart + k * Math.max(step, 5)
      if (fixedItems.some((f) => Math.abs((f.time as number) - t) < p.visitMinutes)) continue
      slots.push(t)
    }
    // direction of the route that matches the usual hours best
    const cost = (list: Placed[]) => list.reduce((a, x, i) => { const h = toMin(x.doc.usual_hour); return h === null ? a : a + Math.abs(h - slots[i]) }, 0)
    const rev = [...flex].reverse()
    const useList = flex.length > 1 && cost(rev) < cost(flex) ? rev : flex
    useList.forEach((x, i) => { x.time = slots[i] ?? wStart })
    const all = [...fixedItems, ...useList].sort((a, b) => (a.time as number) - (b.time as number) || (routePos.get(a.doc.doctor_id) ?? 0) - (routePos.get(b.doc.doctor_id) ?? 0))
    const last = all.length > 0 ? (all[all.length - 1].time as number) : 0
    if (all.length > 0 && last + p.visitMinutes > wEnd + 30) timeOverflow.push(open[di].day)
    dayOrder.push(all)
  }

  // visit numbers in time order
  const counter = new Map<number, number>()
  for (let di = 0; di < W; di++) {
    dayOrder[di].forEach((x, i) => {
      const n = (counter.get(x.doc.doctor_id) ?? 0) + 1
      counter.set(x.doc.doctor_id, n)
      rows.push({ day: open[di].day, seq: i + 1, doctor_id: x.doc.doctor_id, planned_time: fromMin(x.time as number), fixed: x.fixed, visit_no: n, note: x.note })
    })
  }

  /* ---- 4. summary ---- */
  const planned = new Map<number, number>()
  const firstDay = new Map<number, string>()
  for (const r of rows) { planned.set(r.doctor_id, (planned.get(r.doctor_id) ?? 0) + 1); if (!firstDay.has(r.doctor_id)) firstDay.set(r.doctor_id, r.day) }
  const cutoff = `${inputs.month.slice(0, 8)}${String(p.coverageDay).padStart(2, '0')}`
  const cov15 = [...firstDay.values()].filter((d) => d <= cutoff).length
  const required = Math.ceil(p.minCoverage * D)
  const covEnd = firstDay.size
  const pcfNum = docs.reduce((a, d) => a + Math.min(planned.get(d.doctor_id) ?? 0, d.freq), 0)
  const pcf = N > 0 ? pcfNum / N : 0
  const dayCounts = open.map((d, i) => ({ day: d.day, count: dayOrder[i].length }))
  const overDays = dayCounts.filter((d) => d.count > T).length
  const dailyKm = open.map((_, i) => routeKm(dayOrder[i].map((x) => x.doc))).filter((_, i) => dayOrder[i].length > 0)
  const noGps = docs.filter((d) => !hasGps(d)).map((d) => ({ id: d.doctor_id, name: d.name }))
  const noTime = docs.filter((d) => toMin(d.usual_hour) === null).map((d) => ({ id: d.doctor_id, name: d.name }))
  const dropped: PlanSummary['dropped'] = []
  for (const d of docs) {
    const miss = d.freq - (planned.get(d.doctor_id) ?? 0)
    if (miss > 0) dropped.push({ id: d.doctor_id, name: d.name, missing: miss, reason: (planned.get(d.doctor_id) ?? 0) === 0 ? 'no capacity left for the first visit' : 'no capacity left for the later visits' })
  }
  const listTooBig = N > T * W
  const covPct = D > 0 ? cov15 / D : 0
  const warnings: string[] = []
  if (W === 0) warnings.push('No open PM day in this month: nothing can be planned.')
  if (targetMissing) warnings.push(`The box has no PM call-rate target: ${p.fallbackTarget} a day was used.`)
  if (listTooBig) warnings.push(`The list (${N} visits) is bigger than the capacity (${T} x ${W} = ${T * W}): ${overDays} day${overDays === 1 ? '' : 's'} above the target, highest day ${peak}.`)
  if (covPct < p.minCoverage) warnings.push(`Coverage by day ${p.coverageDay} is ${cov15} of ${D} doctors; ${required} are required (${Math.round(p.minCoverage * 100)}%): short by ${required - cov15}.`)
  if (pcf < p.minPcf) warnings.push(`Expected PCF is ${(pcf * 100).toFixed(1)}%, below ${Math.round(p.minPcf * 100)}%: ${N - pcfNum} visits cannot be placed.`)
  if (timeOverflow.length > 0) warnings.push(`${timeOverflow.length} day${timeOverflow.length === 1 ? '' : 's'} may not fit the usual PM hours (${fromMin(wStart)}-${fromMin(wEnd)}).`)

  const summary: PlanSummary = {
    target: T, targetMissing, openDays: W, closedDays: inputs.days.length - W, capacity: caps.reduce((a, b) => a + b, 0), targetVisits: N, plannedVisits: rows.length, doctors: D,
    listTooBig, overDays, peak: Math.max(peak, ...dayCounts.map((d) => d.count), 0), windowMinutes: windowMin,
    cov15: { done: cov15, required, total: D, pct: covPct, ok: covPct >= p.minCoverage },
    covEnd: { done: covEnd, total: D, pct: D > 0 ? covEnd / D : 0 },
    pcf: { pct: pcf, ok: pcf >= p.minPcf },
    dayCounts, noGps, noTime, moved, dropped, timeOverflow,
    avgDailyKm: dailyKm.length > 0 ? dailyKm.reduce((a, b) => a + b, 0) / dailyKm.length : 0,
    warnings,
  }
  return { rows, summary, params: p }
}

/* ------------------------------------ backtest ------------------------------------ */
export interface ActualVisit { day: string; doctor_id: number; visit_time: string | null }
export interface Metrics { cov15: number; pcf: number; avgKm: number; daysOver: number; days: number }
export interface Backtest { plan: Metrics; actual: Metrics; closedFromActuals: number }

/** Plans the month with the days the rep really worked (open days with no PM visit count as closed) and compares with what he did. */
export function backtest(inputs: PlanInputs, actuals: ActualVisit[], over: Partial<PlanParams> = {}): Backtest {
  const p: PlanParams = { ...DEFAULT_PARAMS, ...over }
  const inList = new Set(inputs.doctors.map((d) => d.doctor_id))
  const act = actuals.filter((a) => inList.has(a.doctor_id))
  const worked = new Set(actuals.map((a) => a.day))
  let extraClosed = 0
  const days = inputs.days.map((d) => { if (!d.closed && !worked.has(d.day)) { extraClosed++; return { ...d, closed: true, reason: 'no visits' } } return d })
  const res = generatePlan({ ...inputs, days }, over)
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
    const kms = [...perDay.values()].map((ids) => routeKm(ids.map((id) => byDoc.get(id))))
    return {
      cov15: D > 0 ? cov / D : 0, pcf: N > 0 ? pcfNum / N : 0, avgKm: kms.length > 0 ? kms.reduce((a, b) => a + b, 0) / kms.length : 0,
      daysOver: [...perDay.values()].filter((ids) => ids.length > T).length, days: perDay.size,
    }
  }
  return {
    plan: metrics(res.rows.map((r) => ({ day: r.day, doctor_id: r.doctor_id, time: toMin(r.planned_time) ?? 0 }))),
    actual: metrics(act.map((a) => ({ day: a.day, doctor_id: a.doctor_id, time: toMin(a.visit_time) ?? 0 }))),
    closedFromActuals: extraClosed,
  }
}
