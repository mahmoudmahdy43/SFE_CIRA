import { rpc } from './core'
import type { SystemRep } from '../../features/daily/dailyMath'

/** daily_reporting_reps (80_daily_reporting_reps.sql): the reps the system knows, with their district manager. Admin only. */
export async function fetchDailyReps(month: string, signal?: AbortSignal): Promise<SystemRep[]> {
  const rows = await rpc<Record<string, unknown>[] | null>('daily_reporting_reps', { p_line: null, p_month: month }, signal)
  const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
  return (rows ?? []).map((r) => ({
    line_id: Number(r.line_id), line_name: String(r.line_name ?? ''), rep_id: r.rep_id === null || r.rep_id === undefined ? null : Number(r.rep_id),
    rep_name: String(r.rep_name ?? ''), rep_norm: String(r.rep_norm ?? ''), rep_code: s(r.rep_code), status: String(r.status ?? ''),
    district: s(r.district), district_manager: s(r.district_manager), box_name: s(r.box_name),
  }))
}

export interface ProspectionName { name_norm: string; rep_name: string }

/** daily_prospection_list (81_daily_prospection.sql): the fixed Prospection Phase list, not per day. */
export async function fetchProspection(signal?: AbortSignal): Promise<ProspectionName[]> {
  const rows = await rpc<Record<string, unknown>[] | null>('daily_prospection_list', undefined, signal)
  return (rows ?? []).map((r) => ({ name_norm: String(r.name_norm ?? ''), rep_name: String(r.rep_name ?? '') }))
}

/** daily_prospection_save: replaces the whole list (an empty array clears it); returns how many names were saved. */
export async function saveProspection(names: string[]): Promise<number> {
  return Number(await rpc<number>('daily_prospection_save', { p_names: names }))
}
