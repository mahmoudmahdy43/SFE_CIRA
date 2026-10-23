/**
 * The global report period: one month (default) or a custom From / To day range, kept in the URL as
 * `?from=YYYY-MM-DD&to=YYYY-MM-DD`. Pure functions, no runtime imports: also run by scripts/dateRange.test.mjs.
 */

export const MIN_DAY = '2026-01-01'
export const MAX_DAY = '2026-12-31'

export interface DateRange {
  from: string
  to: string
  /** First day of the month of the To date: what monthly-only reports show. */
  month: string
  /** From is the 1st and To is the last day of that same month. */
  isFullMonth: boolean
  /** From and To are in the same calendar month. */
  isSingleMonth: boolean
  /** Picked as a custom range (URL carries from / to). A custom range that happens to be a whole month still has isFullMonth. */
  custom: boolean
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDay(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

export const monthOf = (day: string): string => `${day.slice(0, 7)}-01`

export function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0))
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10) // '' when no month is loaded yet
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const r = new Date(Date.UTC(y, m - 1, d + n))
  return Number.isNaN(r.getTime()) ? '' : r.toISOString().slice(0, 10)
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`
}

/** Every first-of-month from the month of `from` to the month of `to`. */
export function monthsSpan(from: string, to: string): string[] {
  const out: string[] = []
  for (let m = monthOf(from); m <= monthOf(to); m = addMonths(m, 1)) out.push(m)
  return out
}

function build(from: string, to: string, custom: boolean): DateRange {
  const month = monthOf(to)
  return {
    from, to, month, custom,
    isFullMonth: from === monthOf(from) && monthOf(from) === month && to === lastDayOf(month),
    isSingleMonth: monthOf(from) === month,
  }
}

/** A whole month as a range (From = 1st, To = last day). */
export const monthRange = (month: string): DateRange => build(monthOf(month), lastDayOf(month), false)

/** A custom range, or null when it is invalid (bad date, From > To, outside 2026). */
export function customRange(from: unknown, to: unknown): DateRange | null {
  if (!isIsoDay(from) || !isIsoDay(to) || from > to || from < MIN_DAY || to > MAX_DAY) return null
  return build(from, to, true)
}

/** URL parameters (or null) + the month picked in the top bar -> the active range. Invalid parameters fall back to the month. */
export function resolveRange(params: { from?: string | null; to?: string | null }, month: string): DateRange {
  return customRange(params.from, params.to) ?? monthRange(month)
}

/** From is the 1st of a month and To is the last day of a month (possibly a later one): the monthly views cover it exactly. */
export const isWholeMonths = (r: Pick<DateRange, 'from' | 'to'>): boolean => r.from === monthOf(r.from) && r.to === lastDayOf(monthOf(r.to))

/** Writes (or removes) the range parameters, keeping every other parameter. A plain month carries none. */
export function withRangeParams(search: string, range: { from: string; to: string } | null): string {
  const p = new URLSearchParams(search)
  p.delete('from')
  p.delete('to')
  if (range) {
    p.set('from', range.from)
    p.set('to', range.to)
  }
  const s = p.toString()
  return s === '' ? '' : `?${s}`
}

export function readRangeParams(search: string): { from: string | null; to: string | null } {
  const p = new URLSearchParams(search)
  return { from: p.get('from'), to: p.get('to') }
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`

/** "1 Oct - 15 Oct 2026" (a different year on each side shows both years). */
export function periodLabel(from: string, to: string): string {
  return from.slice(0, 4) === to.slice(0, 4) ? `${dayLabel(from)} - ${dayLabel(to)} ${to.slice(0, 4)}` : `${dayLabel(from)} ${from.slice(0, 4)} - ${dayLabel(to)} ${to.slice(0, 4)}`
}
export const monthLabel = (month: string): string => `${MON[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`

/** File-name suffix with both dates: 2026-10-01_to_2026-10-15. */
export const rangeFileSlug = (from: string, to: string): string => `${from}_to_${to}`

/* ------------------------------ quick chips ------------------------------ */
export interface Preset { id: 'this-month' | 'last-month' | 'last-7' | 'last-15' | 'mtd'; label: string; from: string; to: string }

const clamp = (d: string) => (d < MIN_DAY ? MIN_DAY : d > MAX_DAY ? MAX_DAY : d)

/**
 * Quick ranges. This / Last month are calendar months of today; the rolling ones (Last 7 / 15 days, Month to date)
 * end on the latest visit date in the data (today when there is none).
 */
export function presets(today: string, latestVisit: string | null): Preset[] {
  const end = latestVisit ?? today
  const thisM = monthOf(today)
  const lastM = addMonths(thisM, -1)
  const raw: Preset[] = [
    { id: 'this-month', label: 'This month', from: thisM, to: lastDayOf(thisM) },
    { id: 'last-month', label: 'Last month', from: lastM, to: lastDayOf(lastM) },
    { id: 'last-7', label: 'Last 7 days', from: addDays(end, -6), to: end },
    { id: 'last-15', label: 'Last 15 days', from: addDays(end, -14), to: end },
    { id: 'mtd', label: 'Month to date', from: monthOf(end), to: end },
  ]
  return raw.map((p) => ({ ...p, from: clamp(p.from), to: clamp(p.to) }))
}

/** Reports built from monthly tables show the month of the To date; this is the note when the range is not that whole month. */
export function monthlyNote(range: Pick<DateRange, 'isFullMonth' | 'month'>): string | null {
  return range.isFullMonth ? null : `this report is monthly: showing ${monthLabel(range.month)}`
}
