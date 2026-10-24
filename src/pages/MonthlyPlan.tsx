import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarRange, CheckCircle2, FileSpreadsheet, Lock, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorBoundary } from '../components/app/ErrorBoundary'
import { EmptyState, ErrorState, PageHeader } from '../components/app/states'
import { Button } from '../components/ui/button'
import { Card, Input, Skeleton } from '../components/ui/misc'
import { BacktestPanel } from '../features/plan/BacktestPanel'
import { downloadPlanWorkbook } from '../features/plan/planExport'
import { DEFAULT_PARAMS, MAX_PER_DAY, generatePlan, type PlanDoctor, type PlanInputs, type PlanParams, type PlanRow, type PlanSummary } from '../features/plan/planner'
import { useAsync } from '../features/dashboard/useAsync'
import {
  addPlanRequest, approvePlan, deletePlanRequest, fetchPlanInputs, fetchPlanReps, fetchPlanRequests, fetchSavedPlan, savePlan,
  type PlanRep, type PlanRequest, type SavedPlan,
} from '../lib/api/plan'
import { cn } from '../lib/utils'

const LOGO = `${import.meta.env.BASE_URL}assets/cira-logo.png`
const SELECT = 'h-9 rounded-control border bg-card px-2 text-sm text-foreground'
const KIND_LABEL = { activity: 'Activity', training: 'Training', other: 'Other' } as const
const SHIFT_LABEL = { AM: 'AM', PM: 'PM', FULL: 'Full day' } as const

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
const dayName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Failed')

interface Working { rows: PlanRow[]; summary: PlanSummary | null; params: PlanParams; dirty: boolean }

/* ------------------------------ requests ------------------------------ */
function RequestsSection({ rep, month, requests, locked, onChanged }: { rep: number; month: string; requests: PlanRequest[]; locked: boolean; onChanged: () => void }) {
  const [day, setDay] = useState('')
  const [kind, setKind] = useState<PlanRequest['kind']>('activity')
  const [shift, setShift] = useState<PlanRequest['shift']>('PM')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10)
  const add = async () => {
    if (!day) return
    setBusy(true)
    try {
      await addPlanRequest(rep, month, { day, kind, shift, note: note.trim() === '' ? null : note.trim() })
      setNote('')
      onChanged()
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id: number) => {
    try { await deletePlanRequest(id); onChanged() } catch (e) { toast.error(errText(e)) }
  }
  return (
    <Card className="p-4">
      <h2 className="text-base font-semibold">Requests</h2>
      <p className="mt-1 text-xs text-muted-foreground">Days the rep cannot visit. PM and Full day close that PM day; AM does not affect the plan. Holidays and registered leaves close automatically.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input type="date" aria-label="Request day" className="h-9 w-40" min={month} max={last} value={day} disabled={locked} onChange={(e) => setDay(e.target.value)} />
        <select aria-label="Type" className={SELECT} value={kind} disabled={locked} onChange={(e) => setKind(e.target.value as PlanRequest['kind'])}>
          {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="Shift" className={SELECT} value={shift} disabled={locked} onChange={(e) => setShift(e.target.value as PlanRequest['shift'])}>
          {Object.entries(SHIFT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <Input aria-label="Note" placeholder="Note" className="h-9 w-56" value={note} disabled={locked} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
        <Button disabled={busy || locked || !day} onClick={() => void add()}><Plus className="h-4 w-4" aria-hidden /> Add</Button>
      </div>
      {requests.length > 0 && (
        <table className="mt-3 w-full max-w-3xl text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th className="py-1 text-left">Day</th><th className="py-1 text-left">Type</th><th className="py-1 text-left">Shift</th><th className="py-1 text-left">Note</th><th /></tr></thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="py-1.5">{r.day} <span className="text-muted-foreground">{dayName(r.day)}</span></td>
                <td>{KIND_LABEL[r.kind]}</td>
                <td>{SHIFT_LABEL[r.shift]}{r.shift === 'AM' && <span className="ml-1 text-xs text-muted-foreground">(no effect)</span>}</td>
                <td>{r.note ?? ''}</td>
                <td className="text-right"><button aria-label="Delete request" disabled={locked} className="rounded-control p-1 text-muted-foreground hover:bg-muted disabled:opacity-40" onClick={() => void remove(r.id)}><Trash2 className="h-4 w-4" aria-hidden /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

/* ------------------------------ warnings ------------------------------ */
type Tone = 'red' | 'green' | 'yellow' | 'grey'
const TONE: Record<Tone, string> = { red: 'border-red-300 bg-red-50 text-red-900', green: 'border-green-300 bg-green-50 text-green-900', yellow: 'border-amber-300 bg-amber-50 text-amber-900', grey: 'border bg-muted text-foreground' }

function Warn({ tone, title, children }: { tone: Tone; title: string; children?: React.ReactNode }) {
  const icon = { red: '🔴', green: '🟢', yellow: '🟡', grey: '⚪' }[tone]
  return (
    <div className={cn('rounded-card border px-3 py-2 text-sm', TONE[tone])}>
      <div className="font-semibold">{icon} {title}</div>
      {children && <div className="mt-0.5 text-xs">{children}</div>}
    </div>
  )
}
const names = (l: { name: string }[], max = 12) => `${l.slice(0, max).map((d) => d.name).join(', ')}${l.length > max ? ` and ${l.length - max} more` : ''}`

function WarningCards({ s, params }: { s: PlanSummary; params: PlanParams }) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {s.listTooBig && <Warn tone="red" title="The list is bigger than the visit capacity">{s.overDays} day{s.overDays === 1 ? '' : 's'} above the target, highest day {s.peak} (list {s.targetVisits} visits). Capacity at target (Target x open days): {s.target} x {s.openDays} = {s.capacityAtTarget}. Capacity at max ({MAX_PER_DAY} x open days) = {s.capacityAtMax}.</Warn>}
      <Warn tone={s.cov15.ok ? 'green' : 'red'} title={`Coverage by day ${params.coverageDay}: ${s.cov15.done} of ${s.cov15.total} doctors (${Math.round(s.cov15.pct * 100)}%)`}>
        Required {Math.round(params.minCoverage * 100)}% = {s.cov15.required} doctors{s.cov15.ok ? '.' : `: short by ${s.cov15.required - s.cov15.done}.`} End of month: {s.covEnd.done} of {s.covEnd.total}.
      </Warn>
      <Warn tone={s.pcf.ok ? 'green' : 'red'} title={`Expected PCF: ${(s.pcf.pct * 100).toFixed(1)}%`}>Required {Math.round(params.minPcf * 100)}% at least.</Warn>
      {s.noGps.length > 0 && <Warn tone="yellow" title={`${s.noGps.length} doctor${s.noGps.length === 1 ? '' : 's'} without GPS`}>{names(s.noGps)}</Warn>}
      {s.noTime.length > 0 && <Warn tone="yellow" title={`${s.noTime.length} doctor${s.noTime.length === 1 ? '' : 's'} without a known usual time`}>{names(s.noTime, 8)}</Warn>}
      {s.moved.length > 0 && <Warn tone="yellow" title={`${s.moved.length} confirmed-time visit${s.moved.length === 1 ? '' : 's'} moved (usual day closed or full)`}>{s.moved.slice(0, 8).map((m) => `${m.name} ${m.from} → ${m.to} (${m.reason})`).join('; ')}</Warn>}
      {s.dropped.length > 0 && <Warn tone="yellow" title={`Shortfall: ${s.shortfall.visits} visit${s.shortfall.visits === 1 ? '' : 's'} of ${s.dropped.length} doctor${s.dropped.length === 1 ? '' : 's'} not placed`}>{s.dropped.slice(0, 10).map((d) => `${d.name} ${d.visits.join(', ')}`).join('; ')}{s.dropped.length > 10 ? ` and ${s.dropped.length - 10} more` : ''}. Placing them would add {s.shortfall.firstVisits} doctor{s.shortfall.firstVisits === 1 ? '' : 's'} to coverage ({s.shortfall.covLossPts.toFixed(1)} pts) and {s.shortfall.pcfLossPts.toFixed(1)} pts to PCF; no day goes above {MAX_PER_DAY} visits.</Warn>}
      {s.underMin.length > 0 && <Warn tone="red" title={`${s.underMin.length} day${s.underMin.length === 1 ? '' : 's'} under the minimum of ${params.minDay} visits`}>{s.underMin.map((d) => `${d.day} (${d.count})`).join(', ')}</Warn>}
      {s.emptyDays.length > 0 && <Warn tone="yellow" title={`${s.emptyDays.length} open day${s.emptyDays.length === 1 ? ' has' : 's have'} no visits`}>The list has {s.targetVisits} visits; {params.minDay} a day needs {params.minDay * s.openDays}. {s.emptyDays.slice(0, 10).join(', ')}</Warn>}
      {s.warnings.filter((w) => w.startsWith('No open') || w.includes('no PM call-rate')).map((w) => <Warn key={w} tone="red" title={w} />)}
      <Warn tone="grey" title="Summary">
        {s.openDays} open PM days ({s.closedDays} closed). Capacity at target (Target x open days) {s.capacityAtTarget}; at max ({MAX_PER_DAY} x open days) {s.capacityAtMax}. Target visits {s.targetVisits}, in the plan {s.plannedVisits}. Days: highest {s.peak}, lowest {s.lowest}. Average {s.avgDailyKm.toFixed(1)} km a day, {s.avgBricksPerDay.toFixed(1)} bricks a day (up to {s.maxBricksPerDay}). PM window {s.window.start}–{s.window.end}{s.window.own ? '' : ' (default)'}.
      </Warn>
    </div>
  )
}

/* ------------------------------ the plan table ------------------------------ */
function PlanTable({ rows, doctors, target }: { rows: PlanRow[]; doctors: Map<number, PlanDoctor>; target: number }) {
  const days = useMemo(() => {
    const m = new Map<string, PlanRow[]>()
    for (const r of [...rows].sort((a, b) => a.day.localeCompare(b.day) || a.seq - b.seq)) m.set(r.day, [...(m.get(r.day) ?? []), r])
    return [...m]
  }, [rows])
  const freqOf = (id: number) => doctors.get(id)?.freq ?? '?'
  return (
    <div className="overflow-auto rounded-card border bg-card">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted text-xs">
          <tr><th className="px-2 py-1.5 text-left">#</th><th className="px-2 py-1.5 text-left">Doctor</th><th className="px-2 py-1.5 text-left">Account</th><th className="px-2 py-1.5 text-left">Brick</th><th className="px-2 py-1.5 text-left">Time</th><th className="px-2 py-1.5 text-center">Visit</th><th className="px-2 py-1.5 text-left">Note</th></tr>
        </thead>
        <tbody>
          {days.map(([day, list]) => {
            const n = list.length
            const color = n >= MAX_PER_DAY ? 'bg-red-100 text-red-900' : n > target ? 'bg-amber-100 text-amber-900' : 'bg-green-50 text-green-900'
            return (
              <FragmentDay key={day} head={<tr className={cn('border-t-2', color)}><td colSpan={7} className="px-2 py-1.5 font-semibold">{day} <span className="font-normal">{dayName(day)}</span> — {n} visit{n === 1 ? '' : 's'} / target {target}{n > target ? ' (above target)' : ''}</td></tr>}>
                {list.map((r) => {
                  const d = doctors.get(r.doctor_id)
                  return (
                    <tr key={`${r.day}-${r.seq}`} className="border-t">
                      <td className="tnum px-2 py-1">{r.seq}</td>
                      <td className="px-2 py-1 font-medium">{d?.name ?? `Doctor #${r.doctor_id}`}</td>
                      <td className="px-2 py-1 text-muted-foreground">{d?.account ?? ''}</td>
                      <td className="px-2 py-1 text-muted-foreground">{d?.brick ?? ''}</td>
                      <td className="tnum px-2 py-1">{r.planned_time ?? ''} {r.fixed && <span title="Confirmed time (usual day and hour)">🔒</span>}</td>
                      <td className="tnum px-2 py-1 text-center">{r.visit_no}/{freqOf(r.doctor_id)}</td>
                      <td className="px-2 py-1 text-xs text-muted-foreground">{[r.note, d && d.lat === null ? 'no GPS' : null].filter(Boolean).join(' · ')}</td>
                    </tr>
                  )
                })}
              </FragmentDay>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
function FragmentDay({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return <>{head}{children}</>
}

/* ------------------------------ page ------------------------------ */
function MonthlyPlanBody() {
  const [month, setMonth] = useState(currentMonth)
  const [lineId, setLineId] = useState<number | null>(null)
  const [managerId, setManagerId] = useState<number | null>(null)
  const [repId, setRepId] = useState<number | null>(null)
  const repsQ = useAsync(`plan:reps:${month}`, () => fetchPlanReps(month))
  const reps = useMemo(() => repsQ.data ?? [], [repsQ.data])

  const lines = useMemo(() => [...new Map(reps.filter((r) => r.line_id !== null).map((r) => [r.line_id as number, r.line_name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [reps])
  const managers = useMemo(() => [...new Map(reps.filter((r) => r.manager_id !== null && (lineId === null || r.line_id === lineId)).map((r) => [r.manager_id as number, r.manager_name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [reps, lineId])
  const filtered = useMemo(() => reps.filter((r) => (lineId === null || r.line_id === lineId) && (managerId === null || r.manager_id === managerId)), [reps, lineId, managerId])
  const rep: PlanRep | null = filtered.find((r) => r.rep_id === repId) ?? null

  const [inputs, setInputs] = useState<PlanInputs | null>(null)
  const [requests, setRequests] = useState<PlanRequest[]>([])
  const [saved, setSaved] = useState<SavedPlan | null>(null)
  const [work, setWork] = useState<Working | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (repKey: number, m: string, keepWork: boolean) => {
    setLoading(true)
    setError(null)
    try {
      const [inp, req, sp] = await Promise.all([fetchPlanInputs(repKey, m), fetchPlanRequests(repKey, m), fetchSavedPlan(repKey, m)])
      setInputs(inp)
      setRequests(req)
      setSaved(sp)
      if (!keepWork) setWork(sp ? { rows: sp.rows, summary: sp.summary, params: { ...DEFAULT_PARAMS, ...sp.params }, dirty: false } : null)
    } catch (e) {
      setError(errText(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setInputs(null); setRequests([]); setSaved(null); setWork(null); setError(null)
    if (repId !== null && rep) void load(repId, month, false)
  }, [repId, month, rep, load])

  const locked = saved?.status === 'approved'
  const doctors = useMemo(() => new Map((inputs?.doctors ?? []).map((d) => [d.doctor_id, d])), [inputs])
  const noList = inputs !== null && inputs.doctors.length === 0

  const generate = () => {
    if (!inputs) return
    try {
      const res = generatePlan(inputs)
      setWork({ rows: res.rows, summary: res.summary, params: res.params, dirty: true })
    } catch (e) {
      toast.error(`The planner failed: ${errText(e)}`)
    }
  }

  const persist = async (): Promise<number | null> => {
    if (!work || !work.summary || repId === null) return null
    const id = await savePlan(repId, month, work.params, work.summary, work.rows)
    if (id === null) { toast.error('This plan is already approved and cannot be changed.'); return null }
    return id
  }
  const saveDraft = async () => {
    setBusy(true)
    try {
      const id = await persist()
      if (id !== null && repId !== null) { toast.success('Draft saved'); await load(repId, month, false) }
    } catch (e) { toast.error(errText(e)) } finally { setBusy(false) }
  }
  const approve = async () => {
    if (!work || repId === null) return
    if (!window.confirm('Approve this plan? An approved plan is locked and cannot be edited.')) return
    setBusy(true)
    try {
      const id = work.dirty || !saved ? await persist() : saved.id
      if (id !== null) { await approvePlan(id); toast.success('Plan approved'); await load(repId, month, false) }
    } catch (e) { toast.error(errText(e)) } finally { setBusy(false) }
  }
  const exportXlsx = () => {
    if (!work || !rep || !inputs) return
    void downloadPlanWorkbook({ rep: rep.name, month, target: work.summary?.target ?? inputs.daily_target ?? 0, rows: work.rows, doctors, summary: work.summary, status: locked ? 'approved' : work.dirty ? 'unsaved draft' : 'draft' }, LOGO)
      .catch((e) => toast.error(errText(e)))
  }

  const refreshRequests = () => { if (repId !== null) void load(repId, month, true) }

  return (
    <div className="space-y-4">
      <PageHeader title="Monthly Plan" description="PM visit plan for one rep and month: every day one compact area, every doctor visited the number of times of his frequency." />

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input type="month" aria-label="Month" className={SELECT} value={month.slice(0, 7)} onChange={(e) => { if (e.target.value) { setMonth(`${e.target.value}-01`); setRepId(null) } }} />
          <select aria-label="Line" className={SELECT} value={lineId ?? ''} onChange={(e) => { setLineId(e.target.value === '' ? null : Number(e.target.value)); setManagerId(null); setRepId(null) }}>
            <option value="">All lines</option>
            {lines.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select aria-label="Direct manager" className={SELECT} value={managerId ?? ''} onChange={(e) => { setManagerId(e.target.value === '' ? null : Number(e.target.value)); setRepId(null) }}>
            <option value="">All managers</option>
            {managers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select aria-label="Rep" className={cn(SELECT, 'min-w-56')} value={repId ?? ''} onChange={(e) => setRepId(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">{repsQ.loading ? 'Loading reps…' : `Select a rep (${filtered.length})`}</option>
            {filtered.map((r) => <option key={r.rep_id} value={r.rep_id}>{r.name} · {r.line_name}</option>)}
          </select>
          {saved && <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', locked ? 'bg-green-100 text-green-900' : 'bg-amber-100 text-amber-900')}>{locked ? <><Lock className="mr-1 inline h-3 w-3" aria-hidden />Approved</> : 'Draft saved'}</span>}
        </div>
        {repsQ.error && <ErrorState message={repsQ.error} onRetry={repsQ.reload} className="py-4" />}
      </Card>

      {rep === null ? (
        <Card><EmptyState icon={CalendarRange} title="Select a rep" description="Choose the month and a rep to see his requests and generate the plan." /></Card>
      ) : error ? (
        <Card><ErrorState message={error} onRetry={() => void load(rep.rep_id, month, false)} /></Card>
      ) : loading || !inputs ? (
        <div className="space-y-3" aria-busy="true"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
      ) : (
        <>
          <RequestsSection rep={rep.rep_id} month={month} requests={requests} locked={locked} onChanged={refreshRequests} />

          {noList ? (
            <Card><EmptyState title="No list for this rep" description={`${rep.name} has no PM list (Clinics / Poly Clinics) in ${month.slice(0, 7)} or in any earlier month, so there is nothing to plan.`} /></Card>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" disabled={locked || busy} onClick={generate}><Sparkles className="h-4 w-4" aria-hidden /> Generate plan</Button>
                <Button disabled={!work || !work.dirty || locked || busy} onClick={() => void saveDraft()}><Save className="h-4 w-4" aria-hidden /> Save draft</Button>
                <Button disabled={!work || locked || busy} onClick={() => void approve()}><CheckCircle2 className="h-4 w-4" aria-hidden /> Approve</Button>
                <Button disabled={!work} onClick={exportXlsx}><FileSpreadsheet className="h-4 w-4" aria-hidden /> Download Excel</Button>
                <span className="text-xs text-muted-foreground">
                  List of {inputs.list_month?.slice(0, 7) ?? '—'} · {inputs.doctors.length} doctors · {inputs.doctors.reduce((a, d) => a + d.freq, 0)} visits · PM target {inputs.daily_target ?? 'not set'} a day
                  {work?.dirty && ' · unsaved changes'}
                </span>
              </div>
              {work ? (
                <>
                  {work.summary && <WarningCards s={work.summary} params={work.params} />}
                  <PlanTable rows={work.rows} doctors={doctors} target={work.summary?.target ?? inputs.daily_target ?? 8} />
                </>
              ) : (
                <Card><EmptyState icon={Sparkles} title="No plan yet" description="Press Generate plan to build the plan from the list, the open days and the requests above." /></Card>
              )}
            </>
          )}
        </>
      )}

      <BacktestPanel reps={filtered} selected={rep} />
    </div>
  )
}

export default function MonthlyPlan() {
  return (
    <ErrorBoundary label="Monthly Plan">
      <MonthlyPlanBody />
    </ErrorBoundary>
  )
}
