/**
 * List Strategy screen helpers: parsing the typed percentages, the running total, strategy versions per line and the
 * upsert rows. Pure. The red flags / shares themselves are computed by the database views, not here.
 * No imports: this file is also run directly by scripts/reportMath.test.mjs.
 */

export interface StrategyRowLike { line_id: number; speciality_id: number; effective_from: string; share_pct: number }
/** speciality id -> typed text (empty = not set = saved as 0). */
export type StrategyForm = Record<number, string>

export const TOTAL_TARGET = 100

/** '' -> 0; a number 0-100 -> itself rounded to 1 decimal; anything else -> null (invalid). */
export function parseShare(text: string): number | null {
  const t = text.trim()
  if (t === '') return 0
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  return Math.round(n * 10) / 10
}

/** Invalid entries count as 0 so the running total stays readable while typing. */
export function formTotal(form: StrategyForm): number {
  const sum = Object.values(form).reduce((a, t) => a + (parseShare(t) ?? 0), 0)
  return Math.round(sum * 10) / 10
}

export const isFullTotal = (total: number): boolean => Math.abs(total - TOTAL_TARGET) < 0.05

const trim1 = (v: number): string => String(Number(v.toFixed(1)))
export const totalMessage = (total: number): string =>
  isFullTotal(total) ? `total ${trim1(total)}% - adds up to 100%` : `total ${trim1(total)}% - the strategy should add up to 100%`

/** Ids whose typed value is not a valid 0-100 number. */
export const invalidIds = (form: StrategyForm): number[] => Object.entries(form).filter(([, t]) => parseShare(t) === null).map(([id]) => Number(id))

/** Distinct effective_from months already entered for a line, newest first. */
export function versionsOf(rows: StrategyRowLike[], lineId: number): string[] {
  return [...new Set(rows.filter((r) => r.line_id === lineId).map((r) => r.effective_from))].sort().reverse()
}

/** The saved version of a line exactly at `effective` as a form (empty when nothing was saved for that month). */
export function formAt(rows: StrategyRowLike[], lineId: number, effective: string): StrategyForm {
  const out: StrategyForm = {}
  for (const r of rows) if (r.line_id === lineId && r.effective_from === effective) out[r.speciality_id] = String(r.share_pct)
  return out
}

/** The latest version of a line strictly before `effective`, or null. */
export function previousVersion(rows: StrategyRowLike[], lineId: number, effective: string): { effective_from: string; form: StrategyForm } | null {
  const prev = versionsOf(rows, lineId).find((v) => v < effective)
  return prev ? { effective_from: prev, form: formAt(rows, lineId, prev) } : null
}

/** One row per listed speciality; empty / unset is saved as 0 (never deleted). Throws on an invalid entry. */
export function buildUpserts(lineId: number, effective: string, ids: number[], form: StrategyForm): StrategyRowLike[] {
  return ids.map((id) => {
    const v = parseShare(form[id] ?? '')
    if (v === null) throw new Error('Strategy % must be a number between 0 and 100')
    return { line_id: lineId, speciality_id: id, effective_from: effective, share_pct: v }
  })
}

/** Red threshold input: a number 0-100 in steps of 0.5; null when invalid. */
export function parseThreshold(text: string): number | null {
  const t = text.trim()
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0 || n > 100 || Math.abs(n * 2 - Math.round(n * 2)) > 1e-9) return null
  return n
}

/** First-of-month ISO dates around `center` (-24..+12 months) plus the extra ones, sorted. */
export function monthChoices(center: string, extra: string[]): string[] {
  const [y, m] = center.split('-').map(Number)
  const set = new Set<string>(extra)
  for (let i = -24; i <= 12; i++) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1))
    set.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`)
  }
  return [...set].sort()
}
