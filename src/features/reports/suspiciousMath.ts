/**
 * "Suspicious Cases" report (monthly): pure helpers (no imports: also run directly by scripts/suspicious.test.mjs).
 * The report shows data patterns, not proof.
 */
export interface Cluster {
  rep_id: number; rep_name: string; rep_code: string; rep_status: string | null; resign_date: string | null; line_id: number | null; manager_id: number | null
  cell_lat: number; cell_lng: number
  clinics: number; visits: number; visit_days: number; pct_of_rep_pm_visits: number
  clinics_registered_here: number; clinics_far: number; visits_far: number; night_visits: number; other_reps_at_cell: number
  first_visit: string | null; last_visit: string | null; severity: Severity
}
export interface VisitStamp { d: string; t: string | null }
export interface ClinicRow {
  account: string; acc_type_code: string | null; visits: number; first_visit: string | null; last_visit: string | null
  avg_deviation_m: number | null; acc_lat: number | null; acc_lng: number | null; pattern: string | null; visit_log: VisitStamp[]
}
export type Severity = 'High' | 'Medium' | 'Low'
export type Pattern = 'registered_here' | 'visit_far' | 'unknown'

/** A clinic whose registered position is within this distance of the device position is "registered at this point". */
export const DEVIATION_THRESHOLD_M = 300
export const BUSY_DAY_VISITS = 8
/** Visit chips shown before "Show all". */
export const CHIPS_BEFORE_TOGGLE = 12
export const DEFAULT_SEVERITIES: Severity[] = ['High', 'Medium']
/** The monthly report always asks for Bricks of 10+ clinics. */
export const MIN_CLINICS = 10
export const DISCLAIMER = 'This report shows data patterns, not proof. Confirm with the line manager before any action.'
export const NO_CASES = 'No suspicious cases in this period'

export const clusterKey = (c: Pick<Cluster, 'rep_id' | 'cell_lat' | 'cell_lng'>): string => `${c.rep_id}|${c.cell_lat}|${c.cell_lng}`

/* ------------------------------ month ------------------------------ */
const pad = (n: number) => String(n).padStart(2, '0')
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** The latest closed month (YYYY-MM): the month before the one `today` is in. */
export function latestClosedMonth(today: Date): string {
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth() - 1, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}
/** A month (YYYY-MM) -> the RPC range: first day of the month, first day of the next month (exclusive). */
export function monthRange(ym: string): { from: string; to: string } {
  const y = Number(ym.slice(0, 4))
  const m = Number(ym.slice(5, 7))
  return { from: `${y}-${pad(m)}-01`, to: m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01` }
}
export const monthLabel = (ym: string): string => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1] ?? ''} ${ym.slice(0, 4)}`
export const fmtDate = (iso: string | null): string => (iso ? `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '')
/** Every day of [from, to). */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(`${from}T00:00:00Z`); t < Date.parse(`${to}T00:00:00Z`); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

/* ------------------------------ visit dates ------------------------------ */
/** Ascending by date, then time (a visit without a time first). */
export function orderedVisits(log: VisitStamp[] | null | undefined): VisitStamp[] {
  return [...(log ?? [])].sort((a, b) => a.d.localeCompare(b.d) || (a.t ?? '').localeCompare(b.t ?? ''))
}
/** "07 Sep 19:40" (the chip). */
export const visitChip = (v: VisitStamp): string => `${v.d.slice(8, 10)} ${MON[Number(v.d.slice(5, 7)) - 1]}${v.t ? ` ${v.t}` : ''}`
/** "07/09 19:40" (the Excel cell). */
export const visitExcel = (v: VisitStamp): string => `${v.d.slice(8, 10)}/${v.d.slice(5, 7)}${v.t ? ` ${v.t}` : ''}`
export const visitDatesCell = (log: VisitStamp[] | null | undefined): string => orderedVisits(log).map(visitExcel).join('; ')

/* ------------------------------ chips ------------------------------ */
export function patternOf(avgDeviationM: number | null | undefined): Pattern {
  if (avgDeviationM === null || avgDeviationM === undefined || !Number.isFinite(avgDeviationM)) return 'unknown'
  return avgDeviationM <= DEVIATION_THRESHOLD_M ? 'registered_here' : 'visit_far'
}
/** "850 m" under 1 km (rounded to 10 m), else km with one decimal under 10 km, whole km above. */
export function fmtDistance(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return ''
  if (m < 1000) return `${Math.round(m / 10) * 10} m`
  const km = m / 1000
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}
export function patternChip(avgDeviationM: number | null | undefined): { label: string; tone: 'red' | 'amber' | 'grey' } {
  const p = patternOf(avgDeviationM)
  if (p === 'registered_here') return { label: 'Clinic registered at this point', tone: 'red' }
  if (p === 'visit_far') return { label: `Visit logged here, clinic ~${fmtDistance(avgDeviationM)} away`, tone: 'amber' }
  return { label: 'Deviation unknown', tone: 'grey' }
}
export const SEVERITY_TONE: Record<Severity, { label: string; classes: string; border: string }> = {
  High: { label: 'High', classes: 'bg-red-100 text-red-900', border: 'border-l-red-500' },
  Medium: { label: 'Medium', classes: 'bg-amber-100 text-amber-900', border: 'border-l-amber-500' },
  Low: { label: 'Low', classes: 'bg-gray-200 text-gray-800', border: 'border-l-gray-400' },
}
export const severityChip = (s: string): { label: string; classes: string; border: string } => SEVERITY_TONE[s as Severity] ?? SEVERITY_TONE.Low
const SEVERITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 }
/** The hover text of the severity chip: the numbers behind it. */
export function severityReason(c: Pick<Cluster, 'clinics' | 'pct_of_rep_pm_visits' | 'night_visits' | 'visits_far' | 'other_reps_at_cell'>): string {
  return `${c.clinics} clinics at the point · ${c.pct_of_rep_pm_visits.toFixed(1)}% of the rep's PM visits · ${c.night_visits} night visit${c.night_visits === 1 ? '' : 's'} · ${c.visits_far} visit${c.visits_far === 1 ? '' : 's'} logged from far · ${c.other_reps_at_cell} other rep${c.other_reps_at_cell === 1 ? '' : 's'} at the point`
}
/** The Resigned badge with the date, only for a resigned rep. */
export function resignedBadge(status: string | null | undefined, resignDate: string | null | undefined): { show: boolean; text: string } {
  if (status !== 'Resigned') return { show: false, text: '' }
  return { show: true, text: resignDate ? `Resigned ${fmtDate(resignDate)}` : 'Resigned' }
}
/** After 23:00 or before 06:00. */
export function isNight(hhmm: string | null | undefined): boolean {
  if (!hhmm) return false
  const h = Number(hhmm.slice(0, 2))
  return Number.isFinite(h) && (h >= 23 || h < 6)
}
export const mapsUrl = (lat: number, lng: number): string => `https://www.google.com/maps?q=${lat},${lng}`
/** A name from a list, or the id when it cannot be resolved ('' when there is no id). */
export const nameOrId = (id: number | null | undefined, names: Map<number, string>): string => (id === null || id === undefined ? '' : names.get(id) ?? `#${id}`)

/* ------------------------------ filters and sort ------------------------------ */
export interface Filters { severities: Severity[]; search: string; lineId: number | null; managerId: number | null }
/** Severity (High first), then clinics descending. */
export const sortClusters = (rows: Cluster[]): Cluster[] =>
  [...rows].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3) || b.clinics - a.clinics || b.visits - a.visits || a.rep_id - b.rep_id)
export function filterClusters(rows: Cluster[], f: Filters): Cluster[] {
  const q = f.search.trim().toLowerCase()
  return sortClusters(rows
    .filter((r) => f.severities.includes(r.severity))
    .filter((r) => f.managerId === null || r.manager_id === f.managerId)
    .filter((r) => f.lineId === null || r.line_id === f.lineId)
    .filter((r) => q === '' || r.rep_name.toLowerCase().includes(q) || r.rep_code.toLowerCase().includes(q)))
}
export interface Kpis { reps: number; clinics: number; visits: number; shareOfPmVisits: number }
/** Reps flagged, clinics sharing a location, visits involved, and their share of those reps' PM visits (the rep's total comes from visits / pct). */
export function summarize(rows: Cluster[]): Kpis {
  const repVisits = new Map<number, number>()
  const repTotal = new Map<number, number>()
  for (const r of rows) {
    repVisits.set(r.rep_id, (repVisits.get(r.rep_id) ?? 0) + r.visits)
    if (r.pct_of_rep_pm_visits > 0) repTotal.set(r.rep_id, Math.max(repTotal.get(r.rep_id) ?? 0, Math.round((r.visits * 100) / r.pct_of_rep_pm_visits)))
  }
  const visits = [...repVisits.values()].reduce((a, b) => a + b, 0)
  const total = [...repTotal.values()].reduce((a, b) => a + b, 0)
  return { reps: repVisits.size, clinics: rows.reduce((a, r) => a + r.clinics, 0), visits, shareOfPmVisits: total > 0 ? Math.min(1, visits / total) : 0 }
}
export const fmtPct = (v: number, digits = 1): string => `${(v * 100).toFixed(digits)}%`
export const fmtPctPoints = (v: number): string => `${(Math.round(v * 10) / 10).toFixed(1)}%`

/* ------------------------------ reading note and day strip ------------------------------ */
/** "N different PM clinics share one ~110 m location, M of them registered at the point and K visited from X km away." */
export function readingNote(c: Pick<Cluster, 'clinics' | 'clinics_registered_here' | 'clinics_far'>, detail: ClinicRow[] | null): string {
  const far = detail ? detail.filter((d) => patternOf(d.avg_deviation_m) === 'visit_far') : []
  const km = far.length > 0 ? far.reduce((a, d) => a + (d.avg_deviation_m ?? 0), 0) / far.length : 0
  const where = c.clinics_far > 0 ? `${c.clinics_far} visited from ${far.length > 0 ? `about ${fmtDistance(km)}` : 'far'} away` : ''
  return `${c.clinics} different PM clinics share one ~110 m location, ${c.clinics_registered_here} of them registered at the point${where ? ` and ${where}` : ''}.`
}
export interface StripDay { day: string; count: number; busy: boolean; night: number; visits: { t: string | null; clinic: string }[] }
/** One entry per day of [from, to) with the number of visits at this point and the visits themselves (time, clinic). */
export function buildDayStrip(detail: ClinicRow[], from: string, to: string): StripDay[] {
  const by = new Map<string, { t: string | null; clinic: string }[]>()
  for (const c of detail) for (const v of c.visit_log ?? []) by.set(v.d, [...(by.get(v.d) ?? []), { t: v.t, clinic: c.account }])
  return daysOf(from, to).map((day) => {
    const list = (by.get(day) ?? []).sort((a, b) => (a.t ?? '').localeCompare(b.t ?? ''))
    return { day, count: list.length, busy: list.length > BUSY_DAY_VISITS, night: list.filter((v) => isNight(v.t)).length, visits: list }
  })
}
/** Weekday header of the strip (the week the reps work: Saturday first). */
export const STRIP_WEEKDAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']
/** The column (0 = Saturday ... 6 = Friday) of a date. */
export const stripColumn = (iso: string): number => ((new Date(`${iso}T00:00:00Z`).getUTCDay() || 7) + 1) % 7
/** The month laid out in weeks of 7 cells (null = a day outside the month). */
export function stripWeeks(days: StripDay[]): (StripDay | null)[][] {
  const weeks: (StripDay | null)[][] = []
  let week: (StripDay | null)[] = []
  days.forEach((d, i) => {
    if (i === 0) for (let k = 0; k < stripColumn(d.day); k++) week.push(null)
    week.push(d)
    if (week.length === 7) { weeks.push(week); week = [] }
  })
  if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week) }
  return weeks
}

/* ------------------------------ Excel rows ------------------------------ */
type Cell = string | number | null
export interface RowNames { month: string; line: string; manager: string }
const repStatus = (c: Cluster): string => { const rb = resignedBadge(c.rep_status, c.resign_date); return rb.show ? rb.text : c.rep_status ?? '' }
/** The main table, same columns. */
export function summaryRow(c: Cluster, n: RowNames): Record<string, Cell> {
  return {
    Month: n.month, Severity: c.severity, Line: n.line, Manager: n.manager, 'Medical Rep': c.rep_name, 'Rep code': c.rep_code, Status: repStatus(c),
    Clinics: c.clinics, Visits: c.visits, 'Visit days': c.visit_days, '% of rep PM visits': c.pct_of_rep_pm_visits,
    'Clinics registered at the point': c.clinics_registered_here, 'Visits registered at the point': c.visits - c.visits_far,
    'Clinics visited from far': c.clinics_far, 'Visits from far': c.visits_far, 'Night visits': c.night_visits, 'Other reps at the point': c.other_reps_at_cell,
    'First visit': c.first_visit ?? '', 'Last visit': c.last_visit ?? '', 'Point latitude': c.cell_lat, 'Point longitude': c.cell_lng,
  }
}
/** One row per account of a rep and point. */
export function detailRows(c: Cluster, n: RowNames, detail: ClinicRow[]): Record<string, Cell>[] {
  return [...detail].sort((a, b) => b.visits - a.visits || a.account.localeCompare(b.account)).map((d) => ({
    Month: n.month, Severity: c.severity, Line: n.line, Manager: n.manager, 'Medical Rep': c.rep_name, 'Rep code': c.rep_code,
    'Account name': d.account, Type: d.acc_type_code ?? '', Visits: d.visits, 'Visit dates': visitDatesCell(d.visit_log),
    'First visit': d.first_visit ?? '', 'Last visit': d.last_visit ?? '', 'Avg deviation (m)': d.avg_deviation_m, Pattern: patternChip(d.avg_deviation_m).label,
    'Clinic latitude': d.acc_lat, 'Clinic longitude': d.acc_lng, 'Point latitude': c.cell_lat, 'Point longitude': c.cell_lng,
  }))
}
export const exportFileName = (ym: string): string => `Suspicious_Cases_${ym}.xlsx`
