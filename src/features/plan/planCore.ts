/** Shared types, constants and small helpers of the monthly planner. No imports: it is also run directly by scripts/planner.test.mjs. */

export interface PlanDoctor {
  doctor_id: number; name: string; account: string | null; account_type: string | null
  freq: number; brick: string | null; division: string | null
  lat: number | null; lng: number | null; pos_source: string | null
  usual_isodow: number | null; usual_hour: string | null; n_visits: number
  /** From the rep's own last 3 months (strong preferences, not hard rules): the usual weekday and the hours he is usually visited in. */
  pref_isodow?: number | null
  win_start?: number | null
  win_end?: number | null
  n_hist?: number
}
export interface PlanDay { day: string; isodow: number; closed: boolean; reason: string | null }
/** One pair of bricks the rep really worked in the same day before (plan_brick_pairs). */
export interface BrickPair { a: string; b: string; pm_days: number; any_days: number; last_day: string | null }
export interface BrickRepeat { brick: string; repeat_days: number; brick_days: number; last_repeat: string | null }
export interface PlanInputs {
  rep: { id: number; name: string; code: string } | null
  month: string; list_month: string | null; box_id: number | null
  daily_target: number | null; days: PlanDay[]; doctors: PlanDoctor[]
  /** The rep's own PM window in minutes: earliest / latest visit start (5th-95th percentile of his last 3 months). Absent = default window. */
  window?: { start: number; end: number } | null
  /** How often the rep really worked the same brick two PM working days in a row (plan_brick_repeats); undefined = not loaded. */
  brickRepeats?: BrickRepeat[]
  /** Bricks worked together before; undefined = not loaded (then no day may have two bricks). */
  brickPairs?: BrickPair[]
  /** Plan only from this day on (mid-month re-plan); earlier days are not touched. */
  fromDay?: string | null
  /** Visits already done this month per doctor (plan_actuals): the plan only covers freq - done. */
  done?: Record<number, number>
}

/** Hard cap: no day of any plan has more visits than this, whatever the constraint. */
export const MAX_PER_DAY = 12

export interface PlanParams {
  coverageDay: number; minCoverage: number; minPcf: number
  maxDay: number; minDay: number; extraLevels: number[]
  maxBricksPerDay: number; minSecondBrickDoctors: number
  visitMinutes: number; speedKmh: number; detourFactor: number; gapMin: number; gapMax: number
  maxWaitMin: number; earlyToleranceMin: number; windowGapMaxMin: number; maxBrickRepeats: number; minGapDays: number
  defaultStart: string; defaultEnd: string; fallbackTarget: number; minHistory: number
}
export const DEFAULT_PARAMS: PlanParams = {
  coverageDay: 15, minCoverage: 0.9, minPcf: 0.9,
  maxDay: MAX_PER_DAY, minDay: 6, extraLevels: [11, 12],
  maxBricksPerDay: 2, minSecondBrickDoctors: 3,
  visitMinutes: 15, speedKmh: 25, detourFactor: 1.35, gapMin: 15, gapMax: 25,
  maxWaitMin: 45, earlyToleranceMin: 20, windowGapMaxMin: 90, maxBrickRepeats: 3, minGapDays: 5,
  defaultStart: '14:00', defaultEnd: '22:00', fallbackTarget: 8, minHistory: 30,
}

export interface PlanRow { day: string; seq: number; doctor_id: number; planned_time: string | null; fixed: boolean; visit_no: number; note: string | null }
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
  twoBrickDays: { day: string; a: string; b: string; why: string }[]
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
  window: { start: string; end: string; own: boolean }
  fromDay: string | null
  warnings: string[]
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
/** Two bricks may share a day only if the rep worked them together before: both in the PM, or in any shift (AM in one, PM in the other). */
export const pairAllowed = (p: BrickPair | null): boolean => p !== null && (p.pm_days >= 1 || p.any_days >= 1)
export const pairWhy = (p: BrickPair): string => (p.pm_days >= 1 ? `worked together ${p.pm_days} PM day${p.pm_days === 1 ? '' : 's'} before` : `worked together ${p.any_days} day${p.any_days === 1 ? '' : 's'} before (AM + PM)`)

/** One real PM visit of the rep (plan_actuals). */
export interface ActualVisit { day: string; doctor_id: number; visit_time: string | null }
