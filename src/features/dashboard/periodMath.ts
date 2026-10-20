/**
 * Dashboard period: whole months only (KPIs and sales are monthly). Pure functions, no imports, no DOM:
 * also run by scripts/dashboardPeriod.test.mjs. Month strings are "YYYY-MM"; days are "YYYY-MM-DD".
 */

export type PeriodMode = 'month' | 'quarter' | 'semester' | 'custom'
export const MODES: PeriodMode[] = ['month', 'quarter', 'semester', 'custom']

export interface Period { mode: PeriodMode; fromYM: string; toYM: string }

const YM = /^\d{4}-(0[1-9]|1[0-2])$/
export const isYM = (s: unknown): s is string => typeof s === 'string' && YM.test(s)

const idx = (ym: string): number => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1
const fromIdx = (i: number): string => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`

export const addYM = (ym: string, n: number): string => fromIdx(idx(ym) + n)
export const monthCount = (fromYM: string, toYM: string): number => idx(toYM) - idx(fromYM) + 1
export const monthsOf = (fromYM: string, toYM: string): string[] => Array.from({ length: Math.max(0, monthCount(fromYM, toYM)) }, (_, i) => addYM(fromYM, i))

export const firstDay = (ym: string): string => `${ym}-01`
export function lastDay(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/** Snap a period to its mode: a quarter starts on a quarter boundary, a semester on January / July, a month is one month. */
export function normalizePeriod(p: Period): Period {
  const [a, b] = p.fromYM <= p.toYM ? [p.fromYM, p.toYM] : [p.toYM, p.fromYM]
  const y = a.slice(0, 4)
  const m = Number(a.slice(5, 7))
  if (p.mode === 'month') return { mode: 'month', fromYM: a, toYM: a }
  if (p.mode === 'quarter') { const s = Math.floor((m - 1) / 3) * 3 + 1; const f = `${y}-${String(s).padStart(2, '0')}`; return { mode: 'quarter', fromYM: f, toYM: addYM(f, 2) } }
  if (p.mode === 'semester') { const f = `${y}-${m <= 6 ? '01' : '07'}`; return { mode: 'semester', fromYM: f, toYM: addYM(f, 5) } }
  return { mode: 'custom', fromYM: a, toYM: b }
}

/**
 * Read ?mode=&pfrom=&pto= (months). Missing or invalid values fall back to the default month.
 * `from` / `to` are the GLOBAL day range of the top bar (2026-02-01), so the page period uses its own names; an old
 * ?from=2026-02 link still works because only a YYYY-MM value is accepted.
 */
export function parsePeriod(get: (k: string) => string | null, defaultYM: string): Period {
  const m = get('mode')
  const mode = (MODES as string[]).includes(m ?? '') ? (m as PeriodMode) : null
  const from = get('pfrom') ?? get('from')
  const to = get('pto') ?? get('to')
  if (!mode && !isYM(from) && !isYM(to)) return { mode: 'month', fromYM: defaultYM, toYM: defaultYM }
  const f = isYM(from) ? from : isYM(to) ? to : defaultYM
  const t = isYM(to) ? to : f
  return normalizePeriod({ mode: mode ?? (f === t ? 'month' : 'custom'), fromYM: f, toYM: t })
}

export interface Resolved { from: string; to: string; prevFrom: string; prevTo: string; months: string[]; n: number }

/** First day of the first month, last day of the last month, and the immediately preceding period of the same number of months. */
export function resolvePeriod(p: Period): Resolved {
  const n = monthCount(p.fromYM, p.toYM)
  const prevToYM = addYM(p.fromYM, -1)
  const prevFromYM = addYM(prevToYM, -(n - 1))
  return { from: firstDay(p.fromYM), to: lastDay(p.toYM), prevFrom: firstDay(prevFromYM), prevTo: lastDay(prevToYM), months: monthsOf(p.fromYM, p.toYM), n }
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monthName = (ym: string): string => MON[Number(ym.slice(5, 7)) - 1]
export const monthShort = (ym: string): string => `${monthName(ym)} ${ym.slice(2, 4)}`

export function periodLabel(p: Period): string {
  const y = p.fromYM.slice(0, 4)
  if (p.mode === 'month') return `${monthName(p.fromYM)} ${y}`
  if (p.mode === 'quarter') return `Q${Math.floor((Number(p.fromYM.slice(5, 7)) - 1) / 3) + 1} ${y}`
  if (p.mode === 'semester') return `${Number(p.fromYM.slice(5, 7)) <= 6 ? 'H1' : 'H2'} ${y}`
  return p.fromYM === p.toYM ? `${monthName(p.fromYM)} ${y}` : `${monthName(p.fromYM)} ${y} – ${monthName(p.toYM)} ${p.toYM.slice(0, 4)}`
}

/** URL query for a period + line (keeps unrelated parameters out). */
export function periodQuery(p: Period, line: number | null): string {
  const q = new URLSearchParams({ mode: p.mode, pfrom: p.fromYM, pto: p.toYM })
  if (line !== null) q.set('line', String(line))
  return q.toString()
}

/** `current` with the period + line replaced; every other parameter (the global from= / to= day range, shift, group…) stays. */
export function withPeriodQuery(current: string, p: Period, line: number | null): URLSearchParams {
  const q = new URLSearchParams(current)
  for (const k of ['mode', 'pfrom', 'pto', 'line']) q.delete(k)
  if (isYM(q.get('from'))) q.delete('from') // old links
  if (isYM(q.get('to'))) q.delete('to')
  for (const [k, v] of new URLSearchParams(periodQuery(p, line))) q.set(k, v)
  return q
}
