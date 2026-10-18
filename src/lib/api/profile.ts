/**
 * Data access of the 360° view. Everything is read from existing views / functions; new functions (script 63:
 * profile_search, box_overview, box_rep_history, box_coverage) and views whose columns are not in this repo
 * (v_sales_cube, v_staff_*) are read tolerantly and an empty answer is an empty state, not an error.
 */
import { supabase } from '../supabase'
import { addDaysIso, addMonthsIso } from '../norm'
import { toKpi, type KpiNumbers } from '../../features/dashboard/kpiMath'
import { toSearchHits, type SearchHit } from '../../features/profile/profileLinks'
import { toRepPeriods, type RepPeriod } from '../../features/profile/boxHistory'
import { fetchAll, rpc } from './core'
import { lookup } from './lists'
import { fetchCoachingRepVisits, fetchCoachingReps } from './coaching'
import { fetchCoverageDoctors, fetchJointMonth, fetchManagerCoverage, fetchManagerReport, rpcAll, type CoverageDoctor, type Raw } from './reports'
import { fetchSalesGap, fetchSalesMonthly, fetchSalesProducts } from './sales'

export type { Raw }

export const lastDayOf = (month: string): string => addDaysIso(addMonthsIso(month, 1), -1)
export const yearStart = (month: string): string => `${month.slice(0, 4)}-01-01`
export const yearMonths = (month: string): string[] => Array.from({ length: 12 }, (_, i) => `${month.slice(0, 4)}-${String(i + 1).padStart(2, '0')}-01`)

const text = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === '' ? null : String(v))
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
/** First present key among `keys`. */
export const pick = (o: Raw, keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]
  return undefined
}

/* ------------------------------------------- search ------------------------------------------- */
export async function profileSearch(q: string): Promise<SearchHit[]> {
  return toSearchHits(await rpc<unknown>('profile_search', { p_q: q }))
}

/* ------------------------------------------- rep ------------------------------------------- */
export type RepMonthKpi = KpiNumbers & { month: string; target_am: number | null; target_pm: number | null; field_days: number | null }

/** One entry per month of the year of `month`; months where the rep did not occupy a box have no v_kpi_rep row -> null. */
export async function fetchRepKpiYear(repId: number, month: string): Promise<(RepMonthKpi | null)[]> {
  const rows = await fetchAll<Raw>('v_kpi_rep', '*', ['month'], (q) => q.eq('rep_id', repId).gte('month', yearStart(month)).lte('month', `${month.slice(0, 4)}-12-01`))
  const by = new Map(rows.map((r) => {
    const k = toKpi(r)
    return [String(r.month).slice(0, 10), { ...k, month: String(r.month).slice(0, 10), target_am: numOrNull(r.target_am), target_pm: numOrNull(r.target_pm), field_days: k.days_am === null && k.days_pm === null ? null : (k.days_am ?? 0) + (k.days_pm ?? 0) }] as const
  }))
  return yearMonths(month).map((m) => by.get(m) ?? null)
}

export interface OrgMonthRow { territory_id: number; box_id: number; line_id: number; rep_id: number | null; manager_id: number | null; nsm_id: number | null }

/** The flattened org of a month for one rep / manager / box (org_month). */
export async function fetchOrgMonth(by: 'rep_id' | 'manager_id' | 'box_id', id: number, month: string): Promise<OrgMonthRow[]> {
  const rows = await fetchAll<Raw>('org_month', 'territory_id,box_id,line_id,rep_id,manager_id,nsm_id', ['territory_id'], (q) => q.eq('month', month).eq(by, id))
  return rows.map((r) => ({
    territory_id: Number(r.territory_id), box_id: Number(r.box_id), line_id: Number(r.line_id),
    rep_id: numOrNull(r.rep_id), manager_id: numOrNull(r.manager_id), nsm_id: numOrNull(r.nsm_id),
  }))
}

export interface ListDoctor extends CoverageDoctor { speciality: string | null }

/** The rep's list for the month (v_coverage_doctors) with the doctors' speciality. */
export async function fetchRepList(repId: number, month: string): Promise<ListDoctor[]> {
  const docs = await fetchCoverageDoctors(repId, month)
  const info = await lookup<{ id: number; speciality_id: number | null }>('doctors', 'id,speciality_id', docs.map((d) => d.doctor_id))
  const specIds = [...new Set([...info.values()].flatMap((d) => (d.speciality_id === null ? [] : [d.speciality_id])))]
  const specs = await lookup<{ id: number; name: string }>('specialities', 'id,name', specIds)
  return docs.map((d) => {
    const sid = info.get(d.doctor_id)?.speciality_id ?? null
    return { ...d, speciality: sid === null ? null : specs.get(sid)?.name ?? null }
  })
}

/** v_speciality_mix rows of one rep for the month: share of the list per speciality vs the line strategy. */
export const fetchRepSpecMix = (repId: number, month: string): Promise<Raw[]> =>
  fetchAll<Raw>('v_speciality_mix', 'speciality,doctors,total_docs,share_pct,strategy_pct,diff_points,is_off,threshold_points', ['speciality'], (q) => q.eq('month', month).eq('rep_id', repId))

export interface DaySlot { day: string; shift: 'AM' | 'PM'; status: string; visits: number }
export async function fetchRepDays(repId: number, month: string): Promise<DaySlot[]> {
  const rows = await fetchAll<Raw>('rep_day_shift', 'day,shift,status,visits', ['day', 'shift'], (q) => q.eq('rep_id', repId).gte('day', month).lte('day', lastDayOf(month)))
  return rows.map((r) => ({ day: String(r.day).slice(0, 10), shift: r.shift === 'PM' ? 'PM' : 'AM', status: String(r.status), visits: numOrNull(r.visits) ?? 0 }))
}

/** Joint days of the month (v_manager_joint_month) for one rep or one manager. */
export async function fetchJointFor(by: 'rep' | 'manager', id: number, month: string) {
  return (await fetchJointMonth(month)).filter((r) => (by === 'rep' ? r.rep_id === id : r.manager_id === id))
}

/** A rep's coaching summary and visits (coaching_rep_summary / coaching_rep_visits), January to the selected month. */
export async function fetchRepCoaching(repId: number, month: string) {
  const from = yearStart(month)
  const to = lastDayOf(month)
  const summaries = await fetchCoachingReps(from, to, 'ALL', 0)
  const mine = summaries.find((s) => s.rep_id === repId) ?? null
  const visits = mine ? await fetchCoachingRepVisits(mine.rep_key, from, to, 'ALL') : []
  return { summary: mine, visits }
}

/* ------------------------------------------- manager ------------------------------------------- */
export const fetchManagerRow = async (managerId: number, month: string) => (await fetchManagerReport(month)).find((r) => r.manager_id === managerId) ?? null
export const fetchManagerCoverageFor = async (managerId: number, month: string) => (await fetchManagerCoverage(month, month, 'ALL')).filter((r) => r.manager_id === managerId)

/** District sales through the existing sales functions (p_manager): monthly, per rep and per product. */
export async function fetchManagerSales(managerId: number, month: string) {
  const from = yearStart(month)
  const to = lastDayOf(month)
  const sc = { line: null, manager: managerId }
  const [monthly, reps, territories, products] = await Promise.all([
    fetchSalesMonthly(from, to, sc),
    fetchSalesGap(month, to, 'rep', sc),
    fetchSalesGap(month, to, 'territory', sc),
    fetchSalesProducts(month, to, month, to, sc),
  ])
  return { monthly, reps, territories, products }
}

export interface OwnVisit { visit_date: string; shift: string; visit_type: string | null; territory: string | null; doctor: string | null; account: string | null }
/** A manager's own visits of the month (visits rows with his manager_id). */
export async function fetchManagerVisits(managerId: number, month: string): Promise<OwnVisit[]> {
  const rows = await fetchAll<Raw>('visits', 'id,visit_date,shift,visit_type,territory_raw,doctor_id,doctor_raw,account_raw', ['visit_date', 'id'], (q) => q.eq('manager_id', managerId).gte('visit_date', month).lte('visit_date', lastDayOf(month)))
  const docs = await lookup<{ id: number; doctor_name: string; account_name: string | null }>('doctors', 'id,doctor_name,account_name', rows.flatMap((r) => (numOrNull(r.doctor_id) === null ? [] : [Number(r.doctor_id)])))
  return rows.map((r) => {
    const d = numOrNull(r.doctor_id) === null ? undefined : docs.get(Number(r.doctor_id))
    return { visit_date: String(r.visit_date).slice(0, 10), shift: String(r.shift), visit_type: text(r.visit_type), territory: text(r.territory_raw), doctor: d?.doctor_name ?? text(r.doctor_raw), account: d?.account_name ?? text(r.account_raw) }
  })
}

/** Coaching given by a manager (evaluator view): the coaching summary rows are keyed by rep, so visits are listed per evaluator name. */
export async function fetchCoachingGiven(evaluatorName: string, month: string) {
  const from = yearStart(month)
  const to = lastDayOf(month)
  const reps = await fetchCoachingReps(from, to, 'MANAGER', 0)
  const out: { rep: string; visit_date: string | null; avg_score: number | null }[] = []
  const wanted = evaluatorName.trim().toLowerCase()
  await Promise.all(reps.map(async (r) => {
    for (const v of await fetchCoachingRepVisits(r.rep_key, from, to, 'MANAGER')) {
      if ((v.evaluator ?? '').trim().toLowerCase() === wanted) out.push({ rep: r.rep_name, visit_date: v.visit_date, avg_score: v.avg_score })
    }
  }))
  return out.sort((a, b) => String(b.visit_date).localeCompare(String(a.visit_date)))
}

/* ------------------------------------------- sales cube (rep / box) ------------------------------------------- */
export interface CubeRow { month: string; product: string; sales: number; target: number; units: number; vacant: boolean }

/** v_sales_cube rows for one rep or one box. Column spellings are read tolerantly; rows without a month are dropped. */
export async function fetchSalesCube(by: 'rep_id' | 'box_id', id: number, month: string): Promise<CubeRow[]> {
  const rows = await fetchAll<Raw>('v_sales_cube', '*', ['month'], (q) => q.eq(by, id).gte('month', yearStart(month)).lte('month', `${month.slice(0, 4)}-12-01`))
  return rows.flatMap((r) => {
    const m = text(r.month)
    if (!m) return []
    return [{
      month: m.slice(0, 10),
      product: text(pick(r, ['product_name', 'product'])) ?? '—',
      sales: numOrNull(pick(r, ['s_value', 'sales_value', 'sales', 'value'])) ?? 0,
      target: numOrNull(pick(r, ['t_value', 'target_value', 'target'])) ?? 0,
      units: numOrNull(pick(r, ['s_units', 'sales_units', 'units'])) ?? 0,
      vacant: r.rep_id === null || r.rep_id === undefined,
    }]
  })
}

/* ------------------------------------------- staff ------------------------------------------- */
/** Generic rows of the staff views (columns are not fixed here). */
export const fetchStaffMonths = (staffId: number, month: string): Promise<Raw[]> =>
  fetchAll<Raw>('v_staff_visits_month', '*', ['month'], (q) => q.eq('staff_id', staffId).gte('month', yearStart(month)).lte('month', `${month.slice(0, 4)}-12-01`))
export const fetchStaffDetail = (staffId: number, month: string): Promise<Raw[]> =>
  fetchAll<Raw>('v_staff_visit_detail', '*', ['visit_date'], (q) => q.eq('staff_id', staffId).gte('visit_date', month).lte('visit_date', lastDayOf(month)))

/** Simple identity of a staff member (small table lookup by id; the table name is tried in order). */
export async function fetchStaffInfo(staffId: number): Promise<Raw | null> {
  for (const table of ['staff', 'v_staff']) {
    const { data, error } = await supabase.from(table).select('*').eq('id', staffId).maybeSingle()
    if (!error && data) return data as Raw
  }
  return null
}

/* ------------------------------------------- box ------------------------------------------- */
export interface BoxOverview {
  line: string | null; district: string | null; district_manager: string | null; manager: string | null; nsm: string | null
  rep: string | null; rep_id: number | null; manager_id: number | null; territories: string[]
}
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(/\s*[|,;]\s*/).filter(Boolean) : [])

/** box_overview(p_box, p_month): one row (or object); every key is read tolerantly. */
export async function fetchBoxOverview(boxId: number, month: string): Promise<BoxOverview | null> {
  let res = await rpc<unknown>('box_overview', { p_box: boxId, p_month: month })
  if (Array.isArray(res)) res = res[0]
  if (typeof res !== 'object' || res === null) return null
  const o = res as Raw
  return {
    line: text(pick(o, ['line', 'line_name'])), district: text(pick(o, ['district', 'district_name'])),
    district_manager: text(pick(o, ['district_manager', 'district_manager_name'])), manager: text(pick(o, ['manager', 'manager_name'])),
    nsm: text(pick(o, ['nsm', 'nsm_name'])), rep: text(pick(o, ['rep', 'rep_name', 'current_rep'])),
    rep_id: numOrNull(pick(o, ['rep_id', 'current_rep_id'])), manager_id: numOrNull(pick(o, ['manager_id'])),
    territories: asList(pick(o, ['territories', 'territory_names', 'territory'])),
  }
}

export const fetchBoxRepHistory = async (boxId: number): Promise<RepPeriod[]> => toRepPeriods(await rpc<unknown>('box_rep_history', { p_box: boxId }))

export interface BoxCoverageRow { month: string; rep: string | null; list_doctors: number; visited: number; fully: number; target_visits: number; visits: number }
/** box_coverage(p_box, p_from, p_to): one row per month; a month without a row has no box link in its list yet. */
export async function fetchBoxCoverage(boxId: number, from: string, to: string): Promise<BoxCoverageRow[]> {
  const rows = await rpcAll('box_coverage', { p_box: boxId, p_from: from, p_to: to }, ['month'])
  return rows.flatMap((r) => {
    const m = text(r.month)
    if (!m) return []
    const n = (keys: string[]) => numOrNull(pick(r, keys)) ?? 0
    return [{
      month: m.slice(0, 10), rep: text(pick(r, ['rep', 'rep_name'])), list_doctors: n(['list_doctors', 'list']), visited: n(['visited', 'visited_doctors', 'covered_doctors']),
      fully: n(['fully_covered', 'fully']), target_visits: n(['target_visits', 'target']), visits: n(['visits', 'valid_visits', 'total_visits']),
    }]
  })
}

export interface BoxListDoctor { doctor_id: number; doctor: string; account: string | null; rep: string | null; class: string | null; freq: number; visits: number }

/** The month's list rows of a box (list_snapshot.box_id) with the visits each doctor received that month. */
export async function fetchBoxList(boxId: number, month: string): Promise<BoxListDoctor[]> {
  const rows = await fetchAll<Raw>('list_snapshot', 'doctor_id,rep_id,class,freq', ['doctor_id'], (q) => q.eq('month', month).eq('box_id', boxId))
  const ids = rows.map((r) => Number(r.doctor_id))
  const [docs, reps] = await Promise.all([
    lookup<{ id: number; doctor_name: string; account_name: string | null }>('doctors', 'id,doctor_name,account_name', ids),
    lookup<{ id: number; name: string }>('reps', 'id,name', rows.flatMap((r) => (numOrNull(r.rep_id) === null ? [] : [Number(r.rep_id)]))),
  ])
  const counts = new Map<number, number>()
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('visits').select('doctor_id').in('doctor_id', chunk).gte('visit_date', month).lte('visit_date', lastDayOf(month)).order('id').range(from, from + 999)
      if (error) throw new Error(error.message)
      for (const v of (data ?? []) as { doctor_id: number }[]) counts.set(v.doctor_id, (counts.get(v.doctor_id) ?? 0) + 1)
      if ((data ?? []).length < 1000) break
    }
  }
  return rows.map((r) => {
    const id = Number(r.doctor_id)
    return { doctor_id: id, doctor: docs.get(id)?.doctor_name ?? `#${id}`, account: docs.get(id)?.account_name ?? null, rep: numOrNull(r.rep_id) === null ? null : reps.get(Number(r.rep_id))?.name ?? null, class: text(r.class), freq: numOrNull(r.freq) ?? 0, visits: counts.get(id) ?? 0 }
  })
}

/** How many list rows of the month have no box link yet (the hint about backfill_list_box). */
export async function countListWithoutBox(month: string): Promise<number> {
  const { count, error } = await supabase.from('list_snapshot').select('doctor_id', { count: 'exact', head: true }).eq('month', month).is('box_id', null)
  if (error) throw new Error(error.message)
  return count ?? 0
}
