import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Search, UserMinus, UserPlus, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input, Skeleton } from '../../components/ui/misc'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/overlay'
import { EmptyState, ErrorState } from '../../components/app/states'
import { useAuth } from '../../context/AuthContext'
import { downloadCsv } from '../../lib/csv'
import { downloadXlsx } from '../../lib/xlsxExport'
import { fetchMonthDetail } from '../../lib/api/kpi'
import { kpiRepRows } from '../../lib/api/reports'
import { kpiTone, toneText } from '../../lib/kpi'
import { cn } from '../../lib/utils'
import { useAsync } from '../dashboard/useAsync'
import { ReportToolbar } from './ReportToolbar'
import { filterRows, managerOptions, type ReportFilters } from './reportMath'
import {
  DASH, aggregate, byLine, byManager, exportGroups, exportReps, fmtInt, fmtPct, fmtRate, parseIds, splitExcluded,
  type KpiGroup, type KpiRepRow, type Metrics,
} from './kpiRepMath'

type View = 'reps' | 'dm' | 'line'
const VIEWS: { id: View; label: string }[] = [{ id: 'reps', label: 'Reps' }, { id: 'dm', label: 'By DM' }, { id: 'line', label: 'By Line' }]

interface Col<T> {
  id: string
  header: string
  tip?: string
  numeric?: boolean
  sticky?: boolean
  value: (r: T) => string | number | null
  render: (r: T) => ReactNode
  foot?: (t: Metrics & { reps: number }) => ReactNode
}

const kpiCell = (v: number | null) => <span className={cn('font-medium', v !== null && toneText[kpiTone(v, 1)])}>{fmtPct(v)}</span>

/** The thirteen metric columns shared by the rep table and the roll-ups. */
function metricCols<T extends Metrics>(): Col<T>[] {
  const m = (id: string, header: string, key: keyof Metrics, render: (v: number | null) => ReactNode, foot: (t: Metrics) => ReactNode, tip?: string): Col<T> => ({
    id, header, tip, numeric: true, value: (r) => r[key], render: (r) => render(r[key]), foot,
  })
  return [
    m('list', 'List Doctors', 'list_doctors', fmtInt, (t) => fmtInt(t.list_doctors)),
    m('covered', 'Covered', 'covered_doctors', fmtInt, (t) => fmtInt(t.covered_doctors)),
    m('coverage', 'Coverage %', 'coverage', fmtPct, (t) => fmtPct(t.coverage), 'Covered ÷ List doctors.'),
    m('total', 'Total Visits (C/PC)', 'total_visits', fmtInt, (t) => fmtInt(t.total_visits), 'PM-shift visits to Clinics and Poly Clinics. Pharmacy and AM Center / A / H are outside the KPI.'),
    m('target', 'Target Visits', 'target_visits', fmtInt, (t) => fmtInt(t.target_visits), "Sum of Freq over the rep's Clinic / Poly Clinic list doctors."),
    m('valid', 'Valid Visits', 'valid_visits', fmtInt, (t) => fmtInt(t.valid_visits), 'Per doctor: visits capped at Freq.'),
    m('pcf', 'PCF %', 'pcf', fmtPct, (t) => fmtPct(t.pcf), 'Valid visits ÷ target visits.'),
    m('days', 'Days PM', 'days_pm', fmtInt, (t) => fmtInt(t.days_pm)),
    m('missing', 'Missing Days', 'missing_pm', fmtInt, (t) => fmtInt(t.missing_pm)),
    m('cr', 'Call Rate PM', 'call_rate_pm', fmtRate, (t) => fmtRate(t.call_rate_pm), 'PM visits ÷ PM days.'),
    m('expected', 'Expected Visits', 'expected_visits', fmtInt, (t) => fmtInt(t.expected_visits), 'PM target × PM days.'),
    m('ach', 'Ach CR %', 'ach_cr', fmtPct, (t) => fmtPct(t.ach_cr), 'Total visits ÷ expected visits.'),
    m('kpi', 'Total KPI %', 'total_kpi', kpiCell, (t) => kpiCell(t.total_kpi), 'PCF × 50% + Coverage × 35% + Ach CR × 15%.'),
  ]
}

function SortTable<T>({ cols, rows, total, rowKey, rowClass, sort, onSort, empty }: {
  cols: Col<T>[]
  rows: T[]
  total: Metrics & { reps: number }
  rowKey: (r: T) => string
  rowClass?: (r: T) => string | undefined
  sort: { id: string; dir: 'asc' | 'desc' }
  onSort: (id: string) => void
  empty: { title: string; description: string }
}) {
  const th = 'sticky top-0 z-20 h-9 whitespace-nowrap border-b bg-muted px-3 text-xs font-medium text-muted-foreground'
  return (
    <div className="rounded-card border bg-card">
      <div className="max-h-[68vh] min-h-[320px] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.id} title={c.tip} aria-sort={sort.id === c.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn(th, c.numeric ? 'text-right' : 'text-left')}>
                  <button onClick={() => onSort(c.id)} className={cn('inline-flex items-center gap-1 hover:text-foreground', c.numeric && 'flex-row-reverse')}>
                    {c.header}
                    {sort.id === c.id ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} className={cn('group', rowClass?.(r))}>
                {cols.map((c) => (
                  <td key={c.id} className={cn('h-10 whitespace-nowrap border-b bg-card px-3 group-hover:bg-muted/60', c.numeric && 'tnum text-right')}>{c.render(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                {cols.map((c, i) => (
                  <td key={c.id} className={cn('sticky bottom-0 z-10 h-10 whitespace-nowrap border-t-2 bg-muted px-3 font-semibold', c.numeric && 'tnum text-right')}>
                    {c.foot ? c.foot(total) : i === 0 ? `Total · ${total.reps} reps` : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
        {rows.length === 0 && <EmptyState title={empty.title} description={empty.description} />}
      </div>
    </div>
  )
}

function sortRows<T>(rows: T[], cols: Col<T>[], sort: { id: string; dir: 'asc' | 'desc' }): T[] {
  const col = cols.find((c) => c.id === sort.id)
  if (!col) return rows
  const k = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = col.value(a)
    const y = col.value(b)
    if (x === y) return 0
    if (x === null) return 1 // empty values always last
    if (y === null) return -1
    return typeof x === 'number' && typeof y === 'number' ? k * (x - y) : k * String(x).localeCompare(String(y), 'en', { numeric: true, sensitivity: 'base' })
  })
}

export function KpiRepTab({ month, lines, filters, onFilters }: {
  month: string
  lines: { id: number; name: string }[]
  filters: ReportFilters
  onFilters: (f: ReportFilters) => void
}) {
  const { session } = useAuth()
  const storageKey = `sfe-hub:kpi-rep-excluded:${session?.user.id ?? 'anon'}`
  const detail = useAsync(`kpi:detail:${month}`, () => fetchMonthDetail(month))
  const all = useMemo(() => (detail.data ? kpiRepRows(detail.data, month) : []), [detail.data, month])

  const [excluded, setExcluded] = useState<Set<number>>(() => {
    try {
      return new Set(parseIds(localStorage.getItem(storageKey)))
    } catch {
      return new Set()
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...excluded]))
    } catch {
      /* storage unavailable: the choice just lasts for this visit */
    }
  }, [excluded, storageKey])
  const toggleExcluded = useCallback((id: number) => setExcluded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }), [])

  const [view, setView] = useState<View>('reps')
  const [showExcluded, setShowExcluded] = useState(false)
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' }>({ id: 'kpi', dir: 'desc' })
  const [pick, setPick] = useState('')
  const onSort = (id: string) => setSort((s) => (s.id === id ? { id, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { id, dir: id === 'rep' || id === 'code' || id === 'box' || id === 'line' || id === 'dm' || id === 'name' ? 'asc' : 'desc' }))

  const managers = useMemo(() => managerOptions(all, filters.lineId), [all, filters.lineId])
  const effective = managers.includes(filters.manager) ? filters : { ...filters, manager: '' }
  const visible = useMemo(() => filterRows(all, effective), [all, effective.lineId, effective.manager, effective.search]) // eslint-disable-line react-hooks/exhaustive-deps
  const split = useMemo(() => splitExcluded(visible, excluded), [visible, excluded])
  const total = useMemo(() => aggregate(split.included), [split.included])

  const excludedHere = useMemo(() => all.filter((r) => excluded.has(r.rep_id)), [all, excluded])

  const repCols = useMemo<Col<KpiRepRow>[]>(() => [
    { id: 'rep', header: 'Rep', sticky: true, value: (r) => r.rep_name, render: (r) => <span className="font-medium">{r.rep_name ?? DASH}</span> },
    { id: 'code', header: 'Code', value: (r) => r.rep_code, render: (r) => <span className="tnum">{r.rep_code ?? DASH}</span> },
    { id: 'box', header: 'Box', value: (r) => r.box, render: (r) => r.box ?? DASH },
    { id: 'line', header: 'Line', value: (r) => r.line, render: (r) => r.line ?? DASH },
    { id: 'dm', header: 'DM', value: (r) => r.manager, render: (r) => r.manager ?? DASH },
    ...metricCols<KpiRepRow>(),
    {
      id: 'action', header: '', value: () => null,
      render: (r) => (
        <button
          onClick={() => toggleExcluded(r.rep_id)}
          aria-label={excluded.has(r.rep_id) ? `Include ${r.rep_name}` : `Exclude ${r.rep_name}`}
          title={excluded.has(r.rep_id) ? 'Include again' : 'Exclude from the report and totals'}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {excluded.has(r.rep_id) ? <UserPlus className="h-4 w-4" /> : <UserMinus className="h-4 w-4" />}
        </button>
      ),
      foot: () => '',
    },
  ], [excluded, toggleExcluded])
  const groupCols = useMemo<Col<KpiGroup>[]>(() => [
    { id: 'name', header: view === 'dm' ? 'DM' : 'Line', value: (g) => g.label, render: (g) => <span className="font-medium">{g.label}</span> },
    { id: 'reps', header: 'Reps', numeric: true, value: (g) => g.reps, render: (g) => g.reps, foot: (t) => t.reps },
    ...metricCols<KpiGroup>(),
  ], [view])

  const repRows = useMemo(() => {
    const inc = sortRows(split.included, repCols, sort)
    return showExcluded ? [...inc, ...sortRows(split.excluded, repCols, sort)] : inc
  }, [split, repCols, sort, showExcluded])
  const groups = useMemo(() => sortRows(view === 'dm' ? byManager(split.included) : byLine(split.included), groupCols, sort), [split.included, view, groupCols, sort])

  const records = () => (view === 'reps' ? exportReps(repRows.filter((r) => !excluded.has(r.rep_id)), total, split.excluded, showExcluded) : exportGroups(groups, total, view === 'dm' ? 'DM' : 'Line'))
  const fileName = `kpi-by-rep-${view}-${month.slice(0, 7)}`

  const pickable = useMemo(() => {
    const q = pick.trim().toLowerCase()
    return all.filter((r) => q === '' || [r.rep_name, r.rep_code, r.box].some((v) => v !== null && v.toLowerCase().includes(q))).slice(0, 60)
  }, [all, pick])

  return (
    <div className="space-y-3">
      <ReportToolbar
        lines={lines} filters={effective} onFilters={onFilters} managers={managers}
        columns={[]} hidden={new Set()} onToggleColumn={() => undefined}
        canExport={repRows.length > 0 || groups.length > 0}
        onXlsx={() => void downloadXlsx(`${fileName}.xlsx`, 'KPI by rep', records())}
        onCsv={() => downloadCsv(`${fileName}.csv`, records())}
      >
        <div role="group" aria-label="View" className="inline-flex rounded-control border bg-card p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              aria-pressed={view === v.id}
              onClick={() => { setView(v.id); setSort(v.id === 'reps' ? { id: 'kpi', dir: 'desc' } : { id: 'kpi', dir: 'desc' }) }}
              className={cn('rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors', view === v.id && 'bg-accent font-medium text-accent-foreground')}
            >
              {v.label}
            </button>
          ))}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm"><UserMinus className="h-4 w-4" /> Exclude reps{excludedHere.length > 0 ? ` (${excludedHere.length})` : ''}</Button>
          </PopoverTrigger>
          <PopoverContent className="w-72">
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input aria-label="Search reps to exclude" placeholder="Rep, code or box…" value={pick} onChange={(e) => setPick(e.target.value)} className="pl-8" />
            </div>
            <div className="max-h-64 overflow-auto">
              {pickable.map((r) => (
                <label key={r.rep_id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <input type="checkbox" checked={excluded.has(r.rep_id)} onChange={() => toggleExcluded(r.rep_id)} />
                  <span className="min-w-0 flex-1 truncate">{r.rep_name}</span>
                  <span className="tnum text-xs text-muted-foreground">{r.rep_code}</span>
                </label>
              ))}
              {pickable.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">No rep matches.</p>}
            </div>
          </PopoverContent>
        </Popover>
      </ReportToolbar>

      {excludedHere.length > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-card border border-warning/40 bg-warning-soft px-4 py-2 text-sm text-warning">
          <b>{excludedHere.length} {excludedHere.length === 1 ? 'rep' : 'reps'} excluded</b>
          <span className="flex flex-wrap gap-1.5">
            {excludedHere.map((r) => (
              <span key={r.rep_id} className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs text-foreground">
                {r.rep_name}
                <button aria-label={`Include ${r.rep_name}`} onClick={() => toggleExcluded(r.rep_id)} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
              </span>
            ))}
          </span>
          <span className="ml-auto flex gap-3">
            <button className="underline" onClick={() => setShowExcluded((v) => !v)}>{showExcluded ? 'Hide them' : 'Show them'}</button>
            <button className="underline" onClick={() => { setExcluded(new Set()); setShowExcluded(false) }}>Clear</button>
          </span>
        </div>
      )}

      {detail.error ? (
        <div className="rounded-card border bg-card"><ErrorState message={detail.error} onRetry={detail.reload} /></div>
      ) : detail.loading ? (
        <div className="space-y-2" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : view === 'reps' ? (
        <SortTable
          cols={repCols} rows={repRows} total={total} rowKey={(r) => String(r.rep_id)} sort={sort} onSort={onSort}
          rowClass={(r) => (excluded.has(r.rep_id) ? 'opacity-50 [&_td]:line-through' : undefined)}
          empty={{ title: all.length === 0 ? `No KPI data for ${month.slice(0, 7)}` : 'No reps match the filters', description: all.length === 0 ? 'KPIs appear once the list, visits and calendar exist for the month. Pick another month.' : 'Clear the search, choose another line / manager, or clear the exclusions.' }}
        />
      ) : (
        <SortTable
          cols={groupCols} rows={groups} total={total} rowKey={(g) => g.key} sort={sort} onSort={onSort}
          empty={{ title: 'Nothing to roll up', description: 'No reps match the filters.' }}
        />
      )}
      <p className="text-xs text-muted-foreground">
        KPIs use the PM shift only (Clinic + Poly Clinic). Totals and roll-ups are recomputed from the sums of the reps shown, never as an average of their ratios. Pharmacy and AM Center / A / H visits are outside the KPI.
      </p>
    </div>
  )
}
