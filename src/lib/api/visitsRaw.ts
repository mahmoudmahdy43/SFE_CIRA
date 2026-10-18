import { fetchAll, rpc } from './core'

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
