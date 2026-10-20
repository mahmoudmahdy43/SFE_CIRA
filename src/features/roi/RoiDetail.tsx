import { useMemo, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ChartCard } from '../../components/app/ChartCard'
import { CHART, ChartTip, axisProps } from '../../components/app/charts'
import { EmptyState, ErrorState } from '../../components/app/states'
import { Button } from '../../components/ui/button'
import { Card, Skeleton } from '../../components/ui/misc'
import { fetchRoiLink, fetchRoiMonthly, fetchRoiTerritories, type RoiRow, type RoiTerritory } from '../../lib/api/roi'
import { fmtInt } from '../dashboard/kpiMath'
import { monthShort } from '../dashboard/periodMath'
import { fmtMoney } from '../dashboard/rangeKpi'
import { PRIORITY, useDash, useNearViewport } from '../dashboard/useDash'
import { RoiTable, type RoiCol } from './RoiTable'
import { buildTerritoriesGrid, downloadRoiWorkbook } from './roiExport'
import { corrWord, fmtRoi, type Shift } from './roiMath'
import { RoiBadge } from './RoiBadge'

/** Section for the selected group. Its three calls start only when it is near the viewport. */
export function RoiDetail({ group, from, to, shift, rev, periodLine }: { group: RoiRow; from: string; to: string; shift: Shift; rev: number; periodLine: string }) {
  const [ref, seen] = useNearViewport()
  const k = `${rev}:${group.group_id}:${from}:${to}:${shift}`
  const monthly = useDash(seen ? `roi:m:${k}` : null, PRIORITY.lazy, (s) => fetchRoiMonthly(group.group_id, from, to, shift, s))
  const terr = useDash(seen ? `roi:t:${k}` : null, PRIORITY.lazy, (s) => fetchRoiTerritories(group.group_id, from, to, shift, s))
  const link = useDash(seen ? `roi:l:${k}` : null, PRIORITY.lazy, (s) => fetchRoiLink(group.group_id, from, to, shift, s))

  const chart = useMemo(() => (monthly.data ?? []).map((m) => ({ ...m, label: monthShort(m.month.slice(0, 7)) })), [monthly.data])
  const hasSales = chart.some((m) => m.s_value > 0 || m.visits > 0)

  const cols: RoiCol<RoiTerritory>[] = useMemo(() => [
    { id: 'territory', header: 'Territory', value: (r) => r.territory_name },
    { id: 'rep', header: 'Rep', value: (r) => r.rep_name, render: (r) => r.rep_name ?? '—' },
    { id: 'manager', header: 'Manager', value: (r) => r.manager_name, render: (r) => r.manager_name ?? '—' },
    { id: 'visits', header: 'Visits', numeric: true, value: (r) => r.visits, render: (r) => fmtInt(r.visits) },
    { id: 'sales', header: 'Sales (EGP)', numeric: true, value: (r) => r.s_value, render: (r) => fmtInt(r.s_value) },
    { id: 'cost', header: 'Visit cost', numeric: true, value: (r) => r.cost, render: (r) => fmtInt(r.cost) },
    { id: 'spv', header: 'Sales per visit', numeric: true, value: (r) => r.sales_per_visit, render: (r) => fmtInt(r.sales_per_visit) },
    { id: 'roi', header: 'ROI', numeric: true, value: (r) => r.roi, render: (r) => <RoiBadge roi={r.roi} /> },
  ], [])

  const [busy, setBusy] = useState(false)
  const exportTerr = async () => {
    setBusy(true)
    try { await downloadRoiWorkbook(`territories-${group.group_name}.xlsx`, [buildTerritoriesGrid([{ group, rows: terr.data ?? [] }], periodLine)]) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Export failed') }
    finally { setBusy(false) }
  }

  return (
    <div ref={ref} className="space-y-4" aria-label={`Selected group: ${group.group_name}`}>
      <h2 className="text-base font-semibold">{group.line_name} · {group.group_name}</h2>

      <ChartCard title="Visits and sales by month" description="Columns = visits (left axis); line = sales in EGP (right axis).">
        {monthly.error ? <ErrorState title="Could not load the months" message={monthly.error} onRetry={monthly.reload} className="py-8" />
          : monthly.loading ? <Skeleton className="h-64 w-full" />
          : !hasSales ? <EmptyState title="No visits or sales for this group in the period" className="py-8" />
          : (
            <>
              <div role="img" aria-label="Visits and sales by month" className="h-64">
                <ResponsiveContainer>
                  <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" {...axisProps} />
                    <YAxis yAxisId="v" {...axisProps} />
                    <YAxis yAxisId="s" orientation="right" {...axisProps} tickFormatter={(v: number) => fmtMoney(v)} />
                    <Tooltip content={<ChartTip fmt={(v) => Math.round(v).toLocaleString('en-US')} />} cursor={{ fill: 'hsl(var(--muted))' }} />
                    <Bar yAxisId="v" dataKey="visits" name="Visits" fill={CHART[0]} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                    <Line yAxisId="s" dataKey="s_value" name="Sales (EGP)" stroke={CHART[1]} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-max text-13" aria-label="Sales per visit and ROI by month">
                  <thead><tr><th className="py-1 pr-3 text-left text-xs font-medium text-muted-foreground" />{chart.map((m) => <th key={m.month} className="px-2 py-1 text-right text-xs font-medium text-muted-foreground">{m.label}</th>)}</tr></thead>
                  <tbody>
                    <tr><th className="py-1 pr-3 text-left text-xs font-medium">Sales per visit</th>{chart.map((m) => <td key={m.month} className="tnum px-2 py-1 text-right">{fmtInt(m.sales_per_visit)}</td>)}</tr>
                    <tr><th className="py-1 pr-3 text-left text-xs font-medium">ROI</th>{chart.map((m) => <td key={m.month} className="px-2 py-1 text-right"><RoiBadge roi={m.roi} /></td>)}</tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
      </ChartCard>

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Territories</h3>
          <Button size="sm" disabled={busy || !terr.data?.length} onClick={() => void exportTerr()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />}Excel
          </Button>
        </div>
        {terr.error ? <ErrorState title="Could not load the territories" message={terr.error} onRetry={terr.reload} className="py-8" />
          : terr.loading ? <Skeleton className="h-40 w-full" />
          : (terr.data ?? []).length === 0 ? <EmptyState title="No territory has visits or sales for this group" className="py-8" />
          : <RoiTable label="Territories" cols={cols} rows={terr.data ?? []} rowKey={(r) => r.territory_id} initial={{ id: 'spv', dir: 'desc' }} />}
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold">Are more visits linked with more sales?</h3>
        {link.error ? <ErrorState title="Could not load the link" message={link.error} onRetry={link.reload} className="py-6" />
          : link.loading ? <Skeleton className="mt-3 h-16 w-full" />
          : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {[0, 1].map((lag) => {
                const row = (link.data ?? []).find((x) => x.lag === lag)
                return (
                  <li key={lag} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{lag === 0 ? 'Same month' : 'Visits of the month before'}:</span>
                    <span>{corrWord(row?.r ?? null)}</span>
                    {row?.r != null && <span className="tnum text-muted-foreground">(r = {row.r.toFixed(2)}, {row.n} territory-months)</span>}
                  </li>
                )
              })}
            </ul>
          )}
        <p className="mt-3 text-xs italic text-muted-foreground">Compares each territory with itself over time; a link is not proof of cause.</p>
      </Card>
      <span className="sr-only">{fmtRoi(group.roi)}</span>
    </div>
  )
}
