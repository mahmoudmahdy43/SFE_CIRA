import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, FileUp, Loader2, ShieldAlert, Undo2, XCircle } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Badge, Card, Progress } from '../../../components/ui/misc'
import { useAuth } from '../../../context/AuthContext'
import { fetchLines, fetchOwnerLines, type LineRef } from '../../../lib/api/visitsRaw'
import { normName } from '../../../lib/norm'
import { cn } from '../../../lib/utils'
import { UndoDialog } from '../UploadWizard'
import { LoadFailure, type LoadOutcome } from '../types'
import RawVisitsResult from './RawVisitsResult'
import { loadRawVisits } from './rawVisitsLoad'
import { guessLineNumber, monthsBetween, parseRawVisitsFile, planRawUpload, effectiveRange, shiftOfAccType, type PlannedFile } from './rawVisitsParse'
import { expandAutoFiles, summarizeByLine, type OwnerLineMap } from './pharmacyLines'

type Stage = 'files' | 'parsing' | 'preview' | 'decide' | 'loading' | 'result'
const STEPS: { id: Stage[]; label: string }[] = [
  { id: ['files', 'parsing'], label: 'Files' }, { id: ['preview'], label: 'Preview' }, { id: ['decide'], label: 'Replace' }, { id: ['loading'], label: 'Load' }, { id: ['result'], label: 'Result' },
]

export const RAW_VISITS_LABEL = 'Raw CRM files'
export const RAW_VISITS_DESCRIPTION = 'The c_L_M.xls files straight from the CRM (HTML saved as .xls): clinics and pharmacies, several files at once. Owner, doctor and shift are resolved by the database. A pharmacy file (all rows Acc. Type P) covers all lines: its line is taken from each visit owner.'

/** FileReader.readAsText, UTF-8 — the files are not real Excel. */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result ?? ''))
    fr.onerror = () => reject(new Error(`Could not read ${file.name}`))
    fr.readAsText(file, 'UTF-8')
  })
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

export default function RawVisitsWizard({ onExit }: { onExit: () => void }) {
  const { role } = useAuth()
  const [stage, setStage] = useState<Stage>('files')
  const [error, setError] = useState<string | null>(null)
  const [lines, setLines] = useState<LineRef[]>([])
  const [files, setFiles] = useState<PlannedFile[]>([])
  const [ownerMap, setOwnerMap] = useState<OwnerLineMap | null>(null)
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

  // Auto pharmacy files are split into one file per owner line; owners without a line are listed and not sent.
  const expanded = useMemo(() => expandAutoFiles(files, ownerMap), [files, ownerMap])
  const plan = useMemo(() => planRawUpload(expanded.files), [expanded.files])
  const usable = expanded.files.filter((f) => f.file.rows.length > 0)
  const pharmacyLines = useMemo(() => summarizeByLine(expanded.files.filter((f) => f.pharmacy)), [expanded.files])
  const hasAuto = files.some((f) => f.auto)
  const clinicIncluded = usable.some((f) => !f.pharmacy)
  const lineName = (id: number | null) => lines.find((l) => l.id === id)?.name ?? '—'

  if (role !== 'admin') {
    return <Card className="p-6"><p className="flex items-center gap-2 text-sm"><ShieldAlert className="h-4 w-4" aria-hidden /> The raw CRM visits upload is for administrators only.</p></Card>
  }

  const reset = () => {
    setStage('files'); setError(null); setFiles([]); setOwnerMap(null); setProgress(null); setLoadProg(null); setOutcome(null); setFailure(null)
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
      const out: PlannedFile[] = []
      for (let i = 0; i < picked.length; i++) {
        setProgress({ done: i, total: picked.length, name: picked[i].name })
        await tick()
        const parsed = parseRawVisitsFile(picked[i].name, await readText(picked[i]))
        const guess = guessLineNumber(picked[i].name)
        const line = parsed.pharmacy || guess === null ? null : known.find((l) => normName(l.name) === `cira ${guess}`)?.id ?? null
        out.push({ file: parsed, line, pharmacy: parsed.pharmacy, auto: parsed.pharmacy })
      }
      const autoDays = out.filter((f) => f.auto).flatMap((f) => f.file.rows.map((r) => r.visit_date)).sort()
      if (autoDays.length > 0) setOwnerMap(await fetchOwnerLines(monthsBetween(autoDays[0], autoDays[autoDays.length - 1])))
      setProgress({ done: picked.length, total: picked.length, name: '' })
      setFiles(out)
      setStage('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the files')
      setStage('files')
    }
  }

  /** A pharmacy file keeps the Auto option; picking a line forces it. */
  const setLine = (i: number, id: number | 'auto' | null) => setFiles((fs) => fs.map((f, k) => (k === i ? { ...f, line: id === 'auto' ? null : id, auto: id === 'auto' } : f)))
  const missingLine = files.some((f) => f.file.rows.length > 0 && !f.auto && f.line === null)

  const start = async () => {
    if (!plan.from || !plan.to) return
    setStage('loading')
    setFailure(null)
    setLoadProg({ done: 0, total: plan.rows, month: '' })
    await run(() => loadRawVisits({
      files: usable.map((f) => ({ name: f.file.name, lineId: f.line as number, rows: f.file.rows, rowNumbers: f.file.rowNumbers })),
      clears: plan.perLine, months: plan.months, onProgress: setLoadProg, onBatch: (id) => { batchRef.current = id },
    }))
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
  const retry = async () => {
    const r = failure?.retry
    if (!r) return
    setFailure(null)
    await run(r)
  }

  const stepIndex = STEPS.findIndex((s) => s.id.includes(stage))
  const warnings: string[] = [...plan.overlaps]
  if (hasAuto && expanded.unresolved.length > 0) warnings.push(`${expanded.unresolved.reduce((a, u) => a + u.rows, 0).toLocaleString()} pharmacy row(s) of ${expanded.unresolved.length} owner(s) have no line in the master data for their month: they will NOT be sent (list below).`)
  for (const f of files) {
    if (f.file.rows.length === 0) warnings.push(`${f.file.name}: no visit rows found — is this a CRM visits file? It is left out of the upload.`)
    const bad = f.file.accTypes.filter((t) => t.shift === null)
    if (bad.length > 0) warnings.push(`${f.file.name}: Acc. Type ${bad.map((t) => `${t.type || '(blank)'} (${t.rows.toLocaleString()})`).join(', ')} is outside A, H, AM, PC, C, P — the database will reject those rows as “unknown account type”.`)
    if (f.file.errors.length > 0) warnings.push(`${f.file.name}: ${f.file.errors.length.toLocaleString()} row(s) without a valid visit date are left out.`)
    if (f.file.shortRows > 0) warnings.push(`${f.file.name}: ${f.file.shortRows.toLocaleString()} row(s) did not match the clinic (17+ cells) or pharmacy (16 cells) layout and were ignored.`)
    if (f.file.rows.some((r) => r.owner === '')) warnings.push(`${f.file.name}: ${f.file.rows.filter((r) => r.owner === '').length.toLocaleString()} row(s) have no owner in Members — the database will reject them.`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={onExit} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> All upload types</button>
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
          <h2 className="text-base font-semibold">Upload visits — {RAW_VISITS_LABEL}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{RAW_VISITS_DESCRIPTION}</p>
          <label
            htmlFor="raw-visits-files"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files) }}
            className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-6 py-10 text-center hover:bg-muted"
          >
            <FileUp className="h-6 w-6 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">Drop the CRM visit files here (c_1_10.xls, p_2_10.xls …), or click to choose</span>
            <span className="text-xs text-muted-foreground">Select all files at once. You choose the line of each file in the next step. Read in your browser; only parsed rows are sent.</span>
            <input ref={inputRef} id="raw-visits-files" type="file" multiple accept=".xls,.html,.htm,.txt" className="sr-only" onChange={(e) => void onFiles(e.target.files)} />
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
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Preview</h2>
            <dl className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Files', usable.length.toLocaleString()],
                ['Rows', plan.rows.toLocaleString()],
                ['Date range', plan.from && plan.to ? `${plan.from} → ${plan.to}` : '—'],
                ['Months touched', plan.months.length ? plan.months.map((m) => m.slice(0, 7)).join(', ') : '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between border-b py-1.5 text-sm"><dt className="text-muted-foreground">{k}</dt><dd className="tnum font-medium">{v}</dd></div>
              ))}
            </dl>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {files.map((f, i) => {
              const range = effectiveRange(f.file)
              return (
                <Card key={`${f.file.name}-${i}`} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold">{f.file.name}</h3>
                      <p className="tnum text-xs text-muted-foreground">{range ? `${range.from} → ${range.to}` : 'no dates found'}</p>
                    </div>
                    {f.file.pharmacy && <Badge tone="info">Pharmacy file</Badge>}
                    {f.file.rows.length > 0 && !f.auto && f.line === null && <Badge tone="warning">Choose a line</Badge>}
                  </div>
                  <div className="mt-3">
                    <label htmlFor={`line-${i}`} className="mb-1 block text-xs font-medium">Line <span className="text-danger" aria-hidden>*</span></label>
                    <select id={`line-${i}`} required value={f.auto ? 'auto' : f.line ?? ''} onChange={(e) => setLine(i, e.target.value === 'auto' ? 'auto' : e.target.value ? Number(e.target.value) : null)} className="h-9 w-full rounded-control border bg-card px-3 text-sm">
                      {f.file.pharmacy ? <option value="auto">Auto (by owner)</option> : <option value="">Select a line…</option>}
                      {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </div>
                  <dl className="mt-3 grid grid-cols-4 gap-2 text-sm">
                    {[['Rows', f.file.rows.length], ['Single', f.file.single], ['Double', f.file.double], ['Owners', f.file.owners]].map(([k, v]) => (
                      <div key={k as string}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="tnum font-semibold">{(v as number).toLocaleString()}</dd></div>
                    ))}
                  </dl>
                  {f.file.accTypes.length > 0 && (
                    <table className="mt-3 w-full text-sm">
                      <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Acc. Type</th><th className="py-1 text-right font-medium">Rows</th><th className="py-1 pl-4 font-medium">Shift</th></tr></thead>
                      <tbody>
                        {f.file.accTypes.map((t) => (
                          <tr key={t.type} className="border-b last:border-0">
                            <td className="py-1">{t.type || '(blank)'}</td>
                            <td className="tnum py-1 text-right">{t.rows.toLocaleString()}</td>
                            <td className="py-1 pl-4">{shiftOfAccType(t.type) ?? <span className="text-danger">unknown — rejected</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              )
            })}
          </div>

          {pharmacyLines.length > 0 && (
            <Card className="p-5">
              <h3 className="mb-2 text-sm font-semibold">Pharmacy visits per line</h3>
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Line</th><th className="py-1 text-right font-medium">Rows</th><th className="py-1 text-right font-medium">Single</th><th className="py-1 text-right font-medium">Double</th><th className="py-1 text-right font-medium">Owners</th><th className="py-1 pl-4 font-medium">Dates</th></tr></thead>
                <tbody>
                  {pharmacyLines.map((l) => (
                    <tr key={l.line} className="border-b last:border-0"><td className="py-1">{lineName(l.line)}</td><td className="tnum py-1 text-right">{l.rows.toLocaleString()}</td><td className="tnum py-1 text-right">{l.single.toLocaleString()}</td><td className="tnum py-1 text-right">{l.double.toLocaleString()}</td><td className="tnum py-1 text-right">{l.owners.toLocaleString()}</td><td className="tnum py-1 pl-4">{l.from} → {l.to}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {hasAuto && <UnresolvedOwners items={expanded.unresolved} />}

          {warnings.length > 0 && (
            <Card className="p-5">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> Warnings</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </Card>
          )}

          <div className="flex gap-2">
            <Button variant="primary" disabled={usable.length === 0 || missingLine || !plan.from} onClick={() => setStage('decide')}>Continue</Button>
            <Button onClick={reset}>Cancel — nothing has been written</Button>
            {missingLine && <span className="self-center text-sm text-warning">Choose a line for every file.</span>}
          </div>
        </>
      )}

      {stage === 'decide' && plan.from && plan.to && (
        <>
          <Card className="p-5">
            <h2 className="mb-2 text-sm font-semibold">Replace confirmation</h2>
            {[false, true].map((ph) => {
              const cl = plan.perLine.filter((c) => c.pharmacy === ph)
              if (cl.length === 0) return null
              const from = cl.reduce((m, c) => (c.from < m ? c.from : m), cl[0].from)
              const to = cl.reduce((m, c) => (c.to > m ? c.to : m), cl[0].to)
              return (
                <div key={String(ph)} className="mb-3">
                  <p className="text-sm">
                    {ph ? 'Pharmacy' : 'Clinic'} visits already uploaded from raw files for <b>{cl.map((c) => lineName(c.line)).join(', ')}</b> between <b className="tnum">{from}</b> and <b className="tnum">{to}</b> will be <b className="text-danger">REPLACED</b>. {ph ? 'Clinic visits are not touched.' : 'Clinic visits only; pharmacy visits are not touched.'} Other lines are not affected.
                  </p>
                  {cl.length > 1 && (
                    <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
                      {cl.map((c) => <li key={c.line}>{lineName(c.line)}: <span className="tnum">{c.from} → {c.to}</span></li>)}
                    </ul>
                  )}
                </div>
              )
            })}
            <p className="mt-2 text-sm text-muted-foreground">Loading: {usable.map((f) => `${f.file.name} → ${lineName(f.line)}`).join('; ')}.</p>
          </Card>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm" role="status">Load <b className="tnum">{plan.rows.toLocaleString()}</b> rows from {usable.length} file{usable.length === 1 ? '' : 's'} · process {plan.months.length} month{plan.months.length === 1 ? '' : 's'}.</p>
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
              <p className="mt-1 text-sm text-muted-foreground">It stopped at: <b>{failure.where}</b>. {loadProg ? `${loadProg.done.toLocaleString()} of ${loadProg.total.toLocaleString()} rows had been sent.` : ''} Some rows may already be stored.</p>
              <div className="mt-4 flex gap-2">
                {failure.retry && <Button variant="primary" onClick={() => void retry()}>Retry this month</Button>}
                {failure.batch !== null && <Button variant={failure.retry ? 'outline' : 'danger'} onClick={() => setUndoBatch(failure.batch)}><Undo2 className="h-4 w-4" aria-hidden /> Undo this batch</Button>}
                <Button variant={failure.retry ? 'outline' : undefined} onClick={reset}>Start over</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm font-medium"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {loadProg?.phase ?? 'Loading'}…</div>
              <div className="mt-3"><Progress label="Upload progress" value={loadProg && loadProg.total > 0 ? loadProg.done / loadProg.total : 0} /></div>
              <p className="tnum mt-2 text-xs text-muted-foreground">{loadProg?.done.toLocaleString()} / {loadProg?.total.toLocaleString()}. Please keep this tab open. Finishing matches visits and rebuilds KPIs for each month.</p>
            </>
          )}
        </Card>
      )}

      {stage === 'result' && outcome && (
        <>
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold"><CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> Upload finished</h2>
            <dl className="mt-3 grid gap-x-8 sm:grid-cols-3">
              <div className="border-b py-1.5 text-sm"><dt className="text-muted-foreground">Loaded</dt><dd className="tnum text-xl font-semibold">{outcome.loaded.toLocaleString()}</dd></div>
              <div className="border-b py-1.5 text-sm"><dt className="text-muted-foreground">Rejected by the database</dt><dd className={cn('tnum text-xl font-semibold', outcome.rejectedCount > 0 && 'text-danger')}>{outcome.rejectedCount.toLocaleString()}</dd></div>
              <div className="border-b py-1.5 text-sm"><dt className="text-muted-foreground">Months</dt><dd className="tnum text-xl font-semibold">{outcome.months.length}</dd></div>
            </dl>
            <p className="mt-3 text-sm text-muted-foreground">{outcome.months.map((m) => m.slice(0, 7)).join(', ')}. Batch #{outcome.batch}.</p>
          </Card>
          {hasAuto && <UnresolvedOwners items={expanded.unresolved} />}
          <RawVisitsResult outcome={outcome} onViewChanges={() => undefined} showLinks={clinicIncluded} />
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

/** Pharmacy owners with no line for their month: not sent; fix the master data and upload the file again. */
function UnresolvedOwners({ items }: { items: { owner: string; rows: number }[] }) {
  if (items.length === 0) return null
  return (
    <Card className="p-5">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> Owners without a line ({items.length.toLocaleString()})</h3>
      <p className="mb-3 text-sm text-muted-foreground">These owners are not in the master data for the month of their visits (reps / managers in the organisation), so their pharmacy rows were not sent. Fix the master data and upload the file again.</p>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Owner</th><th className="py-1.5 text-right font-medium">Rows</th></tr></thead>
        <tbody>{items.map((u) => <tr key={u.owner} className="border-b last:border-0"><td className="py-1.5">{u.owner}</td><td className="tnum py-1.5 text-right">{u.rows.toLocaleString()}</td></tr>)}</tbody>
      </table>
    </Card>
  )
}
