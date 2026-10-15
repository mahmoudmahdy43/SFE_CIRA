/**
 * Pure helpers for the Managers report (v_manager_report: one row per manager per month, days in 0.5 steps).
 * Call rates come from the view; the totals row cannot recompute them (field slots are not in the view), so it shows a dash.
 */
import { DASH, hireDateValue, type ExportRow } from './absenceMath'

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

export const MANAGER_ROLES = ['DM', 'NSM', 'PM', 'TM', 'FT', 'SD'] as const

export interface ManagerRow {
  month: string
  manager_id: number
  code: string | null
  name: string | null
  role_type: string | null
  title: string | null
  line: string | null
  line_id: number | null
  hire_date: string | null
  working_days: number
  field_days: number
  leave_days: number
  office_work_days: number
  activity_days: number
  missing_days: number
  single_visits: number
  double_visits: number
  total_visits: number
  visits_am: number
  visits_pm: number
  visits_pharmacy: number
  call_rate_am: number | null
  call_rate_pm: number | null
  call_rate_pharmacy: number | null
}

export const MANAGER_COLS =
  'month,manager_id,code,name,role_type,title,line,line_id,hire_date,working_days,field_days,leave_days,office_work_days,activity_days,missing_days,' +
  'single_visits,double_visits,total_visits,visits_am,visits_pm,visits_pharmacy,call_rate_am,call_rate_pm,call_rate_pharmacy'

export const toManagerRow = (r: Record<string, unknown>): ManagerRow => ({
  month: String(r.month ?? ''),
  manager_id: num(r.manager_id),
  code: str(r.code),
  name: str(r.name),
  role_type: str(r.role_type),
  title: str(r.title),
  line: str(r.line),
  line_id: numOrNull(r.line_id),
  hire_date: str(r.hire_date),
  working_days: num(r.working_days),
  field_days: num(r.field_days),
  leave_days: num(r.leave_days),
  office_work_days: num(r.office_work_days),
  activity_days: num(r.activity_days),
  missing_days: num(r.missing_days),
  single_visits: num(r.single_visits),
  double_visits: num(r.double_visits),
  total_visits: num(r.total_visits),
  visits_am: num(r.visits_am),
  visits_pm: num(r.visits_pm),
  visits_pharmacy: num(r.visits_pharmacy),
  call_rate_am: numOrNull(r.call_rate_am),
  call_rate_pm: numOrNull(r.call_rate_pm),
  call_rate_pharmacy: numOrNull(r.call_rate_pharmacy),
})

export interface ManagerFilters { lineId: number | null; role: string; search: string }

export function filterManagers(rows: ManagerRow[], f: ManagerFilters): ManagerRow[] {
  const q = f.search.trim().toLowerCase()
  return rows.filter(
    (r) =>
      (f.lineId === null || r.line_id === f.lineId) &&
      (f.role === '' || r.role_type === f.role) &&
      (q === '' || [r.name, r.code].some((v) => v !== null && v.toLowerCase().includes(q))),
  )
}

const cmpText = (a: string | null, b: string | null): number =>
  a === null ? (b === null ? 0 : 1) : b === null ? -1 : a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
/** Line, then manager name. */
export const lineManagerOrder = (rows: ManagerRow[]): ManagerRow[] => [...rows].sort((a, b) => cmpText(a.line, b.line) || cmpText(a.name, b.name))

export type ManagerSums = Pick<
  ManagerRow,
  'working_days' | 'field_days' | 'leave_days' | 'office_work_days' | 'activity_days' | 'missing_days' | 'single_visits' | 'double_visits' | 'visits_am' | 'visits_pm' | 'visits_pharmacy'
>
const SUM_KEYS: (keyof ManagerSums)[] = [
  'working_days', 'field_days', 'leave_days', 'office_work_days', 'activity_days', 'missing_days', 'single_visits', 'double_visits', 'visits_am', 'visits_pm', 'visits_pharmacy',
]
export function totalManagers(rows: ManagerRow[]): ManagerSums {
  const t = Object.fromEntries(SUM_KEYS.map((k) => [k, 0])) as ManagerSums
  for (const r of rows) for (const k of SUM_KEYS) t[k] += r[k]
  return t
}

/** Days: one decimal, zero = dash. Visits: whole numbers, zero = dash. Rates: two decimals, null = dash. */
export const fmtMDays = (v: number): string => (v === 0 ? DASH : v.toFixed(1))
export const fmtMCount = (v: number): string => (v === 0 ? DASH : String(v))
export const fmtRate = (v: number | null): string => (v === null ? DASH : v.toFixed(2))

export function exportManagers(rows: ManagerRow[], total: ManagerSums, withVisits: boolean): ExportRow[] {
  const cells = (r: ManagerSums & { call_rate_am: number | null; call_rate_pm: number | null; call_rate_pharmacy: number | null }): ExportRow => ({
    'Working Days': r.working_days, 'Field Days': r.field_days, Vacation: r.leave_days, 'Office Work': r.office_work_days, Activities: r.activity_days,
    'Missing Days': r.missing_days, 'Single Visits': r.single_visits, 'Double Visits': r.double_visits,
    'Call Rate AM': r.call_rate_am, 'Call Rate PM': r.call_rate_pm, 'Call Rate Pharmacy': r.call_rate_pharmacy,
    ...(withVisits ? { 'AM Visits': r.visits_am, 'PM Visits': r.visits_pm, 'Pharmacy Visits': r.visits_pharmacy } : {}),
  })
  return [
    ...rows.map((r) => ({ Line: r.line, Manager: r.name, Code: r.code, Role: r.role_type, 'Hire Date': hireDateValue(r.hire_date), ...cells(r) })),
    { Line: 'Total', Manager: null, Code: null, Role: null, 'Hire Date': null, ...cells({ ...total, call_rate_am: null, call_rate_pm: null, call_rate_pharmacy: null }) },
  ]
}
