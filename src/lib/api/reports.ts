import { fetchAll } from './core'
import { supabase } from '../supabase'
import type { MonthDetail } from './kpi'
import { toKpiRepRow, type KpiRepRow } from '../../features/reports/kpiRepMath'
import { toLeaveRow, toMissingRow, type LeaveRow, type MissingRow } from '../../features/reports/absenceMath'
import { MANAGER_COLS, toManagerRow, type ManagerRow } from '../../features/reports/managerMath'
import { toCapacityRow, type CapacityRow } from '../../features/reports/capacityMath'
import { toJointRow, type JointRow } from '../../features/reports/jointMath'
import { normalizeShares, toCoverRow, toDocRow, toSpecRow, type CoverRow, type CoverShift, type DocRow, type SpecRow } from '../../features/reports/coverageMath'
import {
  numOrNull, toCallRateRow, toCoverageRow, type CallRateRow, type CoverageRow,
} from '../../features/reports/reportMath'

export type Raw = Record<string, unknown>

const IDENT = 'month,line_id,manager_id,box,rep_code,rep_name,manager,hire_date,rep_id'

export async function fetchCoverageReport(month: string): Promise<CoverageRow[]> {
  const rows = await fetchAll<Raw>(
    'v_coverage_report',
    `${IDENT},list_doctors,fully_covered,partially_covered,not_visited,coverage`,
    ['rep_id'],
    (q) => q.eq('month', month),
  )
  return rows.map(toCoverageRow)
}

const CALL_COLS = ['working', 'field', 'leave', 'ow', 'activity', 'missing', 'visits']
  .flatMap((g) => [`${g}_am`, `${g}_pm`, `${g}_total`])
  .concat(['call_rate_am', 'call_rate_pm', 'call_rate_total', 'visits_pharmacy', 'field_days', 'call_rate_pharmacy'])
  .join(',')

export async function fetchCallRateReport(month: string): Promise<CallRateRow[]> {
  const rows = await fetchAll<Raw>('v_call_rate_report', `${IDENT},${CALL_COLS}`, ['rep_id'], (q) => q.eq('month', month))
  return rows.map(toCallRateRow)
}

export type DoctorStatus = 'fully' | 'partially' | 'not_visited'
export interface CoverageDoctor {
  doctor_id: number
  doctor_name: string
  account_name: string | null
  class: string | null
  freq: number | null
  visits: number
  status: DoctorStatus
}

export async function fetchCoverageDoctors(repId: number, month: string): Promise<CoverageDoctor[]> {
  const rows = await fetchAll<Raw>(
    'v_coverage_doctors',
    'doctor_id,doctor_name,account_name,class,freq,visits,status',
    ['doctor_name', 'doctor_id'],
    (q) => q.eq('month', month).eq('rep_id', repId),
  )
  return rows.map((r) => ({
    doctor_id: numOrNull(r.doctor_id) ?? 0,
    doctor_name: String(r.doctor_name ?? ''),
    account_name: r.account_name == null ? null : String(r.account_name),
    class: r.class == null ? null : String(r.class),
    freq: numOrNull(r.freq),
    visits: numOrNull(r.visits) ?? 0,
    status: r.status as DoctorStatus,
  }))
}

/** Box call-rate targets per rep for the month (v_kpi_rep already resolves them). */
export async function fetchRepTargets(month: string): Promise<Map<number, { am: number | null; pm: number | null }>> {
  const rows = await fetchAll<Raw>('v_kpi_rep', 'rep_id,target_am,target_pm', ['rep_id'], (q) => q.eq('month', month))
  return new Map(rows.map((r) => [numOrNull(r.rep_id) ?? 0, { am: numOrNull(r.target_am), pm: numOrNull(r.target_pm) }]))
}

export async function fetchLineNames(): Promise<{ id: number; name: string }[]> {
  return fetchAll<{ id: number; name: string }>('lines', 'id,name', ['id'])
}

/** One row per real rep for the KPI-by-rep report: v_kpi_rep (via the shared month detail) joined with rep / box / line / manager names. */
export function kpiRepRows(detail: MonthDetail, month: string): KpiRepRow[] {
  const rows: KpiRepRow[] = []
  for (const r of detail.reps) {
    const info = detail.names.reps.get(r.rep_id)
    if (!info) continue // vacant boxes / staff have no rep record: not part of this report
    rows.push(
      toKpiRepRow({
        ...r,
        month,
        rep_code: info.code,
        rep_name: info.name,
        box: r.box_id === null ? null : detail.names.boxes.get(r.box_id) ?? null,
        line: r.line_id === null ? null : detail.names.lines.get(r.line_id) ?? null,
        manager: r.manager_id === null ? null : detail.names.managers.get(r.manager_id) ?? null,
      }),
    )
  }
  return rows
}

/** One row per manager for the month (v_manager_report). */
export async function fetchManagerReport(month: string): Promise<ManagerRow[]> {
  const rows = await fetchAll<Raw>('v_manager_report', MANAGER_COLS, ['manager_id'], (q) => q.eq('month', month))
  return rows.map(toManagerRow)
}

const CAPACITY_COLS =
  'month,rep_id,rep_code,rep_name,line,manager,box,call_rate_target_pm,pm_working_days,capacity_visits,list_doctors,list_visits,excess_visits,utilization,status,remove_if_freq2,remove_if_freq1,spare_visits'

/** One row per rep for the month (v_visits_capacity: every number is computed by the view; RLS scopes DMs to their own reps). */
export async function fetchVisitsCapacity(month: string): Promise<CapacityRow[]> {
  const rows = await fetchAll<Raw>('v_visits_capacity', CAPACITY_COLS, ['rep_id'], (q) => q.eq('month', month))
  return rows.map(toCapacityRow)
}

const JOINT_COLS =
  'month,manager,manager_id,rep_name,rep_code,rep_id,line,box,rep_am,rep_pm,rep_pharmacy,rep_total,joint_am,joint_pm,joint_pharmacy,joint_total,cover_am,cover_pm,cover_pharmacy,cover_total'

/** One row per day x manager x rep for `day between from and to` (v_manager_joint_days: every number and ratio comes from the view). */
export async function fetchJointDays(from: string, to: string): Promise<JointRow[]> {
  const rows = await fetchAll<Raw>('v_manager_joint_days', `day,${JOINT_COLS}`, ['day', 'manager_id', 'rep_id'], (q) => q.gte('day', from).lte('day', to))
  return rows.map(toJointRow)
}

/** One row per manager x rep for the month (v_manager_joint_month). */
export async function fetchJointMonth(month: string): Promise<JointRow[]> {
  const rows = await fetchAll<Raw>('v_manager_joint_month', `joint_days,${JOINT_COLS}`, ['manager_id', 'rep_id'], (q) => q.eq('month', month))
  return rows.map(toJointRow)
}

const ABS_IDENT = 'month,line,line_id,manager_id,direct_manager,rep_code,rep_name,box,rep_id,hire_date'

/** Leave days per rep and month for months from..to (v_leave_report: only reps with at least one leave day). */
export async function fetchLeaveReport(from: string, to: string): Promise<LeaveRow[]> {
  const rows = await fetchAll<Raw>('v_leave_report', `${ABS_IDENT},vacation_am,vacation_pm,full_days,total_days`, ['month', 'rep_id'], (q) => q.gte('month', from).lte('month', to))
  return rows.map(toLeaveRow)
}

/** Missing days per rep and month for months from..to (v_missing_report: only reps with at least one missing day). */
export async function fetchMissingReport(from: string, to: string): Promise<MissingRow[]> {
  const rows = await fetchAll<Raw>(
    'v_missing_report',
    `${ABS_IDENT},missing_am,missing_pm,missing_total,missing_dates,missing_dates_list,missing_dates_am,missing_dates_pm`,
    ['month', 'rep_id'],
    (q) => q.gte('month', from).lte('month', to),
  )
  return rows.map(toMissingRow)
}

/* ------------------------------------ Manager Coverage (admin-only database functions) ------------------------------------ */
interface RpcPage { order: (column: string) => RpcPage; range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> }

/** Call a set-returning function and page past PostgREST's 1000-row cap. `orderBy` must give a stable order. */
export async function rpcAll(fn: string, args: Record<string, unknown>, orderBy: string[], max = Infinity): Promise<Raw[]> {
  const out: Raw[] = []
  for (let from = 0; out.length < max; from += 1000) {
    let q = supabase.rpc(fn, args) as unknown as RpcPage
    for (const o of orderBy) q = q.order(o)
    const { data, error } = await q.range(from, Math.min(from + 999, from + max - out.length - 1))
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as Raw[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

/** One row per manager x rep for months from..to (manager_coverage). */
export async function fetchManagerCoverage(from: string, to: string, shift: CoverShift): Promise<CoverRow[]> {
  return (await rpcAll('manager_coverage', { p_from: from, p_to: to, p_shift: shift }, ['manager_id', 'rep_id'])).map(toCoverRow)
}

/** True when manager_coverage has at least one row for the month (cheap probe used to pick the default month). */
export async function hasManagerCoverage(month: string): Promise<boolean> {
  return (await rpcAll('manager_coverage', { p_from: month, p_to: month, p_shift: 'ALL' }, ['manager_id', 'rep_id'], 1)).length > 0
}

/** One row per manager x rep x speciality (manager_coverage_spec). */
export async function fetchManagerCoverageSpec(from: string, to: string, shift: CoverShift): Promise<SpecRow[]> {
  return normalizeShares((await rpcAll('manager_coverage_spec', { p_from: from, p_to: to, p_shift: shift }, ['manager_id', 'rep_id', 'speciality'])).map(toSpecRow))
}

/** Drill-down: every active-list doctor of one rep with whether the manager covered them (manager_coverage_doctors). */
export async function fetchManagerCoverageDoctors(from: string, to: string, repId: number, managerId: number | null, shift: CoverShift): Promise<DocRow[]> {
  return (await rpcAll('manager_coverage_doctors', { p_from: from, p_to: to, p_rep: repId, p_manager: managerId, p_shift: shift }, ['doctor_id'])).map(toDocRow)
}
