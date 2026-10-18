import { ProfileLink } from '../../components/app/ProfileLink'
import { useCallback, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { downloadCsv } from '../../lib/csv'
import { downloadXlsx } from '../../lib/xlsxExport'
import { fetchWorkingDays } from '../../lib/api/kpi'
import { fetchVisitMonths } from '../../lib/api/visits'
import { fetchCallRateReport, fetchRepTargets } from '../../lib/api/reports'
import { cn } from '../../lib/utils'
import { useAsync } from '../dashboard/useAsync'
import { ReportTable, type ReportCol } from './ReportTable'
import { ReportToolbar } from './ReportToolbar'
import {
  CALL_GROUPS, DASH, GROUP_LABEL, SHIFT_LABEL, callRateColumns, defaultOrder, fmtDays, PHARMACY_COLS, showsPharmacy, exportCallRate, filterRows, fmtCallRate, fmtCount,
  fmtHireDate, fmtTarget, managerOptions, targetTone, totalCallRate,
  type CallGroup, type CallRateRow, type ReportFilters, type ViewMode,
} from './reportMath'

const GROUP_TIP: Partial<Record<CallGroup, string>> = {
  working: 'Working days = all working slots of the rep (holidays removed).',
  field: 'Field days = working − vacation − office work − activities.',
  call_rate: 'Call rate = visits ÷ field days (per shift).',
}
const DOT = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' } as const
const MODES: { id: ViewMode; label: string }[] = [
  { id: 'both', label: 'All' }, { id: 'am', label: 'AM' }, { id: 'pm', label: 'PM' }, { id: 'pharmacy', label: 'Pharmacy' },
]
const TOGGLES: { id: string; label: string }[] = [
  { id: 'manager', label: 'Direct Manager' }, { id: 'hire', label: 'Hiring date' },
  ...CALL_GROUPS.filter((g) => g !== 'missing').map((g) => ({ id: g, label: GROUP_LABEL[g] })),
  { id: 'pharmacy', label: 'Pharmacy' },
]

type Targets = Map<number, { am: number | null; pm: number | null }>

export function CallRateTab({ month, lines, filters, onFilters }: {
  month: string
  lines: { id: number; name: string }[]
  filters: ReportFilters
  onFilters: (f: ReportFilters) => void
}) {
  const data = useAsync(`report:callrate:${month}`, () => fetchCallRateReport(month))
  const targets = useAsync(`report:targets:${month}`, () => fetchRepTargets(month))
  const visitMonths = useAsync('visits:months', fetchVisitMonths)
  const working = useAsync(`wd:${month}`, () => fetchWorkingDays(month))
  const [mode, setMode] = useState<ViewMode>('both')
  const [showMissing, setShowMissing] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [sorted, setSorted] = useState<CallRateRow[]>([])

  const all = data.data
  const managers = useMemo(() => managerOptions(all ?? [], filters.lineId), [all, filters.lineId])
  const effective = managers.includes(filters.manager) ? filters : { ...filters, manager: '' }
  const rows = useMemo(() => defaultOrder(filterRows(all ?? [], effective)), [all, effective.lineId, effective.manager, effective.search]) // eslint-disable-line react-hooks/exhaustive-deps
  const total = useMemo(() => totalCallRate(rows), [rows])
  const onRowsChange = useCallback((r: CallRateRow[]) => setSorted(r), [])
  const toggle = (id: string) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const cols = useMemo(() => buildCols(mode, showMissing, hidden, targets.data ?? null), [mode, showMissing, hidden, targets.data])
  // Pharmacy view is Rep, Box and the pharmacy columns only.
  const idVisible = (id: string) => !hidden.has(id) && !(mode === 'pharmacy' && (id === 'manager' || id === 'hire'))

  const visitDays = visitMonths.data?.find((m) => m.month === month)?.days ?? 0
  const partial = !!all && all.length > 0 && working.data != null && visitDays < working.data

  const records = () => exportCallRate(sorted.length === rows.length ? sorted : rows, total, mode, showMissing, idVisible)
  const name = `call-rate-${mode === 'both' ? 'all' : mode}-${month.slice(0, 7)}`

  return (
    <div className="space-y-3">
      {partial && (
        <div role="status" className="flex items-start gap-2 rounded-card border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span><b>Partial month:</b> visits cover <span className="tnum">{visitDays}</span> of <span className="tnum">{working.data}</span> working days — provisional.</span>
        </div>
      )}
      <ReportToolbar
        lines={lines} filters={effective} onFilters={onFilters} managers={managers}
        columns={TOGGLES} hidden={hidden} onToggleColumn={toggle}
        canExport={rows.length > 0}
        onXlsx={() => void downloadXlsx(`${name}.xlsx`, 'Call rate', records())}
        onCsv={() => downloadCsv(`${name}.csv`, records())}
      >
        <div role="group" aria-label="Shift filter" className="inline-flex rounded-control border bg-card p-0.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              aria-pressed={mode === m.id}
              onClick={() => setMode(m.id)}
              className={cn('rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors', mode === m.id && 'bg-accent font-medium text-accent-foreground')}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={showMissing} onChange={(e) => setShowMissing(e.target.checked)} />
          Show Missing days
        </label>
      </ReportToolbar>
      <ReportTable
        cols={cols} rows={rows} total={total} loading={data.loading} error={data.error} onRetry={data.reload} onRowsChange={onRowsChange}
        emptyTitle={all && all.length === 0 ? `No call-rate data for ${month.slice(0, 7)}` : 'No reps match the filters'}
        emptyDescription={all && all.length === 0 ? 'Call rates appear once the org and calendar exist for the month. Pick another month.' : 'Clear the search or choose another line / manager.'}
      />
    </div>
  )
}

function RateCell({ r, shift, targets }: { r: CallRateRow; shift: 'am' | 'pm' | 'total'; targets: Targets | null }) {
  const v = shift === 'am' ? r.call_rate_am : shift === 'pm' ? r.call_rate_pm : r.call_rate_total
  const target = shift === 'total' || r.rep_id === 0 ? null : targets?.get(r.rep_id)?.[shift] ?? null
  const tone = targetTone(v, target)
  return (
    <div className="leading-tight">
      <span className="inline-flex items-center gap-1.5">
        {tone && <span className={cn('h-2 w-2 rounded-full', DOT[tone])} role="img" aria-label={`${tone} vs target`} />}
        {fmtCallRate(v)}
      </span>
      {target !== null && target > 0 && <div className="text-[11px] font-normal text-muted-foreground">target {fmtTarget(target)}</div>}
    </div>
  )
}

function buildCols(mode: ViewMode, showMissing: boolean, hidden: Set<string>, targets: Targets | null): ReportCol<CallRateRow>[] {
  const stat: ReportCol<CallRateRow>[] = ([
    { id: 'box', header: 'Box', sticky: true, width: 132, value: (r) => r.box, render: (r) => r.box ?? DASH },
    {
      id: 'rep', header: 'Medical Rep', sticky: true, width: 190, value: (r) => r.rep_name,
      render: (r) => (
        <div className="leading-tight">
          <div className="font-medium"><ProfileLink type="rep" id={r.rep_id}>{r.rep_name ?? DASH}</ProfileLink></div>
          <div className="tnum text-[11px] text-muted-foreground">{r.rep_code ?? DASH}</div>
        </div>
      ),
    },
    { id: 'manager', header: 'Direct Manager', value: (r) => r.manager, render: (r) => <ProfileLink type="manager" id={r.manager_id}>{r.manager ?? DASH}</ProfileLink> },
    { id: 'hire', header: 'Hiring date', value: (r) => r.hire_date, render: (r) => fmtHireDate(r.hire_date) },
  ] as ReportCol<CallRateRow>[]).filter((c) => !hidden.has(c.id) && !(mode === 'pharmacy' && (c.id === 'manager' || c.id === 'hire')))
  const grouped: ReportCol<CallRateRow>[] = callRateColumns(mode, showMissing)
    .filter((c) => !hidden.has(c.group))
    .map((c) => ({
      id: c.id,
      header: SHIFT_LABEL[c.shift],
      group: GROUP_LABEL[c.group],
      groupTip: GROUP_TIP[c.group],
      numeric: true,
      width: c.group === 'call_rate' ? 84 : undefined,
      value: (r) => r[c.id] as number | null,
      render: (r) => (c.group === 'call_rate' ? <RateCell r={r} shift={c.shift} targets={targets} /> : fmtCount(r[c.id] as number)),
    }))
  const pharmacy: ReportCol<CallRateRow>[] = showsPharmacy(mode) && !hidden.has('pharmacy')
    ? PHARMACY_COLS.map((c) => ({
        id: c.id,
        header: c.header,
        group: mode === 'both' ? 'Pharmacy' : undefined,
        tip: c.id === 'call_rate_pharmacy' ? 'Pharmacy call rate = pharmacy visits ÷ field days. Not part of Total Visits, Call Rate AM/PM, Ach CR or the KPI.' : undefined,
        numeric: true,
        width: c.id === 'call_rate_pharmacy' ? 110 : undefined,
        value: (r) => r[c.id],
        render: (r) => (c.id === 'field_days' ? fmtDays(r.field_days) : c.id === 'visits_pharmacy' ? fmtCount(r.visits_pharmacy) : fmtCallRate(r.call_rate_pharmacy)),
      }))
    : []
  return [...stat, ...grouped, ...pharmacy]
}
