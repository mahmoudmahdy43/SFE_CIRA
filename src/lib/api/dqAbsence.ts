import { supabase } from '../supabase'
import { fetchAll } from './core'
import { monthRange } from './dqVisits'

/* ------------------------- slot status mix (rep_day_shift) ------------------------- */
export type SlotStatus = 'worked' | 'leave' | 'office_work' | 'activity' | 'missing'
export interface SlotRow { rep_id: number; day: string; shift: 'AM' | 'PM'; status: SlotStatus }

/** Every working slot of the month with its status (leave > office work > activity > worked > missing). */
export async function fetchSlots(month: string): Promise<SlotRow[]> {
  const { from, to } = monthRange(month)
  return fetchAll<SlotRow>('rep_day_shift', 'rep_id,day,shift,status', ['rep_id', 'day', 'shift'], (q) => q.gte('day', from).lte('day', to))
}

/* ------------------------------ absence without a box ------------------------------ */
export interface AbsenceNoBoxRow {
  kind: 'leave' | 'office_work' | 'activity'
  id: number
  rep_id: number
  day: string
  shift: string
  type: string | null
  rep: string
}

function noBoxQuery(month: string) {
  const { from, to } = monthRange(month)
  return supabase
    .from('v_dq_absence_without_box')
    .select('kind,id,rep_id,day,shift,type', { count: 'exact' })
    .gte('day', from)
    .lte('day', to)
    .order('day')
    .order('kind')
    .order('id')
}

/** Rep names are resolved with chunked `in` lookups (PostgREST URL length). */
async function withReps(rows: Omit<AbsenceNoBoxRow, 'rep'>[]): Promise<AbsenceNoBoxRow[]> {
  const ids = [...new Set(rows.map((r) => r.rep_id))]
  const names = new Map<number, string>()
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from('reps').select('id,code,name').in('id', ids.slice(i, i + 150))
    if (error) throw new Error(error.message)
    for (const r of (data ?? []) as { id: number; code: string; name: string }[]) names.set(r.id, `${r.name} (${r.code})`)
  }
  return rows.map((r) => ({ ...r, rep: names.get(r.rep_id) ?? `#${r.rep_id}` }))
}

export async function fetchNoBoxPage(month: string, page: number, size: number) {
  const { data, count, error } = await noBoxQuery(month).range(page * size, page * size + size - 1)
  if (error) throw new Error(error.message)
  return { rows: await withReps((data ?? []) as Omit<AbsenceNoBoxRow, 'rep'>[]), total: count ?? 0 }
}

export async function fetchNoBoxAll(month: string): Promise<AbsenceNoBoxRow[]> {
  const raw: Omit<AbsenceNoBoxRow, 'rep'>[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await noBoxQuery(month).range(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as Omit<AbsenceNoBoxRow, 'rep'>[]
    raw.push(...rows)
    if (rows.length < 1000) break
  }
  return withReps(raw)
}
