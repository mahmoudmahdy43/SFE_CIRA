import { rpc } from '../../../lib/api/core'
import type { ProcessResult } from '../../../lib/api/visits'
import { makeFinisher } from '../finish'
import { LoadFailure, type LoadOutcome, type ProgressInfo, type RejectedRow } from '../types'
import { chunkRows } from '../list/listParse'
import type { VisitsExtra } from './VisitsResultPanel'
import type { RawVisitRow } from './rawVisitsParse'

/** Rows per load_visits_raw_chunk call (each row carries its products, so chunks are small). */
export const RAW_CHUNK = 300

interface ChunkResult { loaded: number; rejected_count: number; rejected: { i: number; reason: string }[] }

export interface RawLoadFile { name: string; lineId: number; rows: RawVisitRow[]; rowNumbers: number[] }

export interface RawLoadParams {
  files: RawLoadFile[]
  /** Dates to replace and the months to process / refresh afterwards. */
  from: string
  to: string
  months: string[]
  onProgress: (p: ProgressInfo) => void
  onBatch: (id: number) => void
}

async function sendChunk(batch: number, line: number, rows: RawVisitRow[]): Promise<ChunkResult> {
  const call = () => rpc<ChunkResult>('load_visits_raw_chunk', { p_batch: batch, p_line: line, p_rows: rows })
  try {
    return await call()
  } catch {
    return await call() // retry a failed chunk once; a second failure is reported by the caller
  }
}

/**
 * start_upload('visits', files) -> clear_visits_range(from, to) -> load_visits_raw_chunk per file (300 rows)
 * -> finish_upload_nr -> process_visits_month + refresh_month per month (one request each, retryable).
 */
export async function loadRawVisits(p: RawLoadParams): Promise<LoadOutcome> {
  const total = p.files.reduce((a, f) => a + f.rows.length, 0)
  const batch = await rpc<number>('start_upload', { p_kind: 'visits', p_file: p.files.map((f) => f.name).join(', ').slice(0, 250) })
  p.onBatch(batch)

  const rejected: RejectedRow[] = []
  const extra: VisitsExtra = {}
  let loaded = 0
  let rejectedCount = 0
  let where = 'clearing dates'
  try {
    p.onProgress({ done: 0, total, month: '', phase: 'Clearing dates' })
    await rpc('clear_visits_range', { p_from: p.from, p_to: p.to })
    let done = 0
    for (const f of p.files) {
      const chunks = chunkRows(f.rows, RAW_CHUNK)
      for (let c = 0; c < chunks.length; c++) {
        const chunk = chunks[c]
        where = `${f.name}: chunk ${c + 1} of ${chunks.length}`
        p.onProgress({ done, total, month: '', phase: `Loading ${f.name}` })
        const r = await sendChunk(batch, f.lineId, chunk)
        loaded += r.loaded
        rejectedCount += r.rejected_count
        for (const rej of r.rejected ?? []) {
          const row = chunk[rej.i]
          rejected.push({
            excelRow: f.rowNumbers[c * RAW_CHUNK + rej.i],
            reason: rej.reason,
            context: row ? `${f.name} / ${row.visit_date} / ${row.acc_type} / ${row.owner}` : f.name,
          })
        }
        done += chunk.length
        p.onProgress({ done, total, month: '', phase: `Loading ${f.name}` })
      }
    }
  } catch (e) {
    throw new LoadFailure(e instanceof Error ? e.message : 'Upload failed', batch, where)
  }
  const outcome: LoadOutcome = { batch, total, loaded, rejectedCount, rejected, months: p.months, extra, groupRejected: true, contextLabel: 'File / date / Acc. type / owner' }
  const fin = makeFinisher({
    batch, total, loaded, rejectedCount, months: p.months, onProgress: p.onProgress,
    processVisits: async (m) => { extra[m] = await rpc<ProcessResult>('process_visits_month', { p_month: m }) },
  })
  const finish = async (): Promise<LoadOutcome> => {
    try {
      await fin.run()
    } catch (e) {
      throw new LoadFailure(e instanceof Error ? e.message : 'Finishing failed', batch, fin.current(), finish)
    }
    return outcome
  }
  return finish()
}
