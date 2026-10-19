import { useMemo } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { KpiCard } from '../../components/app/KpiCard'
import { ChartCard } from '../../components/app/ChartCard'
import { CHART } from '../../components/app/charts'
import { Card } from '../../components/ui/misc'
import { useAsync } from '../dashboard/useAsync'
import { fetchBands, fetchCorrelations, fetchOverview, fetchTerritorySummary, type Range } from '../../lib/api/dashV1'
import { insights, money, monthLabel, num, overviewTotals, pct, previousPeriod, ptsChange, relChange } from './dashMath'
import { AXIS, Loadable } from './ui'

const key = (n: string, r: Range) => `dashv1:${n}:${r.from}:${r.to}:${r.line ?? 'all'}`

export function OverviewTab({ range }: { range: Range }) {
  const prev = previousPeriod(range.from, range.to)
  const prevRange: Range = { ...range, ...prev }
  const cur = useAsync(key('overview', range), () => fetchOverview(range))
  const old = useAsync(key('overview', prevRange), () => fetchOverview(prevRange))
  const corr = useAsync(key('corr', range), () => fetchCorrelations(range))
  const bands = useAsync(key('bands', range), () => fetchBands(range))
  const terr = useAsync(key('terr', range), () => fetchTerritorySummary(range))

  const t = useMemo(() => (cur.data ? overviewTotals(cur.data) : null), [cur.data])
  const p = useMemo(() => (old.data && old.data.length ? overviewTotals(old.data) : null), [old.data])
  const loading = cur.loading
  const empty = !loading && (!cur.data || cur.data.length === 0)
  const chart = useMemo(() => (cur.data ?? []).map((r) => ({ month: monthLabel(r.month), Sales: r.s_value, Visits: r.visits })), [cur.data])
  const sentences = useMemo(() => insights({ corr: corr.data, bands: bands.data, territories: terr.data }), [corr.data, bands.data, terr.data])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Sales (EGP)" loading={loading} empty={empty} value={t ? money(t.sales) : undefined}
          delta={t && p ? relChange(t.sales, p.sales) ?? undefined : undefined} deltaSuffix="%" />
        <KpiCard label="Achievement" loading={loading} empty={empty} value={t ? pct(t.ach) : undefined}
          delta={t && p ? ptsChange(t.ach, p.ach) ?? undefined : undefined} tooltip="Sales ÷ target over the period." />
        <KpiCard label="Coverage · PCF" loading={loading} empty={empty} value={t ? `${pct(t.coverage)} · ${pct(t.pcf)}` : undefined}
          delta={t && p ? ptsChange(t.coverage, p.coverage) ?? undefined : undefined}
          tooltip="Coverage = covered ÷ list doctors over the period. PCF = value of the last month." />
        <KpiCard label="Visits · Call Rate PM" loading={loading} empty={empty} value={t ? `${num(t.visits)} · ${num(t.callRate, 1)}` : undefined}
          delta={t && p ? relChange(t.visits, p.visits) ?? undefined : undefined} deltaSuffix="%"
          tooltip="Visits, and visits ÷ PM field days." />
      </div>

      <ChartCard title="Sales vs visits" description="Sales (line, left axis) and visits (dashed, right axis) by month.">
        <Loadable state={cur}>
          {() => (
            <div role="img" aria-label="Sales and visits by month" className="h-64">
              <ResponsiveContainer>
                <LineChart data={chart} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" {...AXIS} />
                  <YAxis yAxisId="s" {...AXIS} tickFormatter={(v: number) => money(v)} />
                  <YAxis yAxisId="v" orientation="right" {...AXIS} tickFormatter={(v: number) => num(v)} />
                  <Tooltip formatter={(v: number, name: string) => (name === 'Sales' ? money(v) : num(v))} />
                  <Legend />
                  <Line yAxisId="s" dataKey="Sales" stroke={CHART[0]} strokeWidth={2} dot />
                  <Line yAxisId="v" dataKey="Visits" stroke={CHART[1]} strokeWidth={2} strokeDasharray="5 4" dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Loadable>
      </ChartCard>

      <Card className="p-5">
        <h3 className="mb-2 text-sm font-semibold">What the data says</h3>
        {corr.loading || bands.loading || terr.loading ? (
          <p className="text-sm text-muted-foreground">Reading the numbers…</p>
        ) : sentences.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not enough data to draw conclusions for this period.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm">{sentences.map((s) => <li key={s.id}>{s.text}</li>)}</ul>
        )}
      </Card>
    </div>
  )
}
