import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Copy, Loader2, Plus, Save, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, PageHeader } from '../components/app/states'
import { Button } from '../components/ui/button'
import { Card, Skeleton } from '../components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/overlay'
import { useAuth } from '../context/AuthContext'
import { useMonth } from '../context/MonthContext'
import { useAsync } from '../features/dashboard/useAsync'
import {
  buildUpserts, formAt, formTotal, invalidIds, isFullTotal, monthChoices, parseThreshold, previousVersion, totalMessage, versionsOf,
  type StrategyForm,
} from '../features/strategy/strategyMath'
import { dropCachedPrefix } from '../lib/api/kpi'
import { fetchLineNames } from '../lib/api/reports'
import {
  fetchListStrategy, fetchSpecialities, fetchSpecialityMixLine, fetchThreshold, saveStrategy, saveThreshold,
  type Speciality, type StrategyRow,
} from '../lib/api/speciality'
import { cn } from '../lib/utils'

const label = (iso: string) => format(parseISO(iso), 'MMM yyyy')
/** Saving changes what the Speciality Mix report shows: forget its cached months. */
const refreshReport = () => dropCachedPrefix('report:speciality')
const NUM_INPUT = 'tnum h-8 w-24 rounded-control border bg-transparent px-2 text-right hover:bg-muted focus:bg-card'

/* ------------------------------ red threshold ------------------------------ */
function ThresholdCard() {
  const th = useAsync('strategy:threshold', fetchThreshold)
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const shown = draft ?? (th.data === null ? '' : String(th.data ?? ''))
  const parsed = parseThreshold(shown)
  const bad = shown !== '' && parsed === null

  const save = async () => {
    if (parsed === null) {
      toast.error('Threshold must be a number between 0 and 100, in steps of 0.5')
      return
    }
    setBusy(true)
    try {
      await saveThreshold(parsed)
      refreshReport()
      toast.success('Red threshold saved', { description: `A speciality turns red when its share differs from the strategy by more than ${parsed} points.` })
      setDraft(null)
      th.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">Red threshold</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        In the Speciality Mix report a speciality is red when its actual share differs from the strategy by more than this many percentage points (not a relative difference).
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Red threshold (percentage points)</span>
          {th.loading ? (
            <Skeleton className="h-9 w-32" />
          ) : (
            <input
              type="number" inputMode="decimal" min={0} max={100} step={0.5} value={shown} placeholder="15" aria-invalid={bad}
              disabled={busy} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save() }}
              className={cn('tnum h-9 w-32 rounded-control border bg-card px-3 text-sm', bad && 'border-danger text-danger')}
            />
          )}
        </label>
        <Button variant="primary" disabled={busy || th.loading || draft === null} onClick={() => void save()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
        </Button>
      </div>
      {th.error && <p className="mt-2 text-xs text-danger">{th.error}</p>}
    </Card>
  )
}

/* ------------------------------ one line's strategy ------------------------------ */
function LineEditor({ line, effective, specs, viewNames, rows, onPickMonth, onSaved }: {
  line: { id: number; name: string }
  effective: string
  specs: Speciality[]
  /** Speciality names that appear in the line's list for the top-bar month (v_speciality_mix_line). */
  viewNames: string[]
  rows: StrategyRow[]
  onPickMonth: (m: string) => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<StrategyForm>(() => formAt(rows, line.id, effective))
  const [busy, setBusy] = useState(false)
  const versions = useMemo(() => versionsOf(rows, line.id), [rows, line.id])
  const saved = versions.includes(effective)
  const inherits = versions.find((v) => v < effective) ?? null

  const byId = useMemo(() => new Map(specs.map((s) => [s.id, s.name])), [specs])
  const ids = useMemo(() => {
    const idByName = new Map(specs.map((s) => [s.name, s.id]))
    const set = new Set<number>(Object.keys(form).map(Number))
    for (const n of viewNames) {
      const id = idByName.get(n)
      if (id !== undefined) set.add(id)
    }
    return [...set].sort((a, b) => (byId.get(a) ?? '').localeCompare(byId.get(b) ?? '', 'en', { sensitivity: 'base' }))
  }, [form, viewNames, specs, byId])
  const addable = specs.filter((s) => !ids.includes(s.id))
  const total = formTotal(form)
  const bad = new Set(invalidIds(form))

  const copyPrevious = () => {
    const prev = previousVersion(rows, line.id, effective)
    if (!prev) {
      toast.info('No earlier strategy', { description: `${line.name} has no strategy before ${label(effective)}.` })
      return
    }
    setForm({ ...prev.form })
    toast.info(`Loaded the ${label(prev.effective_from)} strategy`, { description: 'Not saved yet - press Save to apply it from ' + label(effective) + '.' })
  }

  const save = async () => {
    if (bad.size > 0) {
      toast.error('Strategy % must be a number between 0 and 100', { description: 'Fix the highlighted values first.' })
      return
    }
    setBusy(true)
    try {
      const upserts = buildUpserts(line.id, effective, ids, form)
      await saveStrategy(upserts)
      refreshReport()
      toast.success(`${line.name} strategy saved`, { description: `${upserts.length} specialities, effective from ${label(effective)}.` })
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{line.name} · effective from {label(effective)}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {saved
              ? 'Saved version. Edit the values and press Save to update it.'
              : `Nothing saved for ${label(effective)} yet.${inherits ? ` Reports currently use the ${label(inherits)} version until you save one.` : ''}`}
          </p>
        </div>
        <Button disabled={busy} onClick={copyPrevious}><Copy className="h-4 w-4" /> Copy from previous month</Button>
      </div>

      <div className="overflow-auto rounded-card border">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="h-9 border-b bg-muted px-3 text-left text-xs font-medium text-muted-foreground">Speciality</th>
              <th className="h-9 border-b bg-muted px-3 text-right text-xs font-medium text-muted-foreground">Strategy %</th>
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => {
              const text = form[id] ?? ''
              const invalid = bad.has(id)
              return (
                <tr key={id}>
                  <td className="border-b px-3 py-1.5">{byId.get(id) ?? `#${id}`}</td>
                  <td className="border-b px-3 py-1.5 text-right">
                    <input
                      type="number" inputMode="decimal" min={0} max={100} step={0.1} placeholder="0" value={text} disabled={busy}
                      aria-label={`${byId.get(id) ?? id} strategy %`} aria-invalid={invalid}
                      onChange={(e) => setForm((f) => ({ ...f, [id]: e.target.value }))}
                      className={cn(NUM_INPUT, invalid && 'border-danger text-danger')}
                    />
                  </td>
                </tr>
              )
            })}
            {ids.length === 0 && (
              <tr><td colSpan={2} className="px-3 py-6 text-center text-sm text-muted-foreground">No specialities yet - add one below.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <Plus className="h-4 w-4 text-muted-foreground" aria-hidden />
          <select
            aria-label="Add speciality" value="" disabled={busy || addable.length === 0}
            onChange={(e) => { if (e.target.value) setForm((f) => ({ ...f, [Number(e.target.value)]: '' })) }}
            className="h-9 max-w-[16rem] rounded-control border bg-card px-2 text-sm"
          >
            <option value="">Add speciality…</option>
            {addable.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <p role="status" className={cn('tnum text-sm font-medium', isFullTotal(total) ? 'text-success' : 'text-warning')}>{totalMessage(total)}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`${line.name} history`}>
          <span className="mr-1 text-xs font-medium text-muted-foreground">History</span>
          {versions.length === 0 && <span className="text-xs text-muted-foreground">nothing saved yet</span>}
          {versions.map((v) => (
            <button
              key={v} aria-pressed={v === effective} onClick={() => onPickMonth(v)}
              className={cn('rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:bg-muted', v === effective && 'border-primary bg-accent font-medium text-accent-foreground')}
            >
              {label(v)}
            </button>
          ))}
        </div>
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save strategy
        </Button>
      </div>
    </Card>
  )
}

/* ------------------------------ screen ------------------------------ */
function Screen() {
  const { month } = useMonth()
  const lines = useAsync('lines:names', fetchLineNames)
  const specs = useAsync('specialities:all', fetchSpecialities)
  const strategy = useAsync('strategy:list', fetchListStrategy)
  // Same key as the report tab, so the month's line mix is shared (and dropped when a strategy is saved).
  const mix = useAsync(`report:speciality:line:${month}`, () => fetchSpecialityMixLine(month))
  const [effective, setEffective] = useState(month)
  const [tab, setTab] = useState('')

  const error = lines.error ?? specs.error ?? strategy.error ?? mix.error
  const loading = lines.loading || specs.loading || strategy.loading || mix.loading
  const reloadAll = () => { lines.reload(); specs.reload(); strategy.reload(); mix.reload() }

  const lineList = lines.data ?? []
  const active = lineList.find((l) => String(l.id) === tab) ?? lineList[0]
  const options = useMemo(() => monthChoices(month, [effective, ...(strategy.data ?? []).map((r) => r.effective_from)]), [month, effective, strategy.data])
  const viewNames = useMemo(
    () => (active ? [...new Set((mix.data ?? []).filter((r) => r.line === active.name).map((r) => String(r.speciality ?? '')))] : []),
    [mix.data, active],
  )

  return (
    <div>
      <PageHeader
        title="List Strategy"
        description="The target speciality mix of each line's Clinics + Poly Clinics list, and when a speciality turns red in the Speciality Mix report. A strategy applies from its effective month until a later one is saved."
      />
      <div className="space-y-4">
        <ThresholdCard />

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            Effective from
            <select aria-label="Effective from" value={effective} onChange={(e) => setEffective(e.target.value)} className="h-9 rounded-control border bg-card px-2 text-sm text-foreground">
              {options.map((o) => <option key={o} value={o}>{label(o)}</option>)}
            </select>
          </label>
          <span className="text-xs text-muted-foreground">Starts on the top-bar month; pick a history month below a line to edit an older version.</span>
        </div>

        {error ? (
          <div className="rounded-card border bg-card"><ErrorState message={error} onRetry={reloadAll} /></div>
        ) : loading || !active ? (
          <div className="space-y-2" aria-busy="true"><Skeleton className="h-9 w-72" /><Skeleton className="h-64" /></div>
        ) : (
          <Tabs value={String(active.id)} onValueChange={setTab}>
            <TabsList className="mb-3">
              {lineList.map((l) => <TabsTrigger key={l.id} value={String(l.id)}>{l.name}</TabsTrigger>)}
            </TabsList>
            {lineList.map((l) => (
              <TabsContent key={l.id} value={String(l.id)}>
                <LineEditor
                  key={`${l.id}|${effective}`}
                  line={l} effective={effective} specs={specs.data ?? []} viewNames={viewNames} rows={strategy.data ?? []}
                  onPickMonth={setEffective} onSaved={() => strategy.reload()}
                />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </div>
  )
}

export default function ListStrategy() {
  const { role } = useAuth()
  if (role !== 'admin') {
    return (
      <div>
        <PageHeader title="List Strategy" />
        <EmptyState icon={ShieldAlert} title="Admins only" description="Only an admin can change the list strategy and the red threshold." />
      </div>
    )
  }
  return <Screen />
}
