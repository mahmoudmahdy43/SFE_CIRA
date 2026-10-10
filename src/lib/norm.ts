/**
 * Mirror of SQL `norm_name()` (01_schema.sql): lowercase, strip leading "- ",
 * strip trailing "()", collapse spaces / dots / dashes / underscores. Empty -> null.
 */
export function normName(t: string | null | undefined): string | null {
  const s = (t ?? '')
    .toLowerCase()
    .replace(/^\s*-\s*/, '')
    .replace(/\(\s*\)\s*$/, '')
    .replace(/[\s.\-_]+/g, ' ')
    .trim()
  return s === '' ? null : s
}

export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

export function addMonthsIso(iso: string, n: number): string {
  const [y, m] = iso.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`
}

/** Calendar date arithmetic on ISO strings, no timezone involved. */
export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

export function daysInMonth(iso: string): number {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
