import { supabase } from '../supabase'
import { fetchAll } from './core'
import { rpcAll, type Raw } from './reports'
import { lookup } from './lists'
import { toRangeRepRow } from '../../features/reports/kpiRangeMath'
import type { KpiRepRow } from '../../features/reports/kpiRepMath'
import { leavesFromSlots, missingFromSlots, type RepIdentity } from '../../features/reports/absenceDaily'
import type { LeaveRow, MissingRow } from '../../features/reports/absenceMath'

/** The latest visit date in the data (anchor of the rolling quick ranges); null when there are no visits. */
export async function fetchLatestVisitDate(): Promise<string | null> {
  const { data, error } = await supabase.from('visits').select('visit_date').order('visit_date', { ascending: false }).limit(1)
  if (error) throw new Error(error.message)
  const d = (data as { visit_date: string }[] | null)?.[0]?.visit_date
  return d ?? null
}

/** kpi_range(p_from, p_to): one row per rep, paged past the 1000-row cap. Targets are those of the month of the To date. */
export const fetchKpiRange = (from: string, to: string): Promise<Raw[]> => rpcAll('kpi_range', { p_from: from, p_to: to }, ['rep_id'])

export interface DayShiftRow { rep_id: number; day: string; shift: 'AM' | 'PM'; visits: number; leave: boolean; office_work: boolean; activity: boolean; status: string }

/** Daily slots of every rep with `day between from and to` (rep_day_shift). */
export const fetchDayShifts = (from: string, to: string): Promise<DayShiftRow[]> =>
  fetchAll<DayShiftRow>('rep_day_shift', 'rep_id,day,shift,visits,leave,office_work,activity,status', ['day', 'rep_id', 'shift'], (q) => q.gte('day', from).lte('day', to))

/** KPI-by-rep rows for a partial range: kpi_range joined with manager and line names. `month` is the month of the To date. */
export async function fetchKpiRangeRows(from: string, to: string, month: string): Promise<KpiRepRow[]> {
  const [raw, lines] = await Promise.all([fetchKpiRange(from, to), fetchAll<{ id: number; name: string }>('lines', 'id,name', ['id'])])
  const mgr = await lookup<{ id: number; name: string }>('managers', 'id,name', raw.flatMap((r) => (r.manager_id == null ? [] : [Number(r.manager_id)])))
  const lineName = new Map(lines.map((l) => [l.id, l.name]))
  return raw.map((r) =>
    toRangeRepRow(r, {
      line: r.line_id == null ? null : lineName.get(Number(r.line_id)) ?? null,
      manager: r.manager_id == null ? null : mgr.get(Number(r.manager_id))?.name ?? null,
    }, month),
  )
}

/** Rep identity (names, line, manager, box, hire date) for the reps that have slots in the range: kpi_range rows + hire dates. */
export async function fetchRepIdentities(from: string, to: string, month: string): Promise<Map<number, RepIdentity>> {
  const rows = await fetchKpiRangeRows(from, to, month)
  const hires = await lookup<{ id: number; hire_date: string | null }>('reps', 'id,hire_date', rows.map((r) => r.rep_id))
  return new Map(rows.map((r) => [r.rep_id, {
    rep_id: r.rep_id, line_id: r.line_id, manager_id: r.manager_id, line: r.line, manager: r.manager,
    rep_code: r.rep_code, rep_name: r.rep_name, box: r.box, hire_date: hires.get(r.rep_id)?.hire_date ?? null,
  }]))
}

/** Daily leave report: rep_day_shift for the range + identities. */
export async function fetchLeavesByDay(from: string, to: string, month: string): Promise<LeaveRow[]> {
  const [slots, ids] = await Promise.all([fetchDayShifts(from, to), fetchRepIdentities(from, to, month)])
  return leavesFromSlots(slots, ids, month)
}
/** Daily missing-days report: rep_day_shift for the range + identities. */
export async function fetchMissingByDay(from: string, to: string, month: string): Promise<MissingRow[]> {
  const [slots, ids] = await Promise.all([fetchDayShifts(from, to), fetchRepIdentities(from, to, month)])
  return missingFromSlots(slots, ids, month)
}
