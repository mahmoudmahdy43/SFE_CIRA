import { fetchAll } from './core'
import { rpcAll, type Raw } from './reports'
import { cached } from './kpi'
import { num } from '../../features/dashboard/kpiMath'
import type { KpiMonth } from '../../features/dashboard/rangeKpi'

/** Dashboard phase 1 RPCs (74_dashboard_phase1.sql): admin only, `line` null = all lines. Dates are first / last day of whole months. */
const n0 = (v: unknown): number => num(v) ?? 0
const day = (v: unknown): string => String(v ?? '').slice(0, 10)
const ids = (a: number[]): number[] | null => (a.length ? a : null)

export async function fetchKpiMonths(from: string, to: string, line: number | null): Promise<KpiMonth[]> {
  const rows = await rpcAll('dash_kpi_months', { p_from: from, p_to: to, p_line: line }, ['month'])
  return rows.map((r: Raw) => ({
    month: day(r.month), reps: n0(r.reps), list_doctors: n0(r.list_doctors), covered_doctors: n0(r.covered_doctors),
    total_visits: n0(r.total_visits), valid_visits: n0(r.valid_visits), planned_visits: n0(r.planned_visits), direct_visits: n0(r.direct_visits),
    visits_am: n0(r.visits_am), visits_pm: n0(r.visits_pm), pharmacy_visits: n0(r.pharmacy_visits),
    days_am: n0(r.days_am), days_pm: n0(r.days_pm), missing_am: n0(r.missing_am), missing_pm: n0(r.missing_pm),
    leave_days: n0(r.leave_days), ow_days: n0(r.ow_days), activity_days: n0(r.activity_days), expected_visits: n0(r.expected_visits),
  }))
}

export interface SalesYtd { ytd_month: string | null; year_start: string | null; s_value: number | null; t_value: number | null; ach: number | null }
export async function fetchSalesYtd(to: string, line: number | null): Promise<SalesYtd> {
  const r = (await rpcAll('dash_sales_ytd', { p_to: to, p_line: line }, []))[0]
  return { ytd_month: r?.ytd_month ? day(r.ytd_month) : null, year_start: r?.year_start ? day(r.year_start) : null, s_value: num(r?.s_value), t_value: num(r?.t_value), ach: num(r?.ach) }
}

export interface VisitsMonth { month: string; am: number; pm: number; pharmacy: number; total: number }
export async function fetchVisitsMonthly(from: string, to: string, line: number | null, specialities: number[]): Promise<VisitsMonth[]> {
  const rows = await rpcAll('dash_visits_monthly', { p_from: from, p_to: to, p_line: line, p_specialities: ids(specialities) }, ['month'])
  return rows.map((r) => ({ month: day(r.month), am: n0(r.am), pm: n0(r.pm), pharmacy: n0(r.pharmacy), total: n0(r.total) }))
}

export type SalesGroup = 'company' | 'line' | 'manager'
export interface SalesPoint { month: string; grp_id: number | null; grp_name: string; s_value: number | null; s_units: number | null; t_value: number | null; t_units: number | null }
export async function fetchSalesSeries(from: string, to: string, group: SalesGroup, line: number | null, products: number[]): Promise<SalesPoint[]> {
  const rows = await rpcAll('dash_sales_series', { p_from: from, p_to: to, p_group: group, p_line: line, p_products: ids(products) }, ['month', 'grp_name'])
  return rows.map((r) => ({
    month: day(r.month), grp_id: num(r.grp_id), grp_name: String(r.grp_name ?? 'Company'),
    s_value: num(r.s_value), s_units: num(r.s_units), t_value: num(r.t_value), t_units: num(r.t_units),
  }))
}

export interface Opt { id: number; name: string }
export const fetchSpecialities = (): Promise<Opt[]> => cached('opt:specialities', () => fetchAll<Opt>('specialities', 'id,name', ['name']))
export const fetchProducts = (): Promise<Opt[]> => cached('opt:products', () => fetchAll<Opt>('products', 'id,name', ['name']))
