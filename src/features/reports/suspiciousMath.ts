/**
 * "Suspicious Cases" report: pure helpers (no imports: also run directly by scripts/suspicious.test.mjs).
 * The report shows data patterns, not proof.
 */
export interface Cluster {
  rep_id: number; rep_name: string; rep_code: string; rep_status: string | null; resign_date: string | null; manager_id: number | null
  cell_lat: number; cell_lng: number
  clinics: number; visits: number; visit_days: number; pct_of_rep_pm_visits: number
  clinics_registered_here: number; clinics_far: number; visits_far: number; night_visits: number; other_reps_at_cell: number
  first_visit: string | null; last_visit: string | null; severity: Severity
}
export interface ClinicRow {
  account: string; acc_type_code: string | null; visits: number; first_visit: string | null; last_visit: string | null
  avg_deviation_m: number | null; acc_lat: number | null; acc_lng: number | null; pattern: string | null; visit_log: { d: string; t: string | null }[]
}
export type Severity = 'High' | 'Medium' | 'Low'
export type Pattern = 'registered_here' | 'visit_far' | 'unknown'

/** A clinic whose registered position is within this distance of the device position is "registered at this point". */
export const DEVIATION_THRESHOLD_M = 300
export const BUSY_DAY_VISITS = 8
export const DEFAULT_SEVERITIES: Severity[] = ['High', 'Medium']
export const DEFAULT_MIN_CLINICS = 10
export const DISCLAIMER = 'This report shows data patterns, not proof. Confirm with the line manager (a field visit to a sample of the listed clinics) before any action.'
export const NO_CASES = 'No suspicious cases in this period'

export const clusterKey = (c: Pick<Cluster, 'rep_id' | 'cell_lat' | 'cell_lng'>): string => `${c.rep_id}|${c.cell_lat}|${c.cell_lng}`

/* ------------------------------ dates ------------------------------ */
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
/** First day of the month after `ym` (YYYY-MM). */
export function nextMonthStart(ym: string): string {
  const y = Number(ym.slice(0, 4))
  const m = Number(ym.slice(5, 7))
  return m === 12 ? ymd(y + 1, 1, 1) : ymd(y, m + 1, 1)
}
/** Default range: the last 3 closed months. `to` is exclusive (the first day of the current month). */
export function defaultRange(today: Date): { from: string; to: string } {
  const y = today.getFullYear()
  const m = today.getMonth() + 1
  const to = ymd(y, m, 1)
  const d = new Date(Date.UTC(y, m - 1 - 3, 1))
  return { from: ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, 1), to }
}
/** From month and To month (both inclusive, YYYY-MM) -> the RPC range with an exclusive end. */
export function rangeFromMonths(fromMonth: string, toMonth: string): { from: string; to: string } {
  return { from: `${fromMonth}-01`, to: nextMonthStart(toMonth) }
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const fmtDate = (iso: string | null): string => (iso ? `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '')
/** "1 Jul 2026 - 30 Sep 2026" for a range with an exclusive end. */
export function rangeLabel(from: string, to: string): string {
  const last = new Date(Date.parse(`${to}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
  return `${fmtDate(from)} - ${fmtDate(last)}`
}
/** Every day of [from, to). */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(`${from}T00:00:00Z`); t < Date.parse(`${to}T00:00:00Z`); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}
/** The months (YYYY-MM-01) touched by [from, to). */
export function monthsOf(from: string, to: string): string[] {
  return [...new Set(daysOf(from, to).map((d) => `${d.slice(0, 7)}-01`))]
}

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
  if (p === 'visit_far') return { label: `Visit logged here, clinic ~${fmtDistance(avgDeviationM).replace(/^~/, '')} away`, tone: 'amber' }
  return { label: 'Deviation unknown', tone: 'grey' }
}
export const SEVERITY_TONE: Record<Severity, { label: string; classes: string }> = {
  High: { label: 'High', classes: 'bg-red-100 text-red-900' },
  Medium: { label: 'Medium', classes: 'bg-amber-100 text-amber-900' },
  Low: { label: 'Low', classes: 'bg-gray-200 text-gray-800' },
}
export const severityChip = (s: string): { label: string; classes: string } => SEVERITY_TONE[s as Severity] ?? SEVERITY_TONE.Low
/** The "Resigned" badge with the date, only for a resigned rep. */
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

/* ------------------------------ filters and cards ------------------------------ */
export interface Filters { severities: Severity[]; minClinics: number; search: string; lineId: number | null; managerId: number | null }
export function filterClusters(rows: Cluster[], f: Filters, lineOfRep: Map<number, number | null>): Cluster[] {
  const q = f.search.trim().toLowerCase()
  return rows
    .filter((r) => f.severities.includes(r.severity) && r.clinics >= f.minClinics)
    .filter((r) => f.managerId === null || r.manager_id === f.managerId)
    .filter((r) => f.lineId === null || lineOfRep.get(r.rep_id) === f.lineId)
    .filter((r) => q === '' || r.rep_name.toLowerCase().includes(q) || r.rep_code.toLowerCase().includes(q))
    .sort((a, b) => b.clinics - a.clinics || b.visits - a.visits || a.rep_id - b.rep_id)
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

/* ------------------------------ reading note and timeline ------------------------------ */
/** "N different PM clinics share one ~110 m location, M of them registered at the point and K visited from X km away." */
export function readingNote(c: Pick<Cluster, 'clinics' | 'clinics_registered_here' | 'clinics_far'>, detail: ClinicRow[] | null): string {
  const far = detail ? detail.filter((d) => patternOf(d.avg_deviation_m) === 'visit_far') : []
  const km = far.length > 0 ? far.reduce((a, d) => a + (d.avg_deviation_m ?? 0), 0) / far.length : 0
  const where = c.clinics_far > 0 ? `${c.clinics_far} visited from ${far.length > 0 ? `about ${fmtDistance(km)}` : 'far'} away` : ''
  return `${c.clinics} different PM clinics share one ~110 m location, ${c.clinics_registered_here} of them registered at the point${where ? ` and ${where}` : ''}.`
}
export interface TimelineDay { day: string; count: number; busy: boolean; night: number; visits: { t: string | null; clinic: string }[] }
/** One entry per day of the range with the number of visits at this point and the visits themselves (time, clinic). */
export function buildTimeline(detail: ClinicRow[], from: string, to: string): TimelineDay[] {
  const by = new Map<string, { t: string | null; clinic: string }[]>()
  for (const c of detail) for (const v of c.visit_log ?? []) by.set(v.d, [...(by.get(v.d) ?? []), { t: v.t, clinic: c.account }])
  return daysOf(from, to).map((day) => {
    const list = (by.get(day) ?? []).sort((a, b) => (a.t ?? '').localeCompare(b.t ?? ''))
    return { day, count: list.length, busy: list.length > BUSY_DAY_VISITS, night: list.filter((v) => isNight(v.t)).length, visits: list }
  })
}

/* ------------------------------ Excel rows ------------------------------ */
type Cell = string | number | null
export function summaryRow(c: Cluster, managerName: string): Record<string, Cell> {
  const rb = resignedBadge(c.rep_status, c.resign_date)
  return {
    Rep: c.rep_name, Code: c.rep_code, Status: rb.show ? rb.text : c.rep_status ?? '', Manager: managerName, Severity: c.severity,
    'Cell lat': c.cell_lat, 'Cell lng': c.cell_lng, Clinics: c.clinics, Visits: c.visits, Days: c.visit_days, '% of rep PM visits': c.pct_of_rep_pm_visits,
    'Clinics registered here': c.clinics_registered_here, 'Clinics visited from far': c.clinics_far, 'Visits from far': c.visits_far, 'Night visits': c.night_visits,
    'Other reps at this point': c.other_reps_at_cell, 'First visit': c.first_visit ?? '', 'Last visit': c.last_visit ?? '',
  }
}
export function detailRows(c: Cluster, managerName: string, detail: ClinicRow[]): Record<string, Cell>[] {
  return detail.map((d) => ({
    Rep: c.rep_name, Code: c.rep_code, Manager: managerName, Severity: c.severity, 'Cell lat': c.cell_lat, 'Cell lng': c.cell_lng,
    Clinic: d.account, Type: d.acc_type_code ?? '', Visits: d.visits, 'First visit': d.first_visit ?? '', 'Last visit': d.last_visit ?? '',
    'Avg deviation (m)': d.avg_deviation_m, Pattern: patternChip(d.avg_deviation_m).label, 'Clinic lat': d.acc_lat, 'Clinic lng': d.acc_lng,
    'Visit dates': (d.visit_log ?? []).map((v) => (v.t ? `${v.d} ${v.t}` : v.d)).join('; '),
  }))
}
