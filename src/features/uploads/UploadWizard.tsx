import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileUp, Loader2, Undo2, XCircle } from 'lucide-react'
import * as XLSX from 'xlsx'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Badge, Card, Progress } from '../../components/ui/misc'
import { FormDialog } from '../../components/app/FormDialog'
import { fetchAll, rpc } from '../../lib/api/core'
import { Link } from 'react-router-dom'
import { CHANGE_LABEL, CHANGE_TYPES, DQ_ISSUES, DQ_LABEL, fetchChangeCounts, fetchDqCounts, fetchListMonths, type ChangeType, type DqIssue } from '../../lib/api/lists'
import { downloadCsv } from '../../lib/csv'
import { normName } from '../../lib/norm'
import { cn } from '../../lib/utils'
import { openParseSession, type ParseSession } from './workerClient'
import {
  LoadFailure, type LoadOutcome, type ParsedBase, type Preview, type ReferenceData, type UploadTypeConfig,
} from './types'

type Stage = 'file' | 'sheet' | 'parsing' | 'preview' | 'decide' | 'loading' | 'result'
type Choice = 'replace' | 'skip'

const STEPS: { id: Stage[]; label: string }[] = [
  { id: ['file', 'sheet', 'parsing'], label: 'File' },
  { id: ['preview'], label: 'Preview' },
  { id: ['decide'], label: 'Months' },
  { id: ['loading'], label: 'Load' },
  { id: ['result'], label: 'Result' },
]

const monthLabel = (m: string) => m.slice(0, 7)
const n = (v: number | string) => (typeof v === 'number' ? v.toLocaleString() : v)

export function downloadTemplate(headers: string[], file: string): void {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers]), 'Template')
  XLSX.writeFile(wb, file)
}

export default function UploadWizard<R extends { month: string }, P extends ParsedBase<R>>({
  config,
  onExit,
  onViewChanges,
}: {
  config: UploadTypeConfig<R, P>
  onExit: () => void
  onViewChanges: (month: string) => void
}) {
  const [stage, setStage] = useState<Stage>('file')
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [sheets, setSheets] = useState<string[]>([])
  const [sheet, setSheet] = useState('')
  const [progress, setProgress] = useState<{ phase: string; done: number; total: number } | null>(null)
  const [parsed, setParsed] = useState<P | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [existing, setExisting] = useState<Map<string, number>>(new Map())
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [loadProg, setLoadProg] = useState<{ done: number; total: number; month: string } | null>(null)
  const [outcome, setOutcome] = useState<LoadOutcome | null>(null)
  const [failure, setFailure] = useState<{ message: string; where: string; batch: number | null } | null>(null)
  const [undoBatch, setUndoBatch] = useState<number | null>(null)
  const session = useRef<ParseSession<P> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const batchRef = useRef<number | null>(null)

  useEffect(() => () => session.current?.terminate(), [])

  const reset = useCallback(() => {
    session.current?.terminate()
    session.current = null
    setStage('file'); setError(null); setFileName(''); setSheets([]); setParsed(null); setPreview(null)
    setChoices({}); setOutcome(null); setFailure(null); setLoadProg(null); setProgress(null)
    batchRef.current = null
    if (inputRef.current) inputRef.current.value = ''
  }, [])

  const analyse = async (name: string) => {
    const s = session.current
    if (!s) return
    setStage('parsing')
    setError(null)
    setProgress({ phase: 'reading', done: 0, total: 0 })
    try {
      const result = await s.parse(name, (done, total, phase) => setProgress({ phase, done, total }))
      s.terminate()
      session.current = null
      if (result.missing.length > 0) {
        setError(
          `Missing required column(s): ${result.missing.join(', ')}.\nFound: ${result.headers.join(', ') || '(no headers)'}\nExpected: ${config.requiredHeaders.join(', ')}`,
        )
        setStage('file')
        return
      }
      const [reps, lines, months] = await Promise.all([
        fetchAll<{ id: number; code: string }>('reps', 'id,code', ['id']),
        fetchAll<{ id: number; name: string }>('lines', 'id,name', ['id']),
        fetchListMonths(),
      ])
      const ref: ReferenceData = {
        repCodes: new Set(reps.map((r) => r.code)),
        lineNames: new Set(lines.map((l) => normName(l.name) ?? '')),
        existingMonths: new Map(months.map((m) => [m.month, m.rows])),
      }
      setParsed(result)
      setExisting(ref.existingMonths)
      setPreview(config.buildPreview(result, ref))
      setStage('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not analyse the file')
      setStage('file')
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (!/\.xlsx?$/i.test(file.name)) {
      setError('Please choose an Excel file (.xlsx or .xls).')
      return
    }
    reset()
    setFileName(file.name)
    setStage('parsing')
    setProgress({ phase: 'reading', done: 0, total: 0 })
    try {
      const s = await openParseSession<P>(config.createWorker(), await file.arrayBuffer())
      session.current = s
      setSheets(s.sheets)
      setSheet(s.sheets[0] ?? '')
      if (s.sheets.length <= 1) await analyse(s.sheets[0] ?? '')
      else setStage('sheet')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the file')
      setStage('file')
    }
  }

  const startLoad = async () => {
    if (!parsed) return
    setStage('loading')
    setFailure(null)
    setLoadProg({ done: 0, total: parsed.rows.length, month: '' })
    try {
      const out = await config.load({
        fileName,
        rows: parsed.rows,
        excelRows: parsed.excelRows,
        replaceMonths: Object.entries(choices).filter(([, c]) => c === 'replace').map(([m]) => m),
        skipMonths: Object.entries(choices).filter(([, c]) => c === 'skip').map(([m]) => m),
        onProgress: setLoadProg,
        onBatch: (id) => { batchRef.current = id },
      })
      setOutcome(out)
      setStage('result')
    } catch (e) {
      const f = e instanceof LoadFailure ? e : null
      setFailure({ message: e instanceof Error ? e.message : 'Upload failed', where: f?.where ?? 'unknown step', batch: f?.batch ?? batchRef.current })
    }
  }

  const stepIndex = STEPS.findIndex((s) => s.id.includes(stage))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={onExit} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden /> All upload types
        </button>
        <ol className="flex items-center gap-2 text-xs" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s.label} aria-current={i === stepIndex ? 'step' : undefined} className={cn('flex items-center gap-1.5', i === stepIndex ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
              <span className={cn('flex h-5 w-5 items-center justify-center rounded-full border text-[10px]', i < stepIndex && 'border-success bg-success-soft text-success', i === stepIndex && 'border-primary bg-primary text-primary-foreground')}>
                {i < stepIndex ? '✓' : i + 1}
              </span>
              {s.label}
              {i < STEPS.length - 1 && <span aria-hidden className="mx-1 h-px w-4 bg-border" />}
            </li>
          ))}
        </ol>
      </div>

      {error && (
        <div role="alert" className="whitespace-pre-line rounded-control bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>
      )}

      {/* 1 — file */}
      {(stage === 'file' || stage === 'sheet') && (
        <Card className="p-6">
          <h2 className="text-base font-semibold">Upload {config.label}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{config.description}</p>
          <label
            htmlFor="upload-file"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); void onFile(e.dataTransfer.files[0]) }}
            className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-6 py-10 text-center hover:bg-muted"
          >
            <FileUp className="h-6 w-6 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">Drop an Excel file here, or click to choose</span>
            <span className="text-xs text-muted-foreground">.xlsx or .xls — parsed in your browser; only cleaned rows are sent to the database</span>
            <input ref={inputRef} id="upload-file" type="file" accept=".xlsx,.xls" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          {stage === 'sheet' && (
            <div className="mt-5 flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="sheet-pick" className="mb-1.5 block text-sm font-medium">Sheet in “{fileName}”</label>
                <select id="sheet-pick" value={sheet} onChange={(e) => setSheet(e.target.value)} className="h-9 rounded-control border bg-card px-3 text-sm">
                  {sheets.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <Button variant="primary" onClick={() => void analyse(sheet)}>Analyse sheet</Button>
            </div>
          )}
          <div className="mt-5 flex items-center gap-3 border-t pt-4 text-sm">
            <Button size="sm" onClick={() => downloadTemplate(config.templateHeaders, config.templateFile)}>
              <Download className="h-4 w-4" aria-hidden /> Download template
            </Button>
            <span className="text-muted-foreground">Empty .xlsx with the exact headers.</span>
          </div>
        </Card>
      )}

      {stage === 'parsing' && (
        <Card className="p-6" aria-busy="true">
          <div className="flex items-center gap-2 text-sm font-medium"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {progress?.phase === 'rows' ? 'Reading rows…' : 'Opening workbook…'}</div>
          <div className="mt-3"><Progress label="Parsing progress" value={progress && progress.total > 0 ? progress.done / progress.total : 0.05} /></div>
          <p className="mt-2 text-xs text-muted-foreground">{fileName}{progress && progress.total > 0 ? ` — ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} rows` : ''}. The page stays responsive; large files can take a little while.</p>
        </Card>
      )}

      {/* 2 — preview */}
      {stage === 'preview' && preview && parsed && (
        <>
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Preview — {fileName}</h2>
            <dl className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
              {preview.stats.map((s) => (
                <div key={s.label} className="flex items-center justify-between border-b py-1.5 text-sm">
                  <dt className="text-muted-foreground">{s.label}</dt>
                  <dd className="tnum font-medium">{n(s.value)}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">Months detected vs what is stored</h3>
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Month</th><th className="py-1.5 text-right font-medium">Rows in file</th><th className="py-1.5 text-right font-medium">Rows stored now</th><th className="py-1.5 pl-4 font-medium">State</th></tr></thead>
              <tbody>
                {preview.months.map((m) => (
                  <tr key={m.month} className="border-b last:border-0">
                    <td className="tnum py-1.5">{monthLabel(m.month)}</td>
                    <td className="tnum py-1.5 text-right">{m.rows.toLocaleString()}</td>
                    <td className="tnum py-1.5 text-right">{existing.has(m.month) ? (existing.get(m.month) as number).toLocaleString() : '—'}</td>
                    <td className="py-1.5 pl-4">{existing.has(m.month) ? <Badge tone="warning">Already loaded</Badge> : <Badge tone="success">New</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {preview.monthSamples && preview.monthSamples.length > 0 && (
            <Card className="p-5">
              <h3 className="mb-1 text-sm font-semibold">How the Month column was read</h3>
              <p className="mb-3 text-sm text-muted-foreground">Detected month(s): <b className="tnum">{preview.months.map((m) => monthLabel(m.month)).join(', ') || 'none'}</b>. Raw values of the first 3 rows:</p>
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Excel row</th><th className="py-1.5 font-medium">Raw value (cell.v)</th><th className="py-1.5 font-medium">Type</th><th className="py-1.5 font-medium">Excel shows</th><th className="py-1.5 font-medium">Read as</th></tr></thead>
                <tbody>
                  {preview.monthSamples.map((s) => (
                    <tr key={s.excelRow} className="border-b last:border-0"><td className="tnum py-1.5">{s.excelRow}</td><td className="tnum py-1.5 font-mono">{s.raw || '—'}</td><td className="py-1.5">{s.type === 'number' ? 'number (Excel date serial)' : s.type}</td><td className="tnum py-1.5">{s.shown || '—'}</td><td className="tnum py-1.5 font-medium">{s.parsed ?? <span className="text-danger">not a valid month</span>}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {preview.warnings.length > 0 && (
            <Card className="p-5">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> Warnings</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              {preview.unknownReps.length > 0 && (
                <p className="mt-3 text-sm"><b>Unknown rep codes:</b> {preview.unknownReps.slice(0, 30).map((u) => `${u.code} (${u.count.toLocaleString()})`).join(', ')}{preview.unknownReps.length > 30 ? ` … +${preview.unknownReps.length - 30} more` : ''}</p>
              )}
              {preview.unknownLines.length > 0 && (
                <p className="mt-2 text-sm"><b>Unknown lines:</b> {preview.unknownLines.map((u) => `${u.name} (${u.count.toLocaleString()})`).join(', ')}</p>
              )}
            </Card>
          )}

          {parsed.errors.length > 0 && (
            <Card className="p-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><XCircle className="h-4 w-4 text-danger" aria-hidden /> Excluded rows ({parsed.errors.length.toLocaleString()})</h3>
                <Button size="sm" onClick={() => downloadCsv('excluded-rows.csv', parsed.errors.map((e) => ({ excel_row: e.excelRow, reason: e.reason })))}><Download className="h-4 w-4" aria-hidden /> CSV</Button>
              </div>
              <ul className="max-h-48 space-y-1 overflow-auto text-sm">
                {parsed.errors.slice(0, 100).map((e) => <li key={e.excelRow}><span className="tnum text-muted-foreground">Row {e.excelRow}:</span> {e.reason}</li>)}
              </ul>
              {parsed.errors.length > 100 && <p className="mt-2 text-xs text-muted-foreground">Showing the first 100; download the CSV for all.</p>}
            </Card>
          )}

          <Card className="overflow-hidden">
            <div className="border-b p-3 text-sm font-semibold">First 20 rows</div>
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-muted text-left text-xs text-muted-foreground">{preview.sample.columns.map((c) => <th key={c} className="sticky top-0 whitespace-nowrap bg-muted px-3 py-2 font-medium">{c}</th>)}</tr></thead>
                <tbody>
                  {preview.sample.rows.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">{r.map((v, j) => <td key={j} className={cn('whitespace-nowrap px-3 py-1.5', typeof v === 'number' && 'tnum text-right')}>{v ?? '—'}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex gap-2">
            <Button variant="primary" disabled={parsed.rows.length === 0} onClick={() => setStage('decide')}>Continue</Button>
            <Button onClick={reset}>Cancel — nothing has been written</Button>
          </div>
        </>
      )}

      {/* 3 — decide per month */}
      {stage === 'decide' && preview && parsed && (
        <DecideStep
          preview={preview}
          existing={existing}
          choices={choices}
          setChoices={setChoices}
          onBack={() => setStage('preview')}
          onCancel={reset}
          onConfirm={() => void startLoad()}
        />
      )}

      {/* 4 — loading */}
      {stage === 'loading' && (
        <Card className="p-6" aria-busy={!failure}>
          {failure ? (
            <div role="alert">
              <h2 className="flex items-center gap-2 text-base font-semibold text-danger"><XCircle className="h-5 w-5" aria-hidden /> Upload stopped</h2>
              <p className="mt-2 text-sm">{failure.message}</p>
              <p className="mt-1 text-sm text-muted-foreground">It stopped at: <b>{failure.where}</b>. {loadProg ? `${loadProg.done.toLocaleString()} of ${loadProg.total.toLocaleString()} rows had been sent.` : ''} Some rows may already be stored.</p>
              <div className="mt-4 flex gap-2">
                {failure.batch !== null && <Button variant="danger" onClick={() => setUndoBatch(failure.batch)}><Undo2 className="h-4 w-4" aria-hidden /> Undo this batch</Button>}
                <Button onClick={reset}>Start over</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm font-medium"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading{loadProg?.month ? ` ${monthLabel(loadProg.month)}` : ''}…</div>
              <div className="mt-3"><Progress label="Upload progress" value={loadProg && loadProg.total > 0 ? loadProg.done / loadProg.total : 0} /></div>
              <p className="tnum mt-2 text-xs text-muted-foreground">{loadProg?.done.toLocaleString()} / {loadProg?.total.toLocaleString()} rows. Please keep this tab open. Finishing rebuilds org and KPIs for each month.</p>
            </>
          )}
        </Card>
      )}

      {/* 5 — result */}
      {stage === 'result' && outcome && (
        <ResultStep outcome={outcome} onViewChanges={onViewChanges} onUndo={() => setUndoBatch(outcome.batch)} onAgain={reset} />
      )}

      {undoBatch !== null && (
        <UndoDialog
          batch={undoBatch}
          onClose={() => setUndoBatch(null)}
          onDone={() => { setUndoBatch(null); reset() }}
        />
      )}
    </div>
  )
}

function DecideStep({
  preview, existing, choices, setChoices, onBack, onCancel, onConfirm,
}: {
  preview: Preview
  existing: Map<string, number>
  choices: Record<string, Choice>
  setChoices: (c: Record<string, Choice>) => void
  onBack: () => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const dup = preview.months.filter((m) => existing.has(m.month))
  const undecided = dup.filter((m) => !choices[m.month])
  const toLoad = preview.months.filter((m) => choices[m.month] !== 'skip')
  const rows = toLoad.reduce((a, m) => a + m.rows, 0)
  const replaced = dup.filter((m) => choices[m.month] === 'replace').map((m) => monthLabel(m.month))
  return (
    <>
      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold">Decide per month</h2>
        <p className="mb-4 text-sm text-muted-foreground">New months are loaded. For months that already exist you must choose explicitly: <b>Replace</b> deletes the stored month first; <b>Skip</b> leaves it untouched.</p>
        <ul className="divide-y">
          {preview.months.map((m) => {
            const isDup = existing.has(m.month)
            return (
              <li key={m.month} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="text-sm"><span className="tnum font-medium">{monthLabel(m.month)}</span> <span className="tnum text-muted-foreground">· {m.rows.toLocaleString()} rows{isDup ? ` (stored: ${(existing.get(m.month) as number).toLocaleString()})` : ''}</span></div>
                {isDup ? (
                  <div role="radiogroup" aria-label={`Action for ${monthLabel(m.month)}`} className="flex gap-1 rounded-control bg-muted p-1">
                    {(['replace', 'skip'] as const).map((c) => (
                      <Button key={c} size="sm" role="radio" aria-checked={choices[m.month] === c} variant={choices[m.month] === c ? (c === 'replace' ? 'danger' : 'outline') : 'ghost'} onClick={() => setChoices({ ...choices, [m.month]: c })}>
                        {c === 'replace' ? 'Replace' : 'Skip'}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <Badge tone="success">New — will be loaded</Badge>
                )}
              </li>
            )
          })}
        </ul>
      </Card>
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm" role="status">
          {toLoad.length === 0 ? 'Nothing selected to load.' : <>Load <b>{toLoad.length}</b> month{toLoad.length > 1 ? 's' : ''} · <b className="tnum">{rows.toLocaleString()}</b> rows{replaced.length ? <> · replace <b>{replaced.join(', ')}</b></> : null}</>}
          {undecided.length > 0 && <span className="ml-2 text-warning">Choose Replace or Skip for {undecided.map((m) => monthLabel(m.month)).join(', ')}.</span>}
        </p>
        <div className="flex gap-2">
          <Button onClick={onBack}>Back</Button>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={undecided.length > 0 || toLoad.length === 0} onClick={onConfirm}>Confirm and load</Button>
        </div>
      </Card>
    </>
  )
}

function ResultStep({ outcome, onViewChanges, onUndo, onAgain }: { outcome: LoadOutcome; onViewChanges: (m: string) => void; onUndo: () => void; onAgain: () => void }) {
  const [counts, setCounts] = useState<Record<string, Record<ChangeType, number> | 'error'>>({})
  useEffect(() => {
    let cancelled = false
    for (const m of outcome.months) {
      fetchChangeCounts(m)
        .then((c) => !cancelled && setCounts((p) => ({ ...p, [m]: c })))
        .catch(() => !cancelled && setCounts((p) => ({ ...p, [m]: 'error' })))
    }
    return () => { cancelled = true }
  }, [outcome.months])

  const [dq, setDq] = useState<Record<DqIssue, number> | null | 'error'>(null)
  useEffect(() => {
    let cancelled = false
    fetchDqCounts(outcome.months).then((c) => !cancelled && setDq(c)).catch(() => !cancelled && setDq('error'))
    return () => { cancelled = true }
  }, [outcome.months])

  return (
    <>
      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold"><CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> Upload finished</h2>
        <dl className="mt-3 grid gap-x-8 sm:grid-cols-3">
          <div className="border-b py-1.5 text-sm"><dt className="text-muted-foreground">Loaded</dt><dd className="tnum text-xl font-semibold">{outcome.loaded.toLocaleString()}</dd></div>
          <div className="border-b py-1.5 text-sm"><dt className="text-muted-foreground">Rejected by the database</dt><dd className={cn('tnum text-xl font-semibold', outcome.rejectedCount > 0 && 'text-danger')}>{outcome.rejectedCount.toLocaleString()}</dd></div>
          <div className="border-b py-1.5 text-sm"><dt className="text-muted-foreground">Months</dt><dd className="tnum text-xl font-semibold">{outcome.months.length}</dd></div>
        </dl>
        <p className="mt-3 text-sm text-muted-foreground">Org and KPIs refreshed for {outcome.months.length} month(s). Batch #{outcome.batch}.</p>
      </Card>

      {outcome.rejectedCount > 0 && (
        <Card className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Rejected rows</h3>
            <Button size="sm" onClick={() => downloadCsv('rejected-rows.csv', outcome.rejected.map((r) => ({ excel_row: r.excelRow ?? '', reason: r.reason, row: r.context })))}><Download className="h-4 w-4" aria-hidden /> Download CSV</Button>
          </div>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Excel row</th><th className="py-1.5 font-medium">Reason</th><th className="py-1.5 font-medium">Month / rep / account / doctor</th></tr></thead>
              <tbody>
                {outcome.rejected.slice(0, 200).map((r, i) => (
                  <tr key={i} className="border-b last:border-0"><td className="tnum py-1.5 pr-4">{r.excelRow ?? '?'}</td><td className="py-1.5 pr-4">{r.reason}</td><td className="tnum py-1.5 text-muted-foreground">{r.context}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {outcome.rejected.length < outcome.rejectedCount && <p className="mt-2 text-xs text-muted-foreground">The database reports at most the first 200 rejected rows per chunk; {outcome.rejectedCount.toLocaleString()} rows were rejected in total.</p>}
        </Card>
      )}

      <Card className="p-5">
        <h3 className="mb-3 text-sm font-semibold">List changes vs previous month</h3>
        <ul className="divide-y">
          {outcome.months.map((m) => {
            const c = counts[m]
            return (
              <li key={m} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <span className="tnum text-sm font-medium">{monthLabel(m)}</span>
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  {!c ? <span className="text-muted-foreground">Loading…</span> : c === 'error' ? <span className="text-danger">Could not load changes</span> : CHANGE_TYPES.map((t) => <Badge key={t} tone={t === 'removed' ? 'danger' : t === 'added' ? 'success' : 'info'}>{CHANGE_LABEL[t]} <span className="tnum">{c[t].toLocaleString()}</span></Badge>)}
                  <Button size="sm" variant="ghost" onClick={() => onViewChanges(m)}>View details</Button>
                </span>
              </li>
            )
          })}
        </ul>
      </Card>

      <Card className="p-5">
        <h3 className="mb-1 text-sm font-semibold">Active From checks (warnings)</h3>
        <p className="mb-3 text-sm text-muted-foreground">Active From is for review only — the month is determined by the snapshot. These checks never block an upload.</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {!dq ? <span className="text-muted-foreground">Checking…</span> : dq === 'error' ? <span className="text-danger">Could not load the checks</span> : DQ_ISSUES.map((i) => <Badge key={i} tone={dq[i] > 0 ? 'warning' : 'success'}>{DQ_LABEL[i]} <span className="tnum">{dq[i].toLocaleString()}</span></Badge>)}
          <Link to={`/data-quality?month=${outcome.months[0]}`} className="ml-2 text-sm font-medium text-accent-foreground underline underline-offset-2">Open Data Quality</Link>
        </div>
      </Card>

      <div className="flex gap-2">
        <Button variant="primary" onClick={onAgain}>Upload another</Button>
        <Button variant="danger" onClick={onUndo}><Undo2 className="h-4 w-4" aria-hidden /> Undo this upload</Button>
      </div>
    </>
  )
}

export function UndoDialog({ batch, onClose, onDone }: { batch: number; onClose: () => void; onDone: () => void }) {
  return (
    <FormDialog
      open
      onOpenChange={onClose}
      onDone={onDone}
      title={`Undo upload #${batch}?`}
      description="Everything loaded by this batch will be deleted and org/KPIs refreshed for its months. Rows loaded by other batches are not touched."
      submitLabel="Undo upload"
      variant="danger"
      onSubmit={async () => {
        await rpc('undo_batch', { p_batch: batch })
        toast.info('Upload undone')
        return { message: `Batch #${batch} undone` }
      }}
    >
      <p className="text-sm text-muted-foreground">If this batch replaced an existing month, the old rows of that month are <b>not</b> restored — upload the previous file again if needed.</p>
    </FormDialog>
  )
}

