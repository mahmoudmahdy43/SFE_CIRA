import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, FileUp, Loader2, ShieldAlert, Undo2, XCircle } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Badge, Card, Progress } from '../../../components/ui/misc'
import { useAuth } from '../../../context/AuthContext'
import { fetchLines, fetchOwnerLines, type LineRef } from '../../../lib/api/visitsRaw'
import { cn } from '../../../lib/utils'
import { UndoDialog } from '../UploadWizard'
import { LoadFailure, type LoadOutcome } from '../types'
import RawActivitiesResult from '../absence/RawActivitiesResult'
import RawOfficeWorkResult from '../absence/RawOfficeWorkResult'
import { loadRawActivities } from '../absence/rawActivitiesLoad'
import { loadRawOfficeWork } from '../absence/rawOfficeWorkLoad'
import RawVisitsResult from './RawVisitsResult'
import { loadVisitsGps, type GpsOutcome } from './gpsLoad'
import type { GpsFile } from './gpsParse'
import { loadRawVisits } from './rawVisitsLoad'
import { monthsBetween, shiftOfAccType } from './rawVisitsParse'
import { buildTerritoryPlan, planMonths, type LineChoice, type SectionId } from './territoryPlan'
import { parseDroppedFile, type DroppedFile, type TerritoryReport } from './territoryParse'
import type { OwnerLineMap } from './pharmacyLines'

type Stage = 'files' | 'parsing' | 'preview' | 'decide' | 'loading' | 'result'
const STEPS: { id: Stage[]; label: string }[] = [
  { id: ['files', 'parsing'], label: 'Files' }, { id: ['preview'], label: 'Preview' }, { id: ['decide'], label: 'Replace' }, { id: ['loading'], label: 'Load' }, { id: ['result'], label: 'Result' },
]

export const TERRITORY_LABEL = 'Territory visits report (all sections) + GPS'
export const TERRITORY_DESCRIPTION = 'One Territory visits report loads its Visits, Pharmacies Visits, Office Work and Activities sections in one go (Events are ignored); the GPS report (Device Deviation) is added to the visits by their CRM ID. Drop either file or both.'

const SECTION_LABEL: Record<SectionId, string> = { visits: 'Visits', pharmacy: 'Pharmacies Visits', office_work: 'Office Work', activities: 'Activities' }

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result ?? ''))
    fr.onerror = () => reject(new Error(`Could not read ${file.name}`))
    fr.readAsText(file, 'UTF-8')
  })
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

type StepKey = 'visits' | 'office_work' | 'activities' | 'gps'
type StepResult = { key: Exclude<StepKey, 'gps'>; outcome: LoadOutcome } | { key: 'gps'; gps: GpsOutcome }
interface Step { key: StepKey; label: string; run: () => Promise<StepResult> }
interface Failure { message: string; where: string; batch: number | null; retry?: () => Promise<void> }

const fmt = (n: number) => n.toLocaleString()

export default function TerritoryWizard({ onExit }: { onExit: () => void }) {
  const { role } = useAuth()
  const [stage, setStage] = useState<Stage>('files')
  const [error, setError] = useState<string | null>(null)
  const [lines, setLines] = useState<LineRef[]>([])
  const [dropped, setDropped] = useState<DroppedFile[]>([])
  const [choice, setChoice] = useState<LineChoice>('auto')
  const [ownerMap, setOwnerMap] = useState<OwnerLineMap | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null)
  const [loadProg, setLoadProg] = useState<{ done: number; total: number; phase: string } | null>(null)
  const [results, setResults] = useState<StepResult[]>([])
  const [failure, setFailure] = useState<Failure | null>(null)
  const [undoBatch, setUndoBatch] = useState<number | null>(null)
  const batchRef = useRef<number | null>(null)
  const resultsRef = useRef<StepResult[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchLines().then(setLines).catch((e: unknown) => setError(`Could not load the lines: ${e instanceof Error ? e.message : 'unknown error'}`))
  }, [])

  const reports = useMemo(() => dropped.flatMap((d) => (d.kind === 'territory' ? [d.report] : [])), [dropped])
  const gpsFiles = useMemo(() => dropped.flatMap((d) => (d.kind === 'gps' && d.gps.fatal === null ? [d.gps] : [])), [dropped])
  const gpsRows = useMemo(() => {
    const seen = new Set<string>()
    return gpsFiles.flatMap((g) => g.rows).filter((r) => (seen.has(r.crm_id) ? false : (seen.add(r.crm_id), true)))
  }, [gpsFiles])
  const gpsRange = useMemo(() => {
    const r = gpsFiles.flatMap((g) => (g.titleRange ? [g.titleRange] : []))
    return r.length === gpsFiles.length && r.length > 0 ? { from: r.map((x) => x.from).sort()[0], to: r.map((x) => x.to).sort().reverse()[0] } : null
  }, [gpsFiles])
  const plan = useMemo(() => buildTerritoryPlan(reports, choice, ownerMap), [reports, choice, ownerMap])
  const months = useMemo(() => planMonths(plan), [plan])
  // Rows per line and section, as they will be sent.
  const perLine = useMemo(() => {
    const m = new Map<number, Record<SectionId, number>>()
    const add = (line: number | null, s: SectionId, n: number) => {
      if (line === null) return
      const r = m.get(line) ?? { visits: 0, pharmacy: 0, office_work: 0, activities: 0 }
      r[s] += n
      m.set(line, r)
    }
    for (const f of plan.visits?.files ?? []) add(f.line, f.pharmacy ? 'pharmacy' : 'visits', f.file.rows.length)
    for (const f of plan.officeWork?.files ?? []) add(f.line, 'office_work', f.file.rows.length)
    for (const f of plan.activities?.files ?? []) add(f.line, 'activities', f.file.rows.length)
    return [...m].sort((a, b) => a[0] - b[0])
  }, [plan])

  const lineName = (id: number | null) => lines.find((l) => l.id === id)?.name ?? '—'

  if (role !== 'admin') {
    return <Card className="p-6"><p className="flex items-center gap-2 text-sm"><ShieldAlert className="h-4 w-4" aria-hidden /> The Territory visits upload is for administrators only.</p></Card>
  }

  const reset = () => {
    setStage('files'); setError(null); setDropped([]); setChoice('auto'); setOwnerMap(null); setProgress(null); setLoadProg(null); setResults([]); setFailure(null)
    batchRef.current = null
    resultsRef.current = []
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
      const out: DroppedFile[] = []
      for (let i = 0; i < picked.length; i++) {
        setProgress({ done: i, total: picked.length, name: picked[i].name })
        await tick()
        out.push(parseDroppedFile(picked[i].name, await readText(picked[i])))
      }
      const days = out.flatMap((d) => (d.kind === 'territory' ? reportDays(d.report) : []))
      if (days.length > 0) {
        days.sort()
        setOwnerMap(await fetchOwnerLines(monthsBetween(days[0], days[days.length - 1])))
      } else setOwnerMap(null)
      setProgress({ done: picked.length, total: picked.length, name: '' })
      setDropped(out)
      setChoice('auto')
      setStage('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the files')
      setStage('files')
    }
  }

  const buildSteps = (): Step[] => {
    const steps: Step[] = []
    const onBatch = (id: number) => { batchRef.current = id }
    const prog = (label: string) => (p: { done: number; total: number; phase?: string }) => setLoadProg({ done: p.done, total: p.total, phase: `${label}${p.phase ? ` — ${p.phase}` : ''}` })
    if (plan.visits) {
      const v = plan.visits
      steps.push({
        key: 'visits', label: 'Visits and pharmacies',
        run: async () => ({
          key: 'visits',
          outcome: await loadRawVisits({
            files: v.files.filter((f) => f.file.rows.length > 0).map((f) => ({ name: f.file.name, lineId: f.line as number, rows: f.file.rows, rowNumbers: f.file.rowNumbers })),
            clears: v.plan.perLine, months: v.plan.months, onProgress: prog('Visits'), onBatch,
          }),
        }),
      })
    }
    if (plan.officeWork) {
      const o = plan.officeWork
      steps.push({
        key: 'office_work', label: 'Office Work',
        run: async () => ({
          key: 'office_work',
          outcome: await loadRawOfficeWork({
            files: o.files.map((f) => ({ name: f.file.name, lineId: f.line as number, rows: f.file.rows, rowNumbers: f.file.rowNumbers })),
            clears: o.plan.perLine.map((c) => ({ lineName: lineName(c.line), lineId: c.line, from: c.from, to: c.to })),
            months: o.plan.months, onProgress: prog('Office Work'), onBatch,
          }),
        }),
      })
    }
    if (plan.activities) {
      const a = plan.activities
      steps.push({
        key: 'activities', label: 'Activities',
        run: async () => ({
          key: 'activities',
          outcome: await loadRawActivities({
            files: a.files.map((f) => ({ name: f.file.name, lineId: f.line as number, rows: f.file.rows, rowNumbers: f.file.rowNumbers })),
            clears: a.plan.perLine.map((c) => ({ lineName: lineName(c.line), lineId: c.line, from: c.from, to: c.to })),
            months: a.plan.months, onProgress: prog('Activities'), onBatch,
          }),
        }),
      })
    }
    if (gpsRows.length > 0) {
      steps.push({
        key: 'gps', label: 'GPS',
        run: async () => ({ key: 'gps', gps: await loadVisitsGps({ rows: gpsRows, from: gpsRange?.from ?? null, to: gpsRange?.to ?? null, onProgress: (done, total) => setLoadProg({ done, total, phase: 'GPS — adding coordinates to the visits' }) }) }),
      })
    }
    return steps
  }

  /** Runs the steps in order from `i` (the visits must be loaded before the GPS finds them). `first` re-runs the failed finishing step. */
  const runFrom = async (steps: Step[], i: number, first?: () => Promise<LoadOutcome>): Promise<void> => {
    for (let k = i; k < steps.length; k++) {
      setFailure(null)
      try {
        const res: StepResult = k === i && first ? { key: steps[k].key as Exclude<StepKey, 'gps'>, outcome: await first() } : await steps[k].run()
        resultsRef.current = [...resultsRef.current, res]
      } catch (e) {
        const f = e instanceof LoadFailure ? e : null
        const retryFinish = f?.retry
        // A GPS load is idempotent, so it may simply be run again; the other sections only retry their finishing step.
        const retry = retryFinish ? () => runFrom(steps, k, retryFinish) : steps[k].key === 'gps' ? () => runFrom(steps, k) : undefined
        setFailure({ message: e instanceof Error ? e.message : 'Upload failed', where: `${steps[k].label}: ${f?.where ?? 'unknown step'}`, batch: f?.batch ?? batchRef.current, retry })
        return
      }
    }
    setResults(resultsRef.current)
    setStage('result')
  }

  const start = async () => {
    setStage('loading')
    setFailure(null)
    resultsRef.current = []
    batchRef.current = null
    const steps = buildSteps()
    setLoadProg({ done: 0, total: 1, phase: 'Starting' })
    await runFrom(steps, 0)
  }

  const stepIndex = STEPS.findIndex((s) => s.id.includes(stage))
  const hasWork = !!(plan.visits || plan.officeWork || plan.activities || gpsRows.length > 0)
  const sentRows = (plan.visits?.plan.rows ?? 0) + (plan.officeWork?.plan.rows ?? 0) + (plan.activities?.plan.rows ?? 0)
  const warnings: string[] = []
  for (const d of dropped) {
    if (d.kind === 'unknown') warnings.push(d.reason)
    if (d.kind === 'gps' && d.gps.fatal) warnings.push(d.gps.fatal)
  }
  for (const rep of reports) {
    for (const t of rep.ignored) if (!t.startsWith('Events')) warnings.push(`${rep.name} — ${t}`)
    for (const f of [rep.clinic, rep.pharmacy]) {
      if (!f) continue
      const sec = f === rep.clinic ? 'Visits' : 'Pharmacies Visits'
      const bad = f.accTypes.filter((t) => shiftOfAccType(t.type) === null)
      if (bad.length > 0) warnings.push(`${sec}: Acc. Type ${bad.map((t) => `${t.type || '(blank)'} (${fmt(t.rows)})`).join(', ')} is outside A, H, AM, PC, C, P — the database will reject those rows.`)
      if (f.errors.length > 0) warnings.push(`${sec}: ${fmt(f.errors.length)} row(s) without a valid visit date are left out.`)
      if (f.shortRows > 0) warnings.push(`${sec}: ${fmt(f.shortRows)} row(s) did not match the expected layout and were ignored.`)
      const noOwner = f.rows.filter((r) => r.owner === '').length
      if (noOwner > 0) warnings.push(`${sec}: ${fmt(noOwner)} row(s) have no owner in Members — the database will reject them.`)
    }
    for (const [sec, f] of [['Office Work', rep.officeWork], ['Activities', rep.activities]] as const) {
      if (!f) continue
      if (f.errors.length > 0) warnings.push(`${sec}: ${fmt(f.errors.length)} row(s) without a valid date are left out.`)
      if (f.noMembers > 0) warnings.push(`${sec}: ${fmt(f.noMembers)} row(s) have no member and will be rejected.`)
    }
  }
  warnings.push(...(plan.visits?.plan.overlaps ?? []), ...(plan.officeWork?.plan.overlaps ?? []), ...(plan.activities?.plan.overlaps ?? []))
  if (choice === 'auto' && plan.unresolved.length > 0) {
    const bySection = new Map<SectionId, number>()
    for (const u of plan.unresolved) bySection.set(u.section, (bySection.get(u.section) ?? 0) + u.rows)
    for (const [s, n] of bySection) warnings.push(`${SECTION_LABEL[s]}: ${fmt(n)} row(s) belong to people with no line in the master data for their month: they will NOT be sent (list below).`)
  }
  for (const g of gpsFiles) {
    if (g.noCoords > 0) warnings.push(`${g.name}: ${fmt(g.noCoords)} visit(s) have no readable coordinates and are left out.`)
    if (g.duplicates > 0) warnings.push(`${g.name}: ${fmt(g.duplicates)} visit ID(s) appear more than once; the first is kept.`)
  }
  if (gpsRows.length > 0 && !gpsRange) warnings.push('The GPS file has no “From … To …” in its title: the coverage report will be skipped.')

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
          <h2 className="text-base font-semibold">Upload visits — {TERRITORY_LABEL}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{TERRITORY_DESCRIPTION}</p>
          <label
            htmlFor="territory-files"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files) }}
            className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-6 py-10 text-center hover:bg-muted"
          >
            <FileUp className="h-6 w-6 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">Drop the Territory visits report and, optionally, the GPS report here, or click to choose</span>
            <span className="text-xs text-muted-foreground">Each file is recognised by its columns. The GPS is added after the visits are loaded. Read in your browser; only parsed rows are sent.</span>
            <input ref={inputRef} id="territory-files" type="file" multiple accept=".xls,.html,.htm,.txt" className="sr-only" onChange={(e) => void onFiles(e.target.files)} />
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
            <h2 className="mb-3 text-sm font-semibold">Files</h2>
            <ul className="space-y-1.5 text-sm">
              {dropped.map((d, i) => (
                <li key={`${d.name}-${i}`} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{d.name}</span>
                  {d.kind === 'territory' && <Badge tone="info">Territory visits report</Badge>}
                  {d.kind === 'gps' && d.gps.fatal === null && <Badge tone="info">GPS report</Badge>}
                  {(d.kind === 'unknown' || (d.kind === 'gps' && d.gps.fatal !== null)) && <Badge tone="warning">Not used</Badge>}
                  <span className="tnum text-xs text-muted-foreground">{fileRange(d)}</span>
                </li>
              ))}
            </ul>
          </Card>

          {reports.length > 0 && (
            <>
              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold">Line</h2>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    aria-label="Line"
                    value={choice}
                    onChange={(e) => setChoice(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}
                    className="h-9 min-w-[220px] rounded-control border bg-card px-3 text-sm"
                  >
                    <option value="auto">Auto (by owner / member)</option>
                    {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  <span className="text-sm text-muted-foreground">{choice === 'auto' ? 'Each row goes to the line its owner (or first known member) belongs to in the month of the row.' : 'Every row of every section goes to this line.'}</span>
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold">Sections in the report</h2>
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Section</th><th className="py-1 text-right font-medium">Rows in file</th><th className="py-1 text-right font-medium">Rows sent</th><th className="py-1 pl-4 font-medium">Dates</th></tr></thead>
                  <tbody>
                    {sectionRows(reports, plan).map((s) => (
                      <tr key={s.label} className="border-b last:border-0">
                        <td className="py-1">{s.label}</td>
                        <td className="tnum py-1 text-right">{fmt(s.inFile)}</td>
                        <td className={cn('tnum py-1 text-right', s.sent < s.inFile && 'text-warning')}>{fmt(s.sent)}</td>
                        <td className="tnum py-1 pl-4">{s.range ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {months.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Months touched: {months.map((m) => m.slice(0, 7)).join(', ')}.</p>}
              </Card>

              {perLine.length > 0 && (
                <Card className="p-5">
                  <h3 className="mb-2 text-sm font-semibold">Rows per line</h3>
                  <table className="w-full text-sm">
                    <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Line</th><th className="py-1 text-right font-medium">Visits</th><th className="py-1 text-right font-medium">Pharmacies</th><th className="py-1 text-right font-medium">Office Work</th><th className="py-1 text-right font-medium">Activities</th></tr></thead>
                    <tbody>
                      {perLine.map(([line, r]) => (
                        <tr key={line} className="border-b last:border-0"><td className="py-1">{lineName(line)}</td><td className="tnum py-1 text-right">{fmt(r.visits)}</td><td className="tnum py-1 text-right">{fmt(r.pharmacy)}</td><td className="tnum py-1 text-right">{fmt(r.office_work)}</td><td className="tnum py-1 text-right">{fmt(r.activities)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}

              {choice === 'auto' && plan.unresolved.length > 0 && <UnresolvedList items={plan.unresolved} />}
            </>
          )}

          {gpsFiles.length > 0 && <GpsPreview files={gpsFiles} total={gpsRows.length} />}

          {warnings.length > 0 && (
            <Card className="p-5">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> Warnings</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">{[...new Set(warnings)].map((w) => <li key={w}>{w}</li>)}</ul>
            </Card>
          )}

          <div className="flex gap-2">
            <Button variant="primary" disabled={!hasWork} onClick={() => setStage('decide')}>Continue</Button>
            <Button onClick={reset}>Cancel — nothing has been written</Button>
            {!hasWork && <span className="self-center text-sm text-warning">Nothing to load.</span>}
          </div>
        </>
      )}

      {stage === 'decide' && (
        <>
          <Card className="p-5">
            <h2 className="mb-2 text-sm font-semibold">Replace confirmation</h2>
            {plan.visits && ([false, true] as const).map((ph) => {
              const cl = plan.visits!.plan.perLine.filter((c) => c.pharmacy === ph)
              if (cl.length === 0) return null
              return <ClearNote key={String(ph)} label={ph ? 'Pharmacy visits' : 'Clinic visits'} items={cl.map((c) => ({ line: lineName(c.line), from: c.from, to: c.to }))} />
            })}
            {plan.officeWork && <ClearNote label="Office Work" items={plan.officeWork.plan.perLine.map((c) => ({ line: lineName(c.line), from: c.from, to: c.to }))} />}
            {plan.activities && <ClearNote label="Activities" items={plan.activities.plan.perLine.map((c) => ({ line: lineName(c.line), from: c.from, to: c.to }))} />}
            <p className="mt-2 text-sm text-muted-foreground">Each section is replaced on its own; the others are not touched.</p>
            {gpsRows.length > 0 && <p className="mt-2 text-sm">GPS: <b className="tnum">{fmt(gpsRows.length)}</b> visit(s) get their coordinates by CRM ID, after the visits above are loaded. Nothing is deleted and loading the same file again gives the same result.</p>}
          </Card>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm" role="status">Load <b className="tnum">{fmt(sentRows)}</b> row{sentRows === 1 ? '' : 's'}{gpsRows.length > 0 ? <> and GPS for <b className="tnum">{fmt(gpsRows.length)}</b> visits</> : null} · process {months.length} month{months.length === 1 ? '' : 's'}.</p>
            <div className="flex gap-2">
              <Button onClick={() => setStage('preview')}>Back</Button>
              <Button onClick={reset}>Cancel</Button>
              <Button variant="danger" onClick={() => void start()}>{sentRows > 0 ? 'Confirm: replace and load' : 'Confirm: load GPS'}</Button>
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
              <p className="mt-1 text-sm text-muted-foreground">It stopped at: <b>{failure.where}</b>. {resultsRef.current.length > 0 ? `Already finished: ${resultsRef.current.map((r) => r.key.replace('_', ' ')).join(', ')} (kept).` : ''} Some rows may already be stored.</p>
              <div className="mt-4 flex gap-2">
                {failure.retry && <Button variant="primary" onClick={() => void failure.retry!()}>Retry</Button>}
                {failure.batch !== null && <Button variant={failure.retry ? 'outline' : 'danger'} onClick={() => setUndoBatch(failure.batch)}><Undo2 className="h-4 w-4" aria-hidden /> Undo this batch</Button>}
                <Button variant={failure.retry ? 'outline' : undefined} onClick={reset}>Start over</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm font-medium"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {loadProg?.phase ?? 'Loading'}…</div>
              <div className="mt-3"><Progress label="Upload progress" value={loadProg && loadProg.total > 0 ? loadProg.done / loadProg.total : 0} /></div>
              <p className="tnum mt-2 text-xs text-muted-foreground">{loadProg?.done.toLocaleString()} / {loadProg?.total.toLocaleString()}. Please keep this tab open. The sections load one after the other.</p>
            </>
          )}
        </Card>
      )}

      {stage === 'result' && (
        <>
          {results.map((r) => (
            <div key={r.key} className="space-y-3">
              <Card className="p-5">
                <h2 className="flex items-center gap-2 text-base font-semibold"><CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> {r.key === 'gps' ? 'GPS' : r.key === 'visits' ? 'Visits and pharmacies' : r.key === 'office_work' ? 'Office Work' : 'Activities'} — finished</h2>
                {r.key !== 'gps' && (
                  <>
                    <dl className="mt-3 grid gap-x-8 sm:grid-cols-3">
                      <div className="border-b py-1.5 text-sm"><dt className="text-muted-foreground">Loaded</dt><dd className="tnum text-xl font-semibold">{fmt(r.outcome.loaded)}</dd></div>
                      <div className="border-b py-1.5 text-sm"><dt className="text-muted-foreground">Rejected by the database</dt><dd className={cn('tnum text-xl font-semibold', r.outcome.rejectedCount > 0 && 'text-danger')}>{fmt(r.outcome.rejectedCount)}</dd></div>
                      <div className="border-b py-1.5 text-sm"><dt className="text-muted-foreground">Months</dt><dd className="tnum text-xl font-semibold">{r.outcome.months.length}</dd></div>
                    </dl>
                    <p className="mt-3 text-sm text-muted-foreground">{r.outcome.months.map((m) => m.slice(0, 7)).join(', ')}. Batch #{r.outcome.batch}.</p>
                  </>
                )}
                {r.key === 'gps' && <GpsResult gps={r.gps} />}
              </Card>
              {r.key === 'visits' && <RawVisitsResult outcome={r.outcome} onViewChanges={() => undefined} showLinks={!!plan.visits?.files.some((f) => !f.pharmacy)} />}
              {r.key === 'office_work' && <RawOfficeWorkResult outcome={r.outcome} />}
              {r.key === 'activities' && <RawActivitiesResult outcome={r.outcome} />}
              {r.key !== 'gps' && <div><Button variant="danger" onClick={() => setUndoBatch(r.outcome.batch)}><Undo2 className="h-4 w-4" aria-hidden /> Undo this section (batch #{r.outcome.batch})</Button></div>}
            </div>
          ))}
          {choice === 'auto' && plan.unresolved.length > 0 && <UnresolvedList items={plan.unresolved} />}
          <div className="flex gap-2"><Button variant="primary" onClick={reset}>Upload more</Button></div>
        </>
      )}

      {undoBatch !== null && <UndoDialog batch={undoBatch} onClose={() => setUndoBatch(null)} onDone={() => { setUndoBatch(null); reset() }} />}
    </div>
  )
}

/** Every date a report mentions: its title range and the dates of its rows (to know which months to look the owners up for). */
function reportDays(r: TerritoryReport): string[] {
  const days: string[] = []
  if (r.titleRange) days.push(r.titleRange.from, r.titleRange.to)
  for (const f of [r.clinic, r.pharmacy]) for (const x of f?.rows ?? []) days.push(x.visit_date)
  for (const x of r.officeWork?.rows ?? []) days.push(x.day)
  for (const x of r.activities?.rows ?? []) days.push(x.day)
  return days
}

function fileRange(d: DroppedFile): string {
  if (d.kind === 'territory') return d.report.titleRange ? `${d.report.titleRange.from} → ${d.report.titleRange.to}` : ''
  if (d.kind === 'gps') return d.gps.titleRange ? `${d.gps.titleRange.from} → ${d.gps.titleRange.to}` : ''
  return ''
}

function sectionRows(reports: TerritoryReport[], plan: ReturnType<typeof buildTerritoryPlan>) {
  const range = (a: string[]) => { const s = [...a].sort(); return s.length ? `${s[0]} → ${s[s.length - 1]}` : null }
  const sentOf = (files: { line: number | null; pharmacy?: boolean; file: { rows: unknown[] } }[], pharmacy?: boolean) =>
    files.filter((f) => pharmacy === undefined || !!f.pharmacy === pharmacy).reduce((a, f) => a + f.file.rows.length, 0)
  const out: { label: string; inFile: number; sent: number; range: string | null }[] = []
  const clinic = reports.flatMap((r) => (r.clinic ? [r.clinic] : []))
  const pharmacy = reports.flatMap((r) => (r.pharmacy ? [r.pharmacy] : []))
  const ow = reports.flatMap((r) => (r.officeWork ? [r.officeWork] : []))
  const act = reports.flatMap((r) => (r.activities ? [r.activities] : []))
  if (clinic.length) out.push({ label: 'Visits', inFile: clinic.reduce((a, f) => a + f.rows.length, 0), sent: sentOf(plan.visits?.files ?? [], false), range: range(clinic.flatMap((f) => f.rows.map((r) => r.visit_date))) })
  if (pharmacy.length) out.push({ label: 'Pharmacies Visits', inFile: pharmacy.reduce((a, f) => a + f.rows.length, 0), sent: sentOf(plan.visits?.files ?? [], true), range: range(pharmacy.flatMap((f) => f.rows.map((r) => r.visit_date))) })
  if (ow.length) out.push({ label: 'Office Work', inFile: ow.reduce((a, f) => a + f.rows.length, 0), sent: sentOf(plan.officeWork?.files ?? []), range: range(ow.flatMap((f) => f.rows.map((r) => r.day))) })
  if (act.length) out.push({ label: 'Activities', inFile: act.reduce((a, f) => a + f.rows.length, 0), sent: sentOf(plan.activities?.files ?? []), range: range(act.flatMap((f) => f.rows.map((r) => r.day))) })
  return out
}

function ClearNote({ label, items }: { label: string; items: { line: string; from: string; to: string }[] }) {
  return (
    <div className="mb-3">
      <p className="text-sm"><b>{label}</b> already uploaded for these lines and dates will be <b className="text-danger">REPLACED</b>:</p>
      <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">{items.map((c) => <li key={`${c.line}-${c.from}`}>{c.line}: <span className="tnum">{c.from} → {c.to}</span></li>)}</ul>
    </div>
  )
}

function GpsPreview({ files, total }: { files: GpsFile[]; total: number }) {
  const sum = (f: (g: GpsFile) => number) => files.reduce((a, g) => a + f(g), 0)
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-semibold">GPS report</h2>
      <dl className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Visit IDs in the file', fmt(sum((g) => g.visitRows))],
          ['With coordinates (sent)', fmt(total)],
          ['With a numeric deviation', fmt(total - sum((g) => g.nanDeviation))],
          ['Without coordinates (left out)', fmt(sum((g) => g.noCoords))],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between border-b py-1.5 text-sm"><dt className="text-muted-foreground">{k}</dt><dd className="tnum font-medium">{v}</dd></div>
        ))}
      </dl>
    </Card>
  )
}

function GpsResult({ gps }: { gps: GpsOutcome }) {
  return (
    <>
      <dl className="mt-3 grid gap-x-8 sm:grid-cols-4">
        {[['IDs sent', gps.ids], ['Matched', gps.matched], ['Unmatched', gps.unmatched], ['Rows updated', gps.rowsUpdated]].map(([k, v]) => (
          <div key={k as string} className="border-b py-1.5 text-sm"><dt className="text-muted-foreground">{k}</dt><dd className={cn('tnum text-xl font-semibold', k === 'Unmatched' && (v as number) > 0 && 'text-danger')}>{fmt(v as number)}</dd></div>
        ))}
      </dl>
      {gps.unmatchedSample.length > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">Unmatched IDs (sample — load the visits of that month first): <span className="tnum">{gps.unmatchedSample.join(', ')}</span></p>
      )}
      {gps.coverage.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1 font-medium">Month</th><th className="py-1 text-right font-medium">Visits</th><th className="py-1 text-right font-medium">With GPS</th><th className="py-1 text-right font-medium">Coverage</th></tr></thead>
          <tbody>
            {gps.coverage.map((c) => (
              <tr key={c.month} className="border-b last:border-0"><td className="py-1">{String(c.month).slice(0, 7)}</td><td className="tnum py-1 text-right">{fmt(c.visits)}</td><td className="tnum py-1 text-right">{fmt(c.with_gps)}</td><td className="tnum py-1 text-right">{c.pct === null ? '—' : `${Number(c.pct).toFixed(1)}%`}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function UnresolvedList({ items }: { items: { section: SectionId; owner: string; rows: number }[] }) {
  return (
    <Card className="p-5">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> People without a line ({fmt(items.length)})</h3>
      <p className="mb-3 text-sm text-muted-foreground">They are not in the master data for the month of their rows, so those rows are not sent. Fix the master data and upload the file again, or pick the line by hand.</p>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Section</th><th className="py-1.5 font-medium">Name</th><th className="py-1.5 text-right font-medium">Rows</th></tr></thead>
        <tbody>{items.map((u) => <tr key={`${u.section}|${u.owner}`} className="border-b last:border-0"><td className="py-1.5">{SECTION_LABEL[u.section]}</td><td className="py-1.5">{u.owner}</td><td className="tnum py-1.5 text-right">{fmt(u.rows)}</td></tr>)}</tbody>
      </table>
    </Card>
  )
}
