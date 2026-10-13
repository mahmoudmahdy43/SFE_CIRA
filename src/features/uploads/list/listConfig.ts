import { FileSpreadsheet } from 'lucide-react'
import { normName } from '../../../lib/norm'
import { fetchAll, rpc } from '../../../lib/api/core'
import { fetchListMonths } from '../../../lib/api/lists'
import { makeFinisher } from '../finish'
import ListResultPanel from './ListResultPanel'
import { LoadFailure, type LoadOutcome, type LoadParams, type Preview, type ReferenceData, type RejectedRow, type UploadTypeConfig } from '../types'
import { LIST_COLUMNS, chunkRows, excelRowOf, type ListRow } from './listParse'
import type { ParsedList } from './listSheet'

export const LIST_CHUNK = 2000

interface ChunkResult { loaded: number; rejected_count: number; rejected: { i: number; reason: string }[] }

function buildPreview(p: ParsedList, ref: ReferenceData): Preview {
  const monthCount = new Map<string, number>()
  const reps = new Set<string>()
  const doctors = new Set<string>()
  const unknownReps = new Map<string, number>()
  const unknownLines = new Map<string, number>()
  for (const r of p.rows) {
    monthCount.set(r.month, (monthCount.get(r.month) ?? 0) + 1)
    reps.add(r.emp_code)
    doctors.add(`${r.account_id}|${r.doctor_id}`)
    if (!ref.repCodes.has(r.emp_code)) unknownReps.set(r.emp_code, (unknownReps.get(r.emp_code) ?? 0) + 1)
    const ln = normName(r.line) ?? ''
    if (!ref.lineNames.has(ln)) unknownLines.set(r.line, (unknownLines.get(r.line) ?? 0) + 1)
  }
  const warnings: string[] = []
  if (p.divisionDates > 0) warnings.push(`${p.divisionDates.toLocaleString()} Division value(s) looked like dates — original text kept as displayed.`)
  if (p.duplicates > 0) warnings.push(`${p.duplicates.toLocaleString()} duplicate row(s) (same Account ID + Doctor Id in the same month) — the last occurrence is used.`)
  if (p.ambiguousMonths > 0) warnings.push(`${p.ambiguousMonths.toLocaleString()} Month value(s) such as 3/4/2026 could mean two different months — day-first was assumed. Check the raw values below.`)
  if (p.errors.length > 0) warnings.push(`${p.errors.length.toLocaleString()} row(s) have blank or invalid required values and will be excluded (listed below).`)
  if (unknownReps.size > 0) warnings.push(`${unknownReps.size} unknown rep code(s) — the database will reject those rows.`)
  if (unknownLines.size > 0) warnings.push(`${unknownLines.size} line name(s) not found in the system — the database will reject those rows.`)
  return {
    stats: [
      { label: 'Rows in file', value: p.totalRows },
      { label: 'Rows ready to load', value: p.rows.length },
      { label: 'Months detected', value: monthCount.size },
      { label: 'Distinct reps', value: reps.size },
      { label: 'Distinct doctors', value: doctors.size },
      { label: 'Duplicates merged', value: p.duplicates },
      { label: 'Rows excluded (invalid)', value: p.errors.length },
    ],
    warnings,
    monthSamples: p.monthSamples,
    months: [...monthCount].map(([month, rows]) => ({ month, rows })).sort((a, b) => a.month.localeCompare(b.month)),
    unknownReps: [...unknownReps].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
    unknownLines: [...unknownLines].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    sample: {
      columns: ['Month', 'Line', 'Emp. Code', 'Account ID', 'Doctor Id', 'Doctor Name', 'Account Name', 'Class', 'Freq.'],
      rows: p.rows.slice(0, 20).map((r) => [r.month, r.line, r.emp_code, r.account_id, r.doctor_id, r.doctor_name, r.account_name, r.class, r.freq]),
    },
  }
}

async function loadReference(): Promise<ReferenceData> {
  const [reps, lines, months] = await Promise.all([
    fetchAll<{ id: number; code: string }>('reps', 'id,code', ['id']),
    fetchAll<{ id: number; name: string }>('lines', 'id,name', ['id']),
    fetchListMonths(),
  ])
  return {
    repCodes: new Set(reps.map((r) => r.code)),
    lineNames: new Set(lines.map((l) => normName(l.name) ?? '')),
    existingMonths: new Map(months.map((m) => [m.month, m.rows])),
  }
}

async function sendChunk(batch: number, rows: ListRow[]): Promise<ChunkResult> {
  const call = () => rpc<ChunkResult>('load_list_chunk', { p_batch: batch, p_rows: rows })
  try {
    return await call()
  } catch {
    return await call() // retry a failed chunk once; a second failure is reported by the caller
  }
}

/** start_upload -> (clear_list_month per Replace month) -> load_list_chunk* -> finish_upload_nr -> refresh_month per month. */
async function load(p: LoadParams<ListRow>): Promise<LoadOutcome> {
  const skip = new Set(p.skipMonths)
  const items = p.rows
    .map((row, k) => ({ row, x: p.excelRows[k] }))
    .filter((it) => !skip.has(it.row.month))
    .sort((a, b) => a.row.month.localeCompare(b.row.month)) // stable: file order within a month
  const months = [...new Set(items.map((i) => i.row.month))]

  const batch = await rpc<number>('start_upload', { p_kind: 'list', p_file: p.fileName })
  p.onBatch(batch)

  const rejected: RejectedRow[] = []
  let loaded = 0
  let rejectedCount = 0
  let where = 'clearing months'
  try {
    for (const m of p.replaceMonths.filter((m) => months.includes(m))) {
      where = `clearing ${m.slice(0, 7)}`
      await rpc('clear_list_month', { p_month: m })
    }
    const excel = items.map((i) => i.x)
    const chunks = chunkRows(items.map((i) => i.row), LIST_CHUNK)
    let done = 0
    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c]
      where = `chunk ${c + 1} of ${chunks.length} (${chunk[0].month.slice(0, 7)})`
      p.onProgress({ done, total: items.length, month: chunk[0].month })
      const r = await sendChunk(batch, chunk)
      loaded += r.loaded
      rejectedCount += r.rejected_count
      for (const rej of r.rejected ?? []) {
        const row = chunk[rej.i]
        rejected.push({
          excelRow: excelRowOf(excel, c, LIST_CHUNK, rej.i),
          reason: rej.reason,
          context: row ? `${row.month} / ${row.emp_code} / ${row.account_id} / ${row.doctor_id}` : '',
        })
      }
      done += chunk.length
      p.onProgress({ done, total: items.length, month: chunk[chunk.length - 1].month })
    }
  } catch (e) {
    throw new LoadFailure(e instanceof Error ? e.message : 'Upload failed', batch, where)
  }
  const outcome: LoadOutcome = { batch, total: items.length, loaded, rejectedCount, rejected, months }
  const fin = makeFinisher({ batch, total: items.length, loaded, rejectedCount, months, onProgress: p.onProgress })
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

export const listConfig: UploadTypeConfig<ListRow, ParsedList> = {
  kind: 'list',
  label: 'Target List',
  description: 'Monthly doctor list per rep with target frequency. Detects added, removed, transferred and frequency-changed doctors.',
  icon: FileSpreadsheet,
  enabled: true,
  templateHeaders: LIST_COLUMNS.map((c) => c.label),
  templateFile: 'target_list_template.xlsx',
  requiredHeaders: LIST_COLUMNS.filter((c) => c.required).map((c) => c.label),
  createWorker: () => new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' }),
  loadReference,
  buildPreview,
  load,
  ResultPanel: ListResultPanel,
}
