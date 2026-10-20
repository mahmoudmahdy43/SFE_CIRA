import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarsChart, CHART, ChartTip, Donut, axisProps } from '../../components/app/charts'
import { ChartCard } from '../../components/app/ChartCard'
import { EmptyState } from '../../components/app/states'
import { monthShort } from './periodMath'
import type { RangeKpi } from './rangeKpi'

export interface LineBar { name: string; kpi: RangeKpi }
export interface TrendPoint { month: string; total_kpi: number | null; coverage: number | null; pcf: number | null; ach_cr: number | null }

const pct = (v: number | null) => (v === null ? undefined : Math.round(v * 1000) / 10)
const SERIES: { key: 'total_kpi' | 'coverage' | 'pcf' | 'ach_cr'; name: string }[] = [
  { key: 'total_kpi', name: 'Total KPI' }, { key: 'coverage', name: 'Coverage' }, { key: 'pcf', name: 'PCF' }, { key: 'ach_cr', name: 'Ach CR (PM)' },
]
const MIX = ['Worked', 'Missing', 'Leave', 'Office work', 'Activity']

/** Charts that follow the selected period: every figure is aggregated from sums over the range (per line = one call per line). */
export default function DashboardCharts({ lines, trend, planned, direct, fromYM, toYM }: {
  lines: LineBar[]
  trend: TrendPoint[]
  planned: number | null
  direct: number | null
  fromYM: string
  toYM: string
}) {
  const kpiBars = lines.map((l) => ({ line: l.name, 'Total KPI': pct(l.kpi.total_kpi) ?? 0 }))
  const mixBars = lines.map((l) => {
    const k = l.kpi
    const missing = k.missing_days
    return { line: l.name, Worked: Math.max(0, k.days_am + k.days_pm - missing), Missing: missing, Leave: k.leave_days, 'Office work': k.ow_days, Activity: k.activity_days }
  })
  const trendData = trend.map((t) => {
    const row: Record<string, string | number> = { label: monthShort(t.month.slice(0, 7)), ym: t.month.slice(0, 7) }
    for (const s of SERIES) { const p = pct(t[s.key]); if (p !== undefined) row[s.name] = p }
    return row
  })
  const inRange = trendData.filter((d) => (d.ym as string) >= fromYM && (d.ym as string) <= toYM)
  const hasSplit = (planned ?? 0) + (direct ?? 0) > 0
  return (
    <div className="grid gap-6 xl:grid-cols-12">
      <ChartCard className="xl:col-span-8" title="Monthly trend" description="Every month with data; the selected period is shaded." legend={SERIES.map((s, i) => ({ label: s.name, color: CHART[i] }))}>
        {trendData.length < 2 ? (
          <EmptyState title="Trend needs two months" description="Load another month to see how the KPIs move." className="py-12" />
        ) : (
          <div role="img" aria-label="Line chart of the monthly KPIs" className="h-64">
            <ResponsiveContainer>
              <LineChart data={trendData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                {inRange.length > 0 && <ReferenceArea x1={inRange[0].label as string} x2={inRange[inRange.length - 1].label as string} fill="hsl(var(--primary))" fillOpacity={0.08} />}
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={(v: number) => `${v}%`} />
                <Tooltip content={<ChartTip fmt={(v) => `${v.toFixed(1)}%`} />} cursor={{ stroke: 'hsl(var(--border))' }} />
                {SERIES.map((s, i) => <Line key={s.key} dataKey={s.name} name={s.name} stroke={CHART[i]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>
      <ChartCard className="xl:col-span-4" title="Planned vs Direct" description="Rep visits in the period" legend={[{ label: 'Planned', color: CHART[0] }, { label: 'Direct', color: CHART[1] }]}>
        {hasSplit ? <Donut data={[{ name: 'Planned', value: planned ?? 0 }, { name: 'Direct', value: direct ?? 0 }]} centerLabel="visits" /> : <EmptyState title="No visits in this period" className="py-12" />}
      </ChartCard>
      <ChartCard className="xl:col-span-4" title="Total KPI by line" description="Aggregated over the period" legend={[{ label: 'Total KPI', color: CHART[0] }]}>
        {kpiBars.length === 0 ? <EmptyState title="No lines" className="py-12" /> : <BarsChart data={kpiBars} xKey="line" series={[{ key: 'Total KPI', name: 'Total KPI' }]} />}
      </ChartCard>
      <ChartCard className="xl:col-span-8" title="Status mix by line" description="Working slots by outcome; leave, office work and activity days are removed from actual days" legend={MIX.map((l, i) => ({ label: l, color: CHART[i] }))}>
        {mixBars.length === 0 ? <EmptyState title="No lines" className="py-12" /> : <BarsChart data={mixBars} xKey="line" stacked suffix="" series={MIX.map((k) => ({ key: k, name: k }))} />}
      </ChartCard>
    </div>
  )
}
