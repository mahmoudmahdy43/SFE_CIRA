import { rpc } from '../../../lib/api/core'
import { makeFinisher } from '../finish'
import { LoadFailure, type LoadOutcome, type ProgressInfo, type RejectedRow } from '../types'
import { chunkRows } from '../list/listParse'
import type { RawLeaveRow } from './rawLeavesParse'

export const RAW_LEAVES_CHUNK = 300

interface ChunkResult { loaded: number; rejected_count: number; rejected: { i: number; reason: string }[]; status?: Record<string, number> }

export interface RawLeavesLoadParams {
  files: { name: string; rows: RawLeaveRow[]; rowNumbers: number[] }[]
  /** One clear per Line: the id of the line (smallint) and the Start Date range to replace. */
  clears: { lineName: string; lineId: number; from: string; to: string }[]
  months: string[]
  onProgress: (p: ProgressInfo) => void
  onBatch: (id: number) => void
}

export interface RawLeavesExtra { status: Record<string, number> }

async function sendChunk(batch: number, rows: RawLeaveRow[]): Promise<ChunkResult> {
  const call = () => rpc<ChunkResult>('load_leaves_raw_chunk', { p_batch: batch, p_rows: rows })
  try {
    return await call()
  } catch {
    return await call() // one automatic retry; a second failure is reported by the caller
  }
}

/**
 * start_upload('leaves') -> clear_leaves_range_line per Line -> load_leaves_raw_chunk (300 rows)
 * -> finish_upload_nr -> refresh_month for every month touched (same finisher as the Excel leaves upload).
 */
export async function loadRawLeaves(p: RawLeavesLoadParams): Promise<LoadOutcome> {
  const total = p.files.reduce((a, f) => a + f.rows.length, 0)
  const batch = await rpc<number>('start_upload', { p_kind: 'leaves', p_file: p.files.map((f) => f.name).join(', ').slice(0, 250) })
  p.onBatch(batch)
  const rejected: RejectedRow[] = []
  const extra: RawLeavesExtra = { status: {} }
  let loaded = 0
  let rejectedCount = 0
  let where = 'clearing dates'
  try {
    for (const c of p.clears) {
      where = `clearing ${c.lineName}: ${c.from} → ${c.to}`
      p.onProgress({ done: 0, total, month: '', phase: `Clearing ${c.lineName}` })
      await rpc<number>('clear_leaves_range_line', { p_from: c.from, p_to: c.to, p_line: c.lineId })
    }
    let done = 0
    for (const f of p.files) {
      const chunks = chunkRows(f.rows, RAW_LEAVES_CHUNK)
      for (let c = 0; c < chunks.length; c++) {
        const chunk = chunks[c]
        where = `${f.name}: chunk ${c + 1} of ${chunks.length}`
        p.onProgress({ done, total, month: '', phase: `Loading ${f.name}` })
        const r = await sendChunk(batch, chunk)
        loaded += r.loaded
        rejectedCount += r.rejected_count
        for (const [k, n] of Object.entries(r.status ?? {})) extra.status[k] = (extra.status[k] ?? 0) + Number(n)
        for (const rej of r.rejected ?? []) {
          const row = chunk[rej.i]
          rejected.push({
            excelRow: f.rowNumbers[c * RAW_LEAVES_CHUNK + rej.i],
            reason: rej.reason,
            context: row ? `${f.name} / ${row.employee} / ${row.line} / ${row.start_date}` : f.name,
          })
        }
        done += chunk.length
        p.onProgress({ done, total, month: '', phase: `Loading ${f.name}` })
      }
    }
  } catch (e) {
    throw new LoadFailure(e instanceof Error ? e.message : 'Upload failed', batch, where)
  }
  const outcome: LoadOutcome = { batch, total, loaded, rejectedCount, rejected, months: p.months, extra, groupRejected: true, contextLabel: 'File / employee / line / start date' }
  const fin = makeFinisher({ batch, total, loaded, rejectedCount, months: p.months, onProgress: p.onProgress })
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
