import { useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, FileUp, Loader2, Undo2, XCircle } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Badge, Card, Progress } from '../../../components/ui/misc'
import { fetchSalesMonths } from '../../../lib/api/sales'
import { cn } from '../../../lib/utils'
import { UndoDialog } from '../UploadWizard'
import { LoadFailure, type LoadOutcome } from '../types'
import { loadSales } from './salesLoad'
import { groupByMonth, parseSalesFile, targetMatches, valueMatches, type MonthGroup, type SalesCheck, type SalesFile, type SalesRow } from './salesParse'
import SalesResultPanel from './SalesResultPanel'

type Stage = 'files' | 'parsing' | 'preview' | 'decide' | 'loading' | 'result'
type Choice = 'replace' | 'skip'
const STEPS: { id: Stage[]; label: string }[] = [
  { id: ['files', 'parsing'], label: 'Files' }, { id: ['preview'], label: 'Preview' }, { id: ['decide'], label: 'Months' }, { id: ['loading'], label: 'Load' }, { id: ['result'], label: 'Result' },
]
const fmt = (v: number | null) => (v === null ? '—' : Math.round(v).toLocaleString('en-US'))

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result ?? ''))
    fr.onerror = () => reject(new Error(`Could not read ${file.name}`))
    fr.readAsText(file, 'UTF-8')
  })
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

export const SALES_LABEL = 'Sales'
export const SALES_DESCRIPTION = 'Monthly sales and targets by line, territory and product: three files per month (CIRA 1, 2, 3). Feeds the Sales report.'

export default function SalesUploadWizard({ onExit }: { onExit: () => void }) {
  const [stage, setStage] = useState<Stage>('files')
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<SalesFile[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null)
  const [existing, setExisting] = useState<Map<string, number>>(new Map())
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [override, setOverride] = useState(false)
  const [loadProg, setLoadProg] = useState<{ done: number; total: number; month: string; phase?: string } | null>(null)
  const [outcome, setOutcome] = useState<LoadOutcome | null>(null)
  const [failure, setFailure] = useState<{ message: string; where: string; batch: number | null; retry?: () => Promise<LoadOutcome> } | null>(null)
  const [undoBatch, setUndoBatch] = useState<number | null>(null)
  const batchRef = useRef<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const plan = useRef<{ rows: SalesRow[]; checks: SalesCheck[]; replace: string[]; name: string } | null>(null)

  const reset = () => {
    setStage('files'); setError(null); setFiles([]); setProgress(null); setChoices({}); setOverride(false); setLoadProg(null); setOutcome(null); setFailure(null)
    batchRef.current = null
    if (inputRef.current) inputRef.current.value = ''
  }

  const onFiles = async (list: FileList | File[] | null) => {
    const picked = list ? [...list] : []
    if (picked.length === 0) return
    setError(null)
    setStage('parsing')
    try {
      const out: SalesFile[] = []
      for (let i = 0; i < picked.length; i++) {
        setProgress({ done: i, total: picked.length, name: picked[i].name })
        await tick()
        out.push(parseSalesFile(picked[i].name, await readText(picked[i])))
      }
      setProgress({ done: picked.length, total: picked.length, name: '' })
      const ex = new Map<string, number>()
      for (const m of await fetchSalesMonths()) ex.set(m.month, (ex.get(m.month) ?? 0) + m.rows)
      setFiles(out)
      setExisting(ex)
      setChoices({})
      setOverride(false)
      setStage('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the files')
      setStage('files')
    }
  }

  const valid = files.filter((f) => f.errors.length === 0)
  const { groups, duplicates } = groupByMonth(files)
  const incomplete = groups.filter((g) => g.missing.length > 0)
  const mismatched = valid.filter((f) => !valueMatches(f) || !targetMatches(f))
  const monthIso = (g: MonthGroup) => `${g.month}-01`

  const start = async () => {
    const chosen = groups.filter((g) => choices[monthIso(g)] !== 'skip')
    const rows = chosen.flatMap((g) => g.files.flatMap((f) => f.rows))
    const checks = chosen.flatMap((g) => g.files.flatMap((f) => (f.check ? [f.check] : [])))
    plan.current = {
      rows, checks, replace: chosen.filter((g) => choices[monthIso(g)] === 'replace').map(monthIso),
      name: chosen.flatMap((g) => g.files.map((f) => f.name)).join(', ').slice(0, 250),
    }
    setStage('loading')
    setFailure(null)
    setLoadProg({ done: 0, total: rows.length, month: '' })
    await run(() => loadSales({
      fileName: plan.current!.name, rows, checks, replaceMonths: plan.current!.replace, onProgress: setLoadProg, onBatch: (id) => { batchRef.current = id },
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
  const dup = groups.filter((g) => existing.has(monthIso(g)))
  const undecided = dup.filter((g) => !choices[monthIso(g)])
  const toLoad = groups.filter((g) => choices[monthIso(g)] !== 'skip')
  const loadRows = toLoad.reduce((a, g) => a + g.rows, 0)

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
          <h2 className="text-base font-semibold">Upload {SALES_LABEL}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{SALES_DESCRIPTION}</p>
          <label
            htmlFor="sales-files"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files) }}
            className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-6 py-10 text-center hover:bg-muted"
          >
            <FileUp className="h-6 w-6 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">Drop the sales files here (3 per month), or click to choose</span>
            <span className="text-xs text-muted-foreground">Select all files of one or more months at once. Month and line are read from the file content. Read in your browser; only parsed rows are sent.</span>
            <input ref={inputRef} id="sales-files" type="file" multiple className="sr-only" onChange={(e) => void onFiles(e.target.files)} />
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
          <Card className="overflow-hidden">
            <div className="border-b p-3 text-sm font-semibold">Files ({files.length})</div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted text-left text-xs text-muted-foreground">
                    {['File', 'Line', 'Month', 'Territories', 'Products', 'Rows', 'File value (EGP)', 'Parsed value', 'File target', 'Parsed target', 'Check'].map((h, i) => <th key={h} className={cn('whitespace-nowrap px-3 py-2 font-medium', i >= 3 && 'text-right')}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => {
                    const bad = f.errors.length > 0
                    const ok = !bad && valueMatches(f) && targetMatches(f)
                    return (
                      <tr key={f.name} className="border-t align-top">
                        <td className="whitespace-nowrap px-3 py-1.5 font-medium">{f.name}{(bad || f.warnings.length > 0) && <ul className="mt-1 space-y-0.5 text-xs font-normal text-danger">{f.errors.map((e) => <li key={e} className="max-w-xs whitespace-normal">{e}</li>)}{f.warnings.map((e) => <li key={e} className="max-w-xs whitespace-normal text-warning">{e}</li>)}</ul>}</td>
                        <td className="px-3 py-1.5">{f.line ?? '—'}</td>
                        <td className="tnum px-3 py-1.5">{f.month ?? '—'}</td>
                        <td className="tnum px-3 py-1.5 text-right">{f.territories.toLocaleString()}</td>
                        <td className="tnum px-3 py-1.5 text-right">{f.products.toLocaleString()}</td>
                        <td className="tnum px-3 py-1.5 text-right">{f.rows.length.toLocaleString()}</td>
                        <td className="tnum px-3 py-1.5 text-right">{fmt(f.check?.s_value ?? null)}</td>
                        <td className="tnum px-3 py-1.5 text-right">{fmt(f.sumValue)}</td>
                        <td className="tnum px-3 py-1.5 text-right">{fmt(f.check?.t_value ?? null)}</td>
                        <td className="tnum px-3 py-1.5 text-right">{fmt(f.sumTarget)}</td>
                        <td className="px-3 py-1.5">
                          {bad ? <span className="inline-flex items-center gap-1 text-danger"><XCircle className="h-4 w-4" aria-hidden /> Error</span>
                            : ok ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-4 w-4" aria-hidden /> Match</span>
                            : <span className="inline-flex items-center gap-1 text-danger"><AlertTriangle className="h-4 w-4" aria-hidden /> Differs</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">Months</h3>
            {groups.length === 0 ? <p className="text-sm text-muted-foreground">No valid file to load.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Month</th><th className="py-1.5 font-medium">Files</th><th className="py-1.5 text-right font-medium">Rows in files</th><th className="py-1.5 text-right font-medium">Rows stored now</th><th className="py-1.5 pl-4 font-medium">State</th></tr></thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.month} className="border-b last:border-0">
                      <td className="tnum py-1.5">{g.month}</td>
                      <td className="py-1.5">{g.missing.length === 0 ? <Badge tone="success">3 of 3</Badge> : <Badge tone="warning">{3 - g.missing.length} of 3 — missing {g.missing.map((n) => `CIRA ${n}`).join(', ')}</Badge>}</td>
                      <td className="tnum py-1.5 text-right">{g.rows.toLocaleString()}</td>
                      <td className="tnum py-1.5 text-right">{existing.has(monthIso(g)) ? (existing.get(monthIso(g)) as number).toLocaleString() : '—'}</td>
                      <td className="py-1.5 pl-4">{existing.has(monthIso(g)) ? <Badge tone="warning">Already loaded</Badge> : <Badge tone="success">New</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {(incomplete.length > 0 || mismatched.length > 0 || duplicates.length > 0 || files.some((f) => f.errors.length > 0)) && (
            <Card className="p-5">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> Warnings</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {files.some((f) => f.errors.length > 0) && <li>Files with an error are left out of the upload.</li>}
                {incomplete.map((g) => <li key={g.month}>{g.month}: {g.missing.map((n) => `CIRA ${n}`).join(', ')} {g.missing.length > 1 ? 'are' : 'is'} missing — each month needs 3 files.</li>)}
                {mismatched.map((f) => <li key={f.name}>{f.name}: the company row total differs from the sum of the parsed rows by more than the tolerance (the larger of 5 EGP and 0.05% of the file total).</li>)}
                {duplicates.map((d) => <li key={d}>{d}</li>)}
              </ul>
              {incomplete.length > 0 && (
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                  Load the incomplete months anyway (their line totals will be partial)
                </label>
              )}
            </Card>
          )}

          <div className="flex gap-2">
            <Button variant="primary" disabled={groups.length === 0 || (incomplete.length > 0 && !override)} onClick={() => setStage('decide')}>Continue</Button>
            <Button onClick={reset}>Cancel — nothing has been written</Button>
          </div>
        </>
      )}

      {stage === 'decide' && (
        <>
          <Card className="p-5">
            <h2 className="mb-1 text-sm font-semibold">Decide per month</h2>
            <p className="mb-4 text-sm text-muted-foreground">New months are loaded. For months that already exist you must choose: <b>Replace</b> deletes the stored month first; <b>Skip</b> leaves it untouched.</p>
            <ul className="divide-y">
              {groups.map((g) => {
                const iso = monthIso(g)
                const isDup = existing.has(iso)
                return (
                  <li key={g.month} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <div className="text-sm"><span className="tnum font-medium">{g.month}</span> <span className="tnum text-muted-foreground">· {g.rows.toLocaleString()} rows{isDup ? ` (stored: ${(existing.get(iso) as number).toLocaleString()})` : ''}</span></div>
                    {isDup ? (
                      <div role="radiogroup" aria-label={`Action for ${g.month}`} className="flex gap-1 rounded-control bg-muted p-1">
                        {(['replace', 'skip'] as const).map((c) => (
                          <Button key={c} size="sm" role="radio" aria-checked={choices[iso] === c} variant={choices[iso] === c ? (c === 'replace' ? 'danger' : 'outline') : 'ghost'} onClick={() => setChoices({ ...choices, [iso]: c })}>
                            {c === 'replace' ? 'Replace' : 'Skip'}
                          </Button>
                        ))}
                      </div>
                    ) : <Badge tone="success">New — will be loaded</Badge>}
                  </li>
                )
              })}
            </ul>
          </Card>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm" role="status">
              {toLoad.length === 0 ? 'Nothing selected to load.' : <>Load <b>{toLoad.length}</b> month{toLoad.length > 1 ? 's' : ''} · <b className="tnum">{loadRows.toLocaleString()}</b> rows{dup.some((g) => choices[monthIso(g)] === 'replace') ? <> · replace <b>{dup.filter((g) => choices[monthIso(g)] === 'replace').map((g) => g.month).join(', ')}</b></> : null}</>}
              {undecided.length > 0 && <span className="ml-2 text-warning">Choose Replace or Skip for {undecided.map((g) => g.month).join(', ')}.</span>}
            </p>
            <div className="flex gap-2">
              <Button onClick={() => setStage('preview')}>Back</Button>
              <Button onClick={reset}>Cancel</Button>
              <Button variant="primary" disabled={undecided.length > 0 || toLoad.length === 0} onClick={() => void start()}>Confirm and load</Button>
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
                {failure.retry && <Button variant="primary" onClick={() => void retry()}>Retry this step</Button>}
                {failure.batch !== null && <Button variant={failure.retry ? 'outline' : 'danger'} onClick={() => setUndoBatch(failure.batch)}><Undo2 className="h-4 w-4" aria-hidden /> Undo this batch</Button>}
                <Button variant={failure.retry ? 'outline' : undefined} onClick={reset}>Start over</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm font-medium"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {loadProg?.phase ?? 'Loading'}{loadProg?.month ? ` ${loadProg.month.slice(0, 7)}` : ''}…</div>
              <div className="mt-3"><Progress label="Upload progress" value={loadProg && loadProg.total > 0 ? loadProg.done / loadProg.total : 0} /></div>
              <p className="tnum mt-2 text-xs text-muted-foreground">{loadProg?.done.toLocaleString()} / {loadProg?.total.toLocaleString()}. Please keep this tab open.</p>
            </>
          )}
        </Card>
      )}

      {stage === 'result' && outcome && (
        <>
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold"><CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> Upload finished</h2>
            <p className="mt-2 text-sm text-muted-foreground">{outcome.months.length} month(s): {outcome.months.map((m) => m.slice(0, 7)).join(', ')}. Batch #{outcome.batch}.</p>
          </Card>
          <SalesResultPanel outcome={outcome} onViewChanges={() => undefined} />
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
