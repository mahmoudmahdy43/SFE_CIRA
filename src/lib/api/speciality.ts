import { supabase } from '../supabase'
import { fetchAll, upsertChunks } from './core'

type Raw = Record<string, unknown>

const MIX_COLS = 'month,rep_id,rep_code,rep_name,line,manager,speciality,doctors,total_docs,share_pct,strategy_pct,diff_points,is_off,threshold_points'
const MIX_LINE_COLS = 'month,line,speciality,doctors,total_docs,share_pct,strategy_pct,diff_points,is_off,threshold_points'

/** One row per rep x speciality for the month (v_speciality_mix: shares, strategy and the red flag come from the view). */
export const fetchSpecialityMix = (month: string): Promise<Raw[]> =>
  fetchAll<Raw>('v_speciality_mix', MIX_COLS, ['rep_id', 'speciality'], (q) => q.eq('month', month))

/** One row per line x speciality for the month (v_speciality_mix_line). */
export const fetchSpecialityMixLine = (month: string): Promise<Raw[]> =>
  fetchAll<Raw>('v_speciality_mix_line', MIX_LINE_COLS, ['line', 'speciality'], (q) => q.eq('month', month))

export interface Speciality { id: number; name: string }
export const fetchSpecialities = (): Promise<Speciality[]> => fetchAll<Speciality>('specialities', 'id,name', ['name'])

export interface StrategyRow { line_id: number; speciality_id: number; effective_from: string; share_pct: number }

/** Every saved strategy row (a small table: lines x specialities x versions). */
export async function fetchListStrategy(): Promise<StrategyRow[]> {
  const rows = await fetchAll<Raw>('list_strategy', 'line_id,speciality_id,effective_from,share_pct', ['line_id', 'effective_from', 'speciality_id'])
  return rows.map((r) => ({
    line_id: Number(r.line_id),
    speciality_id: Number(r.speciality_id),
    effective_from: String(r.effective_from).slice(0, 10),
    share_pct: Number(r.share_pct ?? 0),
  }))
}

/** Upsert strategy rows for (line, speciality, effective_from). */
export const saveStrategy = (rows: StrategyRow[]): Promise<void> => upsertChunks('list_strategy', rows, 'line_id,speciality_id,effective_from')

/** The red threshold in percentage points (the single strategy_settings row); null when the row is missing. */
export async function fetchThreshold(): Promise<number | null> {
  const { data, error } = await supabase.from('strategy_settings').select('threshold_points').limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  const v = (data as { threshold_points?: unknown } | null)?.threshold_points
  return v === null || v === undefined ? null : Number(v)
}

export async function saveThreshold(value: number): Promise<void> {
  const { error } = await supabase.from('strategy_settings').upsert({ id: true, threshold_points: value }, { onConflict: 'id' })
  if (error) throw new Error(`strategy_settings: ${error.message}`)
}
