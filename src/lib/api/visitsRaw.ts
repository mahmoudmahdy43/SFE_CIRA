import { fetchAll, rpc } from './core'
import { normName } from '../norm'

export interface LineRef { id: number; name: string }
export const fetchLines = () => fetchAll<LineRef>('lines', 'id,name', ['id'])

/** visits_raw_summary(batch): link quality, unlinked samples, unknown products / territories. Shape is read tolerantly by the caller. */
export const fetchRawSummary = (batch: number) => rpc<unknown>('visits_raw_summary', { p_batch: batch })

export interface TerritoryBoxRow { line: string; territory: string; box: string }
export const loadTerritoryBoxRef = (rows: TerritoryBoxRow[]) => rpc<unknown>('load_territory_box_ref', { p_rows: rows })

export interface TerritoryBoxDiff {
  line: string | null
  territory: string | null
  box_in_sheet: string | null
  box_in_system: string | null
  issue: string | null
}
export const fetchTerritoryBoxDiff = () =>
  fetchAll<TerritoryBoxDiff>('v_territory_box_diff', 'line,territory,box_in_sheet,box_in_system,issue', ['line', 'territory'])

/**
 * Owner -> line for the given months (first-of-month dates): reps and managers by name through org_month.
 * Names are normalised like the rest of the wizard (case / spaces / dots), so the same person matches in every file.
 */
export async function fetchOwnerLines(months: string[]): Promise<Map<string, Map<string, number>>> {
  const [first, last] = [months[0], months[months.length - 1]]
  const [org, reps, mgrs] = await Promise.all([
    fetchAll<{ month: string; rep_id: number | null; manager_id: number | null; line_id: number }>('org_month', 'month,rep_id,manager_id,line_id', ['month', 'territory_id'], (q) => q.gte('month', first).lte('month', last)),
    fetchAll<{ id: number; name: string }>('reps', 'id,name', ['id']),
    fetchAll<{ id: number; name: string }>('managers', 'id,name', ['id']),
  ])
  const repName = new Map(reps.map((r) => [r.id, normName(r.name)]))
  const mgrName = new Map(mgrs.map((m) => [m.id, normName(m.name)]))
  const out = new Map<string, Map<string, number>>()
  const put = (month: string, key: string | null | undefined, line: number) => {
    if (!key) return
    const m = out.get(month) ?? new Map<string, number>()
    if (!m.has(key)) m.set(key, line)
    out.set(month, m)
  }
  for (const o of org) {
    if (o.rep_id !== null) put(o.month, repName.get(o.rep_id), o.line_id)
    if (o.manager_id !== null) put(o.month, mgrName.get(o.manager_id), o.line_id)
  }
  return out
}
