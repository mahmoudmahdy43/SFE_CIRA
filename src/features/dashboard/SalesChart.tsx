import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartCard } from '../../components/app/ChartCard'
import { CHART, ChartTip, axisProps } from '../../components/app/charts'
import { MultiSelect, Segmented } from '../../components/app/Controls'
import { EmptyState, ErrorState } from '../../components/app/states'
import { Skeleton } from '../../components/ui/misc'
import { fetchProducts, fetchSalesSeries, type SalesGroup, type SalesPoint } from '../../lib/api/dash'
import { cn } from '../../lib/utils'
import { monthShort, monthsOf, type Resolved } from './periodMath'
import { fmtMoney } from './rangeKpi'
import { PRIORITY, useDash, useDebounced, useNearViewport } from './useDash'

type Measure = 'value' | 'units'
const TARGET = '__target'

export interface SeriesPoint { label: string; ym: string; [k: string]: number | string | undefined }

/** Pivot the RPC rows to one record per month with a column per group; months without sales stay undefined (a gap, not a zero). */
export function pivotSales(rows: SalesPoint[], months: string[], measure: Measure, withTarget: boolean): { data: SeriesPoint[]; groups: string[] } {
  const groups = [...new Set(rows.map((r) => r.grp_name))].sort((a, b) => a.localeCompare(b))
  const by = new Map(rows.map((r) => [`${r.month.slice(0, 7)}|${r.grp_name}`, r]))
  const data = months.map((ym) => {
    const rec: SeriesPoint = { ym, label: monthShort(ym) }
    for (const g of groups) {
      const r = by.get(`${ym}|${g}`)
      const v = r ? (measure === 'value' ? r.s_value : r.s_units) : null
      if (v !== null && v !== undefined && (v !== 0 || (r?.t_value ?? 0) > 0)) rec[g] = v
      if (withTarget) {
        const t = r ? (measure === 'value' ? r.t_value : r.t_units) : null
        if (t) rec[TARGET] = (typeof rec[TARGET] === 'number' ? (rec[TARGET] as number) : 0) + t
      }
    }
    return rec
  })
  return { data, groups }
}

const fmtUnits = (v: number) => Math.round(v).toLocaleString('en-US')

/** Chart B: sales per month, one line per group. Value / Units come from the same call; Products is local to this chart. */
export function SalesChart({ line, fromYM, toYM, r }: { line: number | null; fromYM: string; toYM: string; r: Resolved }) {
  const [measure, setMeasure] = useState<Measure>('value')
  const [group, setGroup] = useState<SalesGroup>('total')
  const [products, setProducts] = useState<number[]>([])
  const [isolated, setIsolated] = useState<string | null>(null)
  const [ref, seen] = useNearViewport() // the chart asks for its data only when it is near the viewport
  const dProducts = useDebounced(products) // the multi-select waits 400 ms before it calls the database
  const prodOpts = useDash(seen ? 'opt:products' : null, PRIORITY.lazy, () => fetchProducts())

  const ctxFromYM = r.n === 1 ? `${toYM.slice(0, 4)}-01` : fromYM
  const from = `${ctxFromYM}-01`
  const key = seen ? `dash:sales:${from}:${r.to}:${group}:${line ?? 'all'}:${dProducts.join(',')}` : null
  const q = useDash(key, PRIORITY.sales, (signal) => fetchSalesSeries(from, r.to, group, line, dProducts, signal))
  const months = useMemo(() => monthsOf(ctxFromYM, toYM), [ctxFromYM, toYM])
  const { data, groups } = useMemo(() => pivotSales(q.data ?? [], months, measure, group === 'total'), [q.data, months, measure, group])

  const colour = (g: string) => CHART[groups.indexOf(g) % CHART.length]
  const fmt = measure === 'value' ? fmtMoney : fmtUnits
  const direct = groups.length <= 5
  const visible = groups.filter((g) => isolated === null || g === isolated)
  const hasAny = data.some((d) => groups.some((g) => d[g] !== undefined))

  return (
    <div ref={ref} className="xl:col-span-12">
    <ChartCard
      title="Sales per month"
      description={r.n === 1 ? 'From January to the selected month; the selected month is shaded.' : 'One line per group; months without a sales file are gaps.'}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Measure" value={measure} onChange={setMeasure} options={[{ value: 'value', label: 'Value' }, { value: 'units', label: 'Units' }]} />
          <Segmented label="Group by" value={group} onChange={(g) => { setGroup(g); setIsolated(null) }} options={[{ value: 'total', label: 'Company' }, { value: 'line', label: 'Line' }, { value: 'manager', label: 'Manager' }]} />
          <MultiSelect label="Products" options={prodOpts.data ?? []} value={products} onChange={setProducts} allLabel="All" loading={prodOpts.loading} />
        </div>
      }
    >
      {q.error ? (
        <ErrorState title="Could not load sales" message={q.error} onRetry={q.reload} className="py-10" />
      ) : q.loading ? (
        <Skeleton className="h-72 w-full" />
      ) : !hasAny ? (
        <EmptyState title="No sales uploaded for this period" description="Upload the sales file for these months, or clear the product filter." className="py-10" />
      ) : (
        <div className="flex flex-col gap-3 lg:flex-row">
          <div role="img" aria-label={`Sales ${measure} per month by ${group}`} className="h-72 min-w-0 flex-1">
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 12, right: direct ? 110 : 12, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={(v: number) => fmt(v)} />
                <Tooltip content={<ChartTip fmt={fmt} />} cursor={{ stroke: 'hsl(var(--border))' }} />
                {r.n === 1 && <ReferenceArea x1={monthShort(toYM)} x2={monthShort(toYM)} fill="hsl(var(--primary))" fillOpacity={0.08} />}
                {visible.map((g) => {
                  const lastIdx = data.reduce((a, d, i) => (d[g] !== undefined ? i : a), -1)
                  return (
                    <Line key={g} dataKey={g} name={g} stroke={colour(g)} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false}
                      label={direct ? (p: { x?: number; y?: number; index?: number; value?: number }) => (p.index === lastIdx && p.x !== undefined && p.y !== undefined ? (
                        <text key={g} x={p.x + 8} y={p.y + 4} fontSize={12} fill={colour(g)} className="tnum" fontWeight={600}>{g.length > 12 ? `${g.slice(0, 11)}…` : g} {fmt(p.value ?? 0)}</text>
                      ) : <g key={`${g}-${p.index}`} />) : false} />
                  )
                })}
                {group === 'total' && <Line dataKey={TARGET} name="Target" stroke="hsl(var(--muted-foreground))" strokeDasharray="5 4" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {!direct && (
            <ul aria-label="Series" className="max-h-72 w-full shrink-0 space-y-0.5 overflow-auto lg:w-52">
              {groups.map((g) => (
                <li key={g}>
                  <button type="button" aria-pressed={isolated === g} onClick={() => setIsolated(isolated === g ? null : g)}
                    className={cn('flex w-full items-center gap-2 rounded-control px-2 py-1 text-left text-13 hover:bg-muted', isolated === g && 'bg-accent font-medium', isolated !== null && isolated !== g && 'opacity-50')}>
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colour(g) }} />
                    <span className="truncate">{g}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </ChartCard>
    </div>
  )
}
