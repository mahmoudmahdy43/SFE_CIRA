/**
 * "Suspicious Cases" report (monthly): pure helpers (no imports: also run directly by scripts/suspicious.test.mjs).
 * The report shows data patterns, not proof.
 */
export interface Cluster {
  rep_id: number; rep_name: string; rep_code: string; rep_status: string | null; resign_date: string | null; line_id: number | null; manager_id: number | null
  cell_lat: number; cell_lng: number
  accounts: number; accounts_pm: number; accounts_am: number; doctors: number; visits: number; visit_days: number
  double_visits: number; single_visits: number; pct_of_rep_visits: number
  accounts_registered_here: number; accounts_far: number; visits_far: number; night_visits: number; other_reps_at_cell: number
  first_visit: string | null; last_visit: string | null; managers_joined: string; severity: Severity
}
/** One visit: `dbl` = a manager joined (Double), `mgr` = the manager's name(s). */
export interface VisitStamp { d: string; t: string | null; dbl: boolean; mgr: string | null }
export interface AccountRow {
  account_key: string; account_ext_id: string | null; account_name: string; acc_type_code: string | null; shift_group: string | null; doctors: number
  visits: number; double_visits: number; single_visits: number; first_visit: string | null; last_visit: string | null
  avg_deviation_m: number | null; acc_lat: number | null; acc_lng: number | null; pattern: string | null; visit_log: VisitStamp[]
}
export type Shift = 'PM' | 'AM' | 'BOTH'
export type VisitType = 'all' | 'double' | 'single'
export type Severity = 'High' | 'Medium' | 'Low'
export type Pattern = 'registered_here' | 'visit_far' | 'unknown'

/** An account whose registered position is within this distance of the device position is "registered at this point". */
export const DEVIATION_THRESHOLD_M = 300
export const BUSY_DAY_VISITS = 8
/** Visit chips shown before "Show all". */
export const CHIPS_BEFORE_TOGGLE = 12
export const DEFAULT_SEVERITIES: Severity[] = ['High', 'Medium']
/** The monthly report always asks for points of 10+ accounts. */
export const MIN_ACCOUNTS = 10
export const DEFAULT_SHIFT: Shift = 'BOTH'
/** The shift selector -> the `p_shifts` parameter of the RPCs. */
export const shiftParams = (s: Shift): string[] => (s === 'PM' ? ['PM'] : s === 'AM' ? ['AM'] : ['PM', 'AM'])
export const SHIFT_LABEL: Record<Shift, string> = { PM: 'PM', AM: 'AM', BOTH: 'Both' }
/** The Account ID key: account type + external id; without an external id, the account name (lower case, trimmed). Same rule as the SQL. */
export function accountKey(typeId: number | string | null | undefined, extId: string | null | undefined, name: string | null | undefined): string {
  const ext = extId === null || extId === undefined || String(extId).trim() === '' ? null : String(extId).trim()
  if (ext !== null && typeId !== null && typeId !== undefined) return `${typeId}|${ext}`
  return `N|${(name ?? '').trim().toLowerCase()}`
}
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
/** A month (YYYY-MM) moved by `delta` months. */
export function shiftMonth(ym: string, delta: number): string {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}
/** Every month from `minYm` to `maxYm`, ascending. */
export function monthsBetween(minYm: string, maxYm: string): string[] {
  const out: string[] = []
  for (let m = minYm; m <= maxYm && out.length < 600; m = shiftMonth(m, 1)) out.push(m)
  return out
}
export interface MonthOption { month: string; label: string; inProgress: boolean; maxDate: string }
/**
 * The month selector: only months that have visits (`maxByMonth`: month -> latest visit date, null = no visits), newest first.
 * The month `today` is in is still running and is labelled with the date its data reaches.
 */
export function buildMonthOptions(maxByMonth: Record<string, string | null>, today: Date): MonthOption[] {
  const current = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`
  return Object.entries(maxByMonth)
    .filter((e): e is [string, string] => e[1] !== null && e[1] !== undefined)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, maxDate]) => {
      const inProgress = month === current
      return { month, inProgress, maxDate, label: inProgress ? `${monthLabel(month)} — In progress (data to ${fmtDate(maxDate)})` : monthLabel(month) }
    })
}
/** The month to open: the one asked for when it has visits, else the latest month that has visits. */
export const pickMonth = (options: MonthOption[], wanted: string | null): string | null =>
  (wanted && options.some((o) => o.month === wanted) ? wanted : options[0]?.month ?? null)
export const isMonth = (s: string | null | undefined): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
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
/** The Double visits only, with the manager: "07/10 20:46 (Ahmed Niazi)". */
export const doubleDatesCell = (log: VisitStamp[] | null | undefined): string =>
  orderedVisits(log).filter((v) => v.dbl).map((v) => `${visitExcel(v)}${v.mgr ? ` (${v.mgr})` : ''}`).join('; ')
/** The hover text of a visit chip: the manager of a Double, "Single visit" otherwise. */
export const visitTooltip = (v: VisitStamp): string => (v.dbl ? `Double visit${v.mgr ? ` with ${v.mgr}` : ''}` : 'Single visit')
/** Percent of Double visits (0 when there are no visits), one decimal. */
export const pctDouble = (dbl: number, total: number): number => (total > 0 ? Math.round((dbl * 1000) / total) / 10 : 0)

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
  if (p === 'registered_here') return { label: 'Account registered at this point', tone: 'red' }
  if (p === 'visit_far') return { label: `Visit logged here, account ~${fmtDistance(avgDeviationM)} away`, tone: 'amber' }
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
export function severityReason(c: Pick<Cluster, 'accounts' | 'pct_of_rep_visits' | 'night_visits' | 'visits_far' | 'other_reps_at_cell'>): string {
  return `${c.accounts} accounts at the point · ${c.pct_of_rep_visits.toFixed(1)}% of the rep's visits · ${c.night_visits} night visit${c.night_visits === 1 ? '' : 's'} · ${c.visits_far} visit${c.visits_far === 1 ? '' : 's'} logged from far · ${c.other_reps_at_cell} other rep${c.other_reps_at_cell === 1 ? '' : 's'} at the point`
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
export interface Filters { severities: Severity[]; search: string; lineId: number | null; managerId: number | null; /** Only these reps (the "New only" filter). */ onlyReps?: Set<number> | null; visitType?: VisitType }
/** Severity (High first), then accounts descending. */
export const sortClusters = (rows: Cluster[]): Cluster[] =>
  [...rows].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3) || b.accounts - a.accounts || b.visits - a.visits || a.rep_id - b.rep_id)
/** "Double only" keeps the points with a Double visit, "Single only" the points with a Single visit. */
export const matchesVisitType = (c: Pick<Cluster, 'double_visits' | 'single_visits'>, vt: VisitType | undefined): boolean =>
  vt === 'double' ? c.double_visits > 0 : vt === 'single' ? c.single_visits > 0 : true
export function filterClusters(rows: Cluster[], f: Filters): Cluster[] {
  const q = f.search.trim().toLowerCase()
  return sortClusters(rows
    .filter((r) => f.severities.includes(r.severity))
    .filter((r) => matchesVisitType(r, f.visitType))
    .filter((r) => f.managerId === null || r.manager_id === f.managerId)
    .filter((r) => f.lineId === null || r.line_id === f.lineId)
    .filter((r) => !f.onlyReps || f.onlyReps.has(r.rep_id))
    .filter((r) => q === '' || r.rep_name.toLowerCase().includes(q) || r.rep_code.toLowerCase().includes(q)))
}
/* ------------------------------ change against previous months ------------------------------ */
/** Months back that count towards the "repeated" streak. */
export const STREAK_MONTHS_BACK = 3
export type Change = { kind: 'new' } | { kind: 'repeated'; months: number; capped: boolean }
export interface Comparison { byRep: Map<number, Change>; newCount: number; repeatedCount: number; goneCount: number; gone: Cluster[] }
const isFlagged = (c: Pick<Cluster, 'severity'>): boolean => c.severity === 'High' || c.severity === 'Medium'
/**
 * Reps with a High or Medium case this month against the previous months (`prev[0]` = last month, `prev[1]` = the month before...;
 * null = no data for that month). New: not flagged last month. Repeated: flagged last month too, with the number of consecutive
 * months (this one included, up to 3 months back). Gone: flagged last month, not this month (one cluster per rep, the worst).
 * Returns null when last month has no data: there is nothing to compare with.
 */
export function classifyChanges(current: Cluster[], prev: (Cluster[] | null)[]): Comparison | null {
  const last = prev[0]
  if (!last) return null
  const flaggedReps = (rows: Cluster[] | null) => new Set((rows ?? []).filter(isFlagged).map((r) => r.rep_id))
  const now = flaggedReps(current)
  const before = prev.slice(0, STREAK_MONTHS_BACK).map(flaggedReps)
  const byRep = new Map<number, Change>()
  for (const rep of now) {
    let streak = 0
    while (streak < before.length && prev[streak] !== null && before[streak].has(rep)) streak++
    byRep.set(rep, streak === 0 ? { kind: 'new' } : { kind: 'repeated', months: streak + 1, capped: streak === STREAK_MONTHS_BACK })
  }
  const seen = new Set<number>()
  const gone = sortClusters(last.filter((r) => isFlagged(r) && !now.has(r.rep_id))).filter((r) => (seen.has(r.rep_id) ? false : (seen.add(r.rep_id), true)))
  const changes = [...byRep.values()]
  return { byRep, newCount: changes.filter((c) => c.kind === 'new').length, repeatedCount: changes.filter((c) => c.kind === 'repeated').length, goneCount: gone.length, gone }
}
export const changeLabel = (c: Change | undefined): string => (!c ? '' : c.kind === 'new' ? 'New' : `Repeated · ${c.months}${c.capped ? '+' : ''} months`)
/** Reps whose case is new this month (for the "New only" filter). */
export const newReps = (cmp: Comparison | null): Set<number> => new Set(cmp ? [...cmp.byRep].filter(([, c]) => c.kind === 'new').map(([id]) => id) : [])

export interface Kpis { reps: number; accounts: number; visits: number; doubleVisits: number; singleVisits: number; pctDouble: number }
/** Reps flagged, accounts sharing a point, visits involved, Double / Single visits and the % Double. */
export function summarize(rows: Cluster[]): Kpis {
  const visits = rows.reduce((a, r) => a + r.visits, 0)
  const doubleVisits = rows.reduce((a, r) => a + r.double_visits, 0)
  return { reps: new Set(rows.map((r) => r.rep_id)).size, accounts: rows.reduce((a, r) => a + r.accounts, 0), visits, doubleVisits, singleVisits: rows.reduce((a, r) => a + r.single_visits, 0), pctDouble: pctDouble(doubleVisits, visits) }
}
export const fmtPct = (v: number, digits = 1): string => `${(v * 100).toFixed(digits)}%`
export const fmtPctPoints = (v: number): string => `${(Math.round(v * 10) / 10).toFixed(1)}%`


/* ------------------------------ reading note and day strip ------------------------------ */
/** "N different accounts share one ~110 m location, M of them registered at the point and K visited from X km away." */
export function readingNote(c: Pick<Cluster, 'accounts' | 'accounts_registered_here' | 'accounts_far'>, detail: AccountRow[] | null): string {
  const far = detail ? detail.filter((d) => patternOf(d.avg_deviation_m) === 'visit_far') : []
  const km = far.length > 0 ? far.reduce((a, d) => a + (d.avg_deviation_m ?? 0), 0) / far.length : 0
  const where = c.accounts_far > 0 ? `${c.accounts_far} visited from ${far.length > 0 ? `about ${fmtDistance(km)}` : 'far'} away` : ''
  return `${c.accounts} different accounts share one ~110 m location, ${c.accounts_registered_here} of them registered at the point${where ? ` and ${where}` : ''}.`
}
export interface StripDay { day: string; count: number; busy: boolean; night: number; doubles: number; visits: { t: string | null; account: string; dbl: boolean; mgr: string | null }[] }
/** One entry per day of [from, to) with the number of visits at this point and the visits themselves (time, account, Double or not). */
export function buildDayStrip(detail: AccountRow[], from: string, to: string): StripDay[] {
  const by = new Map<string, { t: string | null; account: string; dbl: boolean; mgr: string | null }[]>()
  for (const c of detail) for (const v of c.visit_log ?? []) by.set(v.d, [...(by.get(v.d) ?? []), { t: v.t, account: c.account_name, dbl: v.dbl, mgr: v.mgr }])
  return daysOf(from, to).map((day) => {
    const list = (by.get(day) ?? []).sort((a, b) => (a.t ?? '').localeCompare(b.t ?? ''))
    return { day, count: list.length, busy: list.length > BUSY_DAY_VISITS, night: list.filter((v) => isNight(v.t)).length, doubles: list.filter((v) => v.dbl).length, visits: list }
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
export interface RowNames { month: string; line: string; manager: string; /** Against the previous month ('' when there is no comparison). */ change?: string }
const repStatus = (c: Cluster): string => { const rb = resignedBadge(c.rep_status, c.resign_date); return rb.show ? rb.text : c.rep_status ?? '' }
/** The main table, same columns. */
export function summaryRow(c: Cluster, n: RowNames): Record<string, Cell> {
  return {
    Month: n.month, Severity: c.severity, Line: n.line, Manager: n.manager, 'Medical Rep': c.rep_name, 'Rep code': c.rep_code, Status: repStatus(c),
    Accounts: c.accounts, 'Accounts PM': c.accounts_pm, 'Accounts AM': c.accounts_am, Doctors: c.doctors, Visits: c.visits, 'Visit days': c.visit_days,
    'Double visits': c.double_visits, 'Single visits': c.single_visits, '% Double': pctDouble(c.double_visits, c.visits), 'Managers who joined': c.managers_joined,
    '% of rep visits': c.pct_of_rep_visits,
    'Accounts registered at the point': c.accounts_registered_here, 'Visits registered at the point': c.visits - c.visits_far,
    'Accounts visited from far': c.accounts_far, 'Visits from far': c.visits_far, 'Night visits': c.night_visits, 'Other reps at the point': c.other_reps_at_cell,
    'First visit': c.first_visit ?? '', 'Last visit': c.last_visit ?? '', 'Point latitude': c.cell_lat, 'Point longitude': c.cell_lng,
    ...(n.change === undefined ? {} : { 'Vs previous month': n.change }),
  }
}
/** One row per account of a rep and point. */
export function detailRows(c: Cluster, n: RowNames, detail: AccountRow[]): Record<string, Cell>[] {
  return [...detail].sort((a, b) => b.visits - a.visits || a.account_name.localeCompare(b.account_name)).map((d) => ({
    Month: n.month, Severity: c.severity, Line: n.line, Manager: n.manager, 'Medical Rep': c.rep_name, 'Rep code': c.rep_code,
    'Account ID': d.account_ext_id ?? '', 'Account name': d.account_name, Type: d.acc_type_code ?? '', Shift: d.shift_group ?? '', Doctors: d.doctors,
    Visits: d.visits, 'Double visits': d.double_visits, 'Single visits': d.single_visits, 'Visit dates': visitDatesCell(d.visit_log), 'Double visit dates': doubleDatesCell(d.visit_log),
    'First visit': d.first_visit ?? '', 'Last visit': d.last_visit ?? '', 'Avg deviation (m)': d.avg_deviation_m, Pattern: patternChip(d.avg_deviation_m).label,
    'Account latitude': d.acc_lat, 'Account longitude': d.acc_lng, 'Point latitude': c.cell_lat, 'Point longitude': c.cell_lng,
  }))
}
export const exportFileName = (ym: string): string => `Suspicious_Cases_${ym}.xlsx`
