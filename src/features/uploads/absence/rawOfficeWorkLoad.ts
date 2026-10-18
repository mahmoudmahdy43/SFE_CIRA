import { rpc } from '../../../lib/api/core'
import { makeFinisher } from '../finish'
import { LoadFailure, type LoadOutcome, type ProgressInfo, type RejectedRow } from '../types'
import { chunkRows } from '../list/listParse'
import type { RawOfficeWorkRow } from './rawOfficeWorkParse'

export const RAW_OFFICE_WORK_CHUNK = 300

interface ChunkResult { loaded: number; rejected_count: number; rejected: { i: number; reason: string }[] }

export interface RawOfficeWorkLoadParams {
  files: { name: string; lineId: number; rows: RawOfficeWorkRow[]; rowNumbers: number[] }[]
  clears: { lineName: string; lineId: number; from: string; to: string }[]
  months: string[]
  onProgress: (p: ProgressInfo) => void
  onBatch: (id: number) => void
}

async function sendChunk(batch: number, line: number, rows: RawOfficeWorkRow[]): Promise<ChunkResult> {
  const call = () => rpc<ChunkResult>('load_office_work_raw_chunk', { p_batch: batch, p_line: line, p_rows: rows })
  try {
    return await call()
  } catch {
    return await call() // one automatic retry; a second failure is reported by the caller
  }
}

/**
 * start_upload('office_work') -> clear_office_work_range_line per line -> load_office_work_raw_chunk (300 rows, the file's line)
 * -> finish_upload_nr -> refresh_month for every month touched (the finisher of the Excel office work upload).
 */
export async function loadRawOfficeWork(p: RawOfficeWorkLoadParams): Promise<LoadOutcome> {
  const total = p.files.reduce((a, f) => a + f.rows.length, 0)
  const batch = await rpc<number>('start_upload', { p_kind: 'office_work', p_file: p.files.map((f) => f.name).join(', ').slice(0, 250) })
  p.onBatch(batch)
  const rejected: RejectedRow[] = []
  let loaded = 0
  let rejectedCount = 0
  let where = 'clearing dates'
  try {
    for (const c of p.clears) {
      where = `clearing ${c.lineName}: ${c.from} → ${c.to}`
      p.onProgress({ done: 0, total, month: '', phase: `Clearing ${c.lineName}` })
      await rpc<number>('clear_office_work_range_line', { p_from: c.from, p_to: c.to, p_line: c.lineId })
    }
    let done = 0
    for (const f of p.files) {
      const chunks = chunkRows(f.rows, RAW_OFFICE_WORK_CHUNK)
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
            excelRow: f.rowNumbers[c * RAW_OFFICE_WORK_CHUNK + rej.i],
            reason: rej.reason,
            context: row ? `${f.name} / ${row.day} / ${row.ow_type} / ${row.members}` : f.name,
          })
        }
        done += chunk.length
        p.onProgress({ done, total, month: '', phase: `Loading ${f.name}` })
      }
    }
  } catch (e) {
    throw new LoadFailure(e instanceof Error ? e.message : 'Upload failed', batch, where)
  }
  const outcome: LoadOutcome = { batch, total, loaded, rejectedCount, rejected, months: p.months, groupRejected: true, contextLabel: 'File / day / type / members' }
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
