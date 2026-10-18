/**
 * Box → reps history: normalises box_rep_history rows and computes the "Vacant" gaps between periods.
 * Dates are plain YYYY-MM-DD strings; day arithmetic is UTC-only (never local-time Date conversion).
 */

export interface RepPeriod { repId: number | null; name: string; code: string | null; from: string; to: string | null }
export type BoxSegment =
  | ({ type: 'rep' } & RepPeriod & { days: number | null })
  | { type: 'vacant'; from: string; to: string | null; days: number | null }

const DAY_MS = 86_400_000
const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
export const addDays = (iso: string, n: number): string => new Date(utc(iso) + n * DAY_MS).toISOString().slice(0, 10)
/** Inclusive number of days between two dates. */
export const daysInclusive = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / DAY_MS) + 1

const pick = (o: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]
  return undefined
}
const dateOf = (v: unknown): string | null => (v === undefined || v === null ? null : /^\d{4}-\d\d-\d\d/.test(String(v)) ? String(v).slice(0, 10) : null)

/** box_rep_history rows (key spellings read tolerantly) -> periods, oldest first. Rows without a start date are dropped. */
export function toRepPeriods(rows: unknown): RepPeriod[] {
  if (!Array.isArray(rows)) return []
  const out: RepPeriod[] = []
  for (const r of rows) {
    if (typeof r !== 'object' || r === null) continue
    const o = r as Record<string, unknown>
    const from = dateOf(pick(o, ['valid_from', 'from', 'date_from', 'start', 'from_date']))
    if (!from) continue
    const id = Number(pick(o, ['rep_id', 'id']))
    out.push({
      repId: Number.isInteger(id) ? id : null,
      name: String(pick(o, ['rep_name', 'name', 'rep']) ?? '—'),
      code: pick(o, ['rep_code', 'code']) === undefined ? null : String(pick(o, ['rep_code', 'code'])),
      from,
      to: dateOf(pick(o, ['valid_to', 'to', 'date_to', 'end', 'to_date'])),
    })
  }
  return out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
}

/**
 * Timeline segments: each rep period plus a "Vacant" segment for every gap between two periods
 * (from the day after one ends to the day before the next starts, length in days).
 * `today` closes open-ended periods for the day count only. A period that has not started yet is kept as is.
 * Before the first period nothing is invented: the box may not have existed yet.
 */
export function boxSegments(periods: RepPeriod[], today: string): BoxSegment[] {
  const out: BoxSegment[] = []
  const sorted = [...periods].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
  let coveredTo: string | null = null // last day covered so far; null = nothing yet or open-ended
  let open = false
  sorted.forEach((p) => {
    if (coveredTo !== null && !open) {
      const gapFrom = addDays(coveredTo, 1)
      const gapTo = addDays(p.from, -1)
      if (gapFrom <= gapTo) out.push({ type: 'vacant', from: gapFrom, to: gapTo, days: daysInclusive(gapFrom, gapTo) })
    }
    const end = p.to ?? today
    out.push({ type: 'rep', ...p, days: end >= p.from ? daysInclusive(p.from, end) : null })
    if (p.to === null) open = true
    else if (coveredTo === null || p.to > coveredTo) coveredTo = p.to
  })
  // Last period ended before today: the box is vacant since then.
  if (!open && coveredTo !== null && addDays(coveredTo, 1) <= today) {
    const from = addDays(coveredTo, 1)
    out.push({ type: 'vacant', from, to: null, days: daysInclusive(from, today) })
  }
  return out
}

/** Only the gaps, e.g. for the summary line "Vacant 3 times, 112 days in total". */
export function vacancyGaps(periods: RepPeriod[], today: string): { from: string; to: string | null; days: number }[] {
  return boxSegments(periods, today).flatMap((s) => (s.type === 'vacant' ? [{ from: s.from, to: s.to, days: s.days ?? 0 }] : []))
}
