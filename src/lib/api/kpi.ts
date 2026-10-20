import { supabase } from '../supabase'
import { fetchAll, rpc } from './core'
import { lookup } from './lists'
import { addDaysIso, addMonthsIso } from '../norm'
import {
  num, toKpi, type KpiNumbers, type LineRow, type ManagerRow, type Names, type RepRow,
} from '../../features/dashboard/kpiMath'

/* ----------------------- tiny in-memory cache (keyed, de-duplicated) ----------------------- */
const cache = new Map<string, Promise<unknown>>()

export function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit) return hit as Promise<T>
  const p = fn().catch((e: unknown) => {
    cache.delete(key) // never cache a failure
    throw e
  })
  cache.set(key, p)
  return p
}
export const dropCached = (key: string) => void cache.delete(key)
/** Drop every cached entry whose key starts with `prefix` (e.g. all months of one report). */
export const dropCachedPrefix = (prefix: string) => {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k)
}
export const clearKpiCache = () => cache.clear()

type Raw = Record<string, unknown>

/* ------------------------------------ series ------------------------------------ */
export interface CompanyRow extends KpiNumbers { month: string }
export interface LineSeriesRow extends KpiNumbers { month: string; line_id: number | null }

/** Company KPIs for every month that has data (reads v_kpi_company only). */
export async function fetchCompanySeries(): Promise<CompanyRow[]> {
  const rows = await fetchAll<Raw>('v_kpi_company', '*', ['month'])
  return rows.map((r) => ({ ...toKpi(r), month: String(r.month) }))
}

export async function fetchLineSeries(): Promise<LineSeriesRow[]> {
  const rows = await fetchAll<Raw>('v_kpi_line', '*', ['month', 'line_id'])
  return rows.map((r) => ({ ...toKpi(r), month: String(r.month), line_id: num(r.line_id) }))
}

/* ------------------------------------ one month ------------------------------------ */
export interface MonthDetail { lines: LineRow[]; managers: ManagerRow[]; reps: RepRow[]; names: Names }

export async function fetchMonthDetail(month: string): Promise<MonthDetail> {
  const [lineRaw, mgrRaw, repRaw, lineNames] = await Promise.all([
    fetchAll<Raw>('v_kpi_line', '*', ['line_id'], (q) => q.eq('month', month)),
    fetchAll<Raw>('v_kpi_manager', '*', ['line_id', 'manager_id'], (q) => q.eq('month', month)),
    fetchAll<Raw>('v_kpi_rep', '*', ['rep_id'], (q) => q.eq('month', month)),
    fetchAll<{ id: number; name: string }>('lines', 'id,name', ['id']),
  ])
  const lines: LineRow[] = lineRaw.map((r) => ({ ...toKpi(r), line_id: num(r.line_id) }))
  const managers: ManagerRow[] = mgrRaw.map((r) => ({ ...toKpi(r), line_id: num(r.line_id), manager_id: num(r.manager_id) }))
  const reps: RepRow[] = repRaw.map((r) => ({
    ...toKpi(r),
    rep_id: num(r.rep_id) as number,
    box_id: num(r.box_id),
    line_id: num(r.line_id),
    manager_id: num(r.manager_id),
    target_am: num(r.target_am),
    target_pm: num(r.target_pm),
    target_visits: num(r.target_visits),
  }))
  // Names: chunked `in` lookups (PostgREST URL limit), only for the ids on this page.
  const [repMap, mgrMap, boxMap] = await Promise.all([
    lookup<{ id: number; code: string; name: string }>('reps', 'id,code,name', reps.map((r) => r.rep_id)),
    lookup<{ id: number; name: string }>('managers', 'id,name', managers.flatMap((m) => (m.manager_id === null ? [] : [m.manager_id]))),
    lookup<{ id: number; name: string }>('boxes', 'id,name', reps.flatMap((r) => (r.box_id === null ? [] : [r.box_id]))),
  ])
  return {
    lines, managers, reps,
    names: {
      lines: new Map(lineNames.map((l) => [l.id, l.name])),
      managers: new Map([...mgrMap].map(([id, m]) => [id, m.name])),
      reps: new Map([...repMap].map(([id, r]) => [id, { code: r.code, name: r.name }])),
      boxes: new Map([...boxMap].map(([id, b]) => [id, b.name])),
    },
  }
}

/** The last months of one rep, newest first (drawer history). */
export async function fetchRepHistory(repId: number, limit = 6): Promise<(KpiNumbers & { month: string; target_am: number | null; target_pm: number | null })[]> {
  const { data, error } = await supabase.from('v_kpi_rep').select('*').eq('rep_id', repId).order('month', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Raw[]).map((r) => ({ ...toKpi(r), month: String(r.month), target_am: num(r.target_am), target_pm: num(r.target_pm) }))
}

/* --------------------------------- context for banners --------------------------------- */
/** Boxes with no rep this month (vacant boxes have no KPI rows). Distinct boxes per line. */
export async function fetchVacantBoxes(month: string): Promise<{ box_id: number; line_id: number | null }[]> {
  const rows = await fetchAll<{ territory_id: number; box_id: number; line_id: number | null }>(
    'org_month', 'territory_id,box_id,line_id', ['territory_id'], (q) => q.eq('month', month).is('rep_id', null),
  )
  const seen = new Map<number, number | null>()
  for (const r of rows) if (!seen.has(r.box_id)) seen.set(r.box_id, r.line_id)
  return [...seen].map(([box_id, line_id]) => ({ box_id, line_id }))
}

/** Working AM days of the month, from the database calendar (source of truth). */
export async function fetchWorkingDays(month: string): Promise<number> {
  const days = await rpc<{ day: string }[]>('working_days', { p_shift: 'AM', p_from: month, p_to: addDaysIso(addMonthsIso(month, 1), -1) })
  return days.length
}

/** Working AM days per month (YYYY-MM -> count) for a whole range in ONE call. */
export async function fetchWorkingDaysByMonth(from: string, to: string, signal?: AbortSignal): Promise<Map<string, number>> {
  const days = await rpc<{ day: string }[]>('working_days', { p_shift: 'AM', p_from: from, p_to: to }, signal)
  const out = new Map<string, number>()
  for (const d of days) out.set(String(d.day).slice(0, 7), (out.get(String(d.day).slice(0, 7)) ?? 0) + 1)
  return out
}
