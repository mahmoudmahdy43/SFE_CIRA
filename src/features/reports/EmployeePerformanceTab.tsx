import { useMemo } from 'react'
import { ProfileLink } from '../../components/app/ProfileLink'
import { EmptyState, ErrorState } from '../../components/app/states'
import { Skeleton } from '../../components/ui/misc'
import { useDateRange } from '../../context/DateRangeContext'
import { downloadCsv } from '../../lib/csv'
import { fetchEmployeePerformance } from '../../lib/api/reports'
import { downloadXlsxGrid } from '../../lib/xlsxExport'
import { useAsync } from '../dashboard/useAsync'
import { PERF_BAND, PERF_COLS, exportPerfFlat, buildPerfGrid, fmtPerf, groupFill, orderPerf, perfCellFill, perfFileName, perfTitle } from './employeePerfMath'
import { ReportToolbar } from './ReportToolbar'
import { filterRows, managerOptions, type ReportFilters } from './reportMath'

const NO_HIDDEN = new Set<string>()
const GROUPS = [
  { id: 'call', label: 'Call Rate', fill: '#FFE699' },
  { id: 'cover', label: 'Coverage', fill: '#C6E0B4' },
] as const

/** Reports → Employee performance: PM shift only, follows the global From / To range; screen and Excel share the colours. */
export function EmployeePerformanceTab({ lines, filters, onFilters }: {
  month?: string
  lines: { id: number; name: string }[]
  filters: ReportFilters
  onFilters: (f: ReportFilters) => void
}) {
  const dr = useDateRange()
  const data = useAsync(`report:employee-performance:${dr.from}:${dr.to}`, () => fetchEmployeePerformance(dr.from, dr.to))

  const all = data.data
  const managers = useMemo(() => managerOptions(all ?? [], filters.lineId), [all, filters.lineId])
  const effective = managers.includes(filters.manager) ? filters : { ...filters, manager: '' }
  const rows = useMemo(() => orderPerf(filterRows(all ?? [], effective)), [all, effective.lineId, effective.manager, effective.search]) // eslint-disable-line react-hooks/exhaustive-deps
  const title = perfTitle(dr.from, dr.to)
  const name = perfFileName(dr.from, dr.to)

  return (
    <div className="space-y-3">
      <ReportToolbar
        lines={lines} filters={effective} onFilters={onFilters} managers={managers}
        columns={[]} hidden={NO_HIDDEN} onToggleColumn={() => undefined}
        canExport={rows.length > 0}
        onXlsx={() => void downloadXlsxGrid(`${name}.xlsx`, buildPerfGrid(rows, dr.from, dr.to))}
        onCsv={() => downloadCsv(`${name}.csv`, exportPerfFlat(rows))}
      />
      <p className="text-xs text-muted-foreground">PM shift only (Clinic + Poly Clinic). Coverage counts the visits inside the selected days against the month&apos;s frequency. Actual CR is red below 70% of Target CR.</p>
      {data.error ? (
        <div className="rounded-card border bg-card"><ErrorState message={data.error} onRetry={data.reload} /></div>
      ) : data.loading ? (
        <div className="space-y-2" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : (
        <div className="overflow-hidden rounded-card border bg-card">
          <div className="px-4 py-2 text-sm font-bold" style={{ background: '#C6E0B4' }}>{title}</div>
          <div className="max-h-[68vh] min-h-[320px] overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th colSpan={PERF_COLS.filter((c) => c.group === 'ident').length} className="sticky top-0 z-20 h-7 border-b border-r" style={{ background: '#C6E0B4' }} />
                  {GROUPS.map((g) => (
                    <th key={g.id} colSpan={PERF_COLS.filter((c) => c.group === g.id).length} className="sticky top-0 z-20 h-7 border-b border-r px-2 py-1 text-center text-xs font-bold" style={{ background: g.fill }}>{g.label}</th>
                  ))}
                </tr>
                <tr>
                  {PERF_COLS.map((c) => (
                    <th key={c.id} className="sticky top-7 z-20 whitespace-normal border-b border-r px-2 py-2 text-center text-xs font-bold" style={{ background: groupFill[c.group] }}>{c.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => {
                  const band = ri % 2 === 1 ? PERF_BAND : '#FFFFFF'
                  return (
                    <tr key={r.rep_id}>
                      {PERF_COLS.map((c) => {
                        const v = c.value(r)
                        return (
                          <td key={c.id} className={`border-b border-r px-2 py-1.5 ${c.kind === 'text' ? 'whitespace-nowrap text-left' : 'tnum text-center'}`} style={{ background: perfCellFill(c, r) ?? band, color: '#111' }}>
                            {c.id === 'rep' ? <ProfileLink type="rep" id={r.rep_id}>{r.rep_name ?? ''}</ProfileLink> : c.id === 'manager' ? <ProfileLink type="manager" id={r.manager_id}>{r.manager ?? ''}</ProfileLink> : fmtPerf(c, v)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {rows.length === 0 && (
              <EmptyState
                title={all && all.length === 0 ? `No data for ${dr.from} → ${dr.to}` : 'No reps match the filters'}
                description={all && all.length === 0 ? 'Coverage appears once the Target List and visits exist for the month. Pick another period.' : 'Clear the search or choose another line / manager.'}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
