import { Stethoscope } from 'lucide-react'
import { fetchAll, rpc } from '../../../lib/api/core'
import { fetchListMonths } from '../../../lib/api/lists'
import { fetchVisitMonths, type ProcessResult } from '../../../lib/api/visits'
import { LoadFailure, type LoadOutcome, type LoadParams, type Preview, type ReferenceData, type RejectedRow, type UploadTypeConfig } from '../types'
import { chunkRows, excelRowOf } from '../list/listParse'
import VisitsResultPanel, { type VisitsExtra } from './VisitsResultPanel'
import { VISIT_COLUMNS, dateRangeByMonth, type VisitRow } from './visitsParse'
import type { ParsedVisits } from './visitsSheet'
import { RowsPerDay } from './RowsPerDay'

export const VISITS_CHUNK = 2000

interface ChunkResult { loaded: number; rejected_count: number; rejected: { i: number; reason: string }[] }

async function loadReference(parsed: ParsedVisits): Promise<ReferenceData> {
  const [reps, managers, listMonths, visitMonths] = await Promise.all([
    fetchAll<{ id: number; code: string }>('reps', 'id,code', ['id']),
    fetchAll<{ id: number; code: string | null }>('managers', 'id,code', ['id']),
    fetchListMonths(),
    fetchVisitMonths(),
  ])
  const ranges = dateRangeByMonth(parsed.rows)
  const existing = new Map<string, number>()
  for (const vm of visitMonths) {
    const r = ranges.get(vm.month)
    // Only counts as "already loaded" when the stored days overlap the days in the file.
    if (r && vm.first_day <= r.last && vm.last_day >= r.first) existing.set(vm.month, vm.rows)
  }
  return {
    repCodes: new Set([...reps.map((r) => r.code), ...managers.flatMap((m) => (m.code ? [m.code] : []))]),
    lineNames: new Set(),
    existingMonths: existing,
    listMonths: new Set(listMonths.map((m) => m.month)),
  }
}

function buildPreview(p: ParsedVisits, ref: ReferenceData): Preview {
  const days = new Map<string, number>()
  const codes = new Set<string>()
  const unknown = new Map<string, number>()
  const monthRows = new Map<string, number>()
  let single = 0
  let double = 0
  let planned = 0
  let direct = 0
  for (const r of p.rows) {
    days.set(r.visit_date, (days.get(r.visit_date) ?? 0) + 1)
    monthRows.set(r.month, (monthRows.get(r.month) ?? 0) + 1)
    codes.add(r.code)
    if (!ref.repCodes.has(r.code)) unknown.set(r.code, (unknown.get(r.code) ?? 0) + 1)
    if (r.visit_type === 'D') double++
    else single++
    if (r.visit_root === 'Planned') planned++
    else if (r.visit_root === 'Direct') direct++
  }
  const sortedDays = [...days.keys()].sort()
  const ranges = dateRangeByMonth(p.rows)
  const months = [...monthRows]
    .map(([month, rows]) => {
      const r = ranges.get(month)
      return { month, rows, range: r ? `${r.first} → ${r.last}` : undefined }
    })
    .sort((a, b) => a.month.localeCompare(b.month))

  const alerts = months
    .filter((m) => !ref.listMonths?.has(m.month))
    .map((m) => `Target List for ${m.month.slice(0, 7)} is not loaded — visits will not match any list: load the list first. (You can still continue and use Re-match later.)`)
  const warnings: string[] = []
  if (p.otherRoots > 0) warnings.push(`${p.otherRoots.toLocaleString()} row(s) have a Visit Root other than Planned / Direct — kept as written.`)
  if (p.undecidedDateOrder) warnings.push('Some dates are text like 07/10/2026 and the file does not show whether day or month comes first — day-first was assumed. Check the date range above.')
  if (p.errors.length > 0) warnings.push(`${p.errors.length.toLocaleString()} row(s) have a bad shift, visit type, date, or blank required value and will be excluded (listed below).`)
  if (unknown.size > 0) warnings.push(`${unknown.size} unknown CODE(s) — the database will reject those rows.`)
  const overlap = months.filter((m) => ref.existingMonths.has(m.month))
  if (overlap.length > 0) warnings.push(`Visits already exist for the same dates in ${overlap.map((m) => m.month.slice(0, 7)).join(', ')} — choose Replace or Skip on the next step.`)

  return {
    stats: [
      { label: 'Rows in file', value: p.totalRows },
      { label: 'Rows ready to load', value: p.rows.length },
      { label: 'Date range', value: sortedDays.length ? `${sortedDays[0]} → ${sortedDays[sortedDays.length - 1]}` : '—' },
      { label: 'Distinct days', value: days.size },
      { label: 'Months detected', value: months.length },
      { label: 'Distinct CODEs', value: codes.size },
      { label: 'Single rows', value: single },
      { label: 'Double rows (rep + manager pairs)', value: double },
      { label: 'Planned', value: planned },
      { label: 'Direct', value: direct },
      { label: 'Rows excluded (invalid)', value: p.errors.length },
    ],
    alerts,
    warnings,
    months,
    unknownReps: [...unknown].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
    unknownLabel: 'Unknown CODEs',
    unknownLines: [],
    sample: {
      columns: ['Date', 'Shift', 'CODE', 'Territory', 'Type', 'Doctor Name', 'Acc. Name', 'Root'],
      rows: p.rows.slice(0, 20).map((r) => [r.visit_date, r.shift, r.code, r.territory, r.visit_type, r.doctor_name, r.acc_name, r.visit_root]),
    },
    extra: <RowsPerDay days={sortedDays.map((d) => ({ day: d, rows: days.get(d) as number }))} />,
  }
}

async function sendChunk(batch: number, rows: Omit<VisitRow, 'month'>[]): Promise<ChunkResult> {
  const call = () => rpc<ChunkResult>('load_visits_chunk', { p_batch: batch, p_rows: rows })
  try {
    return await call()
  } catch {
    return await call() // retry a failed chunk once
  }
}

/** start_upload -> clear_visits_range (Replace only, exactly the file's dates) -> chunks -> process_visits_month -> finish_upload. */
async function load(p: LoadParams<VisitRow>): Promise<LoadOutcome> {
  const skip = new Set(p.skipMonths)
  const items = p.rows
    .map((row, k) => ({ row, x: p.excelRows[k] }))
    .filter((it) => !skip.has(it.row.month))
    .sort((a, b) => a.row.month.localeCompare(b.row.month))
  const months = [...new Set(items.map((i) => i.row.month))]
  const ranges = dateRangeByMonth(items.map((i) => i.row))

  const batch = await rpc<number>('start_upload', { p_kind: 'visits', p_file: p.fileName })
  p.onBatch(batch)

  const rejected: RejectedRow[] = []
  const extra: VisitsExtra = {}
  let loaded = 0
  let rejectedCount = 0
  let where = 'clearing dates'
  try {
    for (const m of p.replaceMonths.filter((m) => months.includes(m))) {
      const r = ranges.get(m)
      if (!r) continue
      where = `clearing ${r.first} → ${r.last}`
      p.onProgress({ done: 0, total: items.length, month: m, phase: 'Clearing dates' })
      await rpc('clear_visits_range', { p_from: r.first, p_to: r.last })
    }
    const excel = items.map((i) => i.x)
    const chunks = chunkRows(items.map((i) => i.row), VISITS_CHUNK)
    let done = 0
    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c]
      where = `chunk ${c + 1} of ${chunks.length} (${chunk[0].month.slice(0, 7)})`
      p.onProgress({ done, total: items.length, month: chunk[0].month, phase: 'Loading rows' })
      const payload = chunk.map((row) => {
        const { month, ...rest } = row
        void month
        return rest
      })
      const r = await sendChunk(batch, payload)
      loaded += r.loaded
      rejectedCount += r.rejected_count
      for (const rej of r.rejected ?? []) {
        const row = chunk[rej.i]
        rejected.push({
          excelRow: excelRowOf(excel, c, VISITS_CHUNK, rej.i),
          reason: rej.reason,
          context: row ? `${row.visit_date} / ${row.shift} / ${row.code}` : '',
        })
      }
      done += chunk.length
      p.onProgress({ done, total: items.length, month: chunk[chunk.length - 1].month, phase: 'Loading rows' })
    }
    for (let k = 0; k < months.length; k++) {
      where = `matching doctors for ${months[k].slice(0, 7)}`
      p.onProgress({ done: k, total: months.length, month: months[k], phase: 'Matching doctors and territories' })
      try {
        extra[months[k]] = await rpc<ProcessResult>('process_visits_month', { p_month: months[k] })
      } catch (e) {
        extra[months[k]] = { error: e instanceof Error ? e.message : 'matching failed' }
      }
    }
    where = 'finishing (refreshing org and KPIs)'
    p.onProgress({ done: months.length, total: months.length, month: '', phase: 'Refreshing KPIs' })
    await rpc('finish_upload', { p_batch: batch, p_total: items.length, p_loaded: loaded, p_rejected: rejectedCount, p_months: months })
  } catch (e) {
    throw new LoadFailure(e instanceof Error ? e.message : 'Upload failed', batch, where)
  }
  return { batch, total: items.length, loaded, rejectedCount, rejected, months, extra }
}

export const visitsConfig: UploadTypeConfig<VisitRow, ParsedVisits> = {
  kind: 'visits',
  label: 'Visits',
  description: 'Daily visit log per rep and manager (Single / Double, Planned / Direct). Matched to the monthly Target List by doctor and account name.',
  icon: Stethoscope,
  enabled: true,
  templateHeaders: VISIT_COLUMNS.map((c) => c.label),
  templateFile: 'visits_template.xlsx',
  requiredHeaders: VISIT_COLUMNS.filter((c) => c.required).map((c) => c.label),
  createWorker: () => new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' }),
  loadReference,
  buildPreview,
  load,
  ResultPanel: VisitsResultPanel,
}
