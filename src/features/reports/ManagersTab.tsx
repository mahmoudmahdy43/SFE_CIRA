import { lastDayOf, rangeFileSlug } from '../../lib/dateRange'
import { ProfileLink } from '../../components/app/ProfileLink'
import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Skeleton } from '../../components/ui/misc'
import { EmptyState, ErrorState } from '../../components/app/states'
import { downloadCsv } from '../../lib/csv'
import { downloadXlsx } from '../../lib/xlsxExport'
import { fetchManagerReport } from '../../lib/api/reports'
import { cn } from '../../lib/utils'
import { useAsync } from '../dashboard/useAsync'
import { ReportToolbar } from './ReportToolbar'
import { DASH, fmtHire, rangeLabel } from './absenceMath'
import {
  MANAGER_ROLES, SHIFT_LABEL, applyShift, exportManagers, exportMissingDetail, shiftDateCols, filterManagers, fmtMCount, fmtMDays, fmtRate, lineManagerOrder, shiftRates, shiftUnit, totalManagers,
  type ManagerRow, type ManagerShift, type ManagerSums,
} from './managerMath'
import type { ReportFilters } from './reportMath'

type Dir = 'asc' | 'desc'
interface Col {
  id: string
  header: string
  numeric?: boolean
  wrap?: boolean
  /** Sub-column of the Call Rate group. */
  group?: 'rate'
  /** Header tooltip (units). */
  title?: string
  value: (r: ManagerRow) => string | number | null
  render: (r: ManagerRow) => ReactNode
  foot?: ReactNode
}

interface Props {
  month: string
  lines: { id: number; name: string }[]
  filters: ReportFilters
  onFilters: (f: ReportFilters) => void
}

const VISIT_COLS = [{ id: 'visits', label: 'AM / PM / Pharmacy visits' }]

export function ManagersTab({ month, lines, filters, onFilters }: Props) {
  const data = useAsync(`report:managers:${month}`, () => fetchManagerReport(month))
  const [role, setRole] = useState('DM')
  const [shift, setShift] = useState<ManagerShift>('ALL')
  const [sort, setSort] = useState<{ id: string; dir: Dir } | null>(null) // null = Line, then Manager name
  const [hidden, setHidden] = useState<Set<string>>(new Set(['visits']))
  const showVisits = !hidden.has('visits')

  const visible = useMemo(
    () => applyShift(filterManagers(data.data ?? [], { lineId: filters.lineId, role, search: filters.search }), shift),
    [data.data, filters.lineId, role, filters.search, shift],
  )
  const total = useMemo(() => totalManagers(visible), [visible])
  const unit = shiftUnit(shift)
  const rateKeys = shiftRates(shift)
  const dateKeys = shiftDateCols(shift)

  const days = (id: string, header: string, key: keyof ManagerSums): Col => ({
    id, header, title: unit, numeric: true, value: (r) => r[key], render: (r) => fmtMDays(r[key]), foot: fmtMDays(total[key]),
  })
  const count = (id: string, header: string, key: keyof ManagerSums): Col => ({
    id, header, numeric: true, value: (r) => r[key], render: (r) => fmtMCount(r[key]), foot: fmtMCount(total[key]),
  })
  const rate = (id: string, header: string, key: 'call_rate_am' | 'call_rate_pm' | 'call_rate_pharmacy', visitsKey: 'visits_am' | 'visits_pm' | 'visits_pharmacy'): Col => ({
    id, header, numeric: true, group: 'rate', value: (r) => r[key], foot: DASH,
    render: (r) => (
      <div>
        <div>{fmtRate(r[key])}</div>
        {showVisits && <div className="text-xs text-muted-foreground">{r[visitsKey]}</div>}
      </div>
    ),
  })

  const cols = useMemo<Col[]>(() => [
    { id: 'line', header: 'Line', value: (r) => r.line, render: (r) => r.line ?? DASH, foot: `Total · ${visible.length} managers` },
    {
      id: 'name', header: 'Manager', value: (r) => r.name,
      render: (r) => (
        <div>
          <div className="font-medium"><ProfileLink type="manager" id={r.manager_id}>{r.name ?? DASH}</ProfileLink></div>
          {r.code && <div className="tnum text-xs text-muted-foreground">{r.code}</div>}
        </div>
      ),
    },
    { id: 'role', header: 'Role', value: (r) => r.role_type, render: (r) => r.role_type ?? DASH },
    { id: 'hire', header: 'Hire Date', value: (r) => r.hire_date, render: (r) => fmtHire(r.hire_date) },
    days('working', 'Working Days', 'working_days'),
    days('field', 'Field Days', 'field_days'),
    days('leave', 'Vacation', 'leave_days'),
    days('ow', 'Office Work', 'office_work_days'),
    days('activity', 'Activities', 'activity_days'),
    days('missing', 'Missing Days', 'missing_days'),
    ...(dateKeys.includes('am') ? [{ id: 'datesAm', header: 'AM Missing Dates', wrap: true, value: (r: ManagerRow) => r.missing_dates_am, render: (r: ManagerRow) => r.missing_dates_am || DASH } as Col] : []),
    ...(dateKeys.includes('pm') ? [{ id: 'datesPm', header: 'PM Missing Dates', wrap: true, value: (r: ManagerRow) => r.missing_dates_pm, render: (r: ManagerRow) => r.missing_dates_pm || DASH } as Col] : []),
    count('single', 'Single Visits', 'single_visits'),
    count('double', 'Double Visits', 'double_visits'),
    ...(rateKeys.includes('am') ? [rate('rateAm', 'AM', 'call_rate_am', 'visits_am')] : []),
    ...(rateKeys.includes('pm') ? [rate('ratePm', 'PM', 'call_rate_pm', 'visits_pm')] : []),
    ...(rateKeys.includes('pharmacy') ? [rate('ratePh', 'Pharmacy', 'call_rate_pharmacy', 'visits_pharmacy')] : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [total, visible.length, showVisits, unit, shift])

  const rows = useMemo(() => {
    if (!sort) return lineManagerOrder(visible)
    const col = cols.find((c) => c.id === sort.id)
    if (!col) return visible
    const k = sort.dir === 'asc' ? 1 : -1
    return [...visible].sort((a, b) => {
      const x = col.value(a)
      const y = col.value(b)
      if (x === y) return 0
      if (x === null) return 1
      if (y === null) return -1
      return typeof x === 'number' && typeof y === 'number' ? k * (x - y) : k * String(x).localeCompare(String(y), 'en', { numeric: true, sensitivity: 'base' })
    })
  }, [visible, cols, sort])

  const onSort = (id: string) =>
    setSort((s) => (s?.id === id ? { id, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { id, dir: ['line', 'name', 'role'].includes(id) ? 'asc' : 'desc' }))
  const th = 'sticky z-20 whitespace-nowrap bg-muted px-3 text-xs font-medium text-muted-foreground'
  const sortHead = (c: Col) => (
    <button title={c.title} onClick={() => onSort(c.id)} className={cn('inline-flex items-center gap-1 hover:text-foreground', c.numeric && 'flex-row-reverse')}>
      {c.header}
      {sort?.id === c.id ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
    </button>
  )
  const aria = (c: Col) => (sort?.id === c.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none')
  const plain = cols.filter((c) => !c.group)
  const rates = cols.filter((c) => c.group === 'rate')

  const fileName = `managers-${rangeFileSlug(month, lastDayOf(month))}-${role || 'all'}-${SHIFT_LABEL[shift].toLowerCase()}`
  const records = () => exportManagers(rows, total, showVisits, shift)
  const empty = { title: `No managers for ${rangeLabel(month, month)}`, description: (data.data ?? []).length === 0 ? 'The report has no rows for this month.' : 'No managers match the filters.' }

  const roleSelect = (
    <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} className="h-9 rounded-control border bg-card px-2 text-sm">
      <option value="">All</option>
      {MANAGER_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
    </select>
  )

  const shiftToggle = (
    <div role="group" aria-label="Shift" className="inline-flex rounded-control border bg-card p-0.5">
      {(Object.keys(SHIFT_LABEL) as ManagerShift[]).map((s) => (
        <button
          key={s}
          aria-pressed={shift === s}
          onClick={() => setShift(s)}
          className={cn('rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors', shift === s && 'bg-accent font-medium text-accent-foreground')}
        >
          {SHIFT_LABEL[s]}
        </button>
      ))}
    </div>
  )

  return (
    <div className="space-y-3">
      <ReportToolbar
        lines={lines} filters={filters} onFilters={onFilters} managers={[]}
        roleSelect={<>{roleSelect}{shiftToggle}</>} searchLabel="Search manager or code" searchPlaceholder="Manager or code…"
        columns={VISIT_COLS} hidden={hidden}
        onToggleColumn={(id) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n })}
        canExport={rows.length > 0}
        onXlsx={() => void downloadXlsx(`${fileName}.xlsx`, 'Managers', records(), dateKeys.length ? [{ name: 'Missing Detail', rows: exportMissingDetail(rows, shift, month) }] : [])}
        onCsv={() => downloadCsv(`${fileName}.csv`, records())}
      />
      <h3 className="text-sm font-semibold">Managers · {rangeLabel(month, month)}</h3>
      <p className="text-xs text-muted-foreground">
        Values are in days (0.5 steps); with the AM / PM shift they are shift days (1 per working shift of that shift), and Pharmacy shows the All day columns with the pharmacy visits and call rate. Double = visited with a rep, Single = visited alone. Call rate AM / PM = visits ÷ field slots of that shift; Pharmacy = visits ÷ field days. Days after the last uploaded visit date are not counted. The Total row leaves call rates blank.
      </p>
      {data.error ? (
        <div className="rounded-card border bg-card"><ErrorState message={data.error} onRetry={data.reload} /></div>
      ) : data.loading ? (
        <div className="space-y-2" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : (
        <div className="rounded-card border bg-card">
          <div className="max-h-[68vh] min-h-[320px] overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  {plain.map((c) => (
                    <th key={c.id} rowSpan={2} aria-sort={aria(c)} className={cn(th, 'top-0 border-b', c.numeric ? 'text-right' : 'text-left')}>{sortHead(c)}</th>
                  ))}
                  <th colSpan={rates.length || 1} className={cn(th, 'top-0 h-8 border-b text-center')}>Call Rate</th>
                </tr>
                <tr>
                  {rates.map((c) => (
                    <th key={c.id} aria-sort={aria(c)} className={cn(th, 'top-8 h-8 border-b text-right')}>{sortHead(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.manager_id} className="group">
                    {cols.map((c) => (
                      <td key={c.id} className={cn('border-b bg-card px-3 py-2 align-top group-hover:bg-muted/60', c.wrap ? 'min-w-48 whitespace-normal' : 'whitespace-nowrap', c.numeric && 'tnum text-right')}>{c.render(r)}</td>
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
      )}
    </div>
  )
}
