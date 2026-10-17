import { CartesianGrid, Label, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CPAL } from './coverageMath'
import { fmtScore, fmtShare, fmtSigned, monthShort, sparkRuns, type EffectRow, type SkillBar, type TrendRow } from './coachingMath'

const AXIS = { stroke: 'hsl(var(--muted-foreground))', fontSize: 11, tickLine: false } as const
export const LINE_COLORS = { All: CPAL.navy, Training: CPAL.green, Manager: CPAL.red } as const

/** Company average score by month: All / Training / Manager, axis 1-5, value labels on the points. */
export function TrendChart({ rows }: { rows: TrendRow[] }) {
  const data = rows.map((r) => ({ month: monthShort(r.month), All: r.avg_score, Training: r.training_avg, Manager: r.manager_avg }))
  const lines = [
    { key: 'All', pos: 'top' }, { key: 'Training', pos: 'bottom' }, { key: 'Manager', pos: 'right' },
  ] as const
  return (
    <div role="img" aria-label="Company average score by month, three lines: All, Training, Manager" className="h-72">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 18, right: 28, left: -8, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="month" {...AXIS} />
          <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} {...AXIS}><Label value="Score (1-5)" angle={-90} position="insideLeft" style={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} /></YAxis>
          <Tooltip formatter={(v: number) => fmtScore(v)} />
          <Legend verticalAlign="top" height={24} iconType="plainline" />
          {lines.map((l) => (
            <Line key={l.key} dataKey={l.key} name={l.key} stroke={LINE_COLORS[l.key]} strokeWidth={2} connectNulls={false} dot={{ r: 3 }} activeDot={{ r: 5 }} isAnimationActive={false}>
              <LabelList dataKey={l.key} position={l.pos} formatter={(v: number) => (v === null || v === undefined ? '' : fmtScore(v))} style={{ fontSize: 10, fill: LINE_COLORS[l.key] }} />
            </Line>
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Monthly average line with gaps where a month has no evaluation. */
export function Sparkline({ months, byMonth, w = 96, h = 26 }: { months: string[]; byMonth: Map<string, number | null>; w?: number; h?: number }) {
  const { runs, points } = sparkRuns(months, byMonth, w, h)
  if (points === 0) return <span className="text-xs italic text-muted-foreground">No evaluation</span>
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Monthly average score" className="mx-auto block">
      {runs.map((r, i) =>
        r.length === 1 ? (
          <circle key={i} cx={r[0].x} cy={r[0].y} r={2.2} fill={CPAL.navy} />
        ) : (
          <polyline key={i} points={r.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke={CPAL.navy} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
        ),
      )}
      {runs.flat().map((p, i) => <circle key={`d${i}`} cx={p.x} cy={p.y} r={1.4} fill={CPAL.navy} />)}
    </svg>
  )
}

/** Horizontal bars of the skills of one scope, ascending; the weakest are red; a thin tick marks the company average. */
export function SkillBars({ bars }: { bars: SkillBar[] }) {
  return (
    <div role="list" aria-label="Skill scores, lowest first" className="space-y-1.5">
      {bars.map((b) => (
        <div role="listitem" key={b.code} className="grid grid-cols-[minmax(8rem,16rem)_1fr_3rem] items-center gap-3 text-sm" title={`${b.name}: ${fmtScore(b.score)} (${b.n.toLocaleString()} evaluations)${b.company !== null ? ` · company ${fmtScore(b.company)}` : ''}`}>
          <span className="truncate" style={{ color: CPAL.navy, fontWeight: b.weak ? 700 : 400 }}>{b.name}</span>
          <div className="relative h-4 rounded-sm" style={{ backgroundColor: CPAL.zebra }}>
            {b.score !== null && <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${(Math.max(0, Math.min(5, b.score)) / 5) * 100}%`, backgroundColor: b.weak ? CPAL.red : CPAL.teal }} />}
            {b.company !== null && <div aria-hidden className="absolute -inset-y-0.5 w-0.5" style={{ left: `${(Math.max(0, Math.min(5, b.company)) / 5) * 100}%`, backgroundColor: CPAL.navy }} />}
          </div>
          <span className="tnum text-right font-bold" style={{ color: b.weak ? CPAL.red : CPAL.navy }}>{fmtScore(b.score)}</span>
        </div>
      ))}
    </div>
  )
}

/** Signed bars (green up / red down) for one measure of the coaching-effect bands. */
function EffectBars({ title, values, fmt, max }: { title: string; values: { label: string; v: number | null }[]; fmt: (v: number | null) => string; max: number }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: CPAL.slate }}>{title}</h4>
      <div className="space-y-1.5">
        {values.map((x) => (
          <div key={x.label} className="grid grid-cols-[6rem_1fr_3.5rem] items-center gap-3 text-sm">
            <span className="truncate" style={{ color: CPAL.navy }}>{x.label}</span>
            <div className="h-4 rounded-sm" style={{ backgroundColor: CPAL.zebra }}>
              {x.v !== null && <div className="h-full rounded-sm" style={{ width: `${max > 0 ? (Math.abs(x.v) / max) * 100 : 0}%`, backgroundColor: x.v < 0 ? CPAL.red : CPAL.green }} />}
            </div>
            <span className="tnum text-right font-bold" style={{ color: CPAL.navy }}>{fmt(x.v)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function EffectCharts({ rows }: { rows: EffectRow[] }) {
  const maxChange = Math.max(0, ...rows.map((r) => Math.abs(r.avg_change ?? 0)))
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <EffectBars title="Average change (last − first)" values={rows.map((r) => ({ label: r.band, v: r.avg_change }))} fmt={(v) => fmtSigned(v)} max={maxChange} />
      <EffectBars title="% of reps improved" values={rows.map((r) => ({ label: r.band, v: r.pct_improved }))} fmt={fmtShare} max={1} />
    </div>
  )
}
