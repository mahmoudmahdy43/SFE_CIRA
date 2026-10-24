/** Shared types, constants and small helpers of the monthly planner. No imports: it is also run directly by scripts/planner.test.mjs. */

export interface PlanDoctor {
  doctor_id: number; name: string; account: string | null; account_type: string | null
  freq: number; brick: string | null; division: string | null
  lat: number | null; lng: number | null; pos_source: string | null
  usual_isodow: number | null; usual_hour: string | null; n_visits: number
  /** From the rep's own last 3 months (strong preferences, not hard rules): the usual weekday and the hours he is usually visited in. */
  pref_isodow?: number | null
  /** From the history of the doctor with ANY rep (plan_doctor_history): the weekdays he is usually visited on (a preference, small penalty). */
  pref_dows?: number[]
  /** Weekdays he was visited on at least once. Needed to put him in a second brick by weekday history. */
  hist_dows?: number[]
  /** Visited on 4+ different weekdays: any day is fine, only his hours matter. */
  free_any_day?: boolean
  /** 3+ visits, 80%+ of them on one or two weekdays: he is planned on these weekdays only (hard). */
  allowed_dows?: number[] | null
  /** The hours used for planning: P20-P80 of his visit times (or 90 minutes around the median with fewer than 5 timed visits). Level 2 and up use win_lo / win_hi. */
  win_start?: number | null
  win_end?: number | null
  /** P5-P95 of his visit times (the same as win_start / win_end with fewer than 5 timed visits). */
  win_lo?: number | null
  win_hi?: number | null
  n_hist?: number
  /** Visits of his history that have a recorded time (grade A needs 5). */
  n_timed?: number
  /** Visits of his history per weekday, index 1 = Monday ... 7 = Sunday (index 0 unused). */
  dow_n?: number[]
}
export interface PlanDay { day: string; isodow: number; closed: boolean; reason: string | null }
/** One pair of bricks the rep really worked in the same day before (plan_brick_pairs). */
export interface BrickPair { a: string; b: string; pm_days: number; any_days: number; last_day: string | null }
/** What the history tells about the rep's list (plan_history_info): it decides History / Geography / No plan. */
export interface HistoryInfo { list_doctors: number; doctors_with_any: number; doctors_with_time_any: number; visits_own: number; doctors_with_own: number; doctors_with_gps: number }
export type PlanMode = 'history' | 'geography' | 'none'
export interface BrickRepeat { brick: string; repeat_days: number; brick_days: number; last_repeat: string | null }
export interface PlanInputs {
  rep: { id: number; name: string; code: string } | null
  month: string; list_month: string | null; box_id: number | null
  daily_target: number | null; days: PlanDay[]; doctors: PlanDoctor[]
  /** The PM visits (any rep, last 6 months) of the doctors of the list: the planner builds the Brick and doctor templates from them. */
  history?: ActualVisit[]
  /** The rep's own PM window in minutes: earliest / latest visit start (5th-95th percentile of his last 3 months). Absent = default window. */
  window?: { start: number; end: number; end99?: number } | null
  /** How often the rep really worked the same brick two PM working days in a row (plan_brick_repeats); undefined = not loaded. */
  brickRepeats?: BrickRepeat[]
  /** Counts of the history of the rep's list; undefined = not loaded (then the plan is generated in History mode as before). */
  historyInfo?: HistoryInfo
  /** Whose brick history was used: the rep's own (30+ PM visits in 3 months) or any rep's. */
  brickSource?: 'own' | 'any'
  /** The most visits the rep did in one PM day (90th percentile of his days in the last 3 months): a soft reference, not a rule. */
  usualMaxDay?: number | null
  /** Bricks worked together before; undefined = not loaded (then no day may have two bricks). */
  brickPairs?: BrickPair[]
  /** Plan only from this day on (mid-month re-plan); earlier days are not touched. */
  fromDay?: string | null
  /** Visits already done this month per doctor (plan_actuals): the plan only covers freq - done. */
  done?: Record<number, number>
  /** Date of the last visit already done this month per doctor (re-plan): the minimum gap counts from it. */
  lastDone?: Record<number, string>
}

/** Hard cap: no day of any plan has more visits than this, whatever the constraint. */
export const MAX_PER_DAY = 12

export interface PlanParams {
  coverageDay: number; minCoverage: number; minPcf: number
  maxDay: number; minDay: number
  /** Bricks in one day: at most this many (3), 4 only in step D; every Brick of a multi-Brick day needs minSecondBrickDoctors doctors. */
  maxBricksPerDay: number; maxBricksStepD: number; minSecondBrickDoctors: number
  visitMinutes: number; speedKmh: number; detourFactor: number; gapMin: number; gapMax: number
  minHistoryShare: number; minGpsShare: number
  /** The rep's own visits are used for the templates when he has at least this many in the history window. */
  minOwnVisits: number
  /** Early arrival allowed before a doctor's window: always 20 minutes, 45 when he is certain to be present that weekday. */
  maxWaitMin: number; earlyToleranceMin: number
  /** More idle time than this between two visits of a day (windows too far apart) and the doctor waits for another date. */
  windowGapMaxMin: number
  /** A Brick may be repeated on consecutive PM days when repeat_days / brick_days is at least this (step A, step B). */
  repeatRatioA: number; repeatRatioB: number
  /** Step C: the longest run of consecutive days with the same Brick. */
  maxRunC: number
  /** A weekday needs this many distinct dates (Brick) / visits (doctor) in the history to be allowed; step B accepts 1. */
  minBrickDates: number; minDoctorVisits: number
  /** A doctor is certain to be present on a weekday when he was visited on it this many times before. */
  certainSameDow: number
  /** Window for a doctor and a Brick with no time data, loose sanity bounds, and the end of the day (rep P95 or dayEnd; step C: P99 or c_end up to cap). */
  defaultWinStart: string; defaultWinEnd: string; sanityStart: string; sanityEnd: string; dayEnd: string; stepCEnd: string; stepCCap: string
  /** Hours of Geography mode. */
  geoStart: string; geoEnd: string
  fallbackTarget: number; minHistory: number
}
export const DEFAULT_PARAMS: PlanParams = {
  coverageDay: 15, minCoverage: 0.9, minPcf: 0.9,
  maxDay: MAX_PER_DAY, minDay: 6,
  maxBricksPerDay: 3, maxBricksStepD: 4, minSecondBrickDoctors: 3,
  visitMinutes: 15, speedKmh: 25, detourFactor: 1.35, gapMin: 15, gapMax: 25,
  minHistoryShare: 0.5, minGpsShare: 0.7, minOwnVisits: 30,
  maxWaitMin: 45, earlyToleranceMin: 20, windowGapMaxMin: 90,
  repeatRatioA: 0.15, repeatRatioB: 0.05, maxRunC: 6,
  minBrickDates: 2, minDoctorVisits: 2, certainSameDow: 2,
  defaultWinStart: '18:00', defaultWinEnd: '21:30', sanityStart: '08:00', sanityEnd: '23:59', dayEnd: '22:00', stepCEnd: '22:30', stepCCap: '23:00',
  geoStart: '17:00', geoEnd: '22:00',
  fallbackTarget: 8, minHistory: 30,
}

/** Confidence of one planned visit: A good data, B data exists but does not fully match, C needs timing confirmation from the rep. */
export type Grade = 'A' | 'B' | 'C'
/** Fallback step: A strict history, B softer history, C last resort. */
export type Step = 'A' | 'B' | 'C' | 'D'
export interface PlanRow { day: string; seq: number; doctor_id: number; planned_time: string | null; fixed: boolean; visit_no: number; note: string | null; grade?: Grade | null }
interface Named { id: number; name: string }

export interface ValidationResult { ok: boolean; failures: string[]; warnings: string[] }

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
  /** Days with two bricks and why that was allowed. */
  twoBrickDays: { day: string; a: string; b: string; why: string; bricks?: string[] }[]
  oneBrickDays: number
  noGps: Named[]; noTime: Named[]
  dropped: { id: number; name: string; missing: number; visits: string[]; reason: string }[]
  shortfall: { visits: number; firstVisits: number; covLossPts: number; pcfLossPts: number }
  /** Estimated distance (straight line x detour factor), not road distance. */
  avgEstKmPerDay: number; avgStayMin: number
  waitTotalMin: number; waits: { id: number; name: string; day: string; minutes: number }[]
  /** Same brick on two working days in a row: the few cases history allowed, and why. */
  repeats: { day: string; brick: string; why: string }[]; repeatLimit: number
  /** Days left empty because every brick with visits left was used the day before. */
  blockedDays: string[]
  /** The rep's usual busiest day (P90) and the planned days more than 3 visits above it. */
  usualMaxDay: number | null
  aboveUsual: { day: string; count: number }[]
  /** History mode (doctors' own hours and days), Geography mode (brick + GPS only, low confidence) or No plan. */
  mode: PlanMode; confidence: string | null
  modeInfo: { listDoctors: number; withTime: number; withGps: number; withAny: number }
  brickSource: 'own' | 'any' | null
  /** Doctors planned only on their usual weekdays, and doctors for whom any weekday is fine. */
  restrictedDoctors: number; freeDoctors: number
  /** Why the coverage by day 15 is what it is (closed days, the 12 maximum, doctors moved to avoid waiting ...). */
  cov15Why: string[]
  window: { start: string; end: string; own: boolean }
  fromDay: string | null
  warnings: string[]
  /** The step (A/B/C) at which the plan met both targets, or the step of the best plan found when it did not. null = nothing planned. */
  step?: Step | null
  /** Step D sub-step reached: 1 = up to 4 Bricks, 2 = + reduced gap, 3 = + every open day up to 12. */
  dSub?: 1 | 2 | 3 | null
  /** The non-negotiable end-of-month targets: PCF and Coverage (doctors with a done or planned visit / doctors of the list). */
  endTargets?: { pcfOk: boolean; covEndOk: boolean; bothMet: boolean }
  /** Days with 1, 2 and 3+ Bricks, Brick changes in the month, average km between the Brick blocks of a multi-Brick day. */
  brickDays?: { one: number; two: number; threePlus: number }
  brickChanges?: number
  avgBlockKm?: number
  /** Visits planned closer to the previous visit of the doctor than the normal gap (step D2+). */
  gapReducedVisits?: number
  targetsMet?: boolean
  /** Set when even step C could not reach PCF and Coverage by day 15 ("Not reached with the current rules"): the numbers and the blocking rules with counts. */
  notReachable?: { capacity: number; requiredVisits: number; targetVisits: number; bestPcf: number; bestCov15: number; requiredCov15: number; capacityEnough: boolean; reasons: string[]; impossible?: { capacity: number; required: number; gap: number; addDays: number; removeVisits: number; firstNeeded: number; message: string } | null } | null
  /** The history template used: Brick x weekday dates, kind per Brick, and where it came from. */
  template?: { source: 'own' | 'any' | 'none'; ownVisits: number; freeBricks: number; restrictedBricks: number; unknownBricks: number; bricks: { brick: string; doctors: number; dates: number[]; allowed: number[]; kind: 'free' | 'restricted' | 'unknown'; repeatRatio: number | null }[] } | null
  /** Per date: the Brick(s) assigned, why, and the reason when a day stayed empty. */
  dayReasons?: Record<string, string>
  /** Planned visits per grade, and per day. */
  grades?: { A: number; B: number; C: number }
  dayGrades?: Record<string, { A: number; B: number; C: number }>
  /** Waiting of 20-45 minutes allowed because the doctor is certain to be present that day. */
  waitAllowed?: { doctors: number; minutes: number }
}
export interface PlanResult { rows: PlanRow[]; summary: PlanSummary; params: PlanParams; validation: ValidationResult }

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

export type Gps = { lat: number; lng: number }
export const hasGps = <T extends { lat: number | null; lng: number | null }>(d: T): d is T & Gps => d.lat !== null && d.lng !== null && Number.isFinite(d.lat) && Number.isFinite(d.lng)
export const isoDow = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay() || 7
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Estimated distance in km: straight line x detour factor. It is an estimate, not road distance. */
export const estKm = (a: Gps, b: Gps, detour: number): number => haversineKm(a, b) * detour

/** Estimated km walked through the doctors in the given order (only doctors with GPS count). */
export function routeKm(points: ({ lat: number | null; lng: number | null } | undefined)[], detour: number = DEFAULT_PARAMS.detourFactor): number {
  let km = 0
  let prev: Gps | null = null
  for (const p of points) {
    if (!p || p.lat === null || p.lng === null) continue
    const cur = { lat: p.lat, lng: p.lng }
    if (prev) km += estKm(prev, cur, detour)
    prev = cur
  }
  return km
}

/** The brick label used for the day rules; doctors without a brick count as one brick of their own. */
export const brickOf = (d: { brick: string | null }): string => (d.brick && d.brick.trim() !== '' ? d.brick : '(no brick)')

/** Lookup of the days two bricks were worked together before (either order). */
export function pairLookup(pairs: BrickPair[] | undefined): (a: string, b: string) => BrickPair | null {
  const m = new Map<string, BrickPair>()
  for (const p of pairs ?? []) { m.set(`${p.a}|${p.b}`, p); m.set(`${p.b}|${p.a}`, p) }
  return (a, b) => m.get(`${a}|${b}`) ?? null
}
/** Two bricks may share a day if they were worked together in the PM at least twice, or in the same day in different shifts (AM in one, PM in the other). */
export const pairAllowed = (p: BrickPair | null): boolean => p !== null && (p.pm_days >= 2 || p.any_days - p.pm_days >= 1)
export const pairWhy = (p: BrickPair): string => (p.pm_days >= 2 ? `worked together ${p.pm_days} PM days before` : `worked together AM + PM ${p.any_days - p.pm_days} day${p.any_days - p.pm_days === 1 ? '' : 's'} before`)
export const WEEKDAY = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/**
 * Approval needs both end-of-month targets: PCF and Coverage (doctors with a done or planned visit / doctors of the list) of 90% or more.
 * Save draft stays allowed; there is no "approve anyway".
 */
export function approvalState(s: PlanSummary | null | undefined, p: Pick<PlanParams, 'minPcf' | 'minCoverage'> = DEFAULT_PARAMS): { allowed: boolean; message: string | null } {
  if (!s || s.mode === 'none') return { allowed: false, message: 'There is no plan to approve.' }
  const bits: string[] = []
  if (s.pcf.pct < p.minPcf) bits.push(`PCF ${(s.pcf.pct * 100).toFixed(1)}% < ${Math.round(p.minPcf * 100)}%`)
  const cov = s.covEnd?.pct ?? 0
  if (cov < p.minCoverage) bits.push(`end-of-month Coverage ${(cov * 100).toFixed(1)}% < ${Math.round(p.minCoverage * 100)}%`)
  return bits.length === 0 ? { allowed: true, message: null } : { allowed: false, message: `Approve is disabled: ${bits.join(' · ')}.` }
}

/** Minimum calendar days between two visits of one doctor: 2 visits a month -> 10, 3 -> 7, 4 or more -> 5, one visit -> none. Reduced (step D): 7 / 5 / 4. */
export const gapDaysFor = (freq: number, reduced = false): number => (reduced ? (freq >= 4 ? 4 : freq === 3 ? 5 : freq === 2 ? 7 : 0) : freq >= 4 ? 5 : freq === 3 ? 7 : freq === 2 ? 10 : 0)
/** Calendar day number (days since 1970-01-01) of an ISO date. */
export const dayNum = (iso: string): number => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000)

/** One real PM visit of the rep (plan_actuals). */
export interface ActualVisit { day: string; doctor_id: number; visit_time: string | null; by_rep?: number | null }
