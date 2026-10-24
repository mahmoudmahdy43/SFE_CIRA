/**
 * Monthly visit planner (PM, one rep), v6. Pure and deterministic: the same inputs always give the same plan (no random, no I/O).
 *
 * Principle: history is permission, GPS is proximity, the rules are limits. The plan repeats the rep's weekly rhythm: each Brick on the weekdays
 * it was visited on before, each doctor on his weekdays and at his hours. Every planned visit is justified by a history fact or a stated fallback.
 *
 * Hard rules (checked again by validatePlan.ts): 6 to 12 visits on every day with visits, closed days, the minimum gap in calendar days between
 * visits of one doctor (10 / 7 / 5), nobody above his visits, at most 2 Bricks a day in contiguous blocks, a second Brick only by history.
 *
 * Steps (stop at the first that reaches PCF >= 90% and Coverage by day 15 >= 90%):
 *  A strict history  : Brick weekdays with 2+ dates, doctor weekdays with 2+ visits, windows P20-P80, repeats of a Brick on consecutive days only
 *                      when repeat_days / brick_days >= 15%.
 *  B softer history  : weekdays seen once, any weekday for a doctor inside his Brick, windows P5-P95, repeats at >= 5%.
 *  C last resort     : any Brick on any weekday, doctors without time data placed by Brick and distance, up to 6 same-Brick days in a row,
 *                      end of the day extended to P99 / 22:30.
 *
 * The calendar is built date by date: restricted Bricks (those whose history allows the date's weekday) first, by pressure; free Bricks fill the rest.
 */
import {
  brickOf, clamp, dayNum, DEFAULT_PARAMS, estKm, fromMin, gapDaysFor, hasGps, haversineKm, isoDow, pairAllowed, pairLookup, pairWhy, routeKm, toMin,
  WEEKDAY, type ActualVisit, type Grade, type HistoryInfo, type PlanDoctor, type PlanInputs, type PlanMode, type PlanParams, type PlanResult, type PlanRow, type PlanSummary, type Step,
} from './planCore.ts'
import { allowedDays, brickHours, brickKind, buildBrickTemplates, pctOf, pickHistory, templateSummary, type BrickTpl } from './templates.ts'
import { validatePlan } from './validatePlan.ts'

export * from './planCore.ts'
export { validatePlan } from './validatePlan.ts'
export { allowedDays, brickHours, brickKind, buildBrickTemplates, pickHistory } from './templates.ts'

const pct = pctOf

/* ------------------------------------ history -> rep window, doctor profile ------------------------------------ */
/** The rep's PM window from his visit start times (HH:MM): 5th to 95th percentile (and the 99th), so outliers are ignored. null when there are too few visits. */
export function windowFromTimes(times: (string | null)[], minVisits: number = DEFAULT_PARAMS.minHistory): { start: number; end: number; end99: number } | null {
  const m = times.map((t) => toMin(t)).filter((x): x is number => x !== null).sort((a, b) => a - b)
  if (m.length < minVisits) return null
  const start = pct(m, 0.05)
  const end = pct(m, 0.95)
  return end > start ? { start, end, end99: Math.max(end, pct(m, 0.99)) } : null
}

/**
 * Each doctor's own profile from his visit history (by ANY rep): visits per weekday (dow_n), how many have a time (n_timed), and his hours:
 * P20-P80 of his visit times with 5+ timed visits (P5-P95 in win_lo / win_hi), else 90 minutes around the median. The weekday rules are applied by the planner.
 */
export function doctorTimesFromHistory(history: ActualVisit[], doctors: PlanDoctor[]): PlanDoctor[] {
  const by = new Map<number, ActualVisit[]>()
  for (const v of history) { const a = by.get(v.doctor_id) ?? []; a.push(v); by.set(v.doctor_id, a) }
  return doctors.map((d) => {
    const list = by.get(d.doctor_id) ?? []
    const dowN = [0, 0, 0, 0, 0, 0, 0, 0]
    for (const v of list) dowN[isoDow(v.day)]++
    const seen = [1, 2, 3, 4, 5, 6, 7].filter((k) => dowN[k] > 0)
    const n = list.length
    const ranked = [...seen].sort((a, b) => dowN[b] - dowN[a] || a - b)
    const mins = list.map((v) => toMin(v.visit_time)).filter((m): m is number => m !== null).sort((a, b) => a - b)
    let ws: number | null = null
    let we: number | null = null
    let lo: number | null = null
    let hi: number | null = null
    if (mins.length >= 5) { ws = pct(mins, 0.2); we = pct(mins, 0.8); lo = Math.min(ws, pct(mins, 0.05)); hi = Math.max(we, pct(mins, 0.95)) }
    else if (mins.length > 0) { const med = pct(mins, 0.5); ws = med - 90; we = med + 90; lo = ws; hi = we }
    return {
      ...d, pref_isodow: n >= 2 && ranked.length > 0 && dowN[ranked[0]] / n >= 0.4 ? ranked[0] : null, pref_dows: [], hist_dows: seen, free_any_day: seen.length >= 4, allowed_dows: null,
      win_start: ws, win_end: we, win_lo: lo, win_hi: hi, n_hist: n, n_timed: mins.length, dow_n: dowN,
    }
  })
}

/** The rep's usual busiest day: the 90th percentile of the number of PM visits per day in his history (null with fewer than 8 days). */
export function usualMaxDayFromHistory(history: ActualVisit[]): number | null {
  const per = new Map<string, number>()
  for (const v of history) per.set(v.day, (per.get(v.day) ?? 0) + 1)
  if (per.size < 8) return null
  return pct([...per.values()].sort((a, b) => a - b), 0.9)
}

/* ------------------------------------ confidence grade of one visit ------------------------------------ */
/** A doctor is certain to be present on a weekday when he was visited on it at least twice before, or on 4+ different weekdays (any day). */
export function certainOn(d: PlanDoctor, isodow: number, p: PlanParams = DEFAULT_PARAMS): boolean {
  return (d.dow_n ?? []).filter((x) => x > 0).length >= 4 || (d.dow_n?.[isodow] ?? 0) >= p.certainSameDow
}
export interface GradeInfo { grade: Grade; wait: number; certain: boolean; reason: string | null }

/**
 * Confidence grade of one planned visit; `d` is the doctor as profiled from his history.
 *  A: his weekday is in his history (2+ visits that weekday, or he is visited on 4+ weekdays), 5+ timed visits, the time is inside P20-P80 (up to 20 min early).
 *  C: no time data (placed by Brick hours / proximity), a weekday that is not in his history (restricted doctor), or a time outside any window
 *     (after P95, more than 45 min early for a doctor certain to be present, more than 20 otherwise).
 *  B: the rest (1-4 visits, weekday seen once, inside P5-P95, a wait of 20-45 min for a doctor certain to be present, a Brick with unknown history).
 */
export function gradeVisit(d: PlanDoctor, isodow: number, time: number, brickKnown = true, p: PlanParams = DEFAULT_PARAMS): GradeInfo {
  const certain = certainOn(d, isodow, p)
  if (d.win_start == null || d.win_end == null) return { grade: 'C', wait: 0, certain, reason: 'no time data for this doctor, placed by the hours and the distance of his Brick' }
  const dowN = d.dow_n ?? []
  const seen = dowN.filter((x) => x > 0).length
  const free = seen >= 4
  const lo = d.win_lo ?? d.win_start
  const hi = Math.max(d.win_hi ?? d.win_end, d.win_end)
  const wait = Math.max(0, Math.round(lo - time))
  if (!free && seen > 0 && (dowN[isodow] ?? 0) === 0) return { grade: 'C', wait, certain, reason: `${WEEKDAY[isodow]} is not in his visit history` }
  if (time > hi) return { grade: 'C', wait, certain, reason: `${fromMin(time)} is after the end of his usual hours (${fromMin(hi)})` }
  if (wait > p.maxWaitMin) return { grade: 'C', wait, certain, reason: `it means waiting ${wait} min for his usual hours (${fromMin(lo)})` }
  if (wait > p.earlyToleranceMin && !certain) return { grade: 'C', wait, certain, reason: `it means waiting ${wait} min and he is not certain to be present on a ${WEEKDAY[isodow]}` }
  const weekdayOk = free || (dowN[isodow] ?? 0) >= p.minDoctorVisits
  const inside = time >= d.win_start - p.earlyToleranceMin && time <= d.win_end
  if (brickKnown && weekdayOk && (d.n_timed ?? 0) >= 5 && inside) return { grade: 'A', wait, certain, reason: null }
  return { grade: 'B', wait, certain, reason: null }
}

/* ------------------------------------ the planner ------------------------------------ */
/** A summary with nothing planned (No plan mode). */
function emptySummary(inputs: PlanInputs, p: PlanParams, T: number, targetMissing: boolean, mode: PlanMode, modeInfo: PlanSummary['modeInfo'], warnings: string[]): PlanSummary {
  const W = inputs.days.filter((d) => !d.closed).length
  return {
    target: T, targetMissing, openDays: W, closedDays: inputs.days.length - W, capacityAtTarget: T * W, capacityAtMax: p.maxDay * W,
    targetVisits: inputs.doctors.reduce((a, d) => a + d.freq, 0), plannedVisits: 0, doctors: inputs.doctors.length, listTooBig: false, overDays: 0, peak: 0, lowest: 0, daysAtMax: 0,
    cov15: { done: 0, required: 0, total: inputs.doctors.length, pct: 0, ok: false }, covEnd: { done: 0, total: inputs.doctors.length, pct: 0 }, pcf: { pct: 0, ok: false },
    dayCounts: [], underMin: [], emptyDays: [], twoBrickDays: [], oneBrickDays: 0, noGps: [], noTime: [], dropped: [],
    shortfall: { visits: 0, firstVisits: 0, covLossPts: 0, pcfLossPts: 0 }, avgEstKmPerDay: 0, avgStayMin: 0, waitTotalMin: 0, waits: [], repeats: [], repeatLimit: p.maxRunC,
    blockedDays: [], usualMaxDay: null, aboveUsual: [], cov15Why: [], mode, confidence: null, modeInfo, brickSource: inputs.brickSource ?? null, restrictedDoctors: 0, freeDoctors: 0,
    window: { start: p.defaultWinStart, end: p.defaultWinEnd, own: false }, fromDay: inputs.fromDay ?? null, warnings,
    step: null, targetsMet: false, notReachable: null, grades: { A: 0, B: 0, C: 0 }, dayGrades: {}, waitAllowed: { doctors: 0, minutes: 0 }, template: null, dayReasons: {},
  }
}

export function generatePlan(rawInputs: PlanInputs, over: Partial<PlanParams> = {}): PlanResult {
  const p0: PlanParams = { ...DEFAULT_PARAMS, ...over }
  const info: HistoryInfo | undefined = rawInputs.historyInfo
  const listN = rawInputs.doctors.filter((d) => d.freq > 0).length
  const modeInfo: PlanSummary['modeInfo'] = info
    ? { listDoctors: info.list_doctors, withTime: info.doctors_with_time_any, withGps: info.doctors_with_gps, withAny: info.doctors_with_any }
    : { listDoctors: listN, withTime: rawInputs.doctors.filter((d) => d.win_start != null).length, withGps: rawInputs.doctors.filter(hasGps).length, withAny: rawInputs.doctors.filter((d) => (d.n_hist ?? 0) > 0).length }
  // the planning mode: History when half of the doctors have visit times, Geography when only the GPS is good, else no plan
  let mode: PlanMode = 'history'
  if (info) {
    if (info.list_doctors <= 0) mode = 'none'
    else if (info.doctors_with_time_any / info.list_doctors >= p0.minHistoryShare) mode = 'history'
    else if (info.doctors_with_gps / info.list_doctors >= p0.minGpsShare) mode = 'geography'
    else mode = 'none'
  }
  const T0 = rawInputs.daily_target
  const targetMissing0 = T0 === null || !(T0 > 0)
  if (mode === 'none') {
    const msg = modeInfo.listDoctors === 0
      ? 'This rep has no PM list (Clinics / Poly Clinics) in this month or any earlier one: there is nothing to plan.'
      : `Not enough visit history or GPS to plan this rep: ${modeInfo.withTime} of ${modeInfo.listDoctors} doctors have a visit with a time (${Math.round(p0.minHistoryShare * 100)}% needed) and ${modeInfo.withGps} have GPS (${Math.round(p0.minGpsShare * 100)}% needed). ${modeInfo.withAny} have any visit history.`
    const summary = emptySummary(rawInputs, p0, targetMissing0 ? p0.fallbackTarget : Math.round(T0 as number), targetMissing0, 'none', modeInfo, [msg])
    return { rows: [], summary, params: p0, validation: { ok: true, failures: [], warnings: [] } }
  }
  // the templates: the rep's own visits when he has enough of them, else the visits of any rep to the same doctors. Geography mode has no history to use.
  const picked = mode === 'geography' || !rawInputs.history ? { visits: [] as ActualVisit[], source: 'none' as const, ownVisits: 0 } : pickHistory(rawInputs.history, rawInputs.rep?.id ?? null, p0.minOwnVisits)
  const profiled: PlanDoctor[] = rawInputs.history
    ? doctorTimesFromHistory(picked.visits, rawInputs.doctors)
    : rawInputs.doctors.map((d) => ({ ...d, hist_dows: d.hist_dows ?? (d.dow_n ? [1, 2, 3, 4, 5, 6, 7].filter((k) => (d.dow_n as number[])[k] > 0) : []) }))
  const inputs: PlanInputs = {
    ...rawInputs, doctors: profiled, brickPairs: mode === 'geography' ? [] : rawInputs.brickPairs, brickRepeats: mode === 'geography' ? [] : rawInputs.brickRepeats,
    window: rawInputs.window ?? (mode === 'geography' ? { start: toMin(p0.geoStart) as number, end: toMin(p0.geoEnd) as number } : null),
  }
  const p: PlanParams = mode === 'geography' ? { ...p0, maxBricksPerDay: 1 } : p0
  const tpl = buildBrickTemplates(picked.visits, profiled, inputs.brickRepeats)
  const nTotal = profiled.reduce((acc, d) => acc + (d.freq > 0 ? d.freq : 0), 0)

  let best: PlanResult | null = null
  let bestScore = -1
  let met = false
  for (const step of ['A', 'B', 'C'] as Step[]) {
    const res = buildPlan(inputs, rawInputs, mode, modeInfo, p, step, tpl, picked.source, picked.ownVisits)
    const ok = res.validation.ok && (nTotal === 0 || (res.summary.cov15.ok && res.summary.pcf.ok))
    const score = Math.min(res.summary.pcf.pct, p.minPcf) + Math.min(res.summary.cov15.pct, p.minCoverage) + (res.validation.ok ? 1 : 0)
    if (ok) { best = res; met = true; break }
    if (best === null || score > bestScore + 1e-9) { best = res; bestScore = score }
  }
  const out = best as PlanResult
  out.summary.targetsMet = met
  if (!met) {
    out.summary.notReachable = notReached(out, p)
    const nr = out.summary.notReachable
    out.summary.warnings.unshift(`Not reached with the current rules: PCF ${(nr.bestPcf * 100).toFixed(1)}% and Coverage by day ${p.coverageDay} ${(nr.bestCov15 * 100).toFixed(1)}% are the best found (step ${out.summary.step ?? '-'}); ${Math.round(p.minPcf * 100)}% of ${nr.targetVisits} visits = ${nr.requiredVisits} needed, capacity ${nr.capacity}${nr.capacityEnough ? ' (enough: the rules block it)' : ' (not enough)'}. ${nr.reasons.join('; ')}.`)
  }
  return out
}

/** Why the targets are not reached: whether the capacity is enough and which rules block how many visits. */
function notReached(res: PlanResult, p: PlanParams): NonNullable<PlanSummary['notReachable']> {
  const s = res.summary
  const N = s.targetVisits
  const requiredVisits = Math.ceil(p.minPcf * N)
  const capacity = p.maxDay * s.openDays
  const capacityEnough = capacity >= requiredVisits
  const reasons: string[] = []
  if (!capacityEnough) reasons.push(`capacity: ${p.maxDay} x ${s.openDays} open days = ${capacity} is below the ${requiredVisits} visits needed${s.closedDays > 0 ? ` (${s.closedDays} closed day${s.closedDays === 1 ? '' : 's'})` : ''}`)
  else if (s.closedDays > 0) reasons.push(`closed days: ${s.closedDays} day${s.closedDays === 1 ? '' : 's'} closed (leaves, requests, holidays)`)
  const by = new Map<string, number>()
  for (const d of s.dropped) { const key = d.reason.split(':')[0]; by.set(key, (by.get(key) ?? 0) + d.missing) }
  for (const [r, n] of [...by].sort((a, b) => b[1] - a[1])) reasons.push(`${r}: ${n} visit${n === 1 ? '' : 's'} not placed`)
  const nog = s.dropped.filter((d) => s.noGps.some((g) => g.id === d.id))
  if (nog.length > 0) reasons.push(`no GPS: ${nog.reduce((a, d) => a + d.missing, 0)} of the missing visits belong to ${nog.length} doctor${nog.length === 1 ? '' : 's'} with no GPS (placed by Brick only)`)
  if (s.emptyDays.length > 0) reasons.push(`minimum 6: ${s.emptyDays.length} open day${s.emptyDays.length === 1 ? '' : 's'} could not be given 6 visits`)
  if (!s.cov15.ok && s.cov15Why.length > 0) reasons.push(...s.cov15Why.map((w) => `coverage by day ${p.coverageDay}: ${w}`))
  if (reasons.length === 0) reasons.push('the gap, weekday, Brick and 6-visit rules together leave no room for the missing visits')
  return { capacity, requiredVisits, targetVisits: N, bestPcf: s.pcf.pct, bestCov15: s.cov15.pct, requiredCov15: s.cov15.required, capacityEnough, reasons }
}

/* ------------------------------------ one plan at one step ------------------------------------ */
interface Prof {
  d: PlanDoctor; id: number; brick: string; n: number; dowN: number[]; seen: number[]; free: boolean; timed: boolean
  ws20: number; we80: number; wsLo: number; weHi: number
}
interface OpenDay { day: string; isodow: number; dn: number; early: boolean }
interface Block { brick: string; docs: Prof[] }
interface DayPlan { blocks: Block[]; why: string[]; second: string | null; repeat: { brick: string; why: string } | null }

function buildPlan(inputs: PlanInputs, rawInputs: PlanInputs, mode: PlanMode, modeInfo: PlanSummary['modeInfo'], p: PlanParams, step: Step, tpl: Map<string, BrickTpl>, source: 'own' | 'any' | 'none', ownVisits: number): PlanResult {
  const T0b = inputs.daily_target
  const targetMissing = T0b === null || !(T0b > 0)
  const T = targetMissing ? p.fallbackTarget : Math.round(T0b as number)
  const fromDay = inputs.fromDay ?? null
  const done = inputs.done ?? {}
  const docs = inputs.doctors.filter((d) => d.freq > 0)
  const open: OpenDay[] = inputs.days.filter((d) => !d.closed && (!fromDay || d.day >= fromDay)).map((d) => ({ day: d.day, isodow: d.isodow, dn: dayNum(d.day), early: Number(d.day.slice(8, 10)) <= p.coverageDay }))
  const W = open.length
  const D = docs.length
  const N = docs.reduce((a, d) => a + d.freq, 0)
  const minDay = p.minDay
  const maxDay = p.maxDay
  const SAN_A = toMin(p.sanityStart) as number
  const SAN_Z = toMin(p.sanityEnd) as number
  const defA = toMin(p.defaultWinStart) as number
  const defZ = toMin(p.defaultWinEnd) as number
  const repEnd = inputs.window ? inputs.window.end : 0
  const dayEndAB = Math.max(repEnd, toMin(p.dayEnd) as number)
  const dayEnd = step === 'C' ? Math.min(SAN_Z, Math.max(dayEndAB, Math.min(inputs.window?.end99 ?? (toMin(p.stepCEnd) as number), toMin(p.stepCCap) as number))) : dayEndAB
  const minDates = step === 'A' ? p.minBrickDates : 1
  const pairs = pairLookup(inputs.brickPairs)
  const repStats = new Map((inputs.brickRepeats ?? []).map((r) => [r.brick, r]))

  /* ---- profiles ---- */
  const profs = new Map<number, Prof>()
  for (const d of docs) {
    const dowN = d.dow_n ?? [0, 0, 0, 0, 0, 0, 0, 0]
    const seen = [1, 2, 3, 4, 5, 6, 7].filter((k) => (dowN[k] ?? 0) > 0)
    const timed = d.win_start != null && d.win_end != null
    profs.set(d.doctor_id, {
      d, id: d.doctor_id, brick: brickOf(d), n: d.n_hist ?? seen.reduce((a, k) => a + dowN[k], 0), dowN, seen, free: seen.length >= 4, timed,
      ws20: d.win_start ?? 0, we80: d.win_end ?? 0, wsLo: d.win_lo ?? d.win_start ?? 0, weHi: Math.max(d.win_hi ?? d.win_end ?? 0, d.win_end ?? 0),
    })
  }
  const plist = [...profs.values()]
  const left = new Map(plist.map((pr) => [pr.id, Math.max(0, pr.d.freq - (done[pr.id] ?? 0))]))
  const left0 = (pr: Prof): number => Math.max(0, pr.d.freq - (done[pr.id] ?? 0))
  const Nrem = [...left.values()].reduce((a, b) => a + b, 0)

  /* ---- what the history allows (step dependent) ---- */
  const brickDows = new Map<string, number[] | null>()
  const kindOf = new Map<string, 'free' | 'restricted' | 'unknown'>()
  for (const b of new Set(plist.map((pr) => pr.brick))) {
    const k = step === 'C' ? 'free' : brickKind(tpl.get(b), minDates)
    kindOf.set(b, k)
    brickDows.set(b, k === 'restricted' ? allowedDays(tpl.get(b), minDates) : null)
  }
  const docDows = new Map<number, number[] | null>()
  for (const pr of plist) {
    let set: number[] | null = null
    if (step === 'A' && !pr.free && pr.n > 0) {
      const strict = [1, 2, 3, 4, 5, 6, 7].filter((k) => pr.dowN[k] >= p.minDoctorVisits)
      set = pr.n >= 3 && strict.length > 0 ? strict : pr.seen
      const bd = brickDows.get(pr.brick) ?? null
      if (bd) { const inter = set.filter((k) => bd.includes(k)); set = inter.length > 0 ? inter : bd }
    }
    docDows.set(pr.id, set)
  }
  const dowOk = (pr: Prof, dow: number): boolean => {
    const bd = brickDows.get(pr.brick) ?? null
    if (bd && !bd.includes(dow)) return false
    const dd = docDows.get(pr.id) ?? null
    return !dd || dd.includes(dow)
  }
  const tolFor = (pr: Prof, dow: number): number => (pr.free || pr.dowN[dow] >= p.certainSameDow ? p.maxWaitMin : p.earlyToleranceMin)
  const win = (pr: Prof, dow: number): { a: number; b: number } => {
    if (pr.timed) return step === 'A' ? { a: pr.ws20, b: pr.we80 } : { a: pr.wsLo, b: pr.weHi }
    const bh = brickHours(tpl.get(pr.brick), dow)
    const a0 = bh ? bh.start : defA
    const b0 = bh ? bh.end : defZ
    return step === 'C' ? { a: Math.max(SAN_A, a0), b: dayEnd } : { a: a0, b: b0 }
  }

  /* ---- geography ---- */
  const cent = new Map<string, { lat: number; lng: number } | null>()
  for (const b of kindOf.keys()) {
    const g = plist.filter((pr) => pr.brick === b && hasGps(pr.d))
    cent.set(b, g.length === 0 ? null : { lat: g.reduce((a, pr) => a + (pr.d.lat as number), 0) / g.length, lng: g.reduce((a, pr) => a + (pr.d.lng as number), 0) / g.length })
  }
  const distBricks = (a: string | null, b: string): number => { const x = a ? cent.get(a) : null; const y = cent.get(b); return x && y ? haversineKm(x, y) : 1e6 }
  const gapBetween = (a: Prof, b: Prof): number => {
    const km = hasGps(a.d) && hasGps(b.d) ? estKm(a.d, b.d, p.detourFactor) : 0
    const g = Math.ceil(p.visitMinutes + (km / p.speedKmh) * 60)
    return a.brick === b.brick ? clamp(g, p.gapMin, p.gapMax) : Math.max(p.gapMin, g)
  }

  /* ---- schedule of one day: nobody late, nobody earlier than he tolerates, no long idle gaps ---- */
  interface Sch { ok: boolean; t: number[] }
  const schedule = (seq: Prof[], dow: number): Sch => {
    const n = seq.length
    if (n === 0) return { ok: true, t: [] }
    const w = seq.map((pr) => win(pr, dow))
    const arr: number[] = [Math.max(w[0].a, SAN_A)]
    for (let i = 1; i < n; i++) {
      const base = arr[i - 1] + gapBetween(seq[i - 1], seq[i])
      const a = Math.max(base, w[i].a)
      if (a - base > p.windowGapMaxMin) return { ok: false, t: [] }
      arr.push(a)
    }
    let need = 0
    let allowed = arr[0] - SAN_A
    for (let i = 0; i < n; i++) {
      need = Math.max(need, arr[i] - Math.min(w[i].b, dayEnd))
      allowed = Math.min(allowed, arr[i] - (w[i].a - tolFor(seq[i], dow)))
    }
    if (need > allowed + 1e-9 || arr[n - 1] - need > SAN_Z) return { ok: false, t: [] }
    return { ok: true, t: arr.map((x) => x - need) }
  }
  const median = (xs: number[]): number => { const s2 = [...xs].sort((a, b) => a - b); return s2.length > 0 ? s2[s2.length >> 1] : 0 }
  /** Blocks in order (the block whose doctors start earlier first), inside a block by the start of the hours. */
  const orderBlocks = (blocks: Prof[][], dow: number): Prof[][] => {
    const key = (pr: Prof): number => win(pr, dow).a
    const bs = blocks.filter((b) => b.length > 0).map((b) => [...b].sort((x, y) => key(x) - key(y) || x.id - y.id))
    bs.sort((x, y) => median(x.map(key)) - median(y.map(key)))
    return bs
  }
  const flatKm = (seq: Prof[]): number => routeKm(seq.map((s2) => s2.d), p.detourFactor)
  /** Shortest route among doctors whose windows overlap: 2-opt inside each block, kept only when every doctor still arrives inside his window. */
  const improveRoute = (blocks: Prof[][], dow: number): Prof[][] => {
    const out = blocks.map((b) => [...b])
    for (let pass = 0; pass < 4; pass++) {
      let improved = false
      for (const blk of out) {
        for (let i = 0; i < blk.length - 1; i++) {
          for (let j = i + 1; j < blk.length; j++) {
            const before = flatKm(out.flat())
            const saved = [...blk]
            for (let lo = i, hi = j; lo < hi; lo++, hi--) { const x = blk[lo]; blk[lo] = blk[hi]; blk[hi] = x }
            if (flatKm(out.flat()) < before - 1e-9 && schedule(out.flat(), dow).ok) improved = true
            else blk.splice(0, blk.length, ...saved)
          }
        }
      }
      if (!improved) break
    }
    return out
  }

  /* ---- state ---- */
  const plans: DayPlan[] = open.map(() => ({ blocks: [], why: [], second: null, repeat: null }))
  const dayReasons: Record<string, string> = {}
  const visitDays = new Map<number, number[]>()
  const countOf = (di: number): number => plans[di].blocks.reduce((a, b) => a + b.docs.length, 0)
  const gapOf = (pr: Prof): number => gapDaysFor(pr.d.freq)
  const spaced = (pr: Prof, di: number, except = -1): boolean => {
    const g = gapOf(pr)
    const ld = inputs.lastDone?.[pr.id]
    if (ld && open[di].dn - dayNum(ld) < g) return false
    return (visitDays.get(pr.id) ?? []).every((v) => v === except || Math.abs(open[v].dn - open[di].dn) >= g)
  }
  const onDay = (pr: Prof, di: number): boolean => (visitDays.get(pr.id) ?? []).includes(di)
  const eligibleFor = (pr: Prof, di: number): boolean => (left.get(pr.id) ?? 0) > 0 && !onDay(pr, di) && dowOk(pr, open[di].isodow) && spaced(pr, di)
  const commit = (pr: Prof, di: number) => { left.set(pr.id, (left.get(pr.id) ?? 0) - 1); visitDays.set(pr.id, [...(visitDays.get(pr.id) ?? []), di]); covered.add(pr.id) }

  const ratioOf = (b: string): number => { const r = repStats.get(b); return r && r.brick_days > 0 ? r.repeat_days / r.brick_days : 0 }
  const runBefore = (b: string, di: number): number => { let k = 0; for (let i = di - 1; i >= 0 && plans[i].blocks.some((x) => x.brick === b); i--) k++; return k }
  const repeatOk = (b: string, di: number): { ok: boolean; why: string | null } => {
    const run = runBefore(b, di)
    if (run === 0) return { ok: true, why: null }
    const r = ratioOf(b)
    const share = `${(r * 100).toFixed(0)}% of its visited days in his history`
    if (step === 'A' && r >= p.repeatRatioA) return { ok: true, why: `${b} repeated on consecutive days in ${share}` }
    if (step === 'B' && r >= p.repeatRatioB) return { ok: true, why: `${b} repeated on consecutive days in ${share} (step B)` }
    if (step === 'C' && run < p.maxRunC) return { ok: true, why: r >= p.repeatRatioB ? `${b} repeated on consecutive days in ${share}` : 'Same brick as yesterday: needed to reach the target' }
    return { ok: false, why: null }
  }

  const covered = new Set<number>(plist.filter((pr) => (done[pr.id] ?? 0) > 0).map((pr) => pr.id))
  const remainingAllowed = (b: string, di: number): number => { const bd = brickDows.get(b) ?? null; let k = 0; for (let i = di; i < W; i++) if (!bd || bd.includes(open[i].isodow)) k++; return k }
  const prevBrickOf = (i: number): string | null => { for (let k = i - 1; k >= 0; k--) if (plans[k].blocks.length > 0) return plans[k].blocks[plans[k].blocks.length - 1].brick; return null }
  const sortDocs = (list: Prof[], dow: number): Prof[] => [...list].sort((x, y) => (x.d.freq - (left.get(x.id) ?? 0)) - (y.d.freq - (left.get(y.id) ?? 0)) || win(x, dow).a - win(y, dow).a || x.id - y.id)

  /** Takes doctors of a Brick, in priority order, as long as the whole day still works. */
  const takeDocs = (di: number, base: Block[], list: Prof[], room: number): Prof[] => {
    const dow = open[di].isodow
    const chosen: Prof[] = []
    const baseBlocks = base.map((b) => b.docs)
    for (const pr of sortDocs(list, dow)) {
      if (chosen.length >= room) break
      if (schedule(orderBlocks([...baseBlocks, [...chosen, pr]], dow).flat(), dow).ok) chosen.push(pr)
    }
    return chosen
  }
  /** Second Brick options for a day: worked together before, else its doctors were visited on this weekday before (3+). */
  const secondOptions = (a: string, di: number, pool: Map<string, Prof[]>): { b: string; list: Prof[]; pm: number; dist: number; why: string }[] => {
    const dow = open[di].isodow
    const opts: { b: string; list: Prof[]; pm: number; dist: number; why: string }[] = []
    for (const [b2, l2] of pool) {
      if (b2 === a || !repeatOk(b2, di).ok) continue
      const pr2 = pairs(a, b2)
      if (pr2 && pairAllowed(pr2)) opts.push({ b: b2, list: l2, pm: pr2.pm_days, dist: distBricks(a, b2), why: pairWhy(pr2) })
      else {
        const same = l2.filter((x) => (x.dowN[dow] ?? 0) > 0)
        if (same.length >= p.minSecondBrickDoctors) opts.push({ b: b2, list: same, pm: 0, dist: distBricks(a, b2), why: `his doctors were visited on a ${WEEKDAY[dow]} before` })
      }
    }
    return opts.sort((x, y) => y.list.length - x.list.length || y.pm - x.pm || x.dist - y.dist || x.b.localeCompare(y.b))
  }

  /* ---- 1. the calendar, date by date ---- */
  const blockedDays: string[] = []
  const repeats: PlanSummary['repeats'] = []
  const unusedWhy = (di: number): string => {
    const dow = open[di].isodow
    let byDow = 0
    let tooFew = 0
    let noRepeat = 0
    for (const b of kindOf.keys()) {
      if (!plist.some((pr) => pr.brick === b && (left.get(pr.id) ?? 0) > 0)) continue
      const bd = brickDows.get(b) ?? null
      if (bd && !bd.includes(dow)) { byDow++; continue }
      if (!repeatOk(b, di).ok) { noRepeat++; continue }
      tooFew++
    }
    return `no Brick could form a day of ${minDay}+ visits on a ${WEEKDAY[dow]}: ${byDow} Brick${byDow === 1 ? '' : 's'} not visited on ${WEEKDAY[dow]}s in the history, ${noRepeat} would repeat the previous day's Brick, ${tooFew} had too few doctors eligible (gap rule, weekdays or hours)`
  }

  for (let di = 0; di < W; di++) {
    const dow = open[di].isodow
    const remaining = [...left.values()].reduce((a, b) => a + b, 0)
    if (remaining === 0) break
    const needFirst = Math.max(0, Math.ceil(p.minCoverage * D) - covered.size)
    const globalWant = clamp(Math.ceil(remaining / (W - di)), minDay, maxDay)
    const earlyLeft = open.slice(di).filter((o) => o.early).length
    const eligs = new Map<string, Prof[]>()
    for (const pr of plist) {
      if (!eligibleFor(pr, di)) continue
      const e = eligs.get(pr.brick) ?? []
      e.push(pr)
      eligs.set(pr.brick, e)
    }
    interface Cand { brick: string; list: Prof[]; score: number; why: string; rep: string | null }
    const cands: Cand[] = []
    const prevB = prevBrickOf(di)
    for (const [b, list] of eligs) {
      const rp = repeatOk(b, di)
      if (!rp.ok) continue
      const unv = list.filter((pr) => !covered.has(pr.id)).length
      const kind = kindOf.get(b) ?? 'free'
      const needB = plist.filter((pr) => pr.brick === b).reduce((a, pr) => a + (left.get(pr.id) ?? 0), 0)
      const pressure = needB / (maxDay * Math.max(1, remainingAllowed(b, di)))
      const t = tpl.get(b)
      const why = kind === 'restricted'
        ? `${WEEKDAY[dow]}s in his history: ${t ? t.dates[dow] : 0} day${t && t.dates[dow] === 1 ? '' : 's'}`
        : kind === 'unknown' ? `no history for ${b}: placed by distance and hours (grade B/C)`
        : step === 'C' ? `${b}: any weekday (step C)` : `free Brick (visited on ${allowedDays(t, minDates).length} weekdays), fills the day`
      const score = (list.length >= minDay ? 1e7 : 0) + (kind === 'restricted' ? 1e6 + pressure * 1e3 : 0) + (open[di].early && needFirst > 0 ? unv * 10 : 0) + needB
      cands.push({ brick: b, list, score, why, rep: rp.why })
    }
    cands.sort((x, y) => y.score - x.score || distBricks(prevB, x.brick) - distBricks(prevB, y.brick) || x.brick.localeCompare(y.brick))

    let made = false
    for (const c of cands) {
      const bd = brickDows.get(c.brick) ?? null
      const needB = plist.filter((pr) => pr.brick === c.brick).reduce((a, pr) => a + (left.get(pr.id) ?? 0), 0)
      let want = globalWant
      if (bd) want = Math.max(want, Math.min(maxDay, Math.ceil(needB / Math.max(1, remainingAllowed(c.brick, di)))))
      if (earlyLeft > 0 && open[di].early && needFirst > 0) want = Math.max(want, Math.min(maxDay, Math.ceil(needFirst / earlyLeft)))
      want = clamp(want, minDay, maxDay)
      const chosen = takeDocs(di, [], c.list, want)
      const blocks: Block[] = [{ brick: c.brick, docs: chosen }]
      const why = [c.why]
      let second: string | null = null
      if (chosen.length < minDay && p.maxBricksPerDay >= 2 && chosen.length >= p.minSecondBrickDoctors) {
        for (const o of secondOptions(c.brick, di, eligs)) {
          const more = takeDocs(di, blocks, o.list, maxDay - chosen.length)
          if (more.length >= p.minSecondBrickDoctors && chosen.length + more.length >= minDay) {
            blocks.push({ brick: o.b, docs: more })
            second = o.b
            why.push(`Second brick ${o.b}: ${o.why}`)
            break
          }
        }
      }
      if (blocks.reduce((a, b) => a + b.docs.length, 0) < minDay) continue
      plans[di] = { blocks, why, second, repeat: c.rep ? { brick: c.brick, why: c.rep } : null }
      for (const b of blocks) for (const pr of b.docs) commit(pr, di)
      made = true
      break
    }
    if (!made) {
      dayReasons[open[di].day] = `Empty: ${unusedWhy(di)}`
      if (cands.length === 0) blockedDays.push(open[di].day)
    }
  }

  /* ---- 2. top-up: leftover visits join days that have room (same Brick, or a small Brick as the second one) ---- */
  for (let di = 0; di < W; di++) {
    if (plans[di].blocks.length === 0) continue
    const dow = open[di].isodow
    for (const blk of plans[di].blocks) {
      const list = sortDocs(plist.filter((pr) => pr.brick === blk.brick && eligibleFor(pr, di)), dow)
      for (const pr of list) {
        if (countOf(di) >= maxDay) break
        const trial = plans[di].blocks.map((b) => (b === blk ? [...b.docs, pr] : b.docs))
        if (!schedule(orderBlocks(trial, dow).flat(), dow).ok) continue
        blk.docs.push(pr)
        commit(pr, di)
      }
    }
    if (plans[di].blocks.length === 1 && countOf(di) <= maxDay - p.minSecondBrickDoctors && p.maxBricksPerDay >= 2) {
      const a = plans[di].blocks[0].brick
      const pool = new Map<string, Prof[]>()
      for (const pr of plist) if (pr.brick !== a && eligibleFor(pr, di)) pool.set(pr.brick, [...(pool.get(pr.brick) ?? []), pr])
      for (const o of secondOptions(a, di, pool)) {
        const more = takeDocs(di, plans[di].blocks, o.list, maxDay - countOf(di))
        if (more.length >= p.minSecondBrickDoctors) {
          plans[di].blocks.push({ brick: o.b, docs: more })
          plans[di].second = o.b
          plans[di].why.push(`Second brick ${o.b}: ${o.why}`)
          for (const pr of more) commit(pr, di)
          break
        }
      }
    }
  }

  /* ---- 3. times and the rows ---- */
  const rows: PlanRow[] = []
  const dayRows: { pr: Prof; time: number; block: string }[][] = open.map(() => [])
  for (let di = 0; di < W; di++) {
    const dow = open[di].isodow
    if (plans[di].blocks.length === 0) continue
    let blocks = orderBlocks(plans[di].blocks.map((b) => b.docs), dow)
    if (blocks.flat().length > 2) blocks = improveRoute(blocks, dow)
    const seq = blocks.flat()
    const sch = schedule(seq, dow)
    const brickOfPr = new Map(plans[di].blocks.flatMap((b) => b.docs.map((pr) => [pr.id, b.brick] as const)))
    seq.forEach((pr, i) => dayRows[di].push({ pr, time: sch.t[i], block: brickOfPr.get(pr.id) as string }))
  }

  const waits: PlanSummary['waits'] = []
  let waitTotal = 0
  const allowedWait = new Map<number, number>()
  const gradeTotals = { A: 0, B: 0, C: 0 }
  const dayGrades: Record<string, { A: number; B: number; C: number }> = {}
  const counter = new Map<number, number>()
  for (let di = 0; di < W; di++) {
    dayRows[di].forEach(({ pr, time, block }, i) => {
      const nth = (counter.get(pr.id) ?? 0) + 1
      counter.set(pr.id, nth)
      let note: string | null = null
      const dow = open[di].isodow
      const g = gradeVisit(pr.d, dow, time, (kindOf.get(pr.brick) ?? 'free') !== 'unknown')
      const w = win(pr, dow)
      const early = Math.max(0, Math.round(w.a - time))
      waitTotal += early
      if (early > p.earlyToleranceMin) {
        if (g.certain && early <= p.maxWaitMin) { note = `Waits ${early} min (doctor present that day)`; allowedWait.set(pr.id, (allowedWait.get(pr.id) ?? 0) + early) }
        else { note = `Waits ${early} min (his usual hours start ${fromMin(w.a)})`; waits.push({ id: pr.id, name: pr.d.name, day: open[di].day, minutes: early }) }
      }
      if (plans[di].second && block === plans[di].second && (i === 0 || dayRows[di][i - 1].block !== block)) {
        const tag = plans[di].why.find((x) => x.startsWith('Second brick')) ?? `Second brick ${block}`
        note = note ? `${note}; ${tag}` : tag
      }
      if (!pr.timed) note = note ? `${note}; hours of ${pr.brick}` : `Hours of ${pr.brick} (no time data for him)`
      if (g.grade === 'C' && g.reason) note = note ? `${note}; Confirm timing with the rep: ${g.reason}` : `Confirm timing with the rep: ${g.reason}`
      gradeTotals[g.grade]++
      const dg = (dayGrades[open[di].day] ??= { A: 0, B: 0, C: 0 })
      dg[g.grade]++
      rows.push({ day: open[di].day, seq: i + 1, doctor_id: pr.id, planned_time: fromMin(time), fixed: false, visit_no: (done[pr.id] ?? 0) + nth, note, grade: g.grade })
    })
    if (dayRows[di].length > 0) {
      const reasons = [...plans[di].why]
      const rp = plans[di].repeat
      if (rp) { reasons.push(`Repeat: ${rp.why}`); repeats.push({ day: open[di].day, brick: rp.brick, why: rp.why }) }
      dayReasons[open[di].day] = `${[...new Set(dayRows[di].map((x) => x.block))].join(' + ')}: ${reasons.join('; ')}`
    }
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
  const kms = used.map((l) => routeKm(l.map((x) => x.pr.d), p.detourFactor))
  const stays = used.map((l) => Math.max(...l.map((x) => x.time)) - Math.min(...l.map((x) => x.time)))
  const twoBrickDays: PlanSummary['twoBrickDays'] = []
  for (let di = 0; di < W; di++) {
    const bs = [...new Set(dayRows[di].map((x) => x.block))]
    if (bs.length === 2) twoBrickDays.push({ day: open[di].day, a: bs[0], b: bs[1], why: plans[di].why.find((x) => x.startsWith('Second brick'))?.replace(/^Second brick [^:]*: /, '') ?? 'allowed' })
  }
  const noGps = docs.filter((d) => !hasGps(d)).map((d) => ({ id: d.doctor_id, name: d.name }))
  const noTime = docs.filter((d) => d.win_start == null).map((d) => ({ id: d.doctor_id, name: d.name }))

  // the reason for every doctor with visits left out
  const whyMissing = (pr: Prof): string => {
    const g = gapOf(pr)
    const need = left0(pr)
    const ld = inputs.lastDone?.[pr.id] ? dayNum(inputs.lastDone[pr.id]) : -1e9
    let last = ld
    let fitGap = 0
    for (const o of open) { if (o.dn - last >= g) { fitGap++; last = o.dn } }
    if (fitGap < need) return `gap rule: ${g} calendar days between his visits leave room for ${fitGap} of his ${need} visits in the open days`
    last = ld
    let fitDow = 0
    for (const o of open) { if (dowOk(pr, o.isodow) && o.dn - last >= g) { fitDow++; last = o.dn } }
    if (fitDow < need) return `Brick weekday: ${pr.brick} / his weekdays leave room for ${fitDow} of his ${need} visits (${(brickDows.get(pr.brick) ?? docDows.get(pr.id) ?? []).map((k) => WEEKDAY[k]).join(', ') || 'any weekday'})`
    if (plist.filter((x) => x.brick === pr.brick).reduce((a, x) => a + left0(x), 0) < minDay) return `minimum 6: ${pr.brick} has fewer than ${minDay} visits to form a day`
    return 'hours: his hours do not fit with the other doctors of the days he is allowed on, or those days are full'
  }
  const dropped: PlanSummary['dropped'] = []
  for (const pr of plist) {
    const got = planned.get(pr.id) ?? 0
    const miss = left0(pr) - got
    if (miss > 0) {
      const base = (done[pr.id] ?? 0) + got
      dropped.push({ id: pr.id, name: pr.d.name, missing: miss, visits: Array.from({ length: miss }, (_, i) => `${base + i + 1}/${pr.d.freq}`), reason: whyMissing(pr) })
    }
  }
  const missingVisits = dropped.reduce((a, d) => a + d.missing, 0)
  const missingFirst = dropped.filter((d) => (done[d.id] ?? 0) === 0 && !planned.has(d.id)).length
  const underMin = dayCounts.filter((d) => d.count > 0 && d.count < minDay)
  const emptyDays = dayCounts.filter((d) => d.count === 0).map((d) => d.day)
  const listTooBig = Nrem > T * W
  const covPct = D > 0 ? cov15 / D : 0
  const usualMax = inputs.usualMaxDay ?? null
  const aboveUsual = usualMax === null ? [] : dayCounts.filter((d) => d.count > usualMax + 3)
  const uncovered = plist.filter((pr) => !((done[pr.id] ?? 0) > 0 || (firstDay.get(pr.id) !== undefined && (firstDay.get(pr.id) as string) <= cutoff)))
  const cov15Why: string[] = []
  const earlyAll = inputs.days.filter((d) => Number(d.day.slice(8, 10)) <= p.coverageDay && (!fromDay || d.day >= fromDay))
  const earlyClosed = earlyAll.filter((d) => d.closed).length
  if (earlyClosed > 0) cov15Why.push(`${earlyClosed} of the first ${p.coverageDay} days ${earlyClosed === 1 ? 'is' : 'are'} closed (leaves, requests or holidays)`)
  const earlyEmpty = dayCounts.filter((d) => d.day <= cutoff && d.count === 0).length
  if (earlyEmpty > 0) cov15Why.push(`${earlyEmpty} early open day${earlyEmpty === 1 ? '' : 's'} had no Brick that could be visited (see the day reasons)`)
  const earlyAtMax = dayCounts.filter((d) => d.day <= cutoff && d.count >= maxDay).length
  if (earlyAtMax > 0) cov15Why.push(`${earlyAtMax} early day${earlyAtMax === 1 ? ' is' : 's are'} at the maximum of ${maxDay} visits`)
  const byWeekday = uncovered.filter((pr) => (brickDows.get(pr.brick) ?? docDows.get(pr.id) ?? null) !== null)
  if (byWeekday.length > 0) cov15Why.push(`${byWeekday.length} uncovered doctor${byWeekday.length === 1 ? '' : 's'} belong to Bricks / weekdays with few dates before day ${p.coverageDay}`)
  const otherUnc = uncovered.length - byWeekday.length
  if (otherUnc > 0) cov15Why.push(`${otherUnc} other doctor${otherUnc === 1 ? '' : 's'} found no early day with room (gap rule, hours or the daily capacity)`)

  const warnings: string[] = []
  if (mode === 'geography') warnings.push(`Low confidence - geography only: only ${modeInfo.withTime} of ${modeInfo.listDoctors} doctors have a visit time (${Math.round(p.minHistoryShare * 100)}% needed), so the plan uses Bricks and GPS only: one Brick a day, shortest GPS path, hours ${p.defaultWinStart}-${p.defaultWinEnd}.`)
  if (W === 0) warnings.push('No open PM day in this month: nothing can be planned.')
  if (targetMissing) warnings.push(`The box has no PM call-rate target: ${p.fallbackTarget} a day was used.`)
  if (inputs.brickRepeats === undefined) warnings.push('Brick repeat history is not loaded (run 87_plan_brick_repeats.sql): the same Brick is never repeated on consecutive days except in step C.')
  if (inputs.brickPairs === undefined) warnings.push('Brick history is not loaded (run 86_plan_brick_pairs.sql): second Bricks are allowed by weekday history only.')
  if (listTooBig) warnings.push(`The list (${Nrem} visits to plan) is bigger than the visit capacity. Capacity at target (Target x open days) = ${T} x ${W} = ${T * W}; Capacity at max (${maxDay} x open days) = ${maxDay} x ${W} = ${maxDay * W}. ${overDays} day${overDays === 1 ? '' : 's'} above the target, highest day ${Math.max(0, ...counts)}.`)
  if (covPct < p.minCoverage) warnings.push(`Coverage by day ${p.coverageDay} is ${cov15} of ${D} doctors; ${required} are required (${Math.round(p.minCoverage * 100)}%): short by ${required - cov15}. Why: ${cov15Why.length > 0 ? cov15Why.join('; ') : 'not enough early capacity'}.`)
  if (aboveUsual.length > 0) warnings.push(`${aboveUsual.length} planned day${aboveUsual.length === 1 ? ' is' : 's are'} more than 3 visits above his usual busiest day (${usualMax}): ${aboveUsual.slice(0, 8).map((d) => `${d.day} (${d.count})`).join(', ')}.`)
  if (pcf < p.minPcf) warnings.push(`Expected PCF is ${(pcf * 100).toFixed(1)}%, below ${Math.round(p.minPcf * 100)}%: ${N - pcfNum} visits cannot be placed.`)
  if (underMin.length > 0) warnings.push(`${underMin.length} day${underMin.length === 1 ? ' is' : 's are'} under the minimum of ${minDay} visits: ${underMin.map((d) => `${d.day} (${d.count})`).join(', ')}.`)
  if (emptyDays.length > 0 && Nrem > 0) warnings.push(`${emptyDays.length} open day${emptyDays.length === 1 ? ' has' : 's have'} no visits: ${emptyDays.slice(0, 6).map((d) => `${d}${dayReasons[d] ? ` (${dayReasons[d]})` : ''}`).join('; ')}.`)
  if (counts.some((c) => c >= maxDay)) warnings.push(`${counts.filter((c) => c >= maxDay).length} day${counts.filter((c) => c >= maxDay).length === 1 ? ' is' : 's are'} at the maximum of ${maxDay}.`)
  if (waits.length > 0) warnings.push(`${waits.length} visit${waits.length === 1 ? '' : 's'} would wait more than the allowed time for the doctor's usual hours (20 minutes, or 45 when he is certain to be present that day).`)
  if (repeats.length > 0) warnings.push(`${repeats.length} same-Brick repeat${repeats.length === 1 ? '' : 's'} on consecutive days: ${repeats.map((r) => `${r.day} ${r.why}`).join('; ')}.`)
  if (step !== 'A') warnings.push(`Step ${step}: ${step === 'B' ? 'weekdays seen once count, doctors may use any weekday of their Brick, windows are P5-P95, Brick repeats need 5% in the history (step A did not reach both targets)' : 'any Brick on any weekday, doctors without time data placed by Brick and distance, up to 6 same-Brick days in a row, the day may end later (steps A and B did not reach both targets)'}.`)

  const ts = templateSummary(tpl, p, minDates)
  const summary: PlanSummary = {
    target: T, targetMissing, openDays: W, closedDays: inputs.days.length - W, capacityAtTarget: T * W, capacityAtMax: maxDay * W,
    targetVisits: N, plannedVisits: rows.length, doctors: D, listTooBig, overDays, peak: Math.max(0, ...counts), lowest: counts.length > 0 ? Math.min(...counts) : 0,
    daysAtMax: counts.filter((c) => c >= maxDay).length,
    cov15: { done: cov15, required, total: D, pct: covPct, ok: covPct >= p.minCoverage },
    covEnd: { done: covEnd, total: D, pct: D > 0 ? covEnd / D : 0 },
    pcf: { pct: pcf, ok: pcf >= p.minPcf },
    dayCounts, underMin, emptyDays, twoBrickDays, oneBrickDays: used.length - twoBrickDays.length, noGps, noTime, dropped,
    shortfall: { visits: missingVisits, firstVisits: missingFirst, covLossPts: D > 0 ? (missingFirst / D) * 100 : 0, pcfLossPts: N > 0 ? (missingVisits / N) * 100 : 0 },
    avgEstKmPerDay: kms.length > 0 ? kms.reduce((a, b) => a + b, 0) / kms.length : 0,
    avgStayMin: stays.length > 0 ? stays.reduce((a, b) => a + b, 0) / stays.length : 0,
    step, targetsMet: false, notReachable: null, grades: gradeTotals, dayGrades, waitAllowed: { doctors: allowedWait.size, minutes: [...allowedWait.values()].reduce((a, b) => a + b, 0) },
    waitTotalMin: waitTotal, waits, repeats, repeatLimit: p.maxRunC, blockedDays, usualMaxDay: usualMax, aboveUsual, cov15Why,
    window: rows.length > 0 ? { start: fromMin(Math.min(...rows.map((r) => toMin(r.planned_time) ?? SAN_Z))), end: fromMin(Math.max(...rows.map((r) => toMin(r.planned_time) ?? SAN_A))), own: !!rawInputs.window } : { start: p.defaultWinStart, end: p.defaultWinEnd, own: !!rawInputs.window },
    fromDay, warnings,
    mode, confidence: mode === 'geography' ? 'Low confidence - geography only' : null, modeInfo, brickSource: source === 'none' ? inputs.brickSource ?? null : source,
    restrictedDoctors: plist.filter((pr) => (docDows.get(pr.id) ?? null) !== null).length, freeDoctors: plist.filter((pr) => pr.free).length,
    template: { source, ownVisits, freeBricks: ts.free, restrictedBricks: ts.restricted, unknownBricks: ts.unknown, bricks: ts.bricks },
    dayReasons,
  }
  const flat: PlanInputs = { ...inputs, window: { start: SAN_A, end: SAN_Z } }
  const validation = validatePlan(flat, rows, p, underMin.map((d) => d.day), { relaxWeekdays: true })
  return { rows, summary, params: p, validation }
}

/* ------------------------------------ backtest ------------------------------------ */
export interface Metrics { cov15: number; pcf: number; avgKm: number; daysOver: number; days: number; maxDay: number }
export interface Backtest { plan: Metrics; actual: Metrics; valid: boolean; grades: { A: number; B: number; C: number }; step: Step | null; targetsMet: boolean }

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
    grades: res.summary.grades ?? { A: 0, B: 0, C: 0 }, step: res.summary.step ?? null, targetsMet: res.summary.targetsMet === true,
  }
}
