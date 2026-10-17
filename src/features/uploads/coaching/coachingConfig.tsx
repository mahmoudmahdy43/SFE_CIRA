import { ClipboardCheck } from 'lucide-react'
import { rpc } from '../../../lib/api/core'
import { fetchCoachingTrend } from '../../../lib/api/coaching'
import { LoadFailure, type LoadOutcome, type LoadParams, type Preview, type ReferenceData, type RejectedRow, type UploadTypeConfig } from '../types'
import { chunkRows, excelRowOf } from '../list/listParse'
import CoachingResultPanel, { type CoachingOutcomeExtra } from './CoachingResultPanel'
import { COACHING_HEADERS, SKILLS_PER_VISIT, incompleteVisits, toPayload, type CoachingRow } from './coachingParse'
import type { ParsedCoaching } from './coachingSheet'
import { EXCLUDED_REASON, readFinalize } from './coachingResult'

export const COACHING_CHUNK = 500

interface ChunkResult { loaded: number; rejected_count: number; rejected: { i: number; reason: string }[] }

async function loadReference(): Promise<ReferenceData> {
  // months already stored: coaching_company_trend lists only months with visits (the count shown is visits)
  const trend = await fetchCoachingTrend('2000-01-01', '2100-01-01')
  return { repCodes: new Set(), lineNames: new Set(), existingMonths: new Map(trend.map((t) => [t.month, t.visits])) }
}

function buildPreview(p: ParsedCoaching, ref: ReferenceData): Preview {
  const visits = new Set<string>()
  const reps = new Set<string>()
  const evaluators = new Map<string, number>()
  const monthRows = new Map<string, number>()
  for (const r of p.rows) {
    visits.add(r.visit_id)
    reps.add(r.emp_name)
    const ev = r.evaluator ?? '(blank)'
    evaluators.set(ev, (evaluators.get(ev) ?? 0) + 1)
    monthRows.set(r.month, (monthRows.get(r.month) ?? 0) + 1)
  }
  const months = [...monthRows].map(([month, rows]) => ({ month, rows })).sort((a, b) => a.month.localeCompare(b.month))
  const incomplete = incompleteVisits(p.rows)
  const warnings: string[] = []
  if (p.errors.length > 0) warnings.push(`${p.errors.length.toLocaleString()} row(s) have a blank or invalid month, visit_date, emp_name, skill_code, visit_id or score and will be excluded (listed below).`)
  if (incomplete.length > 0) warnings.push(`${incomplete.length.toLocaleString()} visit(s) have fewer than ${SKILLS_PER_VISIT} skills in the file.`)
  if (p.duplicates > 0) warnings.push(`${p.duplicates.toLocaleString()} row(s) repeat an earlier visit_id + skill_code pair.`)
  if ([...evaluators.keys()].includes('(blank)')) warnings.push('Some rows have no evaluator.')
  if (months.some((m) => ref.existingMonths.has(m.month))) warnings.push('Months already loaded are shown with their number of stored visits (not rows). Choose Replace or Skip on the next step.')
  const sorted = [...evaluators].sort((a, b) => b[1] - a[1])
  return {
    stats: [
      { label: 'Rows in file', value: p.totalRows },
      { label: 'Rows ready to load', value: p.rows.length },
      { label: 'Months found', value: months.map((m) => m.month.slice(0, 7)).join(', ') || '—' },
      { label: 'Visits (distinct visit_id)', value: visits.size },
      { label: 'Reps (distinct emp_name)', value: reps.size },
      { label: 'Evaluators', value: evaluators.size },
      { label: 'Rows excluded (invalid)', value: p.errors.length },
    ],
    warnings,
    months,
    unknownReps: [],
    unknownLines: [],
    sample: {
      columns: COACHING_HEADERS,
      rows: p.rows.slice(0, 20).map((r) => [r.team_name, r.emp_id, r.emp_name, r.month.slice(0, 7), r.skill_code, r.skill_name, r.visit_id, r.visit_date, r.evaluator, r.score]),
    },
    extra: (
      <div className="rounded-card border bg-card p-5">
        <h3 className="mb-2 text-sm font-semibold">Evaluators in the file</h3>
        <ul className="flex flex-wrap gap-1.5 text-xs">
          {sorted.map(([name, rows]) => <li key={name} className="rounded-full border bg-muted px-2.5 py-0.5">{name} <span className="tnum text-muted-foreground">({rows.toLocaleString()} rows)</span></li>)}
        </ul>
      </div>
    ),
  }
}

async function sendChunk(batch: number, rows: Record<string, string | null>[]): Promise<ChunkResult> {
  const call = () => rpc<ChunkResult>('load_coaching_chunk', { p_batch: batch, p_rows: rows })
  try {
    return await call()
  } catch {
    return await call() // retry a failed chunk once
  }
}

/** start_upload('coaching') -> coaching_delete_months (Replace only) -> load_coaching_chunk x500 -> finish_upload_nr -> finalize_coaching. */
async function load(p: LoadParams<CoachingRow>): Promise<LoadOutcome> {
  const skip = new Set(p.skipMonths)
  const items = p.rows
    .map((row, k) => ({ row, x: p.excelRows[k] }))
    .filter((it) => !skip.has(it.row.month))
    .sort((a, b) => a.row.month.localeCompare(b.row.month))
  const months = [...new Set(items.map((i) => i.row.month))]

  const batch = await rpc<number>('start_upload', { p_kind: 'coaching', p_file: p.fileName })
  p.onBatch(batch)

  const rejected: RejectedRow[] = []
  let loaded = 0
  let rejectedCount = 0
  let excludedRows = 0
  let unreported = 0
  let where = 'clearing months'
  try {
    const replace = p.replaceMonths.filter((m) => months.includes(m))
    if (replace.length > 0) {
      p.onProgress({ done: 0, total: items.length, month: replace[0], phase: 'Clearing months' })
      await rpc('coaching_delete_months', { p_months: replace })
    }
    const excel = items.map((i) => i.x)
    const chunks = chunkRows(items.map((i) => i.row), COACHING_CHUNK)
    let done = 0
    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c]
      where = `chunk ${c + 1} of ${chunks.length} (${chunk[0].month.slice(0, 7)})`
      p.onProgress({ done, total: items.length, month: chunk[0].month, phase: 'Loading rows' })
      const r = await sendChunk(batch, chunk.map(toPayload))
      loaded += r.loaded
      rejectedCount += r.rejected_count
      unreported += Math.max(0, r.rejected_count - (r.rejected ?? []).length)
      for (const rej of r.rejected ?? []) {
        if (EXCLUDED_REASON.test(rej.reason)) excludedRows++
        const row = chunk[rej.i]
        rejected.push({
          excelRow: excelRowOf(excel, c, COACHING_CHUNK, rej.i),
          reason: rej.reason,
          context: row ? `${row.evaluator ?? '—'} / ${row.emp_name} / visit ${row.visit_id}` : '',
        })
      }
      done += chunk.length
      p.onProgress({ done, total: items.length, month: chunk[chunk.length - 1].month, phase: 'Loading rows' })
    }
  } catch (e) {
    throw new LoadFailure(e instanceof Error ? e.message : 'Upload failed', batch, where)
  }

  // The database lists at most 200 rejected rows per chunk; the rest of the "excluded evaluator" rows are counted from the reported ones only.
  const extra: CoachingOutcomeExtra = { visits: null, unmatchedReps: [], unmatchedEvaluators: [], incompleteCount: 0, incompleteList: [], excludedRows, excludedExact: unreported === 0 }
  const outcome: LoadOutcome = { batch, total: items.length, loaded, rejectedCount, rejected, months, extra }
  let step = 0
  const finish = async (): Promise<LoadOutcome> => {
    try {
      if (step === 0) {
        p.onProgress({ done: 0, total: 2, month: '', phase: 'Recording batch' })
        await rpc('finish_upload_nr', { p_batch: batch, p_total: items.length, p_loaded: loaded, p_rejected: rejectedCount, p_months: months })
        step = 1
      }
      if (step === 1) {
        p.onProgress({ done: 1, total: 2, month: '', phase: 'Finalizing coaching visits' })
        const fin = readFinalize(await rpc('finalize_coaching', { p_months: months }))
        Object.assign(extra, fin, { excludedRows, excludedExact: unreported === 0 })
        step = 2
      }
      p.onProgress({ done: 2, total: 2, month: '', phase: 'Done' })
    } catch (e) {
      throw new LoadFailure(e instanceof Error ? e.message : 'Finishing failed', batch, step === 0 ? 'recording the batch' : 'finalizing coaching visits', finish)
    }
    return outcome
  }
  return finish()
}

export const coachingConfig: UploadTypeConfig<CoachingRow, ParsedCoaching> = {
  kind: 'coaching',
  label: 'Coaching',
  description: 'Coaching visits: one row per visit and skill (15 skills, scored 1-5) with the evaluator. Feeds the Coaching report and the Company Skills card.',
  icon: ClipboardCheck,
  enabled: true,
  templateHeaders: COACHING_HEADERS,
  templateFile: 'coaching_template.xlsx',
  requiredHeaders: COACHING_HEADERS,
  createWorker: () => new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' }),
  loadReference,
  buildPreview,
  load,
  ResultPanel: CoachingResultPanel,
}
