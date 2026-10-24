/**
 * Monthly visit planner (PM, one rep). Pure and deterministic: the same inputs always give the same plan (no random, no I/O).
 *
 * Hard rules: every open PM day has 6 to 12 visits (12 is never exceeded), a "confirmed" doctor is visited only on his weekday and
 * within +-60 minutes of his usual time, nobody is planned outside the rep's own PM window, and no two visits share a minute.
 *
 * How a plan is built:
 *  1. Capacity per open day: the box's PM target, never below 6. A list too small for 6 a day is merged into fewer days; a list bigger
 *     than target x open days opens the fewest possible days above the target (11, then 12), early in the month and not back to back.
 *  2. Confirmed doctors (>= 3 visits, >= 60% on one weekday) are pinned first, spread over the dates of their weekday, earliest first.
 *  3. The other doctors with GPS are put on one closed route (nearest-neighbour + 2-opt) cut at its longest edge; a day is a consecutive
 *     chunk of that route, so a day is one compact area and the next day is the neighbouring area. Doctors without GPS are slotted next
 *     to a doctor of the same brick (then division). Visit 1 of everyone comes first, then visit 2, and so on, with a minimum gap.
 *  4. A repair pass lifts days under 6 by moving the nearest flexible visits from fuller days, or merges the day into others.
 *  5. Times: 15-25 minutes apart (visit + walk), whole minutes, inside the PM window; confirmed doctors near their usual time.
 */

export interface PlanDoctor {
  doctor_id: number; name: string; account: string | null; account_type: string | null
  freq: number; brick: string | null; division: string | null
  lat: number | null; lng: number | null; pos_source: string | null
  usual_isodow: number | null; usual_hour: string | null; n_visits: number
  /** Share (0-1) of his visits that fall on usual_isodow; null = unknown (then he is not "confirmed"). */
  usual_share?: number | null
}
export interface PlanDay { day: string; isodow: number; closed: boolean; reason: string | null }
export interface PlanInputs {
  rep: { id: number; name: string; code: string } | null
  month: string; list_month: string | null; box_id: number | null
  daily_target: number | null; days: PlanDay[]; doctors: PlanDoctor[]
  /** The rep's own PM window in minutes (earliest / latest visit start, 5th-95th percentile of his last 3 months); absent = default window. */
  window?: { start: number; end: number } | null
}

/** Hard cap: no day of any plan has more visits than this, whatever the constraint. */
export const MAX_PER_DAY = 12

export interface PlanParams {
  coverageDay: number; minCoverage: number; minPcf: number; maxDay: number; minDay: number; extraLevels: number[]
  visitMinutes: number; speedKmh: number; fixedMinVisits: number; fixedShare: number; fixedToleranceMin: number; minGapDays: number
  defaultStart: string; defaultEnd: string; fallbackTarget: number; minHistory: number
}
export const DEFAULT_PARAMS: PlanParams = {
  coverageDay: 15, minCoverage: 0.9, minPcf: 0.9, maxDay: MAX_PER_DAY, minDay: 6, extraLevels: [11, 12],
  visitMinutes: 15, speedKmh: 25, fixedMinVisits: 3, fixedShare: 0.6, fixedToleranceMin: 60, minGapDays: 5,
  defaultStart: '14:00', defaultEnd: '22:00', fallbackTarget: 8, minHistory: 30,
}

export interface PlanRow { day: string; seq: number; doctor_id: number; planned_time: string | null; fixed: boolean; visit_no: number; note: string | null }
interface Named { id: number; name: string }
export interface PlanSummary {
  target: number; targetMissing: boolean
  openDays: number; closedDays: number
  /** Target x open days, and 12 x open days. */
  capacityAtTarget: number; capacityAtMax: number
  targetVisits: number; plannedVisits: number; doctors: number
  listTooBig: boolean; overDays: number; peak: number; lowest: number; daysAtMax: number
  cov15: { done: number; required: number; total: number; pct: number; ok: boolean }
  covEnd: { done: number; total: number; pct: number }
  pcf: { pct: number; ok: boolean }
  dayCounts: { day: string; count: number }[]
  underMin: { day: string; count: number }[]
  emptyDays: string[]
  noGps: Named[]; noTime: Named[]
  moved: { id: number; name: string; from: string; to: string; reason: string }[]
  dropped: { id: number; name: string; missing: number; visits: string[]; reason: string }[]
  shortfall: { visits: number; firstVisits: number; covLossPts: number; pcfLossPts: number }
  avgDailyKm: number; avgBricksPerDay: number; maxBricksPerDay: number
  window: { start: string; end: string; own: boolean }
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

type Gps = { lat: number; lng: number }
const hasGps = (d: PlanDoctor): d is PlanDoctor & Gps => d.lat !== null && d.lng !== null && Number.isFinite(d.lat) && Number.isFinite(d.lng)
const dom = (iso: string): number => Number(iso.slice(8, 10))
const isoDow = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay() || 7
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Km walked through the doctors in the given order (only doctors with GPS count). */
export function routeKm(points: ({ lat: number | null; lng: number | null } | undefined)[]): number {
  let km = 0
  let prev: Gps | null = null
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
function gpsRoute(docs: (PlanDoctor & Gps)[]): (PlanDoctor & Gps)[] {
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
  const out: (PlanDoctor & Gps)[] = []
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
interface Caps { caps: number[]; peak: number }

const evenPick = (idx: number[], a: number): number[] => Array.from({ length: a }, (_, k) => idx[Math.min(idx.length - 1, Math.floor(((k + 0.5) * idx.length) / a))])

/** Visits wanted per open day. Active days hold minDay..hard visits; days left at 0 were merged into the others. */
function computeCaps(open: OpenDay[], N: number, D: number, T: number, hard: number, minDay: number, p: PlanParams): Caps {
  const W = open.length
  if (W === 0) return { caps: [], peak: 0 }
  const Tc = Math.min(hard, Math.max(minDay, T))
  const early = [...open.keys()].filter((i) => open[i].early)
  const late = [...open.keys()].filter((i) => !open[i].early)
  if (N < minDay * W) {
    // the list cannot give 6 visits to every day: fewer days, spread over the month, the first ones early enough for the coverage target
    const A = Math.max(1, Math.floor(N / minDay))
    const per = N / A
    let aE = Math.min(A, early.length, Math.max(Math.ceil(Math.ceil(p.minCoverage * D) / per), Math.round((A * early.length) / W)))
    let aL = A - aE
    if (aL > late.length) { aL = late.length; aE = A - aL }
    const active = [...evenPick(early, aE), ...evenPick(late, aL)].sort((a, b) => a - b)
    const caps = open.map(() => 0)
    active.forEach((di, k) => { caps[di] = Math.min(hard, Math.floor(N / A) + (k < N % A ? 1 : 0)) })
    return { caps, peak: Math.max(0, ...caps) }
  }
  if (N > Tc * W) {
    const extra = N - Tc * W
    const levels = p.extraLevels.filter((l) => l > Tc && l <= hard)
    const caps = open.map(() => Tc)
    if (levels.length === 0) return { caps, peak: Tc }
    let level = levels[levels.length - 1]
    for (const l of levels) { if (Math.ceil(extra / (l - Tc)) <= Math.ceil(W / 2)) { level = l; break } }
    const m = Math.min(W, Math.ceil(extra / (level - Tc)))
    // every other day from the start of the month first, then the days in between
    const order = [...open.keys()].filter((i) => i % 2 === 0).concat([...open.keys()].filter((i) => i % 2 === 1))
    const chosen = order.slice(0, m).sort((a, b) => a - b)
    let left = extra
    for (const i of chosen) { const add = Math.min(level - Tc, left); caps[i] = Tc + add; left -= add }
    return { caps, peak: Math.max(...caps) }
  }
  const needEarly = Math.ceil(p.minCoverage * D)
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
  return { caps, peak: Math.max(0, ...caps) }
}

/* ------------------------------------ times ------------------------------------ */
interface Job { u: number; a: number; b: number }

/**
 * Times for jobs sorted by their usual time u: each inside [a, b], at least `step` minutes apart, as close to u as possible.
 * Forward pass pushes later when two collide, backward pass pulls back when the window end is hit. null = no such schedule.
 */
function scheduleWindows(jobs: Job[], step: number): number[] | null {
  const n = jobs.length
  if (n === 0) return []
  const f: number[] = []
  for (let i = 0; i < n; i++) f.push(Math.max(clamp(jobs[i].u, jobs[i].a, jobs[i].b), i > 0 ? f[i - 1] + step : -Infinity))
  const g = [...f]
  g[n - 1] = Math.min(f[n - 1], jobs[n - 1].b)
  for (let i = n - 2; i >= 0; i--) g[i] = Math.min(f[i], g[i + 1] - step, jobs[i].b)
  for (let i = 0; i < n; i++) {
    if (g[i] < jobs[i].a) return null
    if (i > 0 && g[i] < g[i - 1] + step) return null
  }
  return g
}

/** Free start times from `start` to `end`, `step` apart, skipping the ones too close to a fixed time. */
function slotsFrom(start: number, end: number, step: number, fixedTimes: number[]): number[] {
  const out: number[] = []
  let t = start
  while (t <= end) {
    const clash = fixedTimes.find((f) => Math.abs(f - t) < step)
    if (clash !== undefined) { t = Math.max(t + 1, clash + step); continue }
    out.push(t)
    t += step
  }
  return out
}

/** Doctors' usual weekday / hour / share from the rep's own visit history (visits of the 3 months before the plan month). */
export function usualFromHistory(history: ActualVisit[], doctors: PlanDoctor[]): PlanDoctor[] {
  const by = new Map<number, ActualVisit[]>()
  for (const v of history) { const a = by.get(v.doctor_id) ?? []; a.push(v); by.set(v.doctor_id, a) }
  return doctors.map((d) => {
    const list = by.get(d.doctor_id) ?? []
    if (list.length < 3) return { ...d, usual_share: null, n_visits: Math.max(d.n_visits, list.length) }
    const dows = new Map<number, number>()
    for (const v of list) { const k = isoDow(v.day); dows.set(k, (dows.get(k) ?? 0) + 1) }
    const [dow, cnt] = [...dows].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
    const mins = list.map((v) => toMin(v.visit_time)).filter((m): m is number => m !== null)
    let hour: string | null = null
    if (mins.length > 0) {
      const hrs = new Map<number, number>()
      for (const m of mins) { const h = Math.floor(m / 60); hrs.set(h, (hrs.get(h) ?? 0) + 1) }
      const top = [...hrs].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
      const inHour = mins.filter((m) => Math.floor(m / 60) === top).sort((a, b) => a - b)
      hour = fromMin(inHour[inHour.length >> 1])
    }
    return { ...d, usual_isodow: dow, usual_hour: hour, n_visits: list.length, usual_share: cnt / list.length }
  })
}

/* ------------------------------------ the planner ------------------------------------ */
interface Unit { doc: PlanDoctor; flexRound: number }
interface Placed { doc: PlanDoctor; fixed: boolean; note: string | null; time: number | null }

export function generatePlan(inputs: PlanInputs, over: Partial<PlanParams> = {}): PlanResult {
  const p: PlanParams = { ...DEFAULT_PARAMS, ...over }
  const T0 = inputs.daily_target
  const targetMissing = T0 === null || !(T0 > 0)
  const T = targetMissing ? p.fallbackTarget : Math.round(T0 as number)
  const docs = inputs.doctors.filter((d) => d.freq > 0)
  const open: OpenDay[] = inputs.days.filter((d) => !d.closed).map((d) => ({ day: d.day, isodow: d.isodow, early: dom(d.day) <= p.coverageDay }))
  const W = open.length
  const D = docs.length
  const N = docs.reduce((a, d) => a + d.freq, 0)

  // PM window (visit start times): the rep's own history, else the default
  const ws = inputs.window ? inputs.window.start : (toMin(p.defaultStart) as number)
  const we = inputs.window ? Math.max(inputs.window.end, ws) : (toMin(p.defaultEnd) as number)
  // minutes between two visits: a visit plus the walk to the next doctor, 15 to 25
  const geo = docs.filter(hasGps)
  let hopKm = 0.5
  if (geo.length > 1) {
    const nn = geo.map((a) => Math.min(...geo.filter((b) => b !== a).map((b) => haversineKm(a, b)))).sort((a, b) => a - b)
    hopKm = nn[nn.length >> 1] * 1.3
  }
  const step = clamp(Math.ceil(p.visitMinutes + (hopKm / p.speedKmh) * 60), 15, 25)
  const hard = Math.max(1, Math.min(p.maxDay, Math.floor((we - ws) / step) + 1))
  const minDay = Math.min(p.minDay, hard)

  const { caps } = computeCaps(open, N, D, T, hard, minDay, p)
  const route = fullRoute(docs)
  const routePos = new Map(route.map((d, i) => [d.doctor_id, i]))

  const dayItems: Placed[][] = open.map(() => [])
  const visitDays = new Map<number, number[]>()
  const addVisit = (id: number, di: number) => { const a = visitDays.get(id) ?? []; a.push(di); visitDays.set(id, a) }
  const onDayId = (id: number, di: number): boolean => dayItems[di].some((x) => x.doc.doctor_id === id)

  /* ---- 1. confirmed doctors: only on their weekday, within +-60 min of their usual time ---- */
  const usualMin = (d: PlanDoctor): number | null => toMin(d.usual_hour)
  const confirmed = (d: PlanDoctor): boolean =>
    d.usual_isodow !== null && d.n_visits >= p.fixedMinVisits && (d.usual_share ?? 0) >= p.fixedShare && usualMin(d) !== null &&
    Math.max(ws, (usualMin(d) as number) - p.fixedToleranceMin) <= Math.min(we, (usualMin(d) as number) + p.fixedToleranceMin)
  const job = (d: PlanDoctor): Job => { const u = usualMin(d) as number; return { u, a: Math.max(ws, u - p.fixedToleranceMin), b: Math.min(we, u + p.fixedToleranceMin) } }
  const fixedSchedule = (items: Placed[]): number[] | null => {
    const sorted = [...items].sort((a, b) => (usualMin(a.doc) as number) - (usualMin(b.doc) as number) || a.doc.doctor_id - b.doc.doctor_id)
    return scheduleWindows(sorted.map((x) => job(x.doc)), step)
  }
  const flexLeft = new Map<number, number>()
  const moved: PlanSummary['moved'] = []
  for (const d of [...docs].sort((a, b) => a.doctor_id - b.doctor_id)) {
    flexLeft.set(d.doctor_id, d.freq)
    if (!confirmed(d)) continue
    flexLeft.set(d.doctor_id, 0) // a confirmed doctor is never given a free day
    const occAll = inputs.days.filter((x) => x.isodow === d.usual_isodow)
    const occ = open.map((x, i) => ({ ...x, i })).filter((x) => x.isodow === d.usual_isodow)
    let prev = -1
    for (let v = 0; v < d.freq; v++) {
      const target = v === 0 ? 0 : Math.max(prev + 1, Math.round((v * occ.length) / d.freq))
      let pick = -1
      const feasible = (k: number): boolean => {
        const di = occ[k].i
        if (dayItems[di].length >= hard || onDayId(d.doctor_id, di)) return false
        return fixedSchedule([...dayItems[di].filter((x) => x.fixed), { doc: d, fixed: true, note: null, time: null }]) !== null
      }
      for (let k = Math.max(target, prev + 1); k < occ.length; k++) if (feasible(k)) { pick = k; break }
      if (pick < 0) for (let k = prev + 1; k < Math.min(target, occ.length); k++) if (feasible(k)) { pick = k; break }
      if (pick < 0) break // no date of his weekday has room: this visit is not placed (shortfall)
      prev = pick
      const di = occ[pick].i
      let note: string | null = null
      if (v === 0 && occAll.length > 0 && occAll[0].day !== occ[pick].day) {
        note = occAll[0].closed ? `usual day ${occAll[0].day} is closed` : 'Moved because the day is full'
        moved.push({ id: d.doctor_id, name: d.name, from: occAll[0].day, to: occ[pick].day, reason: occAll[0].closed ? 'closed' : 'full' })
      }
      dayItems[di].push({ doc: d, fixed: true, note, time: null })
      addVisit(d.doctor_id, di)
    }
  }
  const fixedTimes = open.map((_, i) => fixedSchedule(dayItems[i].filter((x) => x.fixed)) ?? [])
  for (let i = 0; i < open.length; i++) if (dayItems[i].length > 0) caps[i] = clamp(Math.max(caps[i], dayItems[i].length), 0, hard)
  /** Most visits a day can still hold: the cap, the visits already pinned and the free minutes left in the window. */
  const roomCap = (di: number): number => {
    const nFix = dayItems[di].filter((x) => x.fixed).length
    return Math.min(hard, nFix + slotsFrom(ws, we, step, fixedTimes[di]).length)
  }

  /* ---- 2. the other visits: rounds over the route, a day is a chunk of the route ---- */
  const maxFreq = docs.reduce((a, d) => Math.max(a, d.freq), 0)
  const pending: Unit[] = []
  for (let r = 1; r <= maxFreq; r++) for (const d of route) { if ((flexLeft.get(d.doctor_id) ?? 0) >= r) pending.push({ doc: d, flexRound: r }) }

  const spaced = (id: number, di: number, except = -1): boolean => (visitDays.get(id) ?? []).every((v) => v === except || Math.abs(v - di) >= p.minGapDays)
  for (let di = 0; di < W && pending.length > 0; di++) {
    const need = Math.min(caps[di], roomCap(di)) - dayItems[di].length
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
        if (onDayId(id, di) || take.some((t) => pending[t].doc.doctor_id === id)) continue
        if (strict && !spaced(id, di)) continue
        take.push(i)
      }
    }
    scan(need * 3 + 6, true)
    if (take.length < need) { const had = [...take]; take.length = 0; scan(pending.length, false); for (const t of had) if (!take.includes(t)) take.push(t); take.length = Math.min(take.length, need) }
    for (const i of [...take].sort((a, b) => a - b)) {
      dayItems[di].push({ doc: pending[i].doc, fixed: false, note: null, time: null })
      addVisit(pending[i].doc.doctor_id, di)
    }
    const drop = new Set(take)
    for (let i = pending.length - 1; i >= 0; i--) if (drop.has(i)) pending.splice(i, 1)
  }

  /* ---- 3. repair: a day under the minimum takes the nearest flexible visits from fuller days, else merges into other days ---- */
  const centroid = (di: number): Gps | null => {
    const g = dayItems[di].filter((x) => hasGps(x.doc))
    if (g.length === 0) return null
    return { lat: g.reduce((a, x) => a + (x.doc.lat as number), 0) / g.length, lng: g.reduce((a, x) => a + (x.doc.lng as number), 0) / g.length }
  }
  const away = (x: Placed, di: number, c: Gps | null): number => {
    if (c && hasGps(x.doc)) return haversineKm(x.doc, c)
    return dayItems[di].some((y) => y.doc.brick !== null && y.doc.brick === x.doc.brick) ? 0.5 : 1e6
  }
  const moveItem = (x: Placed, from: number, to: number) => {
    dayItems[from].splice(dayItems[from].indexOf(x), 1)
    dayItems[to].push(x)
    const v = visitDays.get(x.doc.doctor_id) as number[]
    v[v.indexOf(from)] = to
  }
  for (let di = 0; di < W; di++) {
    if (caps[di] <= 0 && dayItems[di].length === 0) continue
    for (let guard = 0; guard < 60 && dayItems[di].length < minDay && dayItems[di].length < roomCap(di); guard++) {
      const c = centroid(di)
      let best: { x: Placed; dj: number; d: number } | null = null
      for (let dj = 0; dj < W; dj++) {
        if (dj === di || dayItems[dj].length <= minDay) continue
        for (const x of dayItems[dj]) {
          if (x.fixed || onDayId(x.doc.doctor_id, di) || !spaced(x.doc.doctor_id, di, dj)) continue
          const d = away(x, di, c)
          if (best === null || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && x.doc.doctor_id < best.x.doc.doctor_id)) best = { x, dj, d }
        }
      }
      if (best === null) break
      moveItem(best.x, best.dj, di)
    }
    if (dayItems[di].length > 0 && dayItems[di].length < minDay && dayItems[di].every((x) => !x.fixed)) {
      // merge: every visit of this day goes to the nearest other day that has room
      const counts = dayItems.map((l) => l.length)
      const plan: { x: Placed; to: number }[] = []
      const c = centroid(di)
      let ok = true
      for (const x of [...dayItems[di]]) {
        let best = -1
        let bestD = Infinity
        for (let dj = 0; dj < W; dj++) {
          if (dj === di || counts[dj] === 0 || counts[dj] >= roomCap(dj) || onDayId(x.doc.doctor_id, dj) || plan.some((m) => m.to === dj && m.x.doc.doctor_id === x.doc.doctor_id) || !spaced(x.doc.doctor_id, dj, di)) continue
          const cj = centroid(dj)
          const d = c && cj ? haversineKm(c, cj) : Math.abs(dj - di)
          if (d < bestD - 1e-9) { bestD = d; best = dj }
        }
        if (best < 0) { ok = false; break }
        counts[best]++
        plan.push({ x, to: best })
      }
      if (ok) for (const m of plan) moveItem(m.x, di, m.to)
    }
  }

  /* ---- 4. order and times inside each day ---- */
  const rows: PlanRow[] = []
  const dayOrder: Placed[][] = []
  for (let di = 0; di < W; di++) {
    const items = dayItems[di]
    const fx = [...items.filter((x) => x.fixed)].sort((a, b) => (usualMin(a.doc) as number) - (usualMin(b.doc) as number) || a.doc.doctor_id - b.doc.doctor_id)
    const fxTimes = scheduleWindows(fx.map((x) => job(x.doc)), step) ?? []
    fx.forEach((x, i) => { x.time = fxTimes[i] })
    const flex = items.filter((x) => !x.fixed).sort((a, b) => (routePos.get(a.doc.doctor_id) ?? 0) - (routePos.get(b.doc.doctor_id) ?? 0))
    const hrs = items.map((x) => usualMin(x.doc)).filter((h): h is number => h !== null).sort((a, b) => a - b)
    const anchor = hrs.length > 0 ? hrs[hrs.length >> 1] : (ws + we) / 2
    const from = clamp(Math.round(anchor - ((items.length - 1) * step) / 2), ws, we)
    let slots = slotsFrom(from, we, step, fxTimes)
    if (slots.length < flex.length) slots = slotsFrom(ws, we, step, fxTimes)
    slots = slots.slice(0, flex.length)
    // route direction that matches the doctors' usual hours best
    const cost = (list: Placed[]) => list.reduce((a, x, i) => { const h = usualMin(x.doc); return h === null ? a : a + Math.abs(h - slots[i]) }, 0)
    const rev = [...flex].reverse()
    const use = flex.length > 1 && cost(rev) < cost(flex) ? rev : flex
    use.forEach((x, i) => { x.time = slots[i] })
    dayOrder.push([...fx, ...use].sort((a, b) => (a.time as number) - (b.time as number)))
  }
  const counter = new Map<number, number>()
  for (let di = 0; di < W; di++) {
    dayOrder[di].forEach((x, i) => {
      const n = (counter.get(x.doc.doctor_id) ?? 0) + 1
      counter.set(x.doc.doctor_id, n)
      rows.push({ day: open[di].day, seq: i + 1, doctor_id: x.doc.doctor_id, planned_time: fromMin(x.time as number), fixed: x.fixed, visit_no: n, note: x.note })
    })
  }

  /* ---- 5. summary ---- */
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
  const counts = dayCounts.map((d) => d.count)
  const overDays = counts.filter((c) => c > T).length
  const kms = open.map((_, i) => routeKm(dayOrder[i].map((x) => x.doc))).filter((_, i) => dayOrder[i].length > 0)
  const bricks = dayOrder.filter((l) => l.length > 0).map((l) => new Set(l.map((x) => x.doc.brick ?? '-')).size)
  const noGps = docs.filter((d) => !hasGps(d)).map((d) => ({ id: d.doctor_id, name: d.name }))
  const noTime = docs.filter((d) => usualMin(d) === null).map((d) => ({ id: d.doctor_id, name: d.name }))
  const dropped: PlanSummary['dropped'] = []
  for (const d of docs) {
    const got = planned.get(d.doctor_id) ?? 0
    const miss = d.freq - got
    if (miss > 0) dropped.push({ id: d.doctor_id, name: d.name, missing: miss, visits: Array.from({ length: miss }, (_, i) => `${got + i + 1}/${d.freq}`), reason: confirmed(d) ? 'no free date on his weekday under the daily cap' : 'no room under the daily cap' })
  }
  const missingVisits = dropped.reduce((a, d) => a + d.missing, 0)
  const missingFirst = dropped.filter((d) => !planned.has(d.id)).length
  const underMin = dayCounts.filter((d) => d.count > 0 && d.count < minDay)
  const emptyDays = dayCounts.filter((d) => d.count === 0).map((d) => d.day)
  const listTooBig = N > T * W
  const covPct = D > 0 ? cov15 / D : 0
  const warnings: string[] = []
  if (W === 0) warnings.push('No open PM day in this month: nothing can be planned.')
  if (targetMissing) warnings.push(`The box has no PM call-rate target: ${p.fallbackTarget} a day was used.`)
  if (listTooBig) warnings.push(`The list (${N} visits) is bigger than the visit capacity. Capacity at target (Target x open days) = ${T} x ${W} = ${T * W}; Capacity at max (${p.maxDay} x open days) = ${p.maxDay} x ${W} = ${p.maxDay * W}. ${overDays} day${overDays === 1 ? '' : 's'} above the target, highest day ${Math.max(0, ...counts)}.`)
  if (covPct < p.minCoverage) warnings.push(`Coverage by day ${p.coverageDay} is ${cov15} of ${D} doctors; ${required} are required (${Math.round(p.minCoverage * 100)}%): short by ${required - cov15}.`)
  if (pcf < p.minPcf) warnings.push(`Expected PCF is ${(pcf * 100).toFixed(1)}%, below ${Math.round(p.minPcf * 100)}%: ${N - pcfNum} visits cannot be placed.`)
  if (underMin.length > 0) warnings.push(`${underMin.length} day${underMin.length === 1 ? ' is' : 's are'} under the minimum of ${minDay} visits: ${underMin.map((d) => `${d.day} (${d.count})`).join(', ')}.`)
  if (emptyDays.length > 0) warnings.push(`${emptyDays.length} open day${emptyDays.length === 1 ? ' has' : 's have'} no visits: the list has ${N} visits, ${minDay} a day needs ${minDay * W}.`)

  const summary: PlanSummary = {
    target: T, targetMissing, openDays: W, closedDays: inputs.days.length - W, capacityAtTarget: T * W, capacityAtMax: p.maxDay * W,
    targetVisits: N, plannedVisits: rows.length, doctors: D, listTooBig, overDays, peak: Math.max(0, ...counts), lowest: counts.length > 0 ? Math.min(...counts) : 0,
    daysAtMax: counts.filter((c) => c >= p.maxDay).length,
    cov15: { done: cov15, required, total: D, pct: covPct, ok: covPct >= p.minCoverage },
    covEnd: { done: covEnd, total: D, pct: D > 0 ? covEnd / D : 0 },
    pcf: { pct: pcf, ok: pcf >= p.minPcf },
    dayCounts, underMin, emptyDays, noGps, noTime, moved, dropped,
    shortfall: { visits: missingVisits, firstVisits: missingFirst, covLossPts: D > 0 ? (missingFirst / D) * 100 : 0, pcfLossPts: N > 0 ? (missingVisits / N) * 100 : 0 },
    avgDailyKm: kms.length > 0 ? kms.reduce((a, b) => a + b, 0) / kms.length : 0,
    avgBricksPerDay: bricks.length > 0 ? bricks.reduce((a, b) => a + b, 0) / bricks.length : 0, maxBricksPerDay: Math.max(0, ...bricks),
    window: { start: fromMin(ws), end: fromMin(we), own: !!inputs.window },
    warnings,
  }
  assertWithinCap(rows, p.maxDay)
  return { rows, summary, params: p }
}

/** Throws when any day of the plan has more visits than the hard cap: such a plan must never reach the screen. */
export function assertWithinCap(rows: { day: string }[], max: number = MAX_PER_DAY): void {
  const per = new Map<string, number>()
  for (const r of rows) per.set(r.day, (per.get(r.day) ?? 0) + 1)
  for (const [day, n] of per) if (n > max) throw new Error(`Plan error: ${day} has ${n} visits, above the daily cap of ${max}`)
}

/** The rep's PM window from his visit start times (HH:MM): 5th to 95th percentile, so outliers are ignored. null when there are too few visits. */
export function windowFromTimes(times: (string | null)[], minVisits: number = DEFAULT_PARAMS.minHistory): { start: number; end: number } | null {
  const m = times.map((t) => toMin(t)).filter((x): x is number => x !== null).sort((a, b) => a - b)
  if (m.length < minVisits) return null
  const at = (q: number) => m[Math.min(m.length - 1, Math.max(0, Math.round(q * (m.length - 1))))]
  const start = at(0.05)
  const end = at(0.95)
  return end > start ? { start, end } : null
}

/* ------------------------------------ backtest ------------------------------------ */
export interface ActualVisit { day: string; doctor_id: number; visit_time: string | null }
export interface Metrics { cov15: number; pcf: number; avgKm: number; daysOver: number; days: number; maxDay: number }
export interface Backtest { plan: Metrics; actual: Metrics }

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
    const kms = [...perDay.values()].map((ids) => routeKm(ids.map((id) => byDoc.get(id))))
    return {
      cov15: D > 0 ? cov / D : 0, pcf: N > 0 ? pcfNum / N : 0, avgKm: kms.length > 0 ? kms.reduce((a, b) => a + b, 0) / kms.length : 0,
      daysOver: [...perDay.values()].filter((ids) => ids.length > T).length, days: perDay.size, maxDay: Math.max(0, ...[...perDay.values()].map((ids) => ids.length)),
    }
  }
  return {
    plan: metrics(res.rows.map((r) => ({ day: r.day, doctor_id: r.doctor_id, time: toMin(r.planned_time) ?? 0 }))),
    actual: metrics(act.map((a) => ({ day: a.day, doctor_id: a.doctor_id, time: toMin(a.visit_time) ?? 0 }))),
  }
}
