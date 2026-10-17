import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Info } from 'lucide-react'
import { Skeleton } from '../../components/ui/misc'
import { Tooltip } from '../../components/ui/overlay'
import { cn } from '../../lib/utils'
import { CPAL } from './coverageMath'
import { FieldlessNote } from './SalesNotes'
import { TrendChart, WaterfallChart } from './SalesCharts'
import { AchBar, Growth, NoTargetTag, Section, TH, negStyle, tdBase, thStyle } from './SalesUi'
import {
  CURRENCY, fmtNum, fmtPct, fmtSigned, fmtSignedPct, productDeltas, productTotal, productViews, projectYear, pvmBridge, sortProducts, topMovers, trendPoints, waterfall,
  type LineRow, type Metric, type MonthlyRow, type ProductCol, type ProductRow, type RepDelta, type SalesKpi, type SortDir, type WaterStep,
} from './salesMath'

/* ------------------------------------ 1. KPI cards ------------------------------------ */
export interface KpiCardsProps {
  kpi: SalesKpi | null
  metric: Metric
  hasCmp: boolean
  loading: boolean
  action: number
  watch: number
  actionsLoading: boolean
  showVacant: boolean
}

export function KpiCards({ kpi, metric, hasCmp, loading, action, watch, actionsLoading, showVacant }: KpiCardsProps) {
  if (loading || !kpi) return <div className="grid grid-cols-2 gap-3 lg:grid-cols-6" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
  const unit = metric === 'value' ? CURRENCY : 'units'
  const cards: { id: string; title: string; head: string; body: string; num: string; value: string; lines: string[] }[] = [
    {
      id: 'sales', title: metric === 'value' ? 'SALES' : 'SALES (UNITS)', head: CPAL.navy, body: CPAL.totalBody, num: CPAL.navy, value: fmtNum(kpi.sales),
      lines: metric === 'value' && showVacant
        ? [`of which Vacant boxes: ${fmtNum(kpi.vacant)} ${CURRENCY} (${fmtPct(kpi.vacantShare)})`, `No-target products: ${fmtNum(kpi.noTarget)} ${CURRENCY}`]
        : [unit],
    },
    { id: 'target', title: 'TARGET', head: CPAL.slate, body: CPAL.totalBody, num: CPAL.slate, value: fmtNum(kpi.target), lines: [unit] },
    { id: 'ach', title: 'ACHIEVEMENT', head: CPAL.teal, body: CPAL.tealBody, num: CPAL.teal, value: fmtPct(kpi.ach), lines: ['targeted rows only'] },
    {
      id: 'gap', title: 'GAP', head: kpi.gap < 0 ? CPAL.red : CPAL.green, body: kpi.gap < 0 ? CPAL.redBody : CPAL.greenBody, num: kpi.gap < 0 ? CPAL.red : CPAL.green,
      value: fmtSigned(kpi.gap), lines: ['targeted sales − target'],
    },
    {
      id: 'growth', title: 'GROWTH VS COMPARISON', head: CPAL.slate, body: CPAL.totalBody,
      num: !hasCmp || kpi.growth === null ? CPAL.grey : kpi.growth >= 0 ? CPAL.green : CPAL.red,
      value: hasCmp ? `${kpi.growth === null ? '' : kpi.growth >= 0 ? '▲ ' : '▼ '}${fmtSignedPct(kpi.growth)}` : '-',
      lines: [hasCmp ? `comparison ${fmtNum(kpi.cmp)}` : 'YTD: no comparison'],
    },
    {
      id: 'actions', title: 'REPS NEEDING ACTION', head: CPAL.red, body: CPAL.redBody, num: CPAL.red, value: actionsLoading ? '…' : String(action + watch),
      lines: actionsLoading ? [''] : [`${action} action · ${watch} watch`],
    },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6 print:grid-cols-6">
      {cards.map((c) => (
        <div key={c.id} className="overflow-hidden rounded-md border" style={{ borderColor: c.head }}>
          <div className="px-2 py-1.5 text-center text-[11px] font-bold tracking-wide text-white" style={{ backgroundColor: c.head }}>{c.title}</div>
          <div className="px-2 py-3 text-center" style={{ backgroundColor: c.body }}>
            <div className="tnum text-2xl font-bold" style={{ color: c.num }}>{c.value}</div>
            {c.lines.map((l) => <div key={l} className="mt-0.5 text-[11px] italic" style={{ color: CPAL.grey }}>{l}</div>)}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------ 2. lines & company ------------------------------------ */
export function LinesTable({ rows, threshold, hasCmp, showVacant, loading, unit, managerNote }: { rows: LineRow[]; threshold: number; hasCmp: boolean; showVacant: boolean; loading: boolean; unit: string; managerNote: boolean }) {
  const heads = ['Line', `Sales (${unit})`, 'Target', 'Ach %', 'Gap', 'Comparison sales', 'Growth %', 'Vacant sales (EGP)']
  return (
    <Section title="Lines & Company" caption={`Ach % bar: red below ${threshold}%, amber up to 100%, green from 100%.${managerNote ? ' This table is not filtered by manager.' : ''}`}>
      <div className="overflow-auto rounded-card border bg-card">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead><tr>{heads.map((h, i) => <th key={h} className={cn(TH, i === 0 ? 'text-left' : 'text-right')} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>
            {loading
              ? Array.from({ length: 4 }, (_, r) => <tr key={r}>{heads.map((h) => <td key={h} className="h-9 border-b px-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.map((r) => (
                <tr key={r.name} style={r.isCompany ? { backgroundColor: CPAL.navy } : undefined}>
                  <td className={cn('h-10 whitespace-nowrap border-b px-3 font-bold')} style={r.isCompany ? { color: CPAL.white } : tdBase}>{r.name}</td>
                  <td className="tnum border-b px-3 text-right font-semibold" style={r.isCompany ? { color: CPAL.white } : tdBase}>{fmtNum(r.kpi.sales)}</td>
                  <td className="tnum border-b px-3 text-right" style={r.isCompany ? { color: CPAL.white } : tdBase}>{fmtNum(r.kpi.target)}</td>
                  <td className="w-40 border-b px-3" style={r.isCompany ? { color: CPAL.white } : tdBase}>{r.isCompany ? <span className="tnum block text-right font-bold">{fmtPct(r.kpi.ach)}</span> : <AchBar ach={r.kpi.ach} threshold={threshold} />}</td>
                  <td className="tnum border-b px-3 text-right font-semibold" style={r.isCompany ? { color: r.kpi.gap < 0 ? '#FF9B9B' : '#9BE3B5' } : { ...tdBase, ...negStyle(r.kpi.gap) }}>{fmtSigned(r.kpi.gap)}</td>
                  <td className="tnum border-b px-3 text-right" style={r.isCompany ? { color: CPAL.white } : tdBase}>{hasCmp ? fmtNum(r.kpi.cmp) : '-'}</td>
                  <td className="border-b px-3 text-right" style={r.isCompany ? { color: CPAL.white } : tdBase}>{hasCmp ? (r.isCompany ? <span className="tnum font-bold">{fmtSignedPct(r.kpi.growth)}</span> : <Growth v={r.kpi.growth} />) : '-'}</td>
                  <td className="tnum border-b px-3 text-right" style={r.isCompany ? { color: CPAL.white } : tdBase}>{showVacant ? fmtNum(r.kpi.vacant) : '-'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

/* ------------------------------------ 3. trend ------------------------------------ */
export function TrendSection({ monthly, lineId, lineLabel, metric, loading }: { monthly: MonthlyRow[]; lineId: number | null; lineLabel: string; metric: Metric; loading: boolean }) {
  const points = useMemo(() => trendPoints(monthly, lineId, metric), [monthly, lineId, metric])
  const projection = useMemo(() => projectYear(points), [points])
  const year = points.length > 0 ? points[points.length - 1].month.slice(0, 4) : ''
  const unit = metric === 'value' ? CURRENCY : 'units'
  return (
    <Section title={`Trend — ${lineLabel}`} caption={`Monthly sales (bars) vs target (line); the label on each bar is Ach % of targeted rows. Projection = YTD + average of the last 3 loaded months × months left${projection ? ` → about ${fmtNum(projection.total)} ${unit} for ${year}` : ''}.`}>
      {loading ? <Skeleton className="h-80" /> : points.length === 0 ? <FieldlessNote text="No monthly data for this selection." /> : (
        <div className="rounded-card border bg-card p-3">
          <TrendChart points={points} projection={projection} unit={unit} year={year} />
          <div className="mt-2 overflow-auto">
            <table className="w-full text-xs">
              <tbody>
                <tr>
                  <th scope="row" className="whitespace-nowrap px-2 py-1 text-left font-bold" style={{ color: CPAL.slate }}>Month-over-month</th>
                  {points.map((p) => (
                    <td key={p.month} className="tnum px-2 py-1 text-center">
                      <div style={{ color: CPAL.grey }}>{p.month.slice(5, 7) === '01' ? `${p.month.slice(0, 4)}` : ''}</div>
                      <div className="font-bold" style={{ color: p.mom === null ? CPAL.grey : p.mom >= 0 ? CPAL.green : CPAL.red }}>{fmtSignedPct(p.mom)}</div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Section>
  )
}

/* ------------------------------------ 4. products ------------------------------------ */
const PCOLS: { id: ProductCol; header: string; numeric: boolean; tip?: string }[] = [
  { id: 'name', header: 'Product', numeric: false }, { id: 'line', header: 'Line', numeric: false }, { id: 'sales', header: 'Sales', numeric: true },
  { id: 'share', header: 'Share %', numeric: true }, { id: 'target', header: 'Target', numeric: true },
  { id: 'ach', header: 'Ach %', numeric: true, tip: 'Sales of targeted rows ÷ target. Products without a target are excluded.' },
  { id: 'gap', header: 'Gap', numeric: true, tip: 'Targeted sales − target.' }, { id: 'cmp', header: 'Comparison', numeric: true }, { id: 'growth', header: 'Growth %', numeric: true },
  { id: 'avgPrice', header: 'Avg price', numeric: true, tip: 'Value ÷ units.' },
  { id: 'abc', header: 'ABC', numeric: false, tip: 'A = the first 70% of cumulative sales, B = the next 20%, C = the rest.' },
]
const ABC_COLOR = { A: CPAL.green, B: '#B7791F', C: CPAL.grey } as const

export function ProductsSection({ rows, metric, threshold, hasCmp, loading }: { rows: ProductRow[]; metric: Metric; threshold: number; hasCmp: boolean; loading: boolean }) {
  const [sort, setSort] = useState<{ id: ProductCol; dir: SortDir }>({ id: 'sales', dir: 'desc' })
  const views = useMemo(() => sortProducts(productViews(rows, metric), sort.id, sort.dir), [rows, metric, sort])
  const total = useMemo(() => productTotal(rows, metric), [rows, metric])
  const toggle = (id: ProductCol) => setSort((s) => (s.id === id ? { id, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { id, dir: id === 'name' || id === 'line' || id === 'abc' ? 'asc' : 'desc' }))
  const icon = (id: ProductCol) => (sort.id !== id ? <ArrowUpDown className="h-3 w-3 opacity-40" /> : sort.dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)
  const maxShare = Math.max(0.0001, ...views.map((v) => v.share ?? 0))
  return (
    <Section title="Product analysis" caption="Sales, share, achievement and growth by product. Products without a target are in total sales but out of Ach % and Gap.">
      <div className="max-h-[70vh] overflow-auto rounded-card border bg-card">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              {PCOLS.map((c) => (
                <th key={c.id} aria-sort={sort.id === c.id ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'} className={cn(TH, c.numeric ? 'text-right' : 'text-left')} style={thStyle}>
                  <button onClick={() => toggle(c.id)} className="inline-flex items-center gap-1 hover:opacity-80">
                    {c.tip ? <Tooltip content={<span className="block max-w-64">{c.tip}</span>} side="bottom"><span className="inline-flex items-center gap-1">{c.header}<Info className="h-3 w-3 opacity-60" aria-label={c.tip} /></span></Tooltip> : c.header}
                    {icon(c.id)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 8 }, (_, r) => <tr key={r}>{PCOLS.map((c) => <td key={c.id} className="h-9 border-b px-3"><Skeleton className="h-4" /></td>)}</tr>)
              : views.map((p, i) => (
                <tr key={`${p.id}|${p.line}`} style={i % 2 === 1 ? { backgroundColor: CPAL.zebra } : undefined}>
                  <td className="h-9 whitespace-nowrap border-b px-3 font-medium" style={tdBase}>{p.name}{p.noTarget && <NoTargetTag />}</td>
                  <td className="whitespace-nowrap border-b px-3 text-muted-foreground" style={{ borderBottomColor: CPAL.rowLine }}>{p.line ?? '-'}</td>
                  <td className="tnum border-b px-3 text-right font-semibold" style={tdBase}>{fmtNum(p.sales)}</td>
                  <td className="w-32 border-b px-3" style={{ borderBottomColor: CPAL.rowLine }}>
                    <div className="relative h-5 overflow-hidden rounded-sm" style={{ backgroundColor: CPAL.zebra }}>
                      <div className="absolute inset-y-0 left-0" style={{ width: `${((p.share ?? 0) / maxShare) * 100}%`, backgroundColor: CPAL.teal, opacity: 0.3 }} />
                      <span className="tnum relative z-[1] flex h-full items-center justify-end px-2 text-xs font-semibold" style={{ color: CPAL.navy }}>{fmtPct(p.share)}</span>
                    </div>
                  </td>
                  <td className="tnum border-b px-3 text-right" style={tdBase}>{p.noTarget ? '-' : fmtNum(p.target)}</td>
                  <td className="w-36 border-b px-3" style={{ borderBottomColor: CPAL.rowLine }}><AchBar ach={p.ach} threshold={threshold} /></td>
                  <td className="tnum border-b px-3 text-right font-semibold" style={{ ...tdBase, ...negStyle(p.gap) }}>{p.gap === null ? '-' : fmtSigned(p.gap)}</td>
                  <td className="tnum border-b px-3 text-right" style={tdBase}>{hasCmp ? fmtNum(p.cmp) : '-'}</td>
                  <td className="border-b px-3 text-right" style={{ borderBottomColor: CPAL.rowLine }}>{hasCmp ? <Growth v={p.growth} /> : '-'}</td>
                  <td className="tnum border-b px-3 text-right" style={tdBase}>{p.avgPrice === null ? '-' : p.avgPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="border-b px-3 text-center font-bold" style={{ borderBottomColor: CPAL.rowLine, color: ABC_COLOR[p.abc] }}>{p.abc}</td>
                </tr>
              ))}
            {!loading && views.length > 0 && (
              <tr style={{ backgroundColor: CPAL.navy }}>
                <td className="sticky bottom-0 h-10 px-3 font-bold text-white">TOTAL</td>
                <td className="sticky bottom-0" style={{ backgroundColor: CPAL.navy }} />
                <td className="tnum sticky bottom-0 px-3 text-right font-bold text-white" style={{ backgroundColor: CPAL.navy }}>{fmtNum(total.sales)}</td>
                <td className="tnum sticky bottom-0 px-3 text-right font-bold text-white" style={{ backgroundColor: CPAL.navy }}>100%</td>
                <td className="tnum sticky bottom-0 px-3 text-right font-bold text-white" style={{ backgroundColor: CPAL.navy }}>{fmtNum(total.target)}</td>
                <td className="tnum sticky bottom-0 px-3 text-right font-bold text-white" style={{ backgroundColor: CPAL.navy }}>{fmtPct(total.ach)}</td>
                <td className="tnum sticky bottom-0 px-3 text-right font-bold" style={{ backgroundColor: CPAL.navy, color: total.gap < 0 ? '#FF9B9B' : '#9BE3B5' }}>{fmtSigned(total.gap)}</td>
                <td className="tnum sticky bottom-0 px-3 text-right font-bold text-white" style={{ backgroundColor: CPAL.navy }}>{hasCmp ? fmtNum(total.cmp) : '-'}</td>
                <td className="tnum sticky bottom-0 px-3 text-right font-bold text-white" style={{ backgroundColor: CPAL.navy }}>{hasCmp ? fmtSignedPct(total.growth) : '-'}</td>
                <td className="tnum sticky bottom-0 px-3 text-right font-bold text-white" style={{ backgroundColor: CPAL.navy }}>{total.avgPrice === null ? '-' : total.avgPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="sticky bottom-0" style={{ backgroundColor: CPAL.navy }} />
              </tr>
            )}
          </tbody>
        </table>
        {!loading && views.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No product sales for this selection.</p>}
      </div>
    </Section>
  )
}

/* ------------------------------------ 5. PVM bridge ------------------------------------ */
export function PvmSection({ rows, hasCmp, cmpLabel, selLabel, loading }: { rows: ProductRow[]; hasCmp: boolean; cmpLabel: string; selLabel: string; loading: boolean }) {
  const pvm = useMemo(() => pvmBridge(rows), [rows])
  const bars = useMemo(() => {
    const steps: WaterStep[] = [
      { name: cmpLabel, value: pvm.v0, total: true }, { name: 'Volume', value: pvm.volume }, { name: 'Price', value: pvm.price }, { name: 'Mix', value: pvm.mix }, { name: selLabel, value: pvm.v1, total: true },
    ]
    return waterfall(steps)
  }, [pvm, cmpLabel, selLabel])
  const pctOf = (v: number) => (pvm.v0 > 0 ? fmtSignedPct(v / pvm.v0) : '-')
  return (
    <Section title="Price / volume / mix bridge" caption="Value change split into volume (units at the average comparison price), price (change in price × selected units, products sold in both periods) and mix (everything else, incl. new and discontinued products). Always in EGP.">
      {loading ? <Skeleton className="h-80" /> : !hasCmp ? <FieldlessNote text="Select a comparison period to see the bridge." /> : (
        <div className="grid gap-3 rounded-card border bg-card p-3 lg:grid-cols-[1fr_16rem]">
          <WaterfallChart bars={bars} unit={CURRENCY} label="Price, volume and mix bridge from comparison to selected period" />
          <table className="self-start text-sm">
            <tbody>
              {[['Comparison', pvm.v0, null], ['Volume', pvm.volume, pvm.volume], ['Price', pvm.price, pvm.price], ['Mix', pvm.mix, pvm.mix], ['Selected', pvm.v1, null]].map(([n, v, d]) => (
                <tr key={n as string} className="border-b last:border-0">
                  <th scope="row" className="py-1.5 pr-3 text-left font-medium" style={{ color: CPAL.navy }}>{n as string}</th>
                  <td className="tnum py-1.5 text-right font-semibold" style={d === null ? tdBase : { color: (d as number) < 0 ? CPAL.red : CPAL.green }}>{d === null ? fmtNum(v as number) : fmtSigned(v as number)}</td>
                  <td className="tnum py-1.5 pl-3 text-right text-xs text-muted-foreground">{d === null ? '' : pctOf(d as number)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

/* ------------------------------------ 6. growth bridge by product + top reps ------------------------------------ */
function MoverTable({ title, rows, tone }: { title: string; rows: RepDelta[]; tone: 'up' | 'down' }) {
  const color = tone === 'up' ? CPAL.green : CPAL.red
  return (
    <div className="overflow-hidden rounded-card border bg-card">
      <div className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white" style={{ backgroundColor: color }}>{title}</div>
      <table className="w-full text-sm">
        <tbody>
          {rows.length === 0 ? <tr><td className="px-3 py-4 text-center text-muted-foreground">None.</td></tr> : rows.map((r) => (
            <tr key={r.key} className="border-b last:border-0">
              <td className="px-3 py-1.5"><div className="font-medium" style={{ color: CPAL.navy }}>{r.name}</div><div className="text-xs text-muted-foreground">{r.line ?? ''}</div></td>
              <td className="tnum px-3 py-1.5 text-right font-bold" style={{ color }}>{fmtSigned(r.delta)}</td>
              <td className="tnum px-3 py-1.5 text-right text-xs text-muted-foreground">{fmtNum(r.cmp)} → {fmtNum(r.cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function GrowthSection({ rows, deltas, hasCmp, cmpLabel, selLabel, loading }: { rows: ProductRow[]; deltas: RepDelta[]; hasCmp: boolean; cmpLabel: string; selLabel: string; loading: boolean }) {
  const bars = useMemo(() => {
    const d = productDeltas(rows)
    const v0 = rows.reduce((a, r) => a + r.c_value, 0)
    const v1 = rows.reduce((a, r) => a + r.s_value, 0)
    return waterfall([{ name: cmpLabel, value: v0, total: true }, ...d.map((x) => ({ name: x.name, value: x.delta })), { name: selLabel, value: v1, total: true }])
  }, [rows, cmpLabel, selLabel])
  const up = useMemo(() => topMovers(deltas, 'up'), [deltas])
  const down = useMemo(() => topMovers(deltas, 'down'), [deltas])
  return (
    <Section title="Growth bridge by product" caption="Change in sales value per product from the comparison to the selected period (EGP); next to it the 5 reps that grew and declined most.">
      {loading ? <Skeleton className="h-80" /> : !hasCmp ? <FieldlessNote text="Select a comparison period to see the bridge." /> : (
        <div className="grid gap-3 xl:grid-cols-[1fr_22rem]">
          <div className="rounded-card border bg-card p-3"><WaterfallChart bars={bars} unit={CURRENCY} label="Value change by product" rotate /></div>
          <div className="space-y-3">
            <MoverTable title="Top 5 growing reps" rows={up} tone="up" />
            <MoverTable title="Top 5 declining reps" rows={down} tone="down" />
          </div>
        </div>
      )}
    </Section>
  )
}
