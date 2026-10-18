import { ProfileLink } from '../../components/app/ProfileLink'
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Info, TriangleAlert } from 'lucide-react'
import { Tooltip } from '../../components/ui/overlay'
import { useAuth } from '../../context/AuthContext'
import { downloadCsv } from '../../lib/csv'
import { downloadXlsxStyled } from '../../lib/xlsxExport'
import { fetchSpecialityMix, fetchSpecialityMixLine } from '../../lib/api/speciality'
import { cn } from '../../lib/utils'
import { useAsync } from '../dashboard/useAsync'
import { ReportTable, type ReportCol } from './ReportTable'
import { ReportToolbar } from './ReportToolbar'
import {
  MIX_DASH, NO_STRATEGY_TEXT, buildLineRows, buildRepRows, cellTip, exportMix, filterMixRows, fmtMixCount, fmtMixPct, hasStrategy, isMixTotal,
  mixManagers, mixThreshold, orderMixRows, specialityColumns, thresholdText, totalMixRow,
  type MixCell, type MixKind, type MixRow,
} from './specialityMath'
import type { ReportFilters } from './reportMath'

interface Props {
  month: string
  lines: { id: number; name: string }[]
  filters: ReportFilters
  onFilters: (f: ReportFilters) => void
}

/** Doctor count, with "actual share / strategy" underneath; soft red when the view flagged the cell (is_off). */
function MixCellView({ cell }: { cell: MixCell | undefined }) {
  if (!cell) return <span className="text-muted-foreground">0</span>
  return (
    <Tooltip side="top" content={<span className="block max-w-72">{cellTip(cell)}</span>}>
      <div className={cn('ml-auto w-fit min-w-[4.75rem] rounded-md px-2 py-1 text-right leading-tight', cell.is_off && 'bg-danger-soft text-danger')}>
        <div className="font-medium">{fmtMixCount(cell.doctors)}</div>
        <div className={cn('text-[11px]', cell.is_off ? 'text-danger/80' : 'text-muted-foreground')}>
          {fmtMixPct(cell.share_pct)} / {fmtMixPct(cell.strategy_pct)}
        </div>
      </div>
    </Tooltip>
  )
}

function KindToggle({ value, onChange }: { value: MixKind; onChange: (v: MixKind) => void }) {
  const views = [{ id: 'rep', label: 'By rep' }, { id: 'line', label: 'By line' }] as const
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

export function SpecialityMixTab({ month, lines, filters, onFilters }: Props) {
  const { role } = useAuth()
  const repData = useAsync(`report:speciality:rep:${month}`, () => fetchSpecialityMix(month))
  const lineData = useAsync(`report:speciality:line:${month}`, () => fetchSpecialityMixLine(month))
  const [kind, setKind] = useState<MixKind>('rep')
  const [onlyRed, setOnlyRed] = useState(false)
  const [sorted, setSorted] = useState<MixRow[]>([])

  const data = kind === 'rep' ? repData : lineData
  const all = useMemo(() => (data.data ? (kind === 'rep' ? buildRepRows(data.data) : buildLineRows(data.data)) : []), [data.data, kind])
  // The views carry the line name, the shared filter carries the line id.
  const lineName = filters.lineId === null ? null : lines.find((l) => l.id === filters.lineId)?.name ?? null
  const managers = useMemo(() => (kind === 'rep' ? mixManagers(all, lineName) : []), [all, lineName, kind])
  const effective = managers.includes(filters.manager) ? filters : { ...filters, manager: '' }

  const rows = useMemo(
    () => orderMixRows(filterMixRows(all, { line: lineName, manager: kind === 'rep' ? effective.manager : '', search: effective.search, onlyRed: kind === 'rep' && onlyRed })),
    [all, lineName, kind, effective.manager, effective.search, onlyRed],
  )
  const specs = useMemo(() => specialityColumns(rows), [rows])
  const threshold = useMemo(() => mixThreshold(all), [all])
  const total = useMemo(
    () => totalMixRow(rows, specs, threshold, `Total · ${rows.length} ${kind === 'rep' ? 'reps' : 'lines'}`),
    [rows, specs, threshold, kind],
  )
  const onRowsChange = useCallback((r: MixRow[]) => setSorted(r), [])

  const cols = useMemo<ReportCol<MixRow>[]>(() => {
    const identity: ReportCol<MixRow>[] =
      kind === 'rep'
        ? [
            {
              id: 'rep', header: 'Rep', sticky: true, width: 190, value: (r) => r.rep_name,
              render: (r) => <span className="font-medium"><ProfileLink type="rep" id={kind === 'rep' ? r.rep_id : null}>{r.rep_name ?? MIX_DASH}</ProfileLink></span>,
            },
            { id: 'code', header: 'Code', value: (r) => r.rep_code, render: (r) => (isMixTotal(r) ? '' : r.rep_code ?? MIX_DASH) },
            { id: 'line', header: 'Line', value: (r) => r.line, render: (r) => (isMixTotal(r) ? '' : r.line ?? MIX_DASH) },
            { id: 'manager', header: 'Manager', value: (r) => r.manager, render: (r) => r.manager ?? MIX_DASH },
          ]
        : [{ id: 'rep', header: 'Line', sticky: true, width: 190, value: (r) => r.rep_name, render: (r) => <span className="font-medium">{r.rep_name ?? MIX_DASH}</span> }]
    return [
      ...identity,
      { id: 'total_docs', header: 'Total doctors', numeric: true, value: (r) => r.total_docs, render: (r) => fmtMixCount(r.total_docs) },
      ...specs.map<ReportCol<MixRow>>((sp) => ({
        id: `s:${sp}`, header: sp, numeric: true, width: 112,
        value: (r) => r.cells.get(sp)?.doctors ?? 0,
        render: (r) => <MixCellView cell={r.cells.get(sp)} />,
      })),
    ]
  }, [kind, specs])

  const noData = !!data.data && data.data.length === 0
  const noStrategy = !noData && all.length > 0 && !hasStrategy(all)
  const name = `speciality-mix-${kind}-${month.slice(0, 7)}`
  const records = () => exportMix(sorted.length === rows.length ? sorted : rows, specs, total, kind)
  const exportXlsx = () => {
    const x = records()
    void downloadXlsxStyled(`${name}.xlsx`, [
      { name: kind === 'rep' ? 'Speciality Mix' : 'Speciality Mix (Line)', rows: x.doctors, redCells: x.doctorsRed },
      { name: 'Shares', rows: x.shares, redCells: x.sharesRed },
    ])
  }

  return (
    <div className="space-y-3">
      <ReportToolbar
        lines={lines} filters={effective} onFilters={onFilters} managers={managers}
        columns={[]} hidden={new Set()} onToggleColumn={() => undefined}
        canExport={rows.length > 0 && specs.length > 0}
        onXlsx={exportXlsx}
        onCsv={() => downloadCsv(`${name}.csv`, records().doctors)}
        roleSelect={kind === 'line' ? <></> : undefined}
        searchLabel={kind === 'rep' ? 'Search rep name or code' : 'Search line'}
        searchPlaceholder={kind === 'rep' ? 'Rep name or code…' : 'Line…'}
      >
        <KindToggle value={kind} onChange={(v) => { setKind(v); setSorted([]) }} />
        {kind === 'rep' && (
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" role="switch" checked={onlyRed} onChange={(e) => setOnlyRed(e.target.checked)} />
            Show only reps with a red speciality
          </label>
        )}
      </ReportToolbar>

      {noStrategy && (
        <div role="status" className="flex items-start gap-2 rounded-card border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {NO_STRATEGY_TEXT}
            {role === 'admin' && <> · <Link to="/list-strategy" className="font-medium underline">Open List Strategy</Link></>}
          </span>
        </div>
      )}

      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5" aria-hidden />
        <span>Each cell shows the number of doctors, then actual share / strategy. Clinics and Poly Clinics doctors of the list only.</span>
        {threshold !== null && (
          <span>
            {thresholdText(threshold)}.{role === 'admin' && <> <Link to="/list-strategy" className="font-medium text-foreground underline">Change in List Strategy</Link></>}
          </span>
        )}
      </p>

      <ReportTable
        key={kind}
        cols={cols} rows={rows} total={total} loading={data.loading} error={data.error} onRetry={data.reload} onRowsChange={onRowsChange}
        emptyTitle={noData ? `No speciality data for ${month.slice(0, 7)}` : kind === 'rep' && onlyRed ? 'No reps with a red speciality' : 'Nothing matches the filters'}
        emptyDescription={
          noData
            ? 'The mix appears once the Target List exists for the month. Pick another month.'
            : kind === 'rep' && onlyRed
              ? 'Every rep in the selection is within the threshold. Switch the filter off to see all reps.'
              : 'Clear the search or choose another line / manager.'
        }
      />
    </div>
  )
}
