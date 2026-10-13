import { fetchAll } from './core'
import {
  numOrNull, toCallRateRow, toCoverageRow, type CallRateRow, type CoverageRow,
} from '../../features/reports/reportMath'

type Raw = Record<string, unknown>

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
