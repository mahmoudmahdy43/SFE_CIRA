import { supabase } from '../supabase'
import { addDaysIso, addMonthsIso } from '../norm'
import { fetchAll, rpc, type FilterQuery } from './core'
import type { ProcessResult } from './visits'

export const monthRange = (month: string) => ({ from: month, to: addDaysIso(addMonthsIso(month, 1), -1) })

/** code -> name for reps and managers; the `in` filter is chunked to keep URLs short. */
export async function ownerNames(codes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = [...new Set(codes)]
  for (let i = 0; i < unique.length; i += 100) {
    const part = unique.slice(i, i + 100)
    const [reps, mgrs] = await Promise.all([
      supabase.from('reps').select('code,name').in('code', part),
      supabase.from('managers').select('code,name').in('code', part),
    ])
    if (reps.error) throw new Error(reps.error.message)
    if (mgrs.error) throw new Error(mgrs.error.message)
    for (const r of [...(reps.data ?? []), ...(mgrs.data ?? [])] as { code: string; name: string }[]) out.set(r.code, r.name)
  }
  return out
}

/* ------------------------------ unmatched ------------------------------ */
export type MatchStatus = 'unmatched' | 'not_in_list'
export interface UnmatchedRow {
  visit_date: string
  shift: string
  owner_code: string
  doctor_raw: string | null
  account_raw: string | null
  match_status: MatchStatus
  owner: string
}

function unmatchedQuery(month: string, status: MatchStatus | null, code: string) {
  const { from, to } = monthRange(month)
  let q = supabase
    .from('visits')
    .select('visit_date,shift,owner_code,doctor_raw,account_raw,match_status', { count: 'exact' })
    .gte('visit_date', from)
    .lte('visit_date', to)
  q = status ? q.eq('match_status', status) : q.in('match_status', ['unmatched', 'not_in_list'])
  if (code.trim()) q = q.ilike('owner_code', `%${code.trim().replace(/[%_,()]/g, '')}%`)
  return q.order('visit_date').order('owner_code').order('id')
}

async function withOwners(rows: Omit<UnmatchedRow, 'owner'>[]): Promise<UnmatchedRow[]> {
  const names = await ownerNames(rows.map((r) => r.owner_code))
  return rows.map((r) => ({ ...r, owner: names.get(r.owner_code) ?? '—' }))
}

export async function fetchUnmatchedPage(month: string, status: MatchStatus | null, code: string, page: number, size: number) {
  const { data, count, error } = await unmatchedQuery(month, status, code).range(page * size, page * size + size - 1)
  if (error) throw new Error(error.message)
  return { rows: await withOwners((data ?? []) as Omit<UnmatchedRow, 'owner'>[]), total: count ?? 0 }
}

export async function fetchUnmatchedAll(month: string, status: MatchStatus | null, code: string): Promise<UnmatchedRow[]> {
  const raw: Omit<UnmatchedRow, 'owner'>[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await unmatchedQuery(month, status, code).range(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as Omit<UnmatchedRow, 'owner'>[]
    raw.push(...rows)
    if (rows.length < 1000) break
  }
  return withOwners(raw)
}

export async function fetchUnmatchedCounts(month: string): Promise<Record<MatchStatus, number>> {
  const { from, to } = monthRange(month)
  const out = { unmatched: 0, not_in_list: 0 } as Record<MatchStatus, number>
  await Promise.all(
    (['unmatched', 'not_in_list'] as const).map(async (s) => {
      const { count, error } = await supabase
        .from('visits')
        .select('id', { count: 'exact', head: true })
        .gte('visit_date', from)
        .lte('visit_date', to)
        .eq('match_status', s)
      if (error) throw new Error(error.message)
      out[s] = count ?? 0
    }),
  )
  return out
}

/** Re-run matching for a month (e.g. after loading a list that was missing), then refresh KPIs. */
export async function rematchMonth(month: string): Promise<ProcessResult> {
  const r = await rpc<ProcessResult>('process_visits_month', { p_month: month })
  await rpc('refresh_month', { p_month: month })
  return r
}

/* ------------------------- visits on non-working slots ------------------------- */
export interface NonWorkRow { code: string; name: string; day: string; shift: string; visits: number; status: string }

function nonWorkQuery(month: string) {
  const { from, to } = monthRange(month)
  return supabase
    .from('v_dq_visits_on_nonwork')
    .select('code,name,day,shift,visits,status', { count: 'exact' })
    .gte('day', from)
    .lte('day', to)
    .order('day')
    .order('code')
    .order('shift')
}

export async function fetchNonWorkPage(month: string, page: number, size: number) {
  const { data, count, error } = await nonWorkQuery(month).range(page * size, page * size + size - 1)
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as NonWorkRow[], total: count ?? 0 }
}

export async function fetchNonWorkAll(month: string): Promise<NonWorkRow[]> {
  const out: NonWorkRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await nonWorkQuery(month).range(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as NonWorkRow[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

/* ---------------------- double-visit pairing (columns not assumed) ---------------------- */
export type GenericRow = Record<string, string | number | boolean | null>
let pairingKeys: string[] | null = null

function applyMonth(q: FilterQuery, keys: string[], month: string): { q: FilterQuery; scoped: boolean } {
  const { from, to } = monthRange(month)
  if (keys.includes('month')) return { q: q.eq('month', month), scoped: true }
  for (const k of ['visit_date', 'day']) if (keys.includes(k)) return { q: q.gte(k, from).lte(k, to), scoped: true }
  return { q, scoped: false }
}

/** v_dq_double_pairing is read generically: whatever columns it exposes are shown. */
export async function fetchPairingPage(month: string, page: number, size: number) {
  if (!pairingKeys) {
    const probe = await supabase.from('v_dq_double_pairing').select('*').limit(1)
    if (probe.error) throw new Error(probe.error.message)
    pairingKeys = Object.keys((probe.data?.[0] ?? {}) as GenericRow)
  }
  const keys = pairingKeys
  const base = applyMonth(supabase.from('v_dq_double_pairing').select('*', { count: 'exact' }) as unknown as FilterQuery, keys, month)
  const q = keys.length > 0 ? base.q.order(keys[0]) : base.q
  const { data, count, error } = await q.range(page * size, page * size + size - 1)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as GenericRow[]
  if (rows.length > 0) pairingKeys = Object.keys(rows[0])
  return { rows, total: count ?? 0, scoped: base.scoped, keys: rows.length > 0 ? Object.keys(rows[0]) : keys }
}

export async function fetchPairingAll(month: string): Promise<GenericRow[]> {
  const out: GenericRow[] = []
  for (let p = 0; ; p++) {
    const r = await fetchPairingPage(month, p, 1000)
    out.push(...r.rows)
    if (r.rows.length < 1000) break
  }
  return out
}

/* ------------------------------- no territory ------------------------------- */
export interface NoTerritoryGroup { territory: string; visits: number; codes: string }

/** Visits whose territory could not be resolved, grouped by the raw territory text. */
export async function fetchNoTerritory(month: string): Promise<NoTerritoryGroup[]> {
  const { from, to } = monthRange(month)
  const rows = await fetchAll<{ id: number; territory_raw: string | null; owner_code: string }>(
    'visits',
    'id,territory_raw,owner_code',
    ['id'],
    (q) => q.is('territory_id', null).gte('visit_date', from).lte('visit_date', to),
  )
  const groups = new Map<string, { n: number; codes: Set<string> }>()
  for (const r of rows) {
    const k = r.territory_raw?.trim() || '(blank)'
    const g = groups.get(k) ?? { n: 0, codes: new Set<string>() }
    g.n++
    g.codes.add(r.owner_code)
    groups.set(k, g)
  }
  return [...groups].map(([territory, g]) => ({ territory, visits: g.n, codes: [...g.codes].slice(0, 4).join(', ') + (g.codes.size > 4 ? '…' : '') })).sort((a, b) => b.visits - a.visits)
}

/* -------------------------------- missing days -------------------------------- */
export interface MissingRow { code: string; name: string; rep_id: number; day: string; shift: string }
export interface OrgRepInfo { rep_id: number; line_id: number | null; manager_id: number | null }

export async function fetchMissing(month: string): Promise<MissingRow[]> {
  const { from, to } = monthRange(month)
  return fetchAll<MissingRow>('v_missing_days', 'code,name,rep_id,day,shift', ['rep_id', 'day', 'shift'], (q) => q.gte('day', from).lte('day', to))
}

export async function fetchOrgForMonth(month: string): Promise<Map<number, OrgRepInfo>> {
  const rows = await fetchAll<OrgRepInfo & { territory_id: number }>('org_month', 'rep_id,line_id,manager_id,territory_id', ['territory_id'], (q) => q.eq('month', month))
  const map = new Map<number, OrgRepInfo>()
  for (const r of rows) if (r.rep_id !== null && !map.has(r.rep_id)) map.set(r.rep_id, r)
  return map
}
