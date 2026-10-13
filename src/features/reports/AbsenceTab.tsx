import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Skeleton } from '../../components/ui/misc'
import { EmptyState, ErrorState } from '../../components/app/states'
import { downloadCsv } from '../../lib/csv'
import { downloadXlsx } from '../../lib/xlsxExport'
import { fetchLeaveReport, fetchMissingReport } from '../../lib/api/reports'
import { cn } from '../../lib/utils'
import { useAsync } from '../dashboard/useAsync'
import { ReportToolbar } from './ReportToolbar'
import { filterRows, managerOptions, type ReportFilters } from './reportMath'
import {
  DASH, exportLeaveGroups, exportLeaves, exportMissing, exportMissingDetail, fmtDays1, fmtDaysUpTo1, leavesByLine, leavesByManager,
  lineManagerRep, totalLeaves, totalMissing, type LeaveGroup, type LeaveRow, type MissingRow,
} from './absenceMath'

type Dir = 'asc' | 'desc'
interface Col<T> {
  id: string
  header: string
  numeric?: boolean
  wrap?: boolean
  value: (r: T) => string | number | null
  render: (r: T) => ReactNode
  foot?: ReactNode
}

function Table<T>({ cols, rows, rowKey, sort, onSort, empty }: {
  cols: Col<T>[]
  rows: T[]
  rowKey: (r: T) => string
  sort: { id: string; dir: Dir } | null
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
                <th key={c.id} aria-sort={sort?.id === c.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn(th, c.numeric ? 'text-right' : 'text-left')}>
                  <button onClick={() => onSort(c.id)} className={cn('inline-flex items-center gap-1 hover:text-foreground', c.numeric && 'flex-row-reverse')}>
                    {c.header}
                    {sort?.id === c.id ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} className="group">
                {cols.map((c) => (
                  <td key={c.id} className={cn('border-b bg-card px-3 py-2 align-top group-hover:bg-muted/60', c.wrap ? 'min-w-56 whitespace-normal' : 'whitespace-nowrap', c.numeric && 'tnum text-right')}>{c.render(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                {cols.map((c) => (
                  <td key={c.id} className={cn('sticky bottom-0 z-10 h-10 whitespace-nowrap border-t-2 bg-muted px-3 font-semibold', c.numeric && 'tnum text-right')}>{c.foot ?? ''}</td>
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

function sortBy<T>(rows: T[], cols: Col<T>[], sort: { id: string; dir: Dir }): T[] {
  const col = cols.find((c) => c.id === sort.id)
  if (!col) return rows
  const k = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = col.value(a)
    const y = col.value(b)
    if (x === y) return 0
    if (x === null) return 1
    if (y === null) return -1
    return typeof x === 'number' && typeof y === 'number' ? k * (x - y) : k * String(x).localeCompare(String(y), 'en', { numeric: true, sensitivity: 'base' })
  })
}

const repCell = (r: { rep_name: string | null; rep_code: string | null }) => (
  <div>
    <div className="font-medium">{r.rep_name ?? DASH}</div>
    {r.rep_code && <div className="tnum text-xs text-muted-foreground">{r.rep_code}</div>}
  </div>
)
const TEXT_IDS = new Set(['line', 'dm', 'rep', 'box', 'name'])
const nextSort = (s: { id: string; dir: Dir } | null, id: string): { id: string; dir: Dir } =>
  s?.id === id ? { id, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { id, dir: TEXT_IDS.has(id) ? 'asc' : 'desc' }

interface Props {
  month: string
  lines: { id: number; name: string }[]
  filters: ReportFilters
  onFilters: (f: ReportFilters) => void
}

const NOTE = (what: string) => `Only reps with at least one ${what} in the month appear. Values are in days: an AM-only or PM-only slot counts 0.5, a full day counts 1.`

/* ------------------------------ Leaves ------------------------------ */
export function LeavesTab({ month, lines, filters, onFilters }: Props) {
  const data = useAsync(`report:leaves:${month}`, () => fetchLeaveReport(month))
  const all = useMemo(() => data.data ?? [], [data.data])
  const [view, setView] = useState<'reps' | 'dm' | 'line'>('reps')
  const [sort, setSort] = useState<{ id: string; dir: Dir } | null>(null) // null = Line, Direct Manager, Rep

  const managers = useMemo(() => managerOptions(all, filters.lineId), [all, filters.lineId])
  const effective = managers.includes(filters.manager) ? filters : { ...filters, manager: '' }
  const visible = useMemo(() => filterRows(all, effective), [all, effective.lineId, effective.manager, effective.search]) // eslint-disable-line react-hooks/exhaustive-deps
  const total = useMemo(() => totalLeaves(visible), [visible])

  const num = (id: string, header: string, key: 'vacation_am' | 'vacation_pm' | 'full_days' | 'total_days', foot: number): Col<LeaveRow> => ({
    id, header, numeric: true, value: (r) => r[key], render: (r) => fmtDaysUpTo1(r[key]), foot: fmtDaysUpTo1(foot),
  })
  const repCols = useMemo<Col<LeaveRow>[]>(() => [
    { id: 'line', header: 'Line', value: (r) => r.line, render: (r) => r.line ?? DASH, foot: `Total · ${visible.length} reps` },
    { id: 'dm', header: 'Direct Manager', value: (r) => r.manager, render: (r) => r.manager ?? DASH },
    { id: 'rep', header: 'Medical Rep', value: (r) => r.rep_name, render: repCell },
    { id: 'box', header: 'Box', value: (r) => r.box, render: (r) => r.box ?? DASH },
    num('vam', 'Vacation AM', 'vacation_am', total.vacation_am),
    num('vpm', 'Vacation PM', 'vacation_pm', total.vacation_pm),
    num('full', 'Full Day', 'full_days', total.full_days),
    num('total', 'Total', 'total_days', total.total_days),
  ], [total, visible.length])
  const groupCols = useMemo<Col<LeaveGroup>[]>(() => {
    const g = (id: string, header: string, key: 'vacation_am' | 'vacation_pm' | 'full_days' | 'total_days', foot: number): Col<LeaveGroup> => ({
      id, header, numeric: true, value: (r) => r[key], render: (r) => fmtDaysUpTo1(r[key]), foot: fmtDaysUpTo1(foot),
    })
    return [
      { id: 'name', header: view === 'dm' ? 'Direct Manager' : 'Line', value: (r) => r.label, render: (r) => <span className="font-medium">{r.label}</span>, foot: 'Total' },
      ...(view === 'dm' ? [{ id: 'line', header: 'Line', value: (r: LeaveGroup) => r.line, render: (r: LeaveGroup) => r.line ?? DASH } as Col<LeaveGroup>] : []),
      { id: 'reps', header: 'Reps', numeric: true, value: (r) => r.reps, render: (r) => r.reps, foot: visible.length },
      g('vam', 'Vacation AM', 'vacation_am', total.vacation_am),
      g('vpm', 'Vacation PM', 'vacation_pm', total.vacation_pm),
      g('full', 'Full Day', 'full_days', total.full_days),
      g('total', 'Total', 'total_days', total.total_days),
    ]
  }, [view, total, visible.length])

  const repRows = useMemo(() => (sort ? sortBy(visible, repCols, sort) : lineManagerRep(visible)), [visible, repCols, sort])
  const groups = useMemo(() => {
    const g = view === 'dm' ? leavesByManager(visible) : leavesByLine(visible)
    return sort ? sortBy(g, groupCols, sort) : g.sort((a, b) => (a.line ?? '').localeCompare(b.line ?? '') || a.label.localeCompare(b.label))
  }, [visible, view, groupCols, sort])

  const records = () => (view === 'reps' ? exportLeaves(repRows, total) : exportLeaveGroups(groups, total, view === 'dm' ? 'Direct Manager' : 'Line', visible.length))
  const fileName = `leaves-${view}-${month.slice(0, 7)}`
  const empty = { title: `No leaves in ${month.slice(0, 7)}`, description: all.length === 0 ? 'Nobody has a leave day this month.' : 'No reps match the filters.' }

  return (
    <div className="space-y-3">
      <ReportToolbar
        lines={lines} filters={effective} onFilters={onFilters} managers={managers}
        columns={[]} hidden={new Set()} onToggleColumn={() => undefined}
        canExport={visible.length > 0}
        onXlsx={() => void downloadXlsx(`${fileName}.xlsx`, 'Leaves', records())}
        onCsv={() => downloadCsv(`${fileName}.csv`, records())}
      >
        <ViewToggle value={view} onChange={(v) => { setView(v); setSort(null) }} />
      </ReportToolbar>
      <p className="text-xs text-muted-foreground">{NOTE('leave day')}</p>
      {data.error ? (
        <div className="rounded-card border bg-card"><ErrorState message={data.error} onRetry={data.reload} /></div>
      ) : data.loading ? (
        <div className="space-y-2" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : view === 'reps' ? (
        <Table cols={repCols} rows={repRows} rowKey={(r) => String(r.rep_id)} sort={sort} onSort={(id) => setSort((s) => nextSort(s, id))} empty={empty} />
      ) : (
        <Table cols={groupCols} rows={groups} rowKey={(g) => g.key} sort={sort} onSort={(id) => setSort((s) => nextSort(s, id))} empty={empty} />
      )}
    </div>
  )
}

function ViewToggle({ value, onChange }: { value: 'reps' | 'dm' | 'line'; onChange: (v: 'reps' | 'dm' | 'line') => void }) {
  const views = [{ id: 'reps', label: 'Reps' }, { id: 'dm', label: 'By DM' }, { id: 'line', label: 'By Line' }] as const
  return (
    <div role="group" aria-label="View" className="inline-flex rounded-control border bg-card p-0.5">
      {views.map((v) => (
        <button
          key={v.id}
          aria-pressed={value === v.id}
          onClick={() => onChange(v.id)}
          className={cn('rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors', value === v.id && 'bg-accent font-medium text-accent-foreground')}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------ Missing days ------------------------------ */
export function MissingTab({ month, lines, filters, onFilters }: Props) {
  const data = useAsync(`report:missing:${month}`, () => fetchMissingReport(month))
  const all = useMemo(() => data.data ?? [], [data.data])
  const [sort, setSort] = useState<{ id: string; dir: Dir }>({ id: 'total', dir: 'desc' })

  const managers = useMemo(() => managerOptions(all, filters.lineId), [all, filters.lineId])
  const effective = managers.includes(filters.manager) ? filters : { ...filters, manager: '' }
  const visible = useMemo(() => filterRows(all, effective), [all, effective.lineId, effective.manager, effective.search]) // eslint-disable-line react-hooks/exhaustive-deps
  const total = useMemo(() => totalMissing(visible), [visible])

  const cols = useMemo<Col<MissingRow>[]>(() => [
    { id: 'line', header: 'Line', value: (r) => r.line, render: (r) => r.line ?? DASH, foot: `Total · ${visible.length} reps` },
    { id: 'dm', header: 'Direct Manager', value: (r) => r.manager, render: (r) => r.manager ?? DASH },
    { id: 'rep', header: 'Medical Rep', value: (r) => r.rep_name, render: repCell },
    { id: 'box', header: 'Box', value: (r) => r.box, render: (r) => r.box ?? DASH },
    { id: 'am', header: 'Missing AM', numeric: true, value: (r) => r.missing_am, render: (r) => fmtDays1(r.missing_am), foot: fmtDays1(total.missing_am) },
    { id: 'pm', header: 'Missing PM', numeric: true, value: (r) => r.missing_pm, render: (r) => fmtDays1(r.missing_pm), foot: fmtDays1(total.missing_pm) },
    { id: 'total', header: 'Total', numeric: true, value: (r) => r.missing_total, render: (r) => fmtDays1(r.missing_total), foot: fmtDays1(total.missing_total) },
    { id: 'dates', header: 'Dates', wrap: true, value: (r) => r.missing_dates, render: (r) => r.missing_dates || DASH },
  ], [total, visible.length])

  const rows = useMemo(() => sortBy(visible, cols, sort), [visible, cols, sort])
  const fileName = `missing-days-${month.slice(0, 7)}`

  return (
    <div className="space-y-3">
      <ReportToolbar
        lines={lines} filters={effective} onFilters={onFilters} managers={managers}
        columns={[]} hidden={new Set()} onToggleColumn={() => undefined}
        canExport={rows.length > 0}
        onXlsx={() => void downloadXlsx(`${fileName}.xlsx`, 'Missing Days', exportMissing(rows, total), [{ name: 'Detail', rows: exportMissingDetail(rows) }])}
        onCsv={() => downloadCsv(`${fileName}.csv`, exportMissing(rows, total))}
      />
      <p className="text-xs text-muted-foreground">{NOTE('missing day')} In Dates, a day without a suffix is missing in both shifts.</p>
      {data.error ? (
        <div className="rounded-card border bg-card"><ErrorState message={data.error} onRetry={data.reload} /></div>
      ) : data.loading ? (
        <div className="space-y-2" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : (
        <Table
          cols={cols} rows={rows} rowKey={(r) => String(r.rep_id)} sort={sort} onSort={(id) => setSort((s) => nextSort(s, id) as { id: string; dir: Dir })}
          empty={{ title: `No missing days in ${month.slice(0, 7)}`, description: all.length === 0 ? 'Nobody has a missing day this month.' : 'No reps match the filters.' }}
        />
      )}
    </div>
  )
}
