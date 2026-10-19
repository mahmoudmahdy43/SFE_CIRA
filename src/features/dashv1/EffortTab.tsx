import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, Line, ReferenceLine } from 'recharts'
import { ChartCard } from '../../components/app/ChartCard'
import { CHART } from '../../components/app/charts'
import { useAsync } from '../dashboard/useAsync'
import { fetchBands, fetchCorrelations, fetchTerritoryMonth, type Range } from '../../lib/api/dashV1'
import { corrValue, corrWord, linearFit, metricLabel, monthsWithoutList, pct, scatterPoints } from './dashMath'
import { AXIS, Loadable, SegToggle, SortTable, signTone } from './ui'

const key = (n: string, r: Range) => `dashv1:${n}:${r.from}:${r.to}:${r.line ?? 'all'}`

export function EffortTab({ range, lineName }: { range: Range; lineName: string | null }) {
  const [lag, setLag] = useState<0 | 1>(1)
  const corr = useAsync(key('corr', range), () => fetchCorrelations(range))
  const bands = useAsync(key('bands', range), () => fetchBands(range))
  // territory-month is fetched for all lines once per period; the line filter is applied here
  const tm = useAsync(`dashv1:tm:${range.from}:${range.to}`, () => fetchTerritoryMonth(range.from, range.to))

  const bars = useMemo(
    () => (corr.data ?? []).filter((c) => c.lag === lag).map((c) => ({ metric: metricLabel(c.metric), r: corrValue(c) ?? 0, has: corrValue(c) !== null })),
    [corr.data, lag],
  )
  const dots = useMemo(() => scatterPoints(tm.data ?? [], range.line, lineName), [tm.data, range.line, lineName])
  const fit = useMemo(() => linearFit(dots), [dots])
  const trend = useMemo(() => {
    if (!fit || dots.length === 0) return []
    const xs = dots.map((d) => d.x)
    const lo = Math.min(...xs), hi = Math.max(...xs)
    return [{ x: lo, t: fit.intercept + fit.slope * lo }, { x: hi, t: fit.intercept + fit.slope * hi }]
  }, [fit, dots])
  const noList = useMemo(() => monthsWithoutList(tm.data ?? []), [tm.data])

  return (
    <div className="space-y-4">
      {noList.length > 0 && (
        <div role="alert" className="rounded-control bg-warning-soft px-3 py-2 text-sm text-warning">
          {noList.map((m) => `List for ${m.slice(0, 7)} has no territory — run the backfill`).join('. ')}.
        </div>
      )}
      <ChartCard
        title="What moves sales?"
        description="Correlation with sales (0 = none, 1 = perfect)."
        actions={<SegToggle label="Lag" value={lag} onChange={setLag} options={[{ value: 0, label: 'Same month' }, { value: 1, label: 'Month before' }]} />}
      >
        <Loadable state={corr} empty={(d) => d.length === 0}>
          {() => (
            <>
              <div role="img" aria-label="Correlation of each KPI with sales" className="h-56">
                <ResponsiveContainer>
                  <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 24, left: 24, bottom: 0 }}>
                    <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" domain={[-1, 1]} {...AXIS} />
                    <YAxis type="category" dataKey="metric" width={150} {...AXIS} />
                    <ReferenceLine x={0} stroke="hsl(var(--border))" />
                    <Tooltip formatter={(v: number) => `${v.toFixed(2)} (${corrWord(v)})`} />
                    <Bar dataKey="r" name="Correlation" maxBarSize={28} radius={[0, 4, 4, 0]}>
                      {bars.map((b) => <Cell key={b.metric} fill={b.r >= 0 ? CHART[2] : CHART[3]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 space-y-0.5 text-sm">
                {bars.map((b) => <li key={b.metric}><span className="font-medium">{b.metric}</span>: {b.has ? `${corrWord(b.r)} (r = ${b.r.toFixed(2)})` : 'not enough data'}</li>)}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">Correlation shows a link, not proof of cause.</p>
            </>
          )}
        </Loadable>
      </ChartCard>

      <ChartCard
        title="Visits per doctor vs achievement"
        description={fit ? `One dot per territory-month (${fit.n}). Trend r = ${fit.r.toFixed(2)} (${corrWord(fit.r)}).` : 'One dot per territory-month.'}
      >
        <Loadable state={tm} empty={() => dots.length === 0}>
          {() => (
            <div role="img" aria-label="Scatter of visits per doctor against achievement" className="h-72">
              <ResponsiveContainer>
                <ComposedChart margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid stroke="hsl(var(--border))" />
                  <XAxis type="number" dataKey="x" name="Visits per doctor" {...AXIS} />
                  <YAxis type="number" dataKey="y" name="Achievement %" {...AXIS} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v: number, n: string) => (n === 'Achievement %' ? `${v.toFixed(0)}%` : v.toFixed(2))} />
                  <Scatter data={dots} name="Territory-month" fill={CHART[0]} fillOpacity={0.55} />
                  {trend.length > 0 && <Line data={trend} dataKey="t" name="Trend" type="linear" stroke={CHART[3]} strokeWidth={2} dot={false} isAnimationActive={false} legendType="none" />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Loadable>
      </ChartCard>

      <ChartCard title="Coverage band → results">
        <Loadable state={bands}>
          {(rows) => (
            <SortTable
              rows={rows}
              rowKey={(r) => r.band}
              cols={[
                { id: 'band', header: 'Coverage band', cell: (r) => r.band },
                { id: 'terr', header: 'Territories', align: 'right', cell: (r) => r.territories },
                { id: 'ach', header: 'Avg achievement', align: 'right', cell: (r) => pct(r.ach) },
                { id: 'growth', header: 'Avg month-on-month growth', align: 'right', cell: (r) => <span className={signTone(r.growth)}>{pct(r.growth)}</span> },
              ]}
            />
          )}
        </Loadable>
      </ChartCard>
    </div>
  )
}
