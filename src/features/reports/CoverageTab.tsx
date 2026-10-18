import { lastDayOf, rangeFileSlug } from '../../lib/dateRange'
import { ProfileLink } from '../../components/app/ProfileLink'
import { useCallback, useMemo, useState } from 'react'
import { downloadCsv } from '../../lib/csv'
import { downloadXlsx } from '../../lib/xlsxExport'
import { fetchCoverageReport } from '../../lib/api/reports'
import { useAsync } from '../dashboard/useAsync'
import { CoverageDrawer } from './CoverageDrawer'
import { ReportTable, type ReportCol } from './ReportTable'
import { ReportToolbar } from './ReportToolbar'
import {
  defaultOrder, exportCoverage, filterRows, fmtCoverage, fmtCount, fmtHireDate, managerOptions, totalCoverage,
  DASH, type CoverageRow, type ReportFilters,
} from './reportMath'

const TIPS = {
  fully: 'Fully covered: visits ≥ Freq.',
  partial: 'Partially covered: 1 ≤ visits < Freq.',
  not_visited: 'Not visited: 0 visits.',
  coverage: 'Coverage % = (fully + partially) ÷ List.',
}

const TOGGLES = [
  { id: 'manager', label: 'Direct Manager' }, { id: 'hire', label: 'Hiring date' }, { id: 'list', label: 'List' },
  { id: 'fully', label: 'Fully covered' }, { id: 'partial', label: 'Partially covered' }, { id: 'not_visited', label: 'Not visited' },
  { id: 'coverage', label: 'Coverage %' },
]

function CoverageCell({ v }: { v: number | null }) {
  if (v === null) return <span>{DASH}</span>
  const pct = Math.max(0, Math.min(1, v))
  return (
    <div className="ml-auto w-24">
      <div className="text-right font-medium">{fmtCoverage(v)}</div>
      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct * 100}%`, opacity: 0.35 + 0.65 * pct }} />
      </div>
    </div>
  )
}

const COLS: ReportCol<CoverageRow>[] = [
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
  { id: 'list', header: 'List', numeric: true, value: (r) => r.list_doctors, render: (r) => fmtCount(r.list_doctors) },
  { id: 'fully', header: 'Fully covered', tip: TIPS.fully, numeric: true, value: (r) => r.fully_covered, render: (r) => fmtCount(r.fully_covered) },
  { id: 'partial', header: 'Partially covered', tip: TIPS.partial, numeric: true, value: (r) => r.partially_covered, render: (r) => fmtCount(r.partially_covered) },
  { id: 'not_visited', header: 'Not visited', tip: TIPS.not_visited, numeric: true, value: (r) => r.not_visited, render: (r) => fmtCount(r.not_visited) },
  { id: 'coverage', header: 'Coverage %', tip: TIPS.coverage, numeric: true, width: 130, value: (r) => r.coverage, render: (r) => <CoverageCell v={r.coverage} /> },
]

export function CoverageTab({ month, lines, filters, onFilters }: {
  month: string
  lines: { id: number; name: string }[]
  filters: ReportFilters
  onFilters: (f: ReportFilters) => void
}) {
  const data = useAsync(`report:coverage:${month}`, () => fetchCoverageReport(month))
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [drawer, setDrawer] = useState<CoverageRow | null>(null)
  const [sorted, setSorted] = useState<CoverageRow[]>([])

  const all = data.data
  const managers = useMemo(() => managerOptions(all ?? [], filters.lineId), [all, filters.lineId])
  const effective = managers.includes(filters.manager) ? filters : { ...filters, manager: '' }
  const rows = useMemo(() => defaultOrder(filterRows(all ?? [], effective)), [all, effective.lineId, effective.manager, effective.search]) // eslint-disable-line react-hooks/exhaustive-deps
  const total = useMemo(() => totalCoverage(rows), [rows])
  const cols = useMemo(() => COLS.filter((c) => !hidden.has(c.id)), [hidden])
  const onRowsChange = useCallback((r: CoverageRow[]) => setSorted(r), [])
  const toggle = (id: string) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const records = () => exportCoverage(sorted.length === rows.length ? sorted : rows, total, (id) => !hidden.has(id))
  const name = `coverage-${rangeFileSlug(month, lastDayOf(month))}`

  return (
    <div className="space-y-3">
      <ReportToolbar
        lines={lines} filters={effective} onFilters={onFilters} managers={managers}
        columns={TOGGLES} hidden={hidden} onToggleColumn={toggle}
        canExport={rows.length > 0}
        onXlsx={() => void downloadXlsx(`${name}.xlsx`, 'Coverage', records())}
        onCsv={() => downloadCsv(`${name}.csv`, records())}
      />
      <p className="text-xs text-muted-foreground">Pharmacy visits are not part of Coverage / PCF.</p>
      <ReportTable
        cols={cols} rows={rows} total={total} loading={data.loading} error={data.error} onRetry={data.reload}
        onRowClick={setDrawer} onRowsChange={onRowsChange}
        emptyTitle={all && all.length === 0 ? `No coverage data for ${month.slice(0, 7)}` : 'No reps match the filters'}
        emptyDescription={all && all.length === 0 ? 'Coverage appears once the Target List and visits exist for the month. Pick another month.' : 'Clear the search or choose another line / manager.'}
      />
      <CoverageDrawer rep={drawer} month={month} onClose={() => setDrawer(null)} />
    </div>
  )
}
