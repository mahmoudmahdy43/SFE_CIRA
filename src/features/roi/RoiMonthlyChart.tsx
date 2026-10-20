import { useMemo } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartCard } from '../../components/app/ChartCard'
import { CHART, ChartTip, axisProps } from '../../components/app/charts'
import { EmptyState, ErrorState } from '../../components/app/states'
import { Skeleton } from '../../components/ui/misc'
import type { RoiMonth } from '../../lib/api/roi'
import { fmtInt } from '../dashboard/kpiMath'
import { monthShort } from '../dashboard/periodMath'
import { fmtMoney } from '../dashboard/rangeKpi'
import { RoiBadge } from './RoiBadge'
import type { Measure } from './roiMath'

/** Columns = visits (left axis), line = sales (right axis, Value or Units). Sales per visit and ROI below always use the value. */
export function RoiMonthlyChart({ title = 'Visits and sales by month', rows, measure, loading, error, onRetry, note }: {
  title?: string; rows: RoiMonth[] | null; measure: Measure; loading: boolean; error: string | null; onRetry: () => void; note?: string
}) {
  const chart = useMemo(() => (rows ?? []).map((m) => ({ ...m, label: monthShort(m.month.slice(0, 7)), sales: measure === 'value' ? m.s_value : m.s_units })), [rows, measure])
  const has = chart.some((m) => m.s_value > 0 || m.s_units > 0 || m.visits > 0)
  const unit = measure === 'value' ? 'Sales (EGP)' : 'Sales (units)'
  return (
    <ChartCard title={title} description={`Columns = visits (left axis); line = ${measure === 'value' ? 'sales in EGP' : 'units sold'} (right axis). ROI and sales per visit are always by value.`}>
      {note && <p className="mb-2 rounded-control bg-warning-soft px-3 py-2 text-13 text-warning" role="status">{note}</p>}
      {error ? <ErrorState title="Could not load the months" message={error} onRetry={onRetry} className="py-8" />
        : loading ? <Skeleton className="h-64 w-full" />
        : !has ? <EmptyState title="No visits or sales in the period" className="py-8" />
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
                  <Line yAxisId="s" dataKey="sales" name={unit} stroke={CHART[1]} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
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
  )
}
