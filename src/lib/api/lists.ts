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
export async function lookup<T extends { id: number }>(table: string, columns: string, ids: number[]): Promise<Map<number, T>> {
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

/* ---------- Data quality: Target List "Active From" (view v_dq_list_active_from) ---------- */
export type DqIssue = 'active_from_after_month_end' | 'new_in_list_but_active_earlier' | 'active_from_missing'
export const DQ_ISSUES: DqIssue[] = ['active_from_after_month_end', 'new_in_list_but_active_earlier', 'active_from_missing']
export const DQ_LABEL: Record<DqIssue, string> = {
  active_from_after_month_end: 'Active From after month end',
  new_in_list_but_active_earlier: 'New in list but Active From earlier',
  active_from_missing: 'Active From missing',
}
export const DQ_HINT: Record<DqIssue, string> = {
  active_from_after_month_end: 'Active From is later than the last day of the snapshot month.',
  new_in_list_but_active_earlier: "Doctor was not in last month's list, yet Active From is before this month.",
  active_from_missing: 'The list row has no Active From date.',
}

interface DqRaw { month: string; doctor_id: number; rep_id: number; active_from: string | null; issue: DqIssue }
export interface DqRow extends DqRaw { doctor: string; account: string; repCode: string; repName: string }

function dqBase(months: string[] | null) {
  const q = supabase.from('v_dq_list_active_from')
  return { q, months }
}

/** Issue counts (head-only requests) for one month, several months, or all (null). */
export async function fetchDqCounts(months: string[] | null): Promise<Record<DqIssue, number>> {
  const out = { active_from_after_month_end: 0, new_in_list_but_active_earlier: 0, active_from_missing: 0 } as Record<DqIssue, number>
  await Promise.all(
    DQ_ISSUES.map(async (i) => {
      let r = dqBase(months).q.select('*', { count: 'exact', head: true }).eq('issue', i)
      if (months) r = r.in('month', months)
      const { count, error } = await r
      if (error) throw new Error(error.message)
      out[i] = count ?? 0
    }),
  )
  return out
}

async function resolveDq(rows: DqRaw[]): Promise<DqRow[]> {
  const [docs, reps] = await Promise.all([
    lookup<{ id: number; doctor_name: string; account_name: string | null }>('doctors', 'id,doctor_name,account_name', rows.map((r) => r.doctor_id)),
    lookup<{ id: number; code: string; name: string }>('reps', 'id,code,name', rows.map((r) => r.rep_id)),
  ])
  return rows.map((r) => ({
    ...r,
    doctor: docs.get(r.doctor_id)?.doctor_name ?? `#${r.doctor_id}`,
    account: docs.get(r.doctor_id)?.account_name ?? '—',
    repCode: reps.get(r.rep_id)?.code ?? '—',
    repName: reps.get(r.rep_id)?.name ?? `#${r.rep_id}`,
  }))
}

function dqQuery(month: string | null, issue: DqIssue | null) {
  let q = supabase.from('v_dq_list_active_from').select('month,doctor_id,rep_id,active_from,issue', { count: 'exact' })
  if (month) q = q.eq('month', month)
  if (issue) q = q.eq('issue', issue)
  return q.order('month').order('doctor_id').order('issue')
}

/** One page, with doctor/rep names resolved only for the rows on the page. */
export async function fetchDqPage(month: string | null, issue: DqIssue | null, page: number, size: number): Promise<{ rows: DqRow[]; total: number }> {
  const { data, count, error } = await dqQuery(month, issue).range(page * size, page * size + size - 1)
  if (error) throw new Error(error.message)
  return { rows: await resolveDq((data ?? []) as DqRaw[]), total: count ?? 0 }
}

/** Every row for the filter (paged 1000 at a time), for CSV export. */
export async function fetchDqAll(month: string | null, issue: DqIssue | null): Promise<DqRow[]> {
  const raw: DqRaw[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await dqQuery(month, issue).range(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as DqRaw[]
    raw.push(...rows)
    if (rows.length < 1000) break
  }
  return resolveDq(raw)
}
