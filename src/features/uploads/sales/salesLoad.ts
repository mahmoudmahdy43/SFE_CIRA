import { rpc } from '../../../lib/api/core'
import { LoadFailure, type LoadOutcome, type ProgressInfo, type RejectedRow } from '../types'
import { chunk, type SalesCheck, type SalesRow } from './salesParse'
import { readSalesFinal, rejectedText, splitRejected, type SalesFinal } from './salesResult'

export const SALES_CHUNK = 500

export interface SalesExtra {
  fin: SalesFinal | null
  /** Territory names the database could not match (they need a territory alias in master data). */
  notFound: { name: string; count: number }[]
  /** Rejected rows for any other reason. */
  otherRejected: string[]
  /** refresh_sales_field failures (field activity cache); the upload itself is fine. */
  refreshWarnings: string[]
  checks: SalesCheck[]
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

const monthStart = (ym: string) => `${ym}-01`

/**
 * start_upload('sales') -> sales_delete_months (Replace only) -> load_sales_chunk x500 -> finish_upload_nr
 * -> finalize_sales(p_batch, p_months, p_check) -> refresh_sales_field per month (a failure is a warning).
 */
export async function loadSales(p: {
  fileName: string
  rows: SalesRow[]
  checks: SalesCheck[]
  replaceMonths: string[]
  onProgress: (x: ProgressInfo) => void
  onBatch: (id: number) => void
}): Promise<LoadOutcome> {
  const months = [...new Set(p.rows.map((r) => monthStart(r.month)))].sort()
  const batch = await rpc<number>('start_upload', { p_kind: 'sales', p_file: p.fileName })
  p.onBatch(batch)

  const rejectedTexts: string[] = []
  let loaded = 0
  let rejectedCount = 0
  let where = 'clearing months'
  try {
    const replace = p.replaceMonths.filter((m) => months.includes(m))
    if (replace.length > 0) {
      p.onProgress({ done: 0, total: p.rows.length, month: replace[0], phase: 'Clearing months' })
      await rpc('sales_delete_months', { p_months: replace })
    }
    const chunks = chunk(p.rows, SALES_CHUNK)
    let done = 0
    for (let c = 0; c < chunks.length; c++) {
      const part = chunks[c]
      where = `chunk ${c + 1} of ${chunks.length} (${part[0].line} ${part[0].month})`
      p.onProgress({ done, total: p.rows.length, month: monthStart(part[0].month), phase: 'Loading rows' })
      const call = () => rpc<unknown>('load_sales_chunk', { p_batch: batch, p_rows: part })
      let r: unknown
      try { r = await call() } catch { r = await call() } // retry a failed chunk once
      const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
      const rej = Array.isArray(o.rejected) ? o.rejected : []
      const rc = num(o.rejected_count) ?? rej.length
      rejectedCount += rc
      loaded += num(o.loaded ?? o.rows) ?? Math.max(0, part.length - rc)
      for (const x of rej) rejectedTexts.push(rejectedText(x))
      done += part.length
      p.onProgress({ done, total: p.rows.length, month: monthStart(part[part.length - 1].month), phase: 'Loading rows' })
    }
  } catch (e) {
    throw new LoadFailure(e instanceof Error ? e.message : 'Upload failed', batch, where)
  }

  const extra: SalesExtra = { fin: null, notFound: [], otherRejected: [], refreshWarnings: [], checks: p.checks }
  const apply = (extraRej: string[]) => {
    const all = [...rejectedTexts, ...extraRej]
    const sp = splitRejected(all)
    extra.notFound = sp.notFound
    extra.otherRejected = sp.other
  }
  apply([])
  const rejected: RejectedRow[] = rejectedTexts.map((t) => ({ excelRow: undefined, reason: t, context: '' }))
  const outcome: LoadOutcome = { batch, total: p.rows.length, loaded, rejectedCount, rejected, months, extra }

  const total = 2 + months.length
  let step = 0
  const finish = async (): Promise<LoadOutcome> => {
    try {
      if (step === 0) {
        p.onProgress({ done: 0, total, month: '', phase: 'Recording batch' })
        await rpc('finish_upload_nr', { p_batch: batch, p_total: p.rows.length, p_loaded: loaded, p_rejected: rejectedCount, p_months: months })
        step = 1
      }
      if (step === 1) {
        p.onProgress({ done: 1, total, month: '', phase: 'Finalizing sales' })
        const fin = readSalesFinal(await rpc('finalize_sales', { p_batch: batch, p_months: months, p_check: p.checks }))
        extra.fin = fin
        apply(fin.rejected)
        step = 2
      }
    } catch (e) {
      throw new LoadFailure(e instanceof Error ? e.message : 'Finishing failed', batch, step === 0 ? 'recording the batch' : 'finalizing sales', finish)
    }
    for (let i = 0; i < months.length; i++) {
      p.onProgress({ done: 2 + i, total, month: months[i], phase: 'Refreshing field activity' })
      try { await rpc('refresh_sales_field', { p_month: months[i] }) } catch (e) { extra.refreshWarnings.push(`${months[i].slice(0, 7)}: ${e instanceof Error ? e.message : 'failed'}`) }
    }
    p.onProgress({ done: total, total, month: '', phase: 'Done' })
    return outcome
  }
  return finish()
}
