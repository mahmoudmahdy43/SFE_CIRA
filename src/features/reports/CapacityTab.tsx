import { lastDayOf, rangeFileSlug } from '../../lib/dateRange'
import { ProfileLink } from '../../components/app/ProfileLink'
import { useCallback, useMemo, useState } from 'react'
import { Card, Skeleton } from '../../components/ui/misc'
import { Tooltip } from '../../components/ui/overlay'
import { downloadCsv } from '../../lib/csv'
import { downloadXlsx } from '../../lib/xlsxExport'
import { fetchVisitsCapacity } from '../../lib/api/reports'
import { toneText, type Tone } from '../../lib/kpi'
import { cn } from '../../lib/utils'
import { useAsync } from '../dashboard/useAsync'
import { ReportTable, type ReportCol } from './ReportTable'
import { ReportToolbar } from './ReportToolbar'
import {
  CAP_DASH, CAPACITY_FOOTER_NOTE, DEFAULT_STATUS_FILTER, capacityManagers, capacityOrder, exportCapacity, filterCapacity, filterCapacityScope,
  fmtCap, fmtExcess, fmtTargetPm, fmtUtilization, isCapacityTotal, removeLabel, removeTip, summarizeCapacity, totalCapacity,
  type CapacityRow, type CapacityStatusFilter,
} from './capacityMath'
import type { ReportFilters } from './reportMath'

const TIPS = {
  target: 'PM Call Rate target of the rep\'s box.',
  days: 'PM working days of the month (Thu, Fri and holidays excluded).',
  capacity: 'Capacity = PM Call Rate target × PM working days.',
  listVisits: 'Sum of Freq of the rep\'s C / PC list doctors.',
  excess: 'Excess = List visits − Capacity. Red: more visits on the list than the rep can make. Green: spare capacity.',
  utilization: 'Utilization = List visits ÷ Capacity.',
  remove: 'Doctors to take off the list so it fits the capacity: shown for Freq 2 doctors (hover for the Freq 1 number).',
}

const COLS: ReportCol<CapacityRow>[] = [
  {
    id: 'rep', header: 'Rep', sticky: true, width: 190, value: (r) => r.rep_name,
    render: (r) => (
      <div className="leading-tight">
        <div className="font-medium"><ProfileLink type="rep" id={r.rep_id}>{r.rep_name ?? CAP_DASH}</ProfileLink></div>
        <div className="tnum text-[11px] text-muted-foreground">{r.rep_code ?? ''}</div>
      </div>
    ),
  },
  { id: 'line', header: 'Line', value: (r) => r.line, render: (r) => (isCapacityTotal(r) ? '' : r.line ?? CAP_DASH) },
  { id: 'manager', header: 'Manager', value: (r) => r.manager, render: (r) => r.manager ?? CAP_DASH },
  { id: 'box', header: 'Box', value: (r) => r.box, render: (r) => r.box ?? CAP_DASH },
  { id: 'target', header: 'Target PM', tip: TIPS.target, numeric: true, value: (r) => r.call_rate_target_pm, render: (r) => (isCapacityTotal(r) ? '' : fmtTargetPm(r.call_rate_target_pm)) },
  { id: 'days', header: 'Working days', tip: TIPS.days, numeric: true, value: (r) => r.pm_working_days, render: (r) => (isCapacityTotal(r) ? '' : fmtCap(r.pm_working_days)) },
  { id: 'capacity', header: 'Capacity', tip: TIPS.capacity, numeric: true, value: (r) => r.capacity_visits, render: (r) => fmtCap(r.capacity_visits) },
  { id: 'list_doctors', header: 'List doctors', numeric: true, value: (r) => r.list_doctors, render: (r) => fmtCap(r.list_doctors) },
  { id: 'list_visits', header: 'List visits', tip: TIPS.listVisits, numeric: true, value: (r) => r.list_visits, render: (r) => fmtCap(r.list_visits) },
  {
    id: 'excess', header: 'Excess', tip: TIPS.excess, numeric: true, value: (r) => r.excess_visits,
    render: (r) => <span className={cn('font-medium', r.excess_visits > 0 && 'text-danger', r.excess_visits < 0 && 'text-success')}>{fmtExcess(r.excess_visits)}</span>,
  },
  { id: 'utilization', header: 'Utilization %', tip: TIPS.utilization, numeric: true, value: (r) => r.utilization, render: (r) => (isCapacityTotal(r) ? '' : fmtUtilization(r.utilization)) },
  {
    id: 'remove', header: 'Remove ~N doctors', tip: TIPS.remove, numeric: true, value: (r) => r.remove_if_freq2,
    render: (r) => {
      if (isCapacityTotal(r)) return fmtCap(r.remove_if_freq2)
      if (!(r.remove_if_freq2 > 0)) return CAP_DASH
      return (
        <Tooltip side="left" content={<span className="block max-w-64">{removeTip(r.remove_if_freq1)}</span>}>
          <span className="cursor-help underline decoration-dotted underline-offset-4">{removeLabel(r.remove_if_freq2)}</span>
        </Tooltip>
      )
    },
  },
]

const STATUS_OPTIONS: { value: CapacityStatusFilter; label: string }[] = [
  { value: 'Over capacity', label: 'Over capacity' },
  { value: 'Spare capacity', label: 'Spare capacity' },
  { value: 'Balanced', label: 'Balanced' },
  { value: 'all', label: 'All statuses' },
]

function SummaryCard({ label, value, tone = 'neutral', hint, loading }: { label: string; value: string; tone?: Tone; hint?: string; loading?: boolean }) {
  if (loading) {
    return (
      <Card className="p-4" aria-busy="true">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-8 w-20" />
        <Skeleton className="mt-3 h-3 w-28" />
      </Card>
    )
  }
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn('tnum mt-1.5 text-2xl font-semibold tracking-tight', toneText[tone])}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  )
}

export function CapacityTab({ month, lines, filters, onFilters }: {
  month: string
  lines: { id: number; name: string }[]
  filters: ReportFilters
  onFilters: (f: ReportFilters) => void
}) {
  const data = useAsync(`report:capacity:${month}`, () => fetchVisitsCapacity(month))
  const [status, setStatus] = useState<CapacityStatusFilter>(DEFAULT_STATUS_FILTER)
  const [sorted, setSorted] = useState<CapacityRow[]>([])

  const all = data.data
  // The view carries the line name, the shared filter carries the line id.
  const lineName = filters.lineId === null ? null : lines.find((l) => l.id === filters.lineId)?.name ?? null
  const managers = useMemo(() => capacityManagers(all ?? [], lineName), [all, lineName])
  const effective = managers.includes(filters.manager) ? filters : { ...filters, manager: '' }

  // Cards ignore the status filter (otherwise "spare capacity" would always read 0 while the table shows Over capacity).
  const scope = useMemo(
    () => filterCapacityScope(all ?? [], { line: lineName, manager: effective.manager, search: effective.search }),
    [all, lineName, effective.manager, effective.search],
  )
  const summary = useMemo(() => summarizeCapacity(scope), [scope])
  const rows = useMemo(() => capacityOrder(filterCapacity(scope, { line: null, manager: '', search: '', status })), [scope, status])
  const total = useMemo(() => totalCapacity(rows), [rows])
  const onRowsChange = useCallback((r: CapacityRow[]) => setSorted(r), [])

  const records = () => exportCapacity(sorted.length === rows.length ? sorted : rows)
  const name = `visits-capacity-${rangeFileSlug(month, lastDayOf(month))}`
  const noData = !!all && all.length === 0
  const nobodyOver = !noData && scope.length > 0 && rows.length === 0 && status === 'Over capacity'

  return (
    <div className="space-y-3">
      <ReportToolbar
        lines={lines} filters={effective} onFilters={onFilters} managers={managers}
        columns={[]} hidden={new Set()} onToggleColumn={() => undefined}
        canExport={rows.length > 0}
        onXlsx={() => void downloadXlsx(`${name}.xlsx`, 'Visits Capacity', records())}
        onCsv={() => downloadCsv(`${name}.csv`, records())}
        searchLabel="Search rep name" searchPlaceholder="Rep name…"
      >
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as CapacityStatusFilter)} className="h-9 rounded-control border bg-card px-2 text-sm">
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </ReportToolbar>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          loading={data.loading} label="Reps over capacity" value={fmtCap(summary.overReps)} tone={summary.overReps > 0 ? 'danger' : 'neutral'}
          hint={`of ${fmtCap(summary.reps)} reps`}
        />
        <SummaryCard
          loading={data.loading} label="Total excess visits" value={fmtCap(summary.excessVisits)} tone={summary.excessVisits > 0 ? 'danger' : 'neutral'}
          hint="list visits above capacity"
        />
        <SummaryCard
          loading={data.loading} label="Doctors to remove" value={fmtCap(summary.removeDoctors)}
          hint="if the removed doctors carry Freq 2"
        />
        <SummaryCard
          loading={data.loading} label="Reps with spare capacity" value={fmtCap(summary.spareReps)} tone={summary.spareReps > 0 ? 'success' : 'neutral'}
          hint={`${fmtCap(summary.spareVisits)} spare visits`}
        />
      </div>

      <ReportTable
        cols={COLS} rows={rows} total={total} loading={data.loading} error={data.error} onRetry={data.reload}
        onRowsChange={onRowsChange} initialSorting={[{ id: 'excess', desc: true }]}
        emptyTitle={noData ? `No capacity data for ${month.slice(0, 7)}` : nobodyOver ? 'No reps over capacity' : 'No reps match the filters'}
        emptyDescription={
          noData
            ? 'Capacity appears once the Target List and the PM call-rate targets exist for the month. Pick another month.'
            : nobodyOver
              ? 'Nobody\'s list needs more visits than they can make. Set Status to All statuses to see every rep.'
              : 'Clear the search or choose another line / manager / status.'
        }
      />
      <p className="text-xs text-muted-foreground">{CAPACITY_FOOTER_NOTE}</p>
    </div>
  )
}
