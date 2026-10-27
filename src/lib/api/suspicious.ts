import { supabase } from '../supabase'
import { fetchAll, rpc } from './core'
import { monthRange, monthsBetween, shiftParams, type AccountRow, type Cluster, type Severity, type Shift, type VisitType } from '../../features/reports/suspiciousMath'

type Raw = Record<string, unknown>
const num = (v: unknown): number => Number(v ?? 0)
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v).slice(0, 10))
const textOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

/** suspicious_clusters_v2 (91_suspicious_cases_v2.sql): one row per rep and GPS cell. `to` is exclusive. */
export async function fetchSuspiciousClusters(from: string, to: string, minAccounts: number, shift: Shift = 'BOTH', decimals = 3): Promise<Cluster[]> {
  const rows = (await rpc<Raw[] | null>('suspicious_clusters_v2', { p_from: from, p_to: to, p_min_accounts: minAccounts, p_shifts: shiftParams(shift), p_decimals: decimals })) ?? []
  return rows.map((r) => ({
    rep_id: num(r.rep_id), rep_name: String(r.rep_name ?? ''), rep_code: String(r.rep_code ?? ''), rep_status: textOrNull(r.rep_status),
    resign_date: strOrNull(r.resign_date), line_id: numOrNull(r.line_id), manager_id: numOrNull(r.manager_id), cell_lat: num(r.cell_lat), cell_lng: num(r.cell_lng),
    accounts: num(r.accounts), accounts_pm: num(r.accounts_pm), accounts_am: num(r.accounts_am), doctors: num(r.doctors), visits: num(r.visits), visit_days: num(r.visit_days),
    double_visits: num(r.double_visits), single_visits: num(r.single_visits), pct_of_rep_visits: num(r.pct_of_rep_visits),
    accounts_registered_here: num(r.accounts_registered_here), accounts_far: num(r.accounts_far), visits_far: num(r.visits_far), night_visits: num(r.night_visits),
    other_reps_at_cell: num(r.other_reps_at_cell), first_visit: strOrNull(r.first_visit), last_visit: strOrNull(r.last_visit), managers_joined: String(r.managers_joined ?? ''), severity: String(r.severity) as Severity,
  }))
}

/** suspicious_cluster_detail_v2: one row per account of a rep and cell (loaded when a row is opened). */
export async function fetchSuspiciousDetail(rep: number, lat: number, lng: number, from: string, to: string, shift: Shift = 'BOTH', visitType: VisitType = 'all'): Promise<AccountRow[]> {
  const rows = (await rpc<Raw[] | null>('suspicious_cluster_detail_v2', { p_rep: rep, p_cell_lat: lat, p_cell_lng: lng, p_from: from, p_to: to, p_shifts: shiftParams(shift), p_visit_filter: visitType })) ?? []
  return rows.map((r) => ({
    account_key: String(r.account_key ?? ''), account_ext_id: textOrNull(r.account_ext_id), account_name: String(r.account_name ?? ''), acc_type_code: textOrNull(r.acc_type_code), shift_group: textOrNull(r.shift_group),
    doctors: num(r.doctors), visits: num(r.visits), double_visits: num(r.double_visits), single_visits: num(r.single_visits),
    first_visit: strOrNull(r.first_visit), last_visit: strOrNull(r.last_visit), avg_deviation_m: numOrNull(r.avg_deviation_m), acc_lat: numOrNull(r.acc_lat), acc_lng: numOrNull(r.acc_lng),
    pattern: textOrNull(r.pattern),
    visit_log: Array.isArray(r.visit_log) ? (r.visit_log as Raw[]).map((v) => ({ d: strOrNull(v.d) ?? '', t: v.t == null ? null : String(v.t).slice(0, 5), dbl: v.dbl === true, mgr: textOrNull(v.mgr) })).filter((v) => v.d !== '') : [],
  }))
}

async function visitDateEdge(ascending: boolean, from?: string, to?: string): Promise<string | null> {
  let q = supabase.from('visits').select('visit_date')
  if (from) q = q.gte('visit_date', from)
  if (to) q = q.lt('visit_date', to)
  const { data, error } = await q.order('visit_date', { ascending }).limit(1)
  if (error) throw new Error(error.message)
  const d = (data as { visit_date: string }[] | null)?.[0]?.visit_date
  return d ? d.slice(0, 10) : null
}

/** Month (YYYY-MM) -> latest visit date in `visits` (null = no visits that month), from the first to the last month that has visits. Always read fresh. */
export async function fetchVisitMonths(): Promise<Record<string, string | null>> {
  const [min, max] = await Promise.all([visitDateEdge(true), visitDateEdge(false)])
  if (!min || !max) return {}
  const months = monthsBetween(min.slice(0, 7), max.slice(0, 7))
  const out: Record<string, string | null> = {}
  await Promise.all(months.map(async (m) => { const { from, to } = monthRange(m); out[m] = m === max.slice(0, 7) ? max : await visitDateEdge(false, from, to) }))
  return out
}

/** Manager and line names, resolved from the managers and lines tables (an id is shown when a name is missing). */
export async function fetchSuspiciousNames(): Promise<{ managers: Map<number, string>; lines: Map<number, string> }> {
  const [mgr, lines] = await Promise.all([fetchAll<Raw>('managers', 'id,name', ['id']), fetchAll<Raw>('lines', 'id,name', ['id'])])
  return { managers: new Map(mgr.map((m) => [Number(m.id), String(m.name)])), lines: new Map(lines.map((l) => [Number(l.id), String(l.name)])) }
}
