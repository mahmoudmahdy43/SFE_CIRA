/**
 * Visits Capacity report helpers. Every per-rep number (capacity, list visits, excess, utilization, status,
 * doctors to remove) is computed by the database view `v_visits_capacity`; the browser only maps, filters,
 * sums the view's columns for the cards / pinned Total row, and formats. Nothing here re-derives a number.
 * No imports: this file is also run directly by scripts/reportMath.test.mjs.
 */

export const CAP_DASH = '—'

export const CAPACITY_STATUSES = ['Over capacity', 'Spare capacity', 'Balanced'] as const
export type CapacityStatus = (typeof CAPACITY_STATUSES)[number]
/** Status filter: 'all' or one of the view's three statuses. The tab opens on 'Over capacity'. */
export type CapacityStatusFilter = 'all' | CapacityStatus
export const DEFAULT_STATUS_FILTER: CapacityStatusFilter = 'Over capacity'

export interface CapacityRow {
  month: string
  rep_id: number
  rep_code: string | null
  rep_name: string | null
  line: string | null
  manager: string | null
  box: string | null
  call_rate_target_pm: number | null
  pm_working_days: number | null
  capacity_visits: number
  list_doctors: number
  list_visits: number
  excess_visits: number
  /** list_visits / capacity as a ratio (1.05 = 105%); null when the view has no capacity to divide by. */
  utilization: number | null
  status: string
  remove_if_freq2: number
  remove_if_freq1: number
  spare_visits: number
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const n0 = (v: unknown): number => numOrNull(v) ?? 0
const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

export function toCapacityRow(r: Record<string, unknown>): CapacityRow {
  return {
    month: String(r.month ?? ''),
    rep_id: n0(r.rep_id),
    rep_code: s(r.rep_code),
    rep_name: s(r.rep_name),
    line: s(r.line),
    manager: s(r.manager),
    box: s(r.box),
    call_rate_target_pm: numOrNull(r.call_rate_target_pm),
    pm_working_days: numOrNull(r.pm_working_days),
    capacity_visits: n0(r.capacity_visits),
    list_doctors: n0(r.list_doctors),
    list_visits: n0(r.list_visits),
    excess_visits: n0(r.excess_visits),
    utilization: numOrNull(r.utilization),
    status: String(r.status ?? ''),
    remove_if_freq2: n0(r.remove_if_freq2),
    remove_if_freq1: n0(r.remove_if_freq1),
    spare_visits: n0(r.spare_visits),
  }
}

/* ------------------------------------ filters ------------------------------------ */
export interface CapacityFilters {
  /** Line name (the view carries the name, not an id); null = all lines. */
  line: string | null
  manager: string
  search: string
  status: CapacityStatusFilter
}

/** Line / manager / search only. The summary cards use this so they stay meaningful whatever the status filter says. */
export function filterCapacityScope(rows: CapacityRow[], f: Pick<CapacityFilters, 'line' | 'manager' | 'search'>): CapacityRow[] {
  const q = f.search.trim().toLowerCase()
  return rows.filter(
    (r) =>
      (f.line === null || r.line === f.line) &&
      (f.manager === '' || r.manager === f.manager) &&
      (q === '' || [r.rep_name, r.rep_code].some((v) => v !== null && v.toLowerCase().includes(q))),
  )
}

/** Scope filters plus the status filter: the rows the table shows and the Excel export contains. */
export function filterCapacity(rows: CapacityRow[], f: CapacityFilters): CapacityRow[] {
  return filterCapacityScope(rows, f).filter((r) => f.status === 'all' || r.status === f.status)
}

const cmpText = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })

/** Distinct manager names (optionally of one line), sorted. */
export function capacityManagers(rows: CapacityRow[], line: string | null): string[] {
  return [...new Set(rows.filter((r) => line === null || r.line === line).flatMap((r) => (r.manager ? [r.manager] : [])))].sort(cmpText)
}

/** Worst first (excess desc), ties by line / manager / box / rep so the order is deterministic. */
export function capacityOrder(rows: CapacityRow[]): CapacityRow[] {
  return [...rows].sort(
    (a, b) => b.excess_visits - a.excess_visits || cmpText(a.line, b.line) || cmpText(a.manager, b.manager) || cmpText(a.box, b.box) || cmpText(a.rep_name, b.rep_name),
  )
}

/* ------------------------------------ cards / total ------------------------------------ */
export interface CapacitySummary {
  reps: number
  overReps: number
  excessVisits: number
  /** Sum of remove_if_freq2 over the over-capacity reps. */
  removeDoctors: number
  spareReps: number
  spareVisits: number
}

/** Sums of the view's own columns, grouped by the view's own status. */
export function summarizeCapacity(rows: CapacityRow[]): CapacitySummary {
  const over = rows.filter((r) => r.status === 'Over capacity')
  const spare = rows.filter((r) => r.status === 'Spare capacity')
  return {
    reps: rows.length,
    overReps: over.length,
    excessVisits: over.reduce((a, r) => a + r.excess_visits, 0),
    removeDoctors: over.reduce((a, r) => a + r.remove_if_freq2, 0),
    spareReps: spare.length,
    spareVisits: spare.reduce((a, r) => a + r.spare_visits, 0),
  }
}

/** Pinned Total row: column sums only. Target, working days and utilization are not additive, so they stay empty. */
export function totalCapacity(rows: CapacityRow[]): CapacityRow {
  const sum = (k: 'capacity_visits' | 'list_doctors' | 'list_visits' | 'excess_visits' | 'remove_if_freq2' | 'remove_if_freq1' | 'spare_visits') =>
    rows.reduce((a, r) => a + r[k], 0)
  return {
    month: rows[0]?.month ?? '', rep_id: 0, rep_code: null, rep_name: `${rows.length} reps`, line: null, manager: null, box: null,
    call_rate_target_pm: null, pm_working_days: null,
    capacity_visits: sum('capacity_visits'), list_doctors: sum('list_doctors'), list_visits: sum('list_visits'), excess_visits: sum('excess_visits'),
    utilization: null, status: '',
    remove_if_freq2: sum('remove_if_freq2'), remove_if_freq1: sum('remove_if_freq1'), spare_visits: sum('spare_visits'),
  }
}
export const isCapacityTotal = (r: CapacityRow): boolean => r.rep_id === 0

/* ------------------------------------ formatting ------------------------------------ */
export const fmtCap = (v: number | null): string => (v === null ? CAP_DASH : Math.round(v).toLocaleString('en-US'))
export const fmtTargetPm = (v: number | null): string => (v === null ? CAP_DASH : Number.isInteger(v) ? String(v) : v.toFixed(1))
export const fmtExcess = (v: number): string => (v > 0 ? `+${Math.round(v).toLocaleString('en-US')}` : Math.round(v).toLocaleString('en-US'))
export const fmtUtilization = (v: number | null): string => (v === null ? CAP_DASH : `${(v * 100).toFixed(1)}%`)
export const removeLabel = (n: number): string => `Remove ~${Math.round(n).toLocaleString('en-US')} doctors`
export const removeTip = (freq1: number): string => `if they have Freq 2; if Freq 1 remove ${Math.round(freq1).toLocaleString('en-US')}`

/* ------------------------------------ export ------------------------------------ */
export type CapacityExportRow = Record<string, string | number | null>
const round = (v: number | null, d: number) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d)

/** One flat record per row, in the table's column order (the remove column is split into its Freq 2 / Freq 1 values). No Total row. */
export function exportCapacity(rows: CapacityRow[]): CapacityExportRow[] {
  return rows.map((r) => ({
    'Medical Rep': r.rep_name,
    'Rep code': r.rep_code,
    'Line': r.line,
    'Direct Manager': r.manager,
    'Box': r.box,
    'Target PM': r.call_rate_target_pm,
    'Working days': r.pm_working_days,
    'Capacity': r.capacity_visits,
    'List doctors': r.list_doctors,
    'List visits': r.list_visits,
    'Excess': r.excess_visits,
    'Utilization %': round(r.utilization === null ? null : r.utilization * 100, 1),
    'Remove (if Freq 2)': r.remove_if_freq2,
    'Remove (if Freq 1)': r.remove_if_freq1,
  }))
}

export const CAPACITY_FOOTER_NOTE =
  'Capacity assumes the PM Call Rate target of the box x PM working days of the month (Thu, Fri and holidays excluded). Pharmacy visits are not included.'
