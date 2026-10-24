import { fetchAll, rpc } from './core'
import type { ClinicRow, Cluster, Severity } from '../../features/reports/suspiciousMath'

type Raw = Record<string, unknown>
const num = (v: unknown): number => Number(v ?? 0)
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v).slice(0, 10))

/** suspicious_clusters (90_suspicious_cases.sql): one row per rep and GPS cell. `to` is exclusive. */
export async function fetchSuspiciousClusters(from: string, to: string, minClinics: number, decimals = 3): Promise<Cluster[]> {
  const rows = (await rpc<Raw[] | null>('suspicious_clusters', { p_from: from, p_to: to, p_min_clinics: minClinics, p_decimals: decimals })) ?? []
  return rows.map((r) => ({
    rep_id: num(r.rep_id), rep_name: String(r.rep_name ?? ''), rep_code: String(r.rep_code ?? ''), rep_status: r.rep_status === null || r.rep_status === undefined ? null : String(r.rep_status),
    resign_date: strOrNull(r.resign_date), line_id: numOrNull(r.line_id), manager_id: numOrNull(r.manager_id), cell_lat: num(r.cell_lat), cell_lng: num(r.cell_lng),
    clinics: num(r.clinics), visits: num(r.visits), visit_days: num(r.visit_days), pct_of_rep_pm_visits: num(r.pct_of_rep_pm_visits),
    clinics_registered_here: num(r.clinics_registered_here), clinics_far: num(r.clinics_far), visits_far: num(r.visits_far), night_visits: num(r.night_visits),
    other_reps_at_cell: num(r.other_reps_at_cell), first_visit: strOrNull(r.first_visit), last_visit: strOrNull(r.last_visit), severity: String(r.severity) as Severity,
  }))
}

/** suspicious_cluster_detail: one row per clinic of a rep and cell (loaded when a row is opened). */
export async function fetchSuspiciousDetail(rep: number, lat: number, lng: number, from: string, to: string): Promise<ClinicRow[]> {
  const rows = (await rpc<Raw[] | null>('suspicious_cluster_detail', { p_rep: rep, p_cell_lat: lat, p_cell_lng: lng, p_from: from, p_to: to })) ?? []
  return rows.map((r) => ({
    account: String(r.account ?? ''), acc_type_code: r.acc_type_code === null || r.acc_type_code === undefined ? null : String(r.acc_type_code), visits: num(r.visits),
    first_visit: strOrNull(r.first_visit), last_visit: strOrNull(r.last_visit), avg_deviation_m: numOrNull(r.avg_deviation_m), acc_lat: numOrNull(r.acc_lat), acc_lng: numOrNull(r.acc_lng),
    pattern: r.pattern === null || r.pattern === undefined ? null : String(r.pattern),
    visit_log: Array.isArray(r.visit_log) ? (r.visit_log as Raw[]).map((v) => ({ d: String(v.d).slice(0, 10), t: v.t === null || v.t === undefined ? null : String(v.t) })) : [],
  }))
}

/** Manager and line names, resolved from the managers and lines tables (an id is shown when a name is missing). */
export async function fetchSuspiciousNames(): Promise<{ managers: Map<number, string>; lines: Map<number, string> }> {
  const [mgr, lines] = await Promise.all([fetchAll<Raw>('managers', 'id,name', ['id']), fetchAll<Raw>('lines', 'id,name', ['id'])])
  return { managers: new Map(mgr.map((m) => [Number(m.id), String(m.name)])), lines: new Map(lines.map((l) => [Number(l.id), String(l.name)])) }
}
