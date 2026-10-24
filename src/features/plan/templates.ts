/**
 * History templates of the monthly planner (v6): history is permission.
 *  - Brick x weekday: on how many distinct dates each Brick was visited on each weekday.
 *  - Brick typical hours (P25-P75 of its timed visits, per weekday when there are enough).
 *  - Which history is used: the rep's own when he has enough visits of his own, else the visits of any rep to the same doctors.
 * No imports from the planner: it is run directly by scripts/planner.test.mjs.
 */
import { brickOf, isoDow, toMin, type ActualVisit, type BrickRepeat, type PlanDoctor, type PlanParams } from './planCore.ts'

export interface BrickTpl {
  brick: string
  doctors: number
  /** Distinct dates the Brick was visited, per ISO weekday (index 1 = Monday ... 7 = Sunday). */
  dates: number[]
  /** Visit times (minutes) of the Brick: all, and per weekday. */
  times: number[]
  timesByDow: number[][]
  /** repeat_days / brick_days from plan_brick_repeats; null when not known. */
  repeatRatio: number | null
}

export const pctOf = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]

/** The rep's own visits when he has at least `minOwn` of them, else the visits of any rep. */
export function pickHistory(history: ActualVisit[], repId: number | null, minOwn: number): { visits: ActualVisit[]; source: 'own' | 'any' | 'none'; ownVisits: number } {
  if (history.length === 0) return { visits: [], source: 'none', ownVisits: 0 }
  const own = repId === null ? [] : history.filter((v) => v.by_rep === repId)
  if (own.length >= minOwn) return { visits: own, source: 'own', ownVisits: own.length }
  return { visits: history, source: 'any', ownVisits: own.length }
}

export function buildBrickTemplates(history: ActualVisit[], doctors: PlanDoctor[], repeats: BrickRepeat[] | undefined): Map<string, BrickTpl> {
  const brickByDoc = new Map(doctors.map((d) => [d.doctor_id, brickOf(d)]))
  const out = new Map<string, BrickTpl>()
  const get = (b: string): BrickTpl => {
    let t = out.get(b)
    if (!t) { t = { brick: b, doctors: 0, dates: [0, 0, 0, 0, 0, 0, 0, 0], times: [], timesByDow: [[], [], [], [], [], [], [], []], repeatRatio: null }; out.set(b, t) }
    return t
  }
  for (const d of doctors) if (d.freq > 0) get(brickOf(d)).doctors++
  const seen = new Set<string>()
  for (const v of history) {
    const b = brickByDoc.get(v.doctor_id)
    if (b === undefined) continue
    const t = get(b)
    const dow = isoDow(v.day)
    const key = `${b}|${v.day}`
    if (!seen.has(key)) { seen.add(key); t.dates[dow]++ }
    const m = toMin(v.visit_time)
    if (m !== null) { t.times.push(m); t.timesByDow[dow].push(m) }
  }
  for (const t of out.values()) { t.times.sort((a, b) => a - b); for (const l of t.timesByDow) l.sort((a, b) => a - b) }
  for (const r of repeats ?? []) { const t = out.get(r.brick); if (t && r.brick_days > 0) t.repeatRatio = r.repeat_days / r.brick_days }
  return out
}

/** The set of Bricks visited on each (rep, date) of the history: used to tell whether three Bricks were really worked together. */
export function comboSets(history: ActualVisit[], doctors: PlanDoctor[]): Set<string>[] {
  const brickByDoc = new Map(doctors.map((d) => [d.doctor_id, brickOf(d)]))
  const by = new Map<string, Set<string>>()
  for (const v of history) {
    const b = brickByDoc.get(v.doctor_id)
    if (b === undefined) continue
    const key = `${v.by_rep ?? 'x'}|${v.day}`
    const s = by.get(key) ?? new Set<string>()
    s.add(b)
    by.set(key, s)
  }
  return [...by.values()]
}
/** On how many different days (of one rep) all these Bricks were visited together. */
export const comboDays = (sets: Set<string>[], bricks: string[]): number => sets.filter((s) => bricks.every((b) => s.has(b))).length

/** Weekdays on which the Brick was visited on at least `minDates` distinct dates. */
export const allowedDays = (t: BrickTpl | undefined, minDates: number): number[] => (t ? [1, 2, 3, 4, 5, 6, 7].filter((d) => t.dates[d] >= minDates) : [])

/** free = visited on 4+ allowed weekdays, restricted = 1-3, unknown = none. */
export function brickKind(t: BrickTpl | undefined, minDates: number): 'free' | 'restricted' | 'unknown' {
  const n = allowedDays(t, minDates).length
  return n >= 4 ? 'free' : n > 0 ? 'restricted' : 'unknown'
}

/** P25-P75 of the Brick's visit times on that weekday (5+ visits), else of all its visits (5+), else null. */
export function brickHours(t: BrickTpl | undefined, dow: number): { start: number; end: number } | null {
  if (!t) return null
  const l = t.timesByDow[dow].length >= 5 ? t.timesByDow[dow] : t.times.length >= 5 ? t.times : null
  return l ? { start: pctOf(l, 0.25), end: pctOf(l, 0.75) } : null
}

export function templateSummary(tpl: Map<string, BrickTpl>, p: PlanParams, minDates: number): { bricks: { brick: string; doctors: number; dates: number[]; allowed: number[]; kind: 'free' | 'restricted' | 'unknown'; repeatRatio: number | null }[]; free: number; restricted: number; unknown: number } {
  const bricks = [...tpl.values()].filter((t) => t.doctors > 0).sort((a, b) => a.brick.localeCompare(b.brick)).map((t) => ({ brick: t.brick, doctors: t.doctors, dates: t.dates.slice(1), allowed: allowedDays(t, minDates), kind: brickKind(t, minDates), repeatRatio: t.repeatRatio }))
  void p
  return { bricks, free: bricks.filter((b) => b.kind === 'free').length, restricted: bricks.filter((b) => b.kind === 'restricted').length, unknown: bricks.filter((b) => b.kind === 'unknown').length }
}
