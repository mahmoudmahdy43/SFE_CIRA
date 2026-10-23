import { rpc } from '../../../lib/api/core'
import { chunkRows } from '../list/listParse'
import type { GpsRow } from './gpsParse'

/** Rows per load_visits_gps_chunk call. */
export const GPS_CHUNK = 2000

interface GpsChunkResult {
  rows_updated: number
  ids: number
  ids_matched: number
  ids_unmatched: number
  unmatched_sample: (string | number)[] | null
}

export interface GpsCoverageRow { month: string; visits: number; with_gps: number; pct: number | null }

export interface GpsOutcome {
  ids: number
  matched: number
  unmatched: number
  rowsUpdated: number
  unmatchedSample: string[]
  coverage: GpsCoverageRow[]
}

export interface GpsLoadParams {
  rows: GpsRow[]
  /** Period of the coverage report (the file's date range); null skips the report. */
  from: string | null
  to: string | null
  onProgress: (done: number, total: number) => void
}

async function sendChunk(rows: GpsRow[]): Promise<GpsChunkResult> {
  const call = () => rpc<GpsChunkResult>('load_visits_gps_chunk', { p_rows: rows })
  try {
    return await call()
  } catch {
    return await call() // one automatic retry (the load is idempotent); a second failure is reported by the caller
  }
}

/**
 * load_visits_gps_chunk per 2000 rows (adds the GPS to visits already loaded, by CRM visit ID; nothing is deleted, so loading
 * the same file again gives the same result) -> visits_gps_coverage for the period.
 */
export async function loadVisitsGps(p: GpsLoadParams): Promise<GpsOutcome> {
  const out: GpsOutcome = { ids: 0, matched: 0, unmatched: 0, rowsUpdated: 0, unmatchedSample: [], coverage: [] }
  let done = 0
  for (const chunk of chunkRows(p.rows, GPS_CHUNK)) {
    p.onProgress(done, p.rows.length)
    const r = await sendChunk(chunk)
    out.ids += r.ids
    out.matched += r.ids_matched
    out.unmatched += r.ids_unmatched
    out.rowsUpdated += r.rows_updated
    for (const s of r.unmatched_sample ?? []) if (out.unmatchedSample.length < 20) out.unmatchedSample.push(String(s))
    done += chunk.length
  }
  p.onProgress(done, p.rows.length)
  if (p.from === null || p.to === null) return out
  out.coverage = (await rpc<GpsCoverageRow[] | null>('visits_gps_coverage', { p_from: p.from, p_to: p.to })) ?? []
  return out
}
