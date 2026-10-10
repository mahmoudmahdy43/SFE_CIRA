import { CalendarOff, Clock, Plane, type LucideIcon } from 'lucide-react'
import { fetchAll, rpc } from '../../../lib/api/core'
import { fetchListMonths } from '../../../lib/api/lists'
import { fetchAbsenceMonths } from '../../../lib/api/absence'
import { fetchVisitMonths } from '../../../lib/api/visits'
import { LoadFailure, type LoadOutcome, type LoadParams, type Preview, type ReferenceData, type RejectedRow, type UploadTypeConfig } from '../types'
import { chunkRows, excelRowOf } from '../list/listParse'
import { RowsPerDay } from '../visits/RowsPerDay'
import { dateRangeByMonth } from '../visits/visitsParse'
import {
  ABSENCE_COLUMNS, monthsTouched, parseAbsenceShift, rowDate,
  type AbsenceKind, type AbsenceRow, type LeaveRow,
} from './absenceParse'
import type { ParsedAbsence } from './absenceSheet'
import { Breakdown, type BreakdownGroup } from './Breakdown'
import { makeAbsenceResultPanel } from './AbsenceResultPanel'

export const ABSENCE_CHUNK = 2000

interface ChunkResult { loaded: number; rejected_count: number; rejected: { i: number; reason: string }[] }

interface Meta {
  label: string
  description: string
  icon: LucideIcon
  templateFile: string
  startKind: string
  clearRpc: string
  chunkRpc: string
  createWorker: () => Worker
}

const META: Record<AbsenceKind, Meta> = {
  leaves: {
    label: 'Leaves',
    description: 'Approved and pending leave ranges per person and shift. Only Approved leaves count in KPIs.',
    icon: Plane,
    templateFile: 'leaves_template.xlsx',
    startKind: 'leaves',
    clearRpc: 'clear_leaves_range',
    chunkRpc: 'load_leaves_chunk',
    createWorker: () => new Worker(new URL('./leaves.worker.ts', import.meta.url), { type: 'module' }),
  },
  office_work: {
    label: 'Office Work',
    description: 'Office-work days per person and shift (AM / PM / Full).',
    icon: CalendarOff,
    templateFile: 'office_work_template.xlsx',
    startKind: 'office_work',
    clearRpc: 'clear_office_work_range',
    chunkRpc: 'load_office_work_chunk',
    createWorker: () => new Worker(new URL('./officeWork.worker.ts', import.meta.url), { type: 'module' }),
  },
  activities: {
    label: 'Activities',
    description: 'Meetings and activities with time of day, per person and shift.',
    icon: Clock,
    templateFile: 'activities_template.xlsx',
    startKind: 'activities',
    clearRpc: 'clear_activities_range',
    chunkRpc: 'load_activities_chunk',
    createWorker: () => new Worker(new URL('./activities.worker.ts', import.meta.url), { type: 'module' }),
  },
}

const tally = (values: (string | null)[]) => {
  const m = new Map<string, number>()
  for (const v of values) m.set(v?.trim() || '(blank)', (m.get(v?.trim() || '(blank)') ?? 0) + 1)
  return [...m].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
}

const typeOf = (r: AbsenceRow): string | null => ('leave_type' in r ? r.leave_type : 'ow_type' in r ? r.ow_type : r.act_type)

/** Date ranges per month group, using the date each type is replaced by (leaves: start date). */
const ranges = (rows: AbsenceRow[]) => dateRangeByMonth(rows.map((r) => ({ month: r.month, visit_date: rowDate(r) })))

function makeConfig(kind: AbsenceKind): UploadTypeConfig<AbsenceRow, ParsedAbsence> {
  const meta = META[kind]
  const columns = ABSENCE_COLUMNS[kind]

  async function loadReference(parsed: ParsedAbsence): Promise<ReferenceData> {
    const [reps, managers, listMonths, visitMonths, stored] = await Promise.all([
      fetchAll<{ id: number; code: string }>('reps', 'id,code', ['id']),
      fetchAll<{ id: number; code: string | null }>('managers', 'id,code', ['id']),
      fetchListMonths(),
      fetchVisitMonths(),
      fetchAbsenceMonths(kind),
    ])
    const r = ranges(parsed.rows)
    const existing = new Map<string, number>()
    for (const s of stored) {
      const f = r.get(s.month)
      // "Already loaded" only when the stored days overlap the days in the file.
      if (f && s.first_day <= f.last && s.last_day >= f.first) existing.set(s.month, s.rows)
    }
    return {
      repCodes: new Set([...reps.map((x) => x.code), ...managers.flatMap((m) => (m.code ? [m.code] : []))]),
      lineNames: new Set(),
      existingMonths: existing,
      listMonths: new Set(listMonths.map((m) => m.month)),
      visitMonths: new Set(visitMonths.map((m) => m.month)),
    }
  }

  function buildPreview(p: ParsedAbsence, ref: ReferenceData): Preview {
    const codes = new Set<string>()
    const unknown = new Map<string, number>()
    const monthRows = new Map<string, number>()
    const days = new Map<string, number>()
    const touched = new Set<string>()
    let multiMonth = 0
    for (const r of p.rows) {
      codes.add(r.code)
      if (!ref.repCodes.has(r.code)) unknown.set(r.code, (unknown.get(r.code) ?? 0) + 1)
      monthRows.set(r.month, (monthRows.get(r.month) ?? 0) + 1)
      days.set(rowDate(r), (days.get(rowDate(r)) ?? 0) + 1)
      const t = monthsTouched(r)
      t.forEach((m) => touched.add(m))
      if (t.length > 1) multiMonth++
    }
    const sortedDays = [...days.keys()].sort()
    const rg = ranges(p.rows)
    const months = [...monthRows]
      .map(([month, rows]) => {
        const x = rg.get(month)
        return { month, rows, range: x ? `${x.first} → ${x.last}` : undefined }
      })
      .sort((a, b) => a.month.localeCompare(b.month))

    const shifts = tally(p.rows.map((r) => parseAbsenceShift(r.shift)?.kind ?? r.shift))
    const groups: BreakdownGroup[] = [
      { title: 'By shift', items: shifts.map((s) => ({ ...s, label: s.label === 'FULL' ? 'Full' : s.label })) },
      { title: kind === 'leaves' ? 'By leave type' : kind === 'office_work' ? 'By office-work type' : 'By activity type', items: tally(p.rows.map(typeOf)) },
    ]
    let notApproved = 0
    if (kind === 'leaves') {
      const statuses = tally(p.rows.map((r) => (r as LeaveRow).status))
      groups.push({ title: 'By status', items: statuses })
      notApproved = p.rows.filter((r) => ((r as LeaveRow).status ?? '').trim().toLowerCase() !== 'approved').length
    }

    const warnings: string[] = []
    if (p.unusableCodes > 0) warnings.push(`${p.unusableCodes.toLocaleString()} row(s) have no usable CODE (formula error, #REF!, #N/A or blank) — paste values in Excel first. They are excluded.`)
    if (notApproved > 0) warnings.push(`${notApproved.toLocaleString()} row(s) are not Approved and will be stored but ignored in KPIs.`)
    if (multiMonth > 0) warnings.push(`${multiMonth.toLocaleString()} leave(s) touch more than one month — KPIs will be refreshed for: ${[...touched].sort().map((m) => m.slice(0, 7)).join(', ')}.`)
    if (p.undecidedDateOrder) warnings.push('Some dates are text like 07/10/2026 and the file does not show whether day or month comes first — day-first was assumed. Check the date range above.')
    if (p.errors.length > 0) warnings.push(`${p.errors.length.toLocaleString()} row(s) have a bad shift, date, time or CODE and will be excluded (listed below).`)
    if (unknown.size > 0) warnings.push(`${unknown.size} unknown CODE(s) — the database will reject those rows.`)
    for (const m of [...touched].sort()) {
      if (!ref.visitMonths?.has(m)) warnings.push(`Info: no visits are loaded for ${m.slice(0, 7)} yet — Missing days will look high until they are.`)
      if (!ref.listMonths?.has(m)) warnings.push(`Info: the Target List for ${m.slice(0, 7)} is not loaded.`)
    }
    const overlap = months.filter((m) => ref.existingMonths.has(m.month))
    if (overlap.length > 0) warnings.push(`${meta.label} already exist for the same dates in ${overlap.map((m) => m.month.slice(0, 7)).join(', ')} — choose Replace or Skip on the next step.`)

    return {
      stats: [
        { label: 'Rows in file', value: p.totalRows },
        { label: 'Rows ready to load', value: p.rows.length },
        { label: kind === 'leaves' ? 'Start-date range' : 'Date range', value: sortedDays.length ? `${sortedDays[0]} → ${sortedDays[sortedDays.length - 1]}` : '—' },
        { label: 'Months touched', value: touched.size },
        { label: 'Distinct CODEs', value: codes.size },
        { label: 'Rows without a usable CODE', value: p.unusableCodes },
        { label: 'Rows excluded (invalid)', value: p.errors.length },
      ],
      warnings,
      months,
      unknownReps: [...unknown].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
      unknownLabel: 'Unknown CODEs',
      unknownLines: [],
      sample: {
        columns: columns.map((c) => c.label),
        rows: p.rows.slice(0, 20).map((r) => columns.map((c) => ((r as unknown as Record<string, string | null>)[c.key] ?? null))),
      },
      extra: (
        <>
          <Breakdown groups={groups} />
          <RowsPerDay days={sortedDays.map((d) => ({ day: d, rows: days.get(d) as number }))} />
        </>
      ),
    }
  }

  async function sendChunk(batch: number, rows: object[]): Promise<ChunkResult> {
    const call = () => rpc<ChunkResult>(meta.chunkRpc, { p_batch: batch, p_rows: rows })
    try {
      return await call()
    } catch {
      return await call() // retry a failed chunk once
    }
  }

  /** start_upload -> clear range (Replace only) -> chunks -> finish_upload(every month touched). */
  async function load(p: LoadParams<AbsenceRow>): Promise<LoadOutcome> {
    const skip = new Set(p.skipMonths)
    const items = p.rows
      .map((row, k) => ({ row, x: p.excelRows[k] }))
      .filter((it) => !skip.has(it.row.month))
      .sort((a, b) => a.row.month.localeCompare(b.row.month))
    const loadMonths = [...new Set(items.map((i) => i.row.month))]
    const touched = [...new Set(items.flatMap((i) => monthsTouched(i.row)))].sort()
    const rg = ranges(items.map((i) => i.row))

    const batch = await rpc<number>('start_upload', { p_kind: meta.startKind, p_file: p.fileName })
    p.onBatch(batch)

    const rejected: RejectedRow[] = []
    let loaded = 0
    let rejectedCount = 0
    let where = 'clearing dates'
    try {
      for (const m of p.replaceMonths.filter((m) => loadMonths.includes(m))) {
        const r = rg.get(m)
        if (!r) continue
        where = `clearing ${r.first} → ${r.last}`
        p.onProgress({ done: 0, total: items.length, month: m, phase: 'Clearing dates' })
        await rpc(meta.clearRpc, { p_from: r.first, p_to: r.last })
      }
      const excel = items.map((i) => i.x)
      const chunks = chunkRows(items.map((i) => i.row), ABSENCE_CHUNK)
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
            excelRow: excelRowOf(excel, c, ABSENCE_CHUNK, rej.i),
            reason: rej.reason,
            context: row ? `${rowDate(row)} / ${row.shift} / ${row.code}` : '',
          })
        }
        done += chunk.length
        p.onProgress({ done, total: items.length, month: chunk[chunk.length - 1].month, phase: 'Loading rows' })
      }
      where = 'finishing (refreshing KPIs)'
      p.onProgress({ done: touched.length, total: touched.length, month: '', phase: 'Refreshing KPIs' })
      await rpc('finish_upload', { p_batch: batch, p_total: items.length, p_loaded: loaded, p_rejected: rejectedCount, p_months: touched })
    } catch (e) {
      throw new LoadFailure(e instanceof Error ? e.message : 'Upload failed', batch, where)
    }
    return { batch, total: items.length, loaded, rejectedCount, rejected, months: touched }
  }

  return {
    kind,
    label: meta.label,
    description: meta.description,
    icon: meta.icon,
    enabled: true,
    templateHeaders: columns.map((c) => c.label),
    templateFile: meta.templateFile,
    requiredHeaders: columns.filter((c) => c.required).map((c) => c.label),
    createWorker: meta.createWorker,
    loadReference,
    buildPreview,
    load,
    ResultPanel: makeAbsenceResultPanel(kind),
  }
}

export const leavesConfig = makeConfig('leaves')
export const officeWorkConfig = makeConfig('office_work')
export const activitiesConfig = makeConfig('activities')
