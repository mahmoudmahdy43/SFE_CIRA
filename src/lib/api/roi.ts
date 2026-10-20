import { supabase } from '../supabase'
import { fetchAll, rpc } from './core'
import { rpcAll } from './reports'
import { num } from '../../features/dashboard/kpiMath'
import { monthlyCall, territoriesCall, type CostRow, type QualityRow, type Selection, type Shift } from '../../features/roi/roiMath'

/** Speciality ROI RPCs (76_speciality_roi.sql): admin only. `line` null = all lines. Every read takes an AbortSignal. */
const n0 = (v: unknown): number => num(v) ?? 0
const day = (v: unknown): string => String(v ?? '').slice(0, 10)

export interface RoiRow {
  line_id: number; line_name: string; group_id: number; group_name: string; specialities: string; products: string
  list_doctors: number; visits: number; visits_per_doctor: number | null; s_value: number; s_units: number; cost: number
  sales_per_visit: number | null; roi: number | null
}
export interface RoiMonth { month: string; visits: number; s_value: number; s_units: number; cost: number; sales_per_visit: number | null; roi: number | null }
export interface RoiTerritory {
  territory_id: number; territory_name: string; rep_name: string | null; manager_name: string | null
  visits: number; s_value: number; cost: number; sales_per_visit: number | null; roi: number | null
}
export interface RoiLink { lag: number; n: number; r: number | null }

export async function fetchRoiQuality(from: string, to: string, line: number | null, signal?: AbortSignal): Promise<QualityRow[]> {
  const rows = await rpcAll('speciality_roi_quality', { p_from: from, p_to: to, p_line: line }, ['line_name'], Infinity, signal)
  return rows.map((r) => ({ line_name: String(r.line_name ?? ''), doctor_visits: n0(r.doctor_visits), no_doctor: n0(r.no_doctor), no_speciality: n0(r.no_speciality), in_groups: n0(r.in_groups), classified_pct: num(r.classified_pct) }))
}

export async function fetchRoi(from: string, to: string, line: number | null, shift: Shift, signal?: AbortSignal): Promise<RoiRow[]> {
  const rows = await rpcAll('speciality_roi', { p_from: from, p_to: to, p_line: line, p_shift: shift }, ['line_name', 'group_id'], Infinity, signal)
  return rows.map((r) => ({
    line_id: n0(r.line_id), line_name: String(r.line_name ?? ''), group_id: n0(r.group_id), group_name: String(r.group_name ?? ''),
    specialities: String(r.specialities ?? ''), products: String(r.products ?? ''),
    list_doctors: n0(r.list_doctors), visits: n0(r.visits), visits_per_doctor: num(r.visits_per_doctor), s_value: n0(r.s_value), s_units: n0(r.s_units),
    cost: n0(r.cost), sales_per_visit: num(r.sales_per_visit), roi: num(r.roi),
  }))
}

/** Months for a group (speciality_roi_monthly) or for the scope Line / Product (speciality_roi_scope_monthly, 77_*.sql). */
export async function fetchRoiMonthly(sel: Selection, from: string, to: string, shift: Shift, signal?: AbortSignal): Promise<RoiMonth[]> {
  const c = monthlyCall(sel, from, to, shift)
  const rows = await rpcAll(c.fn, c.args, ['month'], Infinity, signal)
  return rows.map((r) => ({ month: day(r.month), visits: n0(r.visits), s_value: n0(r.s_value), s_units: n0(r.s_units), cost: n0(r.cost), sales_per_visit: num(r.sales_per_visit), roi: num(r.roi) }))
}

export async function fetchRoiTerritories(group: number, from: string, to: string, shift: Shift, signal?: AbortSignal): Promise<RoiTerritory[]> {
  const rows = await rpcAll('speciality_roi_territories', { p_group: group, p_from: from, p_to: to, p_shift: shift }, ['territory_id'], Infinity, signal)
  return rows.map((r) => ({
    territory_id: n0(r.territory_id), territory_name: String(r.territory_name ?? ''), rep_name: r.rep_name ? String(r.rep_name) : null,
    manager_name: r.manager_name ? String(r.manager_name) : null, visits: n0(r.visits), s_value: n0(r.s_value), cost: n0(r.cost),
    sales_per_visit: num(r.sales_per_visit), roi: num(r.roi),
  }))
}

export async function fetchRoiLink(group: number, from: string, to: string, shift: Shift, signal?: AbortSignal): Promise<RoiLink[]> {
  const rows = await rpcAll('speciality_roi_link', { p_group: group, p_from: from, p_to: to, p_shift: shift }, ['lag'], Infinity, signal)
  return rows.map((r) => ({ lag: n0(r.lag), n: n0(r.n), r: num(r.r) }))
}

/* ------------------------------ cost per visit ------------------------------ */
export async function fetchVisitCosts(signal?: AbortSignal): Promise<CostRow[]> {
  void signal
  const rows = await fetchAll<{ month_from: string; cost: number | string }>('visit_cost', 'month_from,cost', ['month_from'])
  return rows.map((r) => ({ month_from: day(r.month_from), cost: n0(r.cost) }))
}
/** The new cost applies from `fromYM` ("YYYY-MM") onward. */
export const saveVisitCost = (fromYM: string, cost: number): Promise<unknown> => rpc('set_visit_cost', { p_from_month: `${fromYM}-01`, p_cost: cost })

/* ------------------------------ speciality map (direct CRUD, admin RLS) ------------------------------ */
export interface MapGroup { id: number; line_id: number; name: string; sort: number; specialities: number[]; products: number[] }
export interface MapNames { specialities: string[]; products: { name: string; line: string | null }[] }
export interface SpecOpt { id: number; name: string }
export interface ProdOpt { id: number; name: string; line_id: number | null }

export async function fetchMapGroups(): Promise<MapGroup[]> {
  const [groups, members, prods] = await Promise.all([
    fetchAll<{ id: number; line_id: number; name: string; sort: number }>('speciality_groups', 'id,line_id,name,sort', ['line_id', 'sort', 'id']),
    fetchAll<{ group_id: number; speciality_id: number }>('speciality_group_members', 'group_id,speciality_id', ['group_id', 'speciality_id']),
    fetchAll<{ group_id: number; product_id: number; priority: number }>('speciality_group_products', 'group_id,product_id,priority', ['group_id', 'priority']),
  ])
  return groups.map((g) => ({
    ...g,
    specialities: members.filter((m) => m.group_id === g.id).map((m) => m.speciality_id),
    products: prods.filter((p) => p.group_id === g.id).sort((a, b) => a.priority - b.priority).map((p) => p.product_id),
  }))
}
export const fetchSpecialityOpts = (): Promise<SpecOpt[]> => fetchAll<SpecOpt>('specialities', 'id,name', ['name'])
export const fetchProductOpts = (): Promise<ProdOpt[]> => fetchAll<ProdOpt>('products', 'id,name,line_id', ['name'])

export async function fetchMapNames(): Promise<MapNames> {
  const v = (await rpc<{ specialities?: unknown; products?: unknown } | null>('speciality_map_names')) ?? {}
  const specs = Array.isArray(v.specialities) ? v.specialities.map(String) : []
  const prods = Array.isArray(v.products) ? (v.products as { name?: unknown; line?: unknown }[]).map((p) => ({ name: String(p.name ?? ''), line: p.line ? String(p.line) : null })) : []
  return { specialities: specs, products: prods }
}

export interface GroupDraft { id?: number; line_id: number; name: string; sort?: number; specialities: number[]; products: number[] }

const check = (what: string, error: { message: string } | null) => { if (error) throw new Error(`${what}: ${error.message}`) }

/** Create or update one group with its specialities and its products (priority = position in the list, from 1). */
export async function saveMapGroup(g: GroupDraft): Promise<number> {
  let id = g.id
  if (id === undefined) {
    const { data, error } = await supabase.from('speciality_groups').insert({ line_id: g.line_id, name: g.name, sort: g.sort ?? 0 }).select('id').single()
    check('speciality_groups', error)
    id = (data as { id: number }).id
  } else {
    check('speciality_groups', (await supabase.from('speciality_groups').update({ name: g.name }).eq('id', id)).error)
    check('speciality_group_members', (await supabase.from('speciality_group_members').delete().eq('group_id', id)).error)
    check('speciality_group_products', (await supabase.from('speciality_group_products').delete().eq('group_id', id)).error)
  }
  if (g.specialities.length) check('speciality_group_members', (await supabase.from('speciality_group_members').insert(g.specialities.map((s) => ({ group_id: id, speciality_id: s })))).error)
  if (g.products.length) check('speciality_group_products', (await supabase.from('speciality_group_products').insert(g.products.map((p, i) => ({ group_id: id, product_id: p, priority: i + 1 })))).error)
  return id
}

/** Deleting a group removes its members and products too (on delete cascade). */
export async function deleteMapGroup(id: number): Promise<void> {
  check('speciality_groups', (await supabase.from('speciality_groups').delete().eq('id', id)).error)
}

/** Replace every group of the given lines by `groups` (used by "Fill from the 2026 strategy" after the user confirmed). */
export async function replaceLineGroups(lineIds: number[], groups: GroupDraft[]): Promise<void> {
  if (lineIds.length) check('speciality_groups', (await supabase.from('speciality_groups').delete().in('line_id', lineIds)).error)
  const sortOf = new Map<number, number>()
  for (const g of groups) {
    const sort = (sortOf.get(g.line_id) ?? 0) + 1
    sortOf.set(g.line_id, sort)
    await saveMapGroup({ ...g, id: undefined, sort })
  }
}

/* ------------------------------ scope: products and territories (77_*.sql / 78_*.sql, run by the user) ------------------------------ */
export interface RoiProduct { product_id: number; name: string; in_group: boolean }
export async function fetchRoiProducts(line: number, signal?: AbortSignal): Promise<RoiProduct[]> {
  const rows = await rpcAll('speciality_roi_products', { p_line: line }, ['name'], Infinity, signal)
  return rows.map((r) => ({ product_id: n0(r.product_id), name: String(r.name ?? ''), in_group: r.in_group === true || r.in_group === 'true' }))
}

export interface RoiScopeTerritory {
  line_id: number; line_name: string; territory_id: number; territory_name: string; rep_name: string | null; manager_name: string | null
  list_doctors: number; visits: number; s_value: number; s_units: number; cost: number; sales_per_visit: number | null; roi: number | null
  kpi_doctors: number; covered_doctors: number; coverage: number | null; pcf: number | null; low_sample: boolean
}
/** Territories of the scope; the database returns the low-sample rows (visits below p_min_visits) last. */
export async function fetchRoiScopeTerritories(sel: Selection, from: string, to: string, shift: Shift, minVisits: number, signal?: AbortSignal): Promise<RoiScopeTerritory[]> {
  const c = territoriesCall({ ...sel, group: null }, from, to, shift, minVisits)
  const rows = await rpcAll(c.fn, c.args, [], Infinity, signal)
  return rows.map((r) => ({
    line_id: n0(r.line_id), line_name: String(r.line_name ?? ''), territory_id: n0(r.territory_id), territory_name: String(r.territory_name ?? ''),
    rep_name: r.rep_name ? String(r.rep_name) : null, manager_name: r.manager_name ? String(r.manager_name) : null,
    list_doctors: n0(r.list_doctors), visits: n0(r.visits), s_value: n0(r.s_value), s_units: n0(r.s_units), cost: n0(r.cost),
    sales_per_visit: num(r.sales_per_visit), roi: num(r.roi), kpi_doctors: n0(r.kpi_doctors), covered_doctors: n0(r.covered_doctors),
    coverage: num(r.coverage), pcf: num(r.pcf), low_sample: r.low_sample === true || r.low_sample === 'true',
  }))
}
