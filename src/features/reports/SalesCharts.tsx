import {
  Bar, CartesianGrid, ComposedChart, LabelList, Legend, Line, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts'
import { CPAL } from './coverageMath'
import {
  fmtK, fmtNum, fmtPct, monthShort, waterDomainMin, type ActionStatus, type Projection, type ScatterPoint, type TrendPoint, type WaterBar,
} from './salesMath'
import { AMBER, STATUS_COLOR } from './SalesUi'

const AXIS = { stroke: 'hsl(var(--muted-foreground))', fontSize: 11, tickLine: false } as const

/** Monthly sales (bars) vs target (line) with Ach % labels; dotted continuation to December. */
export function TrendChart({ points, projection, unit, year }: { points: TrendPoint[]; projection: Projection | null; unit: string; year: string }) {
  const data: { label: string; sales?: number; target?: number | null; proj?: number; ach?: number | null }[] = points.map((p) => ({
    label: monthShort(p.month), sales: p.sales, target: p.target > 0 ? p.target : null, ach: p.ach,
  }))
  if (projection && data.length > 0) {
    data[data.length - 1].proj = points[points.length - 1].sales
    for (const m of projection.months) data.push({ label: monthShort(m), proj: projection.perMonth })
  }
  return (
    <div role="img" aria-label={`Monthly sales vs target ${year}${projection ? ' with projection to December' : ''}`} className="h-80">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 24, right: 24, left: 4, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis {...AXIS} tickFormatter={(v: number) => fmtK(v)} width={56} />
          <Tooltip formatter={(v: number, name: string) => [`${fmtNum(v)} ${unit}`, name]} />
          <Legend verticalAlign="top" height={24} />
          <Bar dataKey="sales" name="Sales" fill={CPAL.teal} radius={[2, 2, 0, 0]} isAnimationActive={false} maxBarSize={56}>
            <LabelList dataKey="ach" position="top" formatter={(v: number | null) => (v === null || v === undefined ? '' : fmtPct(v, 0))} style={{ fontSize: 10, fill: CPAL.navy, fontWeight: 700 }} />
          </Bar>
          <Line dataKey="target" name="Target" stroke={CPAL.red} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          {projection && <Line dataKey="proj" name={`Projection (no ${year} targets after the last loaded month)`} stroke={CPAL.grey} strokeWidth={2} strokeDasharray="2 5" strokeLinecap="round" dot={false} connectNulls isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Waterfall: totals navy, increases green, decreases red. The axis is truncated so the steps are visible. */
export function WaterfallChart({ bars, unit, label, rotate = false }: { bars: WaterBar[]; unit: string; label: string; rotate?: boolean }) {
  const data = bars.map((b) => ({ ...b }))
  const min = waterDomainMin(bars)
  return (
    <div role="img" aria-label={label} className="h-80">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 22, right: 12, left: 4, bottom: rotate ? 56 : 4 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="name" {...AXIS} interval={0} angle={rotate ? -35 : 0} textAnchor={rotate ? 'end' : 'middle'} height={rotate ? 70 : 30} />
          <YAxis {...AXIS} tickFormatter={(v: number) => fmtK(v)} width={56} domain={[min, 'auto']} allowDataOverflow />
          <Tooltip
            formatter={(v: number, name: string) => [`${fmtNum(v)} ${unit}`, name]}
            labelFormatter={(l: string) => l}
          />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} legendType="none" />
          <Bar dataKey="total" name="Total" stackId="w" fill={CPAL.navy} isAnimationActive={false} maxBarSize={64}>
            <LabelList dataKey="total" position="top" formatter={(v: number) => (v ? fmtK(v) : '')} style={{ fontSize: 10, fill: CPAL.navy, fontWeight: 700 }} />
          </Bar>
          <Bar dataKey="up" name="Increase" stackId="w" fill={CPAL.green} isAnimationActive={false} maxBarSize={64}>
            <LabelList dataKey="up" position="top" formatter={(v: number) => (v ? `+${fmtK(v)}` : '')} style={{ fontSize: 10, fill: CPAL.green, fontWeight: 700 }} />
          </Bar>
          <Bar dataKey="down" name="Decrease" stackId="w" fill={CPAL.red} isAnimationActive={false} maxBarSize={64}>
            <LabelList dataKey="down" position="top" formatter={(v: number) => (v ? `-${fmtK(v)}` : '')} style={{ fontSize: 10, fill: CPAL.red, fontWeight: 700 }} />
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

const STATUSES: ActionStatus[] = ['ACTION', 'WATCH', 'OK']

/** Reps: visits (x) vs Ach % (y), colour = status, dashed lines at the medians. */
export function FieldScatter({ points, medianX, medianY }: { points: ScatterPoint[]; medianX: number | null; medianY: number | null }) {
  return (
    <div role="img" aria-label="Reps by field visits and achievement" className="h-96">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 12, right: 24, left: 4, bottom: 18 }}>
          <CartesianGrid stroke="hsl(var(--border))" />
          <XAxis type="number" dataKey="x" name="Visits" {...AXIS} label={{ value: 'Visits in the period', position: 'insideBottom', offset: -8, fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis type="number" dataKey="y" name="Ach %" {...AXIS} unit="%" width={48} />
          <ZAxis range={[60, 60]} />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={({ payload }) => {
              const p = payload?.[0]?.payload as ScatterPoint | undefined
              if (!p) return null
              return (
                <div className="rounded-md border bg-card px-3 py-2 text-xs shadow">
                  <div className="font-bold" style={{ color: CPAL.navy }}>{p.name}</div>
                  {p.manager && <div className="text-muted-foreground">{p.manager}</div>}
                  <div className="tnum mt-1">Visits {fmtNum(p.x)} · Ach {p.y.toFixed(1)}%</div>
                </div>
              )
            }}
          />
          <Legend verticalAlign="top" height={24} />
          {medianX !== null && <ReferenceLine x={medianX} stroke={CPAL.grey} strokeDasharray="4 4" />}
          {medianY !== null && <ReferenceLine y={medianY} stroke={CPAL.grey} strokeDasharray="4 4" />}
          {STATUSES.map((st) => (
            <Scatter key={st} name={st} data={points.filter((p) => p.status === st)} fill={st === 'WATCH' ? AMBER : STATUS_COLOR[st]} fillOpacity={0.8} isAnimationActive={false} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Monthly sales line with the target as a dotted line (action list rows). */
export function SalesSpark({ months, w = 110, h = 28 }: { months: { month: string; s: number; t: number }[]; w?: number; h?: number }) {
  if (months.length === 0) return <span className="text-xs text-muted-foreground">-</span>
  const vals = months.flatMap((m) => [m.s, m.t > 0 ? m.t : m.s])
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const span = hi - lo || 1
  const x = (i: number) => (months.length === 1 ? w / 2 : 2 + (i / (months.length - 1)) * (w - 4))
  const y = (v: number) => h - 3 - ((v - lo) / span) * (h - 6)
  const line = months.map((m, i) => `${x(i).toFixed(1)},${y(m.s).toFixed(1)}`).join(' ')
  const tgt = months.map((m, i) => (m.t > 0 ? `${x(i).toFixed(1)},${y(m.t).toFixed(1)}` : null)).filter(Boolean).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Monthly sales vs target" className="mx-auto block">
      {tgt && <polyline points={tgt} fill="none" stroke={CPAL.red} strokeWidth={1.2} strokeDasharray="2 2" />}
      <polyline points={line} fill="none" stroke={CPAL.navy} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      {months.map((m, i) => <circle key={m.month} cx={x(i)} cy={y(m.s)} r={1.6} fill={CPAL.navy} />)}
    </svg>
  )
}
