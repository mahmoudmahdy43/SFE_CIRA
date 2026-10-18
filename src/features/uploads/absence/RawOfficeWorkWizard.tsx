import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, FileUp, Loader2, ShieldAlert, Undo2, XCircle } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Badge, Card, Progress } from '../../../components/ui/misc'
import { useAuth } from '../../../context/AuthContext'
import { fetchLines, type LineRef } from '../../../lib/api/visitsRaw'
import { normName } from '../../../lib/norm'
import { cn } from '../../../lib/utils'
import { UndoDialog } from '../UploadWizard'
import { LoadFailure, type LoadOutcome } from '../types'
import RawOfficeWorkResult from './RawOfficeWorkResult'
import { loadRawOfficeWork } from './rawOfficeWorkLoad'
import { guessOfficeWorkLine, parseRawOfficeWorkFile, planRawOfficeWork, type PlannedOfficeWorkFile, type Tally } from './rawOfficeWorkParse'

type Stage = 'files' | 'parsing' | 'preview' | 'decide' | 'loading' | 'result'
const STEPS: { id: Stage[]; label: string }[] = [
  { id: ['files', 'parsing'], label: 'Files' }, { id: ['preview'], label: 'Preview' }, { id: ['decide'], label: 'Replace' }, { id: ['loading'], label: 'Load' }, { id: ['result'], label: 'Result' },
]

export const RAW_OFFICE_WORK_LABEL = 'Raw CRM file'
export const RAW_OFFICE_WORK_DESCRIPTION = 'The Actual Visits Report export with an Office Work section (HTML saved as .xls). You choose the line of each file; people are matched by name, one office-work row per person.'

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result ?? ''))
    fr.onerror = () => reject(new Error(`Could not read ${file.name}`))
    fr.readAsText(file, 'UTF-8')
  })
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

function TallyList({ title, items }: { title: string; items: Tally[] }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold text-muted-foreground">{title}</h4>
      <ul className="space-y-0.5 text-sm">
        {items.map((t) => <li key={t.key} className="flex justify-between gap-3"><span className="truncate">{t.key}</span><span className="tnum">{t.rows.toLocaleString()}</span></li>)}
      </ul>
    </div>
  )
}

export default function RawOfficeWorkWizard({ onExit }: { onExit: () => void }) {
  const { role } = useAuth()
  const [stage, setStage] = useState<Stage>('files')
  const [error, setError] = useState<string | null>(null)
  const [lines, setLines] = useState<LineRef[]>([])
  const [files, setFiles] = useState<PlannedOfficeWorkFile[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null)
  const [loadProg, setLoadProg] = useState<{ done: number; total: number; month: string; phase?: string } | null>(null)
  const [outcome, setOutcome] = useState<LoadOutcome | null>(null)
  const [failure, setFailure] = useState<{ message: string; where: string; batch: number | null; retry?: () => Promise<LoadOutcome> } | null>(null)
  const [undoBatch, setUndoBatch] = useState<number | null>(null)
  const batchRef = useRef<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchLines().then(setLines).catch((e: unknown) => setError(`Could not load the lines: ${e instanceof Error ? e.message : 'unknown error'}`))
  }, [])

  const usable = files.filter((f) => !f.file.fatal && f.file.rows.length > 0)
  const plan = useMemo(() => planRawOfficeWork(usable), [usable])
  const lineName = (id: number | null) => lines.find((l) => l.id === id)?.name ?? '—'
  const missingLine = usable.some((f) => f.line === null)

  if (role !== 'admin') {
    return <Card className="p-6"><p className="flex items-center gap-2 text-sm"><ShieldAlert className="h-4 w-4" aria-hidden /> The raw CRM office work upload is for administrators only.</p></Card>
  }

  const reset = () => {
    setStage('files'); setError(null); setFiles([]); setProgress(null); setLoadProg(null); setOutcome(null); setFailure(null)
    batchRef.current = null
    if (inputRef.current) inputRef.current.value = ''
  }

  const onFiles = async (list: FileList | File[] | null) => {
    const picked = list ? [...list] : []
    if (picked.length === 0) return
    setError(null)
    setStage('parsing')
    try {
      const known = lines.length > 0 ? lines : await fetchLines()
      setLines(known)
      const out: PlannedOfficeWorkFile[] = []
      for (let i = 0; i < picked.length; i++) {
        setProgress({ done: i, total: picked.length, name: picked[i].name })
        await tick()
        const file = parseRawOfficeWorkFile(picked[i].name, await readText(picked[i]))
        const guess = guessOfficeWorkLine(picked[i].name)
        out.push({ file, line: guess === null ? null : known.find((l) => normName(l.name) === `cira ${guess}`)?.id ?? null })
      }
      setFiles(out)
      setStage('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the files')
      setStage('files')
    }
  }

  const run = async (fn: () => Promise<LoadOutcome>) => {
    try {
      setOutcome(await fn())
      setStage('result')
    } catch (e) {
      const f = e instanceof LoadFailure ? e : null
      setFailure({ message: e instanceof Error ? e.message : 'Upload failed', where: f?.where ?? 'unknown step', batch: f?.batch ?? batchRef.current, retry: f?.retry })
    }
  }
  const start = async () => {
    setStage('loading')
    setFailure(null)
    setLoadProg({ done: 0, total: plan.rows, month: '' })
    await run(() => loadRawOfficeWork({
      files: usable.map((f) => ({ name: f.file.name, lineId: f.line as number, rows: f.file.rows, rowNumbers: f.file.rowNumbers })),
      clears: plan.perLine.map((p) => ({ lineName: lineName(p.line), lineId: p.line, from: p.from, to: p.to })),
      months: plan.months, onProgress: setLoadProg, onBatch: (id) => { batchRef.current = id },
    }))
  }
  const retry = async () => {
    const r = failure?.retry
    if (!r) return
    setFailure(null)
    await run(r)
  }

  const stepIndex = STEPS.findIndex((s) => s.id.includes(stage))
  const warnings: string[] = [...plan.overlaps]
  for (const { file: f } of usable) {
    if (f.visitRows > 0) warnings.push(`${f.name}: also has ${f.visitRows.toLocaleString()} visit rows in its Visits section — ignored here; load them with the Visits upload.`)
    if (f.errors.length > 0) warnings.push(`${f.name}: ${f.errors.length.toLocaleString()} row(s) without a valid date are left out.`)
    if (f.shortRows > 0) warnings.push(`${f.name}: ${f.shortRows.toLocaleString()} row(s) with too few cells were ignored.`)
    if (f.noMembers > 0) warnings.push(`${f.name}: ${f.noMembers.toLocaleString()} office-work row${f.noMembers === 1 ? " has" : "s have"} no members — the database will reject them.`)
    if (!f.titleRange) warnings.push(`${f.name}: no “From … To …” range in the caption; the Dates of the rows are used.`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={onExit} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> Back</button>
        <ol className="flex items-center gap-2 text-xs" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s.label} aria-current={i === stepIndex ? 'step' : undefined} className={cn('flex items-center gap-1.5', i === stepIndex ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
              <span className={cn('flex h-5 w-5 items-center justify-center rounded-full border text-[10px]', i < stepIndex && 'border-success bg-success-soft text-success', i === stepIndex && 'border-primary bg-primary text-primary-foreground')}>{i < stepIndex ? '✓' : i + 1}</span>
              {s.label}
              {i < STEPS.length - 1 && <span aria-hidden className="mx-1 h-px w-4 bg-border" />}
            </li>
          ))}
        </ol>
      </div>

      {error && <div role="alert" className="whitespace-pre-line rounded-control bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}

      {stage === 'files' && (
        <Card className="p-6">
          <h2 className="text-base font-semibold">Upload office work — {RAW_OFFICE_WORK_LABEL}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{RAW_OFFICE_WORK_DESCRIPTION}</p>
          <label
            htmlFor="raw-office-work-files"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files) }}
            className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-6 py-10 text-center hover:bg-muted"
          >
            <FileUp className="h-6 w-6 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">Drop the CRM Office Work file(s) here, or click to choose</span>
            <span className="text-xs text-muted-foreground">You choose the line of each file in the next step. Read in your browser; only parsed rows are sent.</span>
            <input ref={inputRef} id="raw-office-work-files" type="file" multiple accept=".xls,.html,.htm,.txt" className="sr-only" onChange={(e) => void onFiles(e.target.files)} />
          </label>
        </Card>
      )}

      {stage === 'parsing' && (
        <Card className="p-6" aria-busy="true">
          <div className="flex items-center gap-2 text-sm font-medium"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading files…</div>
          <div className="mt-3"><Progress label="Parsing progress" value={progress && progress.total > 0 ? progress.done / progress.total : 0.05} /></div>
          <p className="tnum mt-2 text-xs text-muted-foreground">{progress?.name} {progress ? `(${progress.done} / ${progress.total})` : ''}</p>
        </Card>
      )}

      {stage === 'preview' && (
        <>
          {files.filter((f) => f.file.fatal).map((f) => <div key={f.file.name} role="alert" className="rounded-control bg-danger-soft px-4 py-3 text-sm text-danger">{f.file.fatal}</div>)}
          <div className="grid gap-4 lg:grid-cols-2">
            {files.flatMap((p, i) => (p.file.fatal ? [] : [(
              <Card key={p.file.name + i} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">{p.file.name}</h3>
                    <p className="tnum text-xs text-muted-foreground">{p.file.titleRange ? `${p.file.titleRange.from} → ${p.file.titleRange.to}` : 'no range in the caption'} · {p.file.rows.length.toLocaleString()} rows · {p.file.people.toLocaleString()} people</p>
                  </div>
                  {p.line === null && <Badge tone="warning">Choose a line</Badge>}
                </div>
                <div className="mt-3">
                  <label htmlFor={`line-${i}`} className="mb-1 block text-xs font-medium">Line <span className="text-danger" aria-hidden>*</span></label>
                  <select id={`line-${i}`} required value={p.line ?? ''} onChange={(e) => setFiles((fs) => fs.map((x, k) => (k === i ? { ...x, line: e.target.value ? Number(e.target.value) : null } : x)))} className="h-9 w-full rounded-control border bg-card px-3 text-sm">
                    <option value="">Select a line…</option>
                    {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-4">
                  <TallyList title="Per type" items={p.file.byType} /><TallyList title="Per shift" items={p.file.byShift} />
                </div>
              </Card>
            )])) }
          </div>
          {warnings.length > 0 && (
            <Card className="p-5">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> Warnings</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </Card>
          )}
          <div className="flex gap-2">
            <Button variant="primary" disabled={usable.length === 0 || missingLine} onClick={() => setStage('decide')}>Continue</Button>
            <Button onClick={reset}>Cancel — nothing has been written</Button>
            {missingLine && <span className="self-center text-sm text-warning">Choose a line for every file.</span>}
          </div>
        </>
      )}

      {stage === 'decide' && (
        <>
          <Card className="p-5">
            <h2 className="mb-2 text-sm font-semibold">Replace confirmation</h2>
            <ul className="space-y-1.5 text-sm">
              {plan.perLine.map((p) => (
                <li key={p.line}>Office Work of <b>{lineName(p.line)}</b> between <b className="tnum">{p.from}</b> and <b className="tnum">{p.to}</b> will be <b className="text-danger">REPLACED</b>. Other lines are not affected.</li>
              ))}
            </ul>
            <p className="tnum mt-3 text-xs text-muted-foreground">Months refreshed afterwards: {plan.months.map((m) => m.slice(0, 7)).join(', ')}.</p>
          </Card>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm" role="status">Load <b className="tnum">{plan.rows.toLocaleString()}</b> office-work rows from {usable.length} file{usable.length === 1 ? '' : 's'}.</p>
            <div className="flex gap-2">
              <Button onClick={() => setStage('preview')}>Back</Button>
              <Button onClick={reset}>Cancel</Button>
              <Button variant="danger" onClick={() => void start()}>Confirm: replace and load</Button>
            </div>
          </Card>
        </>
      )}

      {stage === 'loading' && (
        <Card className="p-6" aria-busy={!failure}>
          {failure ? (
            <div role="alert">
              <h2 className="flex items-center gap-2 text-base font-semibold text-danger"><XCircle className="h-5 w-5" aria-hidden /> Upload stopped</h2>
              <p className="mt-2 text-sm">{failure.message}</p>
              <p className="mt-1 text-sm text-muted-foreground">It stopped at: <b>{failure.where}</b>. Some rows may already be stored.</p>
              <div className="mt-4 flex gap-2">
                {failure.retry && <Button variant="primary" onClick={() => void retry()}>Retry this step</Button>}
                {failure.batch !== null && <Button variant={failure.retry ? 'outline' : 'danger'} onClick={() => setUndoBatch(failure.batch)}><Undo2 className="h-4 w-4" aria-hidden /> Undo this batch</Button>}
                <Button variant={failure.retry ? 'outline' : undefined} onClick={reset}>Start over</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm font-medium"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {loadProg?.phase ?? 'Loading'}…</div>
              <div className="mt-3"><Progress label="Upload progress" value={loadProg && loadProg.total > 0 ? loadProg.done / loadProg.total : 0} /></div>
              <p className="tnum mt-2 text-xs text-muted-foreground">{loadProg?.done.toLocaleString()} / {loadProg?.total.toLocaleString()}. Please keep this tab open.</p>
            </>
          )}
        </Card>
      )}

      {stage === 'result' && outcome && (
        <>
          <h2 className="flex items-center gap-2 text-base font-semibold"><CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> Upload finished</h2>
          <RawOfficeWorkResult outcome={outcome} />
          <div className="flex gap-2">
            <Button variant="primary" onClick={reset}>Upload more</Button>
            <Button variant="danger" onClick={() => setUndoBatch(outcome.batch)}><Undo2 className="h-4 w-4" aria-hidden /> Undo this upload</Button>
          </div>
        </>
      )}

      {undoBatch !== null && <UndoDialog batch={undoBatch} onClose={() => setUndoBatch(null)} onDone={() => { setUndoBatch(null); reset() }} />}
    </div>
  )
}
