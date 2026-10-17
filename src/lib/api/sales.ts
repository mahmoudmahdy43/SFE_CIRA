import { rpcAll } from './reports'
import { fetchAll } from './core'
import {
  toActionRow, toFieldRow, toGapRow, toMonthRow, toMonthlyRow, toProductRow, toRepProductRow, toSummaryRow, toVacantRow,
  type ActionRow, type FieldRow, type GapGroup, type GapRow, type MonthRow, type MonthlyRow, type ProductRow, type RepProductRow, type SummaryRow, type VacantRow,
} from '../../features/reports/salesMath'

/** Month starts (YYYY-MM-01) in, p_line = smallint or null, p_manager = direct manager id or null. */
export interface SalesScope { line: number | null; manager: number | null }

/** What is loaded: one row per month x line (sales_months). */
export async function fetchSalesMonths(): Promise<MonthRow[]> {
  return (await rpcAll('sales_months', {}, ['month', 'line_id'])).map(toMonthRow)
}

export async function fetchSalesSummary(from: string, to: string, cmpFrom: string, cmpTo: string): Promise<SummaryRow[]> {
  return (await rpcAll('sales_summary', { p_from: from, p_to: to, p_cmp_from: cmpFrom, p_cmp_to: cmpTo }, ['line_id'])).map(toSummaryRow)
}

export async function fetchSalesMonthly(from: string, to: string, sc: SalesScope): Promise<MonthlyRow[]> {
  return (await rpcAll('sales_monthly', { p_from: from, p_to: to, p_line: sc.line, p_manager: sc.manager }, ['month', 'line_id'])).map(toMonthlyRow)
}

export async function fetchSalesProducts(from: string, to: string, cmpFrom: string, cmpTo: string, sc: SalesScope): Promise<ProductRow[]> {
  return (await rpcAll('sales_products', { p_from: from, p_to: to, p_cmp_from: cmpFrom, p_cmp_to: cmpTo, p_line: sc.line, p_manager: sc.manager }, ['product_id'])).map(toProductRow)
}

export async function fetchSalesGap(from: string, to: string, group: GapGroup, sc: SalesScope, product: number | null = null): Promise<GapRow[]> {
  return (await rpcAll('sales_gap', { p_from: from, p_to: to, p_group: group, p_line: sc.line, p_manager: sc.manager, p_product: product }, ['key_name', 'key_id'])).map(toGapRow)
}

/** Can exceed 1,000 rows: the heat map always passes one line and the rows are paged. */
export async function fetchSalesRepProduct(from: string, to: string, sc: SalesScope): Promise<RepProductRow[]> {
  return (await rpcAll('sales_rep_product', { p_from: from, p_to: to, p_line: sc.line, p_manager: sc.manager }, ['rep_id', 'product_id'])).map(toRepProductRow)
}

export async function fetchSalesActions(from: string, to: string, threshold: number, down: number, sc: SalesScope): Promise<ActionRow[]> {
  return (await rpcAll('sales_rep_actions', { p_from: from, p_to: to, p_threshold: threshold, p_down: down, p_line: sc.line, p_manager: sc.manager }, ['rep_id'])).map(toActionRow)
}

export async function fetchSalesVacant(from: string, to: string, line: number | null): Promise<VacantRow[]> {
  return (await rpcAll('sales_vacant', { p_from: from, p_to: to, p_line: line }, ['territory_id'])).map(toVacantRow)
}

/** Visits and coaching per rep in the period (empty when field activity is not available). */
export async function fetchSalesField(from: string, to: string): Promise<FieldRow[]> {
  return (await rpcAll('sales_field', { p_from: from, p_to: to }, ['rep_id'])).map(toFieldRow)
}

/** Direct managers for the filter. */
export async function fetchSalesManagers(): Promise<{ id: number; name: string }[]> {
  return fetchAll<{ id: number; name: string }>('managers', 'id,name', ['name'])
}
