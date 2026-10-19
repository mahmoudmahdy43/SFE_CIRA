import { rpcAll, type Raw } from './reports'
import { fetchSalesMonths } from './sales'
import { numOrNull } from '../../features/reports/reportMath'

/** Dashboard V1 RPCs (73_dashboard_v1.sql): computed live, admin only, PM shift only. `line` null = all lines. */
export interface Range { from: string; to: string; line: number | null }

const n = numOrNull
const n0 = (v: unknown): number => numOrNull(v) ?? 0
const s = (v: unknown): string => (v == null ? '' : String(v))
const day = (v: unknown): string => s(v).slice(0, 10)

export interface OverviewRow {
  month: string; s_value: number; t_value: number; ach: number | null; list_doctors: number; covered: number
  coverage: number | null; pcf: number | null; visits: number; days_pm: number; call_rate_pm: number | null
}
export interface CorrRow { metric: string; lag: number; n: number; r_across: number | null; r_within: number | null }
export interface TerritoryMonth {
  month: string; line_id: number | null; line_name: string; territory_name: string; vacant: boolean
  list_doctors: number; visits_per_doctor: number | null; s_value: number; t_value: number; ach: number | null; has_list: boolean
}
export interface BandRow { band: string; territory_months: number; territories: number; ach: number | null; growth: number | null }
export interface TerritoryRow {
  line_name: string; territory_name: string; box_name: string; rep_name: string; manager_name: string
  vacant_months: number; months: number; list_doctors: number; list_share: number | null; coverage: number | null; pcf: number | null
  visits: number; visits_per_doctor: number | null; s_value: number; t_value: number; ach: number | null
  sales_share: number | null; share_index: number | null; sales_per_doctor: number | null; growth: number | null
}
export type Group = 'STAR' | 'NOT_CONVERTING' | 'EFFICIENT' | 'INTERVENTION' | 'NO_DATA'
export interface MatrixRow {
  rep_name: string; line_name: string; manager_name: string; territories: string; visits: number; days_pm: number
  call_rate_pm: number | null; target_pm: number | null; effort_pct: number | null; s_value: number; t_value: number
  ach_pct: number | null; grp: Group
}
export interface AbsenceCostRow { kind: string; label: string; days: number; lost_visits: number; est_lost_sales: number | null; territories: number; avg_ach: number | null }

const args = (r: Range) => ({ p_from: r.from, p_to: r.to, p_line: r.line })

export async function fetchOverview(r: Range): Promise<OverviewRow[]> {
  const rows = await rpcAll('dash_overview', args(r), ['month'])
  return rows.map((x: Raw) => ({
    month: day(x.month), s_value: n0(x.s_value), t_value: n0(x.t_value), ach: n(x.ach), list_doctors: n0(x.list_doctors), covered: n0(x.covered),
    coverage: n(x.coverage), pcf: n(x.pcf), visits: n0(x.visits), days_pm: n0(x.days_pm), call_rate_pm: n(x.call_rate_pm),
  }))
}

export async function fetchCorrelations(r: Range): Promise<CorrRow[]> {
  const rows = await rpcAll('dash_correlations', args(r), ['metric', 'lag'])
  return rows.map((x) => ({ metric: s(x.metric), lag: n0(x.lag), n: n0(x.n), r_across: n(x.r_across), r_within: n(x.r_within) }))
}

/** All lines for the range (the line filter is applied client-side by the caller). */
export async function fetchTerritoryMonth(from: string, to: string): Promise<TerritoryMonth[]> {
  const rows = await rpcAll('dash_territory_month', { p_from: from, p_to: to }, ['month', 'territory_name'])
  return rows.map((x) => ({
    month: day(x.month), line_id: n(x.line_id), line_name: s(x.line_name), territory_name: s(x.territory_name),
    vacant: x.vacant === true || n0(x.vacant) > 0 || n0(x.vacant_months) > 0 || x.is_vacant === true,
    list_doctors: n0(x.list_doctors), visits_per_doctor: n(x.visits_per_doctor), s_value: n0(x.s_value), t_value: n0(x.t_value), ach: n(x.ach),
    has_list: x.list_doctors == null ? true : n0(x.list_doctors) > 0,
  }))
}

export async function fetchBands(r: Range): Promise<BandRow[]> {
  const rows = await rpcAll('dash_coverage_bands', args(r), ['band'])
  return rows.map((x) => ({ band: s(x.band).replace(/^\d+\.\s*/, ''), territory_months: n0(x.territory_months), territories: n0(x.territories), ach: n(x.ach), growth: n(x.growth) }))
}

export async function fetchTerritorySummary(r: Range): Promise<TerritoryRow[]> {
  const rows = await rpcAll('dash_territory_summary', args(r), ['line_name', 'territory_name'])
  return rows.map((x) => ({
    line_name: s(x.line_name), territory_name: s(x.territory_name), box_name: s(x.box_name), rep_name: s(x.rep_name), manager_name: s(x.manager_name),
    vacant_months: n0(x.vacant_months), months: n0(x.months), list_doctors: n0(x.list_doctors), list_share: n(x.list_share), coverage: n(x.coverage), pcf: n(x.pcf),
    visits: n0(x.visits), visits_per_doctor: n(x.visits_per_doctor), s_value: n0(x.s_value), t_value: n0(x.t_value), ach: n(x.ach),
    sales_share: n(x.sales_share), share_index: n(x.share_index), sales_per_doctor: n(x.sales_per_doctor), growth: n(x.growth),
  }))
}

const GROUPS: Group[] = ['STAR', 'NOT_CONVERTING', 'EFFICIENT', 'INTERVENTION', 'NO_DATA']
export async function fetchMatrix(r: Range, effort: number, sales: number): Promise<MatrixRow[]> {
  const rows = await rpcAll('dash_effort_matrix', { p_from: r.from, p_to: r.to, p_effort: effort, p_sales: sales, p_line: r.line }, ['rep_name', 'line_name'])
  return rows.map((x) => {
    const g = s(x.grp).toUpperCase() as Group
    return {
      rep_name: s(x.rep_name), line_name: s(x.line_name), manager_name: s(x.manager_name), territories: s(x.territories), visits: n0(x.visits), days_pm: n0(x.days_pm),
      call_rate_pm: n(x.call_rate_pm), target_pm: n(x.target_pm), effort_pct: n(x.effort_pct), s_value: n0(x.s_value), t_value: n0(x.t_value), ach_pct: n(x.ach_pct),
      grp: GROUPS.includes(g) ? g : 'NO_DATA',
    }
  })
}

export async function fetchAbsenceCost(r: Range): Promise<AbsenceCostRow[]> {
  const rows = await rpcAll('dash_absence_cost', args(r), ['kind', 'label'])
  return rows.map((x) => ({ kind: s(x.kind), label: s(x.label), days: n0(x.days), lost_visits: n0(x.lost_visits), est_lost_sales: n(x.est_lost_sales), territories: n0(x.territories), avg_ach: n(x.avg_ach) }))
}

/** Latest month (first day) that has sales loaded, or null. */
export async function fetchLatestSalesMonth(): Promise<string | null> {
  const rows = await fetchSalesMonths()
  const months = rows.filter((m) => m.s_value > 0 || m.rows > 0).map((m) => m.month).sort()
  return months.length ? months[months.length - 1] : null
}
