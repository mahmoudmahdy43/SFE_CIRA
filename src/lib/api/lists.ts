import { supabase } from '../supabase'
import { fetchAll } from './core'

export interface ListMonth { month: string; rows: number; reps: number; doctors: number; total_freq: number; last_batch: number | null }
export interface Batch {
  id: number
  kind: string
  file_name: string | null
  months: string[]
  rows_total: number
  rows_loaded: number
  rows_rejected: number
  status: 'loaded' | 'replaced' | 'deleted'
  created_by: string | null
  created_at: string
}
export type ChangeType = 'added' | 'removed' | 'transferred' | 'freq_changed'
export interface ListChange {
  change_type: ChangeType
  doctor_id: number
  from_rep: number | null
  to_rep: number | null
  old_freq: number | null
  new_freq: number | null
}
export interface ChangeRow extends ListChange {
  doctor: string
  account: string
  fromRep: string
  toRep: string
}

export const CHANGE_TYPES: ChangeType[] = ['added', 'removed', 'transferred', 'freq_changed']
export const CHANGE_LABEL: Record<ChangeType, string> = {
  added: 'Added', removed: 'Removed', transferred: 'Transferred', freq_changed: 'Freq changed',
}

export const fetchListMonths = () =>
  fetchAll<ListMonth>('v_list_months', 'month,rows,reps,doctors,total_freq,last_batch', ['month'])

export async function fetchBatches(page: number, size: number): Promise<{ rows: Batch[]; total: number }> {
  const { data, count, error } = await supabase
    .from('upload_batches')
    .select('id,kind,file_name,months,rows_total,rows_loaded,rows_rejected,status,created_by,created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(page * size, page * size + size - 1)
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as Batch[], total: count ?? 0 }
}

/** Counts per change type for one month (head-only requests; no rows transferred). */
export async function fetchChangeCounts(month: string): Promise<Record<ChangeType, number>> {
  const out = { added: 0, removed: 0, transferred: 0, freq_changed: 0 } as Record<ChangeType, number>
  await Promise.all(
    CHANGE_TYPES.map(async (t) => {
      const { count, error } = await supabase
        .rpc('list_changes', { p_month: month }, { count: 'exact', head: true })
        .eq('change_type', t)
      if (error) throw new Error(error.message)
      out[t] = count ?? 0
    }),
  )
  return out
}

async function pagedChanges(month: string): Promise<ListChange[]> {
  const out: ListChange[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .rpc('list_changes', { p_month: month })
      .order('doctor_id')
      .order('change_type')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as ListChange[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

/** `in` filters are chunked: PostgREST puts them in the URL. */
async function lookup<T extends { id: number }>(table: string, columns: string, ids: number[]): Promise<Map<number, T>> {
  const map = new Map<number, T>()
  const unique = [...new Set(ids)]
  for (let i = 0; i < unique.length; i += 150) {
    const { data, error } = await supabase.from(table).select(columns).in('id', unique.slice(i, i + 150))
    if (error) throw new Error(error.message)
    for (const r of (data ?? []) as unknown as T[]) map.set(r.id, r)
  }
  return map
}

export async function fetchChangeDetails(month: string): Promise<ChangeRow[]> {
  const changes = await pagedChanges(month)
  const repIds = changes.flatMap((c) => [c.from_rep, c.to_rep]).filter((x): x is number => x !== null)
  const [docs, reps] = await Promise.all([
    lookup<{ id: number; doctor_name: string; account_name: string | null }>('doctors', 'id,doctor_name,account_name', changes.map((c) => c.doctor_id)),
    lookup<{ id: number; code: string; name: string }>('reps', 'id,code,name', repIds),
  ])
  const repText = (id: number | null) => (id === null ? '—' : reps.get(id) ? `${reps.get(id)!.name} (${reps.get(id)!.code})` : `#${id}`)
  return changes.map((c) => ({
    ...c,
    doctor: docs.get(c.doctor_id)?.doctor_name ?? `#${c.doctor_id}`,
    account: docs.get(c.doctor_id)?.account_name ?? '—',
    fromRep: repText(c.from_rep),
    toRep: repText(c.to_rep),
  }))
}
