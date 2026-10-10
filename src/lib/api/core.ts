import { supabase } from '../supabase'
import { addMonthsIso, monthStart, todayIso } from '../norm'

const PAGE = 1000

/** The few filter methods our callers use (a structural subset of the Postgrest builder, kept shallow for the compiler). */
export interface FilterQuery {
  eq: (column: string, value: unknown) => FilterQuery
  gte: (column: string, value: unknown) => FilterQuery
  lte: (column: string, value: unknown) => FilterQuery
  is: (column: string, value: null | boolean) => FilterQuery
  order: (column: string) => FilterQuery
  range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null; count?: number | null }>
}

/** Read a whole table, paging past PostgREST's 1000-row cap. `orderBy` must give a stable order. */
export async function fetchAll<T>(
  table: string,
  columns: string,
  orderBy: string[],
  /** Optional filters (eq/gte/…); applied before ordering. */
  filter?: (q: FilterQuery) => FilterQuery,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const base = supabase.from(table).select(columns) as unknown as FilterQuery
    let q = filter ? filter(base) : base
    for (const o of orderBy) q = q.order(o)
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

/** Call an RPC; throws an Error carrying the database's human-readable message. */
export async function rpc<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}

export async function insertChunks(table: string, rows: object[], size = 500): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + size))
    if (error) throw new Error(`${table}: ${error.message}`)
  }
}

export async function upsertChunks(table: string, rows: object[], onConflict: string, size = 500): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + size), { onConflict })
    if (error) throw new Error(`${table}: ${error.message}`)
  }
}

/** Months from `from` through the current month (or just `from` if it is later), as first-of-month ISO dates. */
export function monthsFrom(from: string): string[] {
  const start = monthStart(from)
  const end = monthStart(todayIso())
  const out = [start]
  for (let m = addMonthsIso(start, 1); m <= end; m = addMonthsIso(m, 1)) out.push(m)
  return out
}

/** Refresh KPI summaries month by month, reporting progress. */
export async function refreshMonths(months: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
  const unique = [...new Set(months.map(monthStart))].sort()
  for (let i = 0; i < unique.length; i++) {
    await rpc('refresh_month', { p_month: unique[i] })
    onProgress?.(i + 1, unique.length)
  }
}
