import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

/** Categorical palette, resolved through CSS variables so it follows the theme. */
export const CHART = [1, 2, 3, 4, 5, 6].map((n) => `var(--chart-${n})`)

const axis = { stroke: 'hsl(var(--muted-foreground))', fontSize: 12, tickLine: false, axisLine: false } as const

function TooltipBox({
  active,
  payload,
  label,
  suffix = '',
}: {
  active?: boolean
  payload?: { name?: string; value?: number | string; color?: string }[]
  label?: string | number
  suffix?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-control border bg-popover px-3 py-2 text-xs shadow-pop">
      {label != null && <div className="mb-1 font-medium">{label}</div>}
      {payload.map((p) => (
        <div key={String(p.name)} className="flex items-center gap-2">
          <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="tnum ml-auto font-medium">
            {p.value}
            {suffix}
          </span>
        </div>
      ))}
    </div>
  )
}

export interface Series {
  key: string
  name: string
}

export function TrendLine({
  data,
  xKey,
  series,
  suffix = '%',
}: {
  data: Record<string, string | number>[]
  xKey: string
  series: Series[]
  suffix?: string
}) {
  return (
    <div role="img" aria-label="Line chart" className="h-64">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey={xKey} {...axis} />
          <YAxis {...axis} tickFormatter={(v: number) => `${v}${suffix}`} />
          <Tooltip content={<TooltipBox suffix={suffix} />} cursor={{ stroke: 'hsl(var(--border))' }} />
          {series.map((s, i) => (
            <Line key={s.key} dataKey={s.key} name={s.name} stroke={CHART[i]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function BarsChart({
  data,
  xKey,
  series,
  stacked,
  suffix = '%',
}: {
  data: Record<string, string | number>[]
  xKey: string
  series: Series[]
  stacked?: boolean
  suffix?: string
}) {
  return (
    <div role="img" aria-label="Bar chart" className="h-64">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey={xKey} {...axis} />
          <YAxis {...axis} tickFormatter={(v: number) => `${v}${suffix}`} />
          <Tooltip content={<TooltipBox suffix={suffix} />} cursor={{ fill: 'hsl(var(--muted))' }} />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              fill={CHART[i]}
              stackId={stacked ? 'a' : undefined}
              radius={stacked ? 0 : [4, 4, 0, 0]}
              maxBarSize={36}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function Donut({ data, centerLabel }: { data: { name: string; value: number }[]; centerLabel?: string }) {
  const total = data.reduce((a, d) => a + d.value, 0)
  return (
    <div role="img" aria-label="Donut chart" className="relative h-64">
      <ResponsiveContainer>
        <PieChart>
          <Tooltip content={<TooltipBox />} />
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="none">
            {data.map((d, i) => (
              <Cell key={d.name} fill={CHART[i]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="tnum text-2xl font-semibold">{total.toLocaleString()}</span>
        {centerLabel && <span className="text-xs text-muted-foreground">{centerLabel}</span>}
      </div>
    </div>
  )
}

/** Small single-series line for KPI cards: gaps (missing keys / nulls) are left open, not drawn as zero. */
export function MiniLine({
  data,
  xKey,
  yKey,
  name,
  suffix = '',
  height = 128,
}: {
  data: Record<string, string | number | null>[]
  xKey: string
  yKey: string
  name: string
  suffix?: string
  height?: number
}) {
  return (
    <div role="img" aria-label={`${name} by month`} style={{ height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey={xKey} {...axis} fontSize={11} />
          <YAxis {...axis} fontSize={11} />
          <Tooltip content={<TooltipBox suffix={suffix} />} cursor={{ stroke: 'hsl(var(--border))' }} />
          <Line dataKey={yKey} name={name} stroke={CHART[0]} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
