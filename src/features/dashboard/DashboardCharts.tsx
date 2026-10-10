import { BarsChart, CHART, Donut, TrendLine } from '../../components/app/charts'
import { ChartCard } from '../../components/app/ChartCard'
import { EmptyState } from '../../components/app/states'
import { Card } from '../../components/ui/misc'
import { statusMix, type KpiNumbers } from './kpiMath'

export interface LineBar { name: string; kpi: KpiNumbers }
export interface TrendPoint { month: string; kpi: KpiNumbers }

const pct = (v: number | null) => (v === null ? undefined : Math.round(v * 1000) / 10)

/** Heavy chart section; loaded lazily so the landing page stays fast. */
export default function DashboardCharts({ lines, trend, planned, direct }: { lines: LineBar[]; trend: TrendPoint[]; planned: number | null; direct: number | null }) {
  const kpiBars = lines.map((l) => ({ line: l.name, 'Total KPI': pct(l.kpi.total_kpi) ?? 0 }))
  const mixBars = lines.map((l) => {
    const m = statusMix(l.kpi)
    return { line: l.name, Worked: m.worked, Missing: m.missing, Leave: m.leave, 'Office work': m.office_work, Activity: m.activity }
  })
  const trendData = trend.map((t) => {
    const row: Record<string, string | number> = { month: t.month.slice(0, 7) }
    const set = (k: string, v: number | null) => { const p = pct(v); if (p !== undefined) row[k] = p }
    set('Total KPI', t.kpi.total_kpi); set('Coverage', t.kpi.coverage); set('PCF', t.kpi.pcf); set('Ach CR', t.kpi.ach_cr)
    return row
  })
  const hasSplit = (planned ?? 0) + (direct ?? 0) > 0
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ChartCard className="lg:col-span-2" title="Monthly trend" description="From the company KPI view, every month with data" legend={['Total KPI', 'Coverage', 'PCF', 'Ach CR'].map((l, i) => ({ label: l, color: CHART[i] }))}>
        {trendData.length < 2 ? (
          <EmptyState title="Trend needs two months" description="Load another month to see how the KPIs move." className="py-12" />
        ) : (
          <TrendLine data={trendData} xKey="month" series={['Total KPI', 'Coverage', 'PCF', 'Ach CR'].map((k) => ({ key: k, name: k }))} />
        )}
      </ChartCard>
      <ChartCard title="Planned vs Direct" description="Rep visits this month" legend={[{ label: 'Planned', color: CHART[0] }, { label: 'Direct', color: CHART[1] }]}>
        {hasSplit ? <Donut data={[{ name: 'Planned', value: planned ?? 0 }, { name: 'Direct', value: direct ?? 0 }]} centerLabel="visits" /> : <EmptyState title="No visits yet" className="py-12" />}
      </ChartCard>
      <ChartCard title="Total KPI by line" legend={[{ label: 'Total KPI', color: CHART[0] }]}>
        {kpiBars.length === 0 ? <EmptyState title="No lines" className="py-12" /> : <BarsChart data={kpiBars} xKey="line" series={[{ key: 'Total KPI', name: 'Total KPI' }]} />}
      </ChartCard>
      <ChartCard className="lg:col-span-2" title="Status mix by line" description="Working slots by outcome (leave, office work and activity days are removed from actual days)" legend={['Worked', 'Missing', 'Leave', 'Office work', 'Activity'].map((l, i) => ({ label: l, color: CHART[i] }))}>
        {mixBars.length === 0 ? <Card className="border-0"><EmptyState title="No lines" className="py-12" /></Card> : <BarsChart data={mixBars} xKey="line" stacked suffix="" series={['Worked', 'Missing', 'Leave', 'Office work', 'Activity'].map((k) => ({ key: k, name: k }))} />}
      </ChartCard>
    </div>
  )
}
