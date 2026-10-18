import { ProfileLink } from '../../components/app/ProfileLink'
import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileSpreadsheet } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Skeleton } from '../../components/ui/misc'
import { fetchSalesRepProduct } from '../../lib/api/sales'
import { cn } from '../../lib/utils'
import { useAsync } from '../dashboard/useAsync'
import { CPAL } from './coverageMath'
import { FieldlessNote } from './SalesNotes'
import { FieldScatter, SalesSpark } from './SalesCharts'
import { AMBER, AchBar, Section, StatusChip, TH, negStyle, tdBase, thStyle } from './SalesUi'
import {
  achOf, fmtNum, fmtPct, fmtSigned, median, monthShort, quadrantOf, scatterPoints, sortVacant, CURRENCY,
  type ActionView, type VacantRow,
} from './salesMath'

function RepDetail({ row, from, to, lineIds, manager, cols }: { row: ActionView; from: string; to: string; lineIds: number[]; manager: number | null; cols: number }) {
  const key = `sales:repdetail:${from}:${to}:${lineIds.join(',')}:${manager ?? ''}:${row.rep_id ?? ''}`
  const q = useAsync(key, async () => {
    const parts = await Promise.all(lineIds.map((l) => fetchSalesRepProduct(from, to, { line: l, manager })))
    return parts.flat().filter((r) => r.rep_id === row.rep_id)
  })
  const products = useMemo(() => [...(q.data ?? [])].sort((a, b) => (a.s_value_tgt - a.t_value) - (b.s_value_tgt - b.t_value)), [q.data])
  return (
    <tr>
      <td colSpan={cols} className="border-b px-4 py-3" style={{ backgroundColor: CPAL.totalBody, borderBottomColor: CPAL.rowLine }}>
        <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
          <div>
            <h4 className="mb-1 text-xs font-bold uppercase tracking-wide" style={{ color: CPAL.slate }}>Month by month</h4>
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-muted-foreground"><th className="py-1 text-left font-medium">Month</th><th className="py-1 text-right font-medium">Sales</th><th className="py-1 text-right font-medium">Target</th><th className="py-1 text-right font-medium">Ach %</th></tr></thead>
              <tbody>
                {row.months.map((m) => {
                  const a = achOf(m.st, m.t)
                  return (
                    <tr key={m.month} className="border-t">
                      <td className="py-1" style={{ color: CPAL.navy }}>{monthShort(m.month)} {m.month.slice(0, 4)}</td>
                      <td className="tnum py-1 text-right font-semibold">{fmtNum(m.s)}</td>
                      <td className="tnum py-1 text-right">{fmtNum(m.t)}</td>
                      <td className="tnum py-1 text-right font-bold" style={{ color: a === null ? CPAL.grey : a < 0.8 ? CPAL.red : a < 1 ? AMBER : CPAL.green }}>{fmtPct(a)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div>
            <h4 className="mb-1 text-xs font-bold uppercase tracking-wide" style={{ color: CPAL.slate }}>Products (worst gap first)</h4>
            {q.loading ? <Skeleton className="h-24" /> : q.error ? <p className="text-sm" style={{ color: CPAL.red }}>{q.error}</p> : products.length === 0 ? <p className="text-sm text-muted-foreground">No product rows for this rep.</p> : (
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-muted-foreground"><th className="py-1 text-left font-medium">Product</th><th className="py-1 text-right font-medium">Sales</th><th className="py-1 text-right font-medium">Target</th><th className="py-1 text-right font-medium">Ach %</th><th className="py-1 text-right font-medium">Gap</th></tr></thead>
                  <tbody>
                    {products.map((p) => {
                      const a = achOf(p.s_value_tgt, p.t_value)
                      const gap = p.t_value > 0 ? p.s_value_tgt - p.t_value : null
                      return (
                        <tr key={p.product_id} className="border-t">
                          <td className="py-1" style={{ color: CPAL.navy }}>{p.product_name}</td>
                          <td className="tnum py-1 text-right font-semibold">{fmtNum(p.s_value)}</td>
                          <td className="tnum py-1 text-right">{p.t_value > 0 ? fmtNum(p.t_value) : '-'}</td>
                          <td className="tnum py-1 text-right">{fmtPct(a)}</td>
                          <td className="tnum py-1 text-right font-semibold" style={negStyle(gap)}>{gap === null ? '-' : fmtSigned(gap)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}

const HEADS = ['', 'Status', 'Rep', 'Line', 'Manager', 'Boxes', 'Sales', 'Target', 'Ach %', 'Gap', 'Last month', 'Down (months)', 'Top 3 gap products', 'Monthly sales', 'Avg visits / month', 'Sales / visit', 'Coaching avg']

export function ActionSection({
  rows, all, showAll, onShowAll, threshold, loading, error, onExport, from, to, lineIds, manager,
}: {
  rows: ActionView[]; all: number; showAll: boolean; onShowAll: (v: boolean) => void; threshold: number; loading: boolean; error: string | null
  onExport: () => void; from: string; to: string; lineIds: (name: string | null) => number[]; manager: number | null
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const rk = (r: ActionView) => `${r.rep_id ?? 'v'}|${r.rep_name}`
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  return (
    <Section
      title="Action list — reps to discuss"
      caption="ACTION = below the Ach threshold and declining; WATCH = one of the two. Sorted by status, then by shortfall. Click a row to open its months and products."
      actions={
        <span className="flex items-center gap-3 text-xs">
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={showAll} onChange={(e) => onShowAll(e.target.checked)} /> Show all ({all})</label>
          <Button size="sm" onClick={onExport} disabled={rows.length === 0}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
        </span>
      }
    >
      <div className="max-h-[75vh] overflow-auto rounded-card border bg-card">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead><tr>{HEADS.map((h, i) => <th key={h || i} className={cn(TH, i >= 5 && i !== 12 && i !== 13 ? 'text-right' : 'text-left', i === 13 && 'text-center')} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }, (_, r) => <tr key={r}>{HEADS.map((_, c) => <td key={c} className="h-10 border-b px-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.map((r, i) => {
                const k = rk(r)
                const isOpen = open.has(k)
                return (
                  <Fragment key={k}>
                    <tr onClick={() => toggle(k)} className="cursor-pointer hover:bg-muted/50" style={i % 2 === 1 ? { backgroundColor: CPAL.zebra } : undefined}>
                      <td className="border-b pl-3 pr-1" style={{ borderBottomColor: CPAL.rowLine }}>{isOpen ? <ChevronDown className="h-4 w-4" aria-label="Collapse" /> : <ChevronRight className="h-4 w-4" aria-label="Expand" />}</td>
                      <td className="border-b px-3" style={{ borderBottomColor: CPAL.rowLine }}><StatusChip status={r.status} /></td>
                      <td className="min-w-48 border-b px-3 py-1.5" style={tdBase}><div className="font-medium"><ProfileLink type="rep" id={r.rep_id}>{r.rep_name}</ProfileLink></div><div className="text-xs italic" style={{ color: CPAL.grey }}>{r.reason}</div></td>
                      <td className="whitespace-nowrap border-b px-3 text-muted-foreground" style={{ borderBottomColor: CPAL.rowLine }}>{r.line_names ?? '-'}</td>
                      <td className="whitespace-nowrap border-b px-3 text-muted-foreground" style={{ borderBottomColor: CPAL.rowLine }}>{r.manager_name ?? '-'}</td>
                      <td className="tnum border-b px-3 text-right" style={tdBase}>{r.territories}</td>
                      <td className="tnum border-b px-3 text-right font-semibold" style={tdBase}>{fmtNum(r.s_value)}</td>
                      <td className="tnum border-b px-3 text-right" style={tdBase}>{fmtNum(r.t_value)}</td>
                      <td className="w-36 border-b px-3" style={{ borderBottomColor: CPAL.rowLine }}><AchBar ach={r.achF} threshold={threshold} /></td>
                      <td className="tnum border-b px-3 text-right font-bold" style={{ ...tdBase, ...negStyle(r.gap) }}>{fmtSigned(r.gap)}</td>
                      <td className="tnum border-b px-3 text-right" style={tdBase}>{fmtPct(r.lastAchF)}</td>
                      <td className="tnum border-b px-3 text-right font-semibold" style={{ ...tdBase, color: r.declining ? CPAL.red : CPAL.navy }}>{r.decline_run > 0 ? r.decline_run : '-'}</td>
                      <td className="border-b px-3" style={{ borderBottomColor: CPAL.rowLine }}>
                        <div className="flex max-w-80 flex-wrap gap-1">
                          {r.top_gap_products.slice(0, 3).map((p) => <span key={p.product} className="rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: CPAL.redBody, color: CPAL.red }}>{p.product} <b className="tnum">-{fmtNum(p.shortfall)}</b></span>)}
                          {r.top_gap_products.length === 0 && <span className="text-muted-foreground">-</span>}
                        </div>
                      </td>
                      <td className="border-b px-3" style={{ borderBottomColor: CPAL.rowLine }}><SalesSpark months={r.months} /></td>
                      <td className="tnum border-b px-3 text-right" style={tdBase}>{r.avgVisits === null ? '-' : r.avgVisits.toFixed(1)}</td>
                      <td className="tnum border-b px-3 text-right" style={tdBase}>{r.perVisit === null ? '-' : fmtNum(r.perVisit)}</td>
                      <td className="tnum border-b px-3 text-right" style={tdBase}>{r.coachAvg === null ? '-' : r.coachAvg.toFixed(2)}</td>
                    </tr>
                    {isOpen && <RepDetail row={r} from={from} to={to} lineIds={lineIds(r.line_names)} manager={manager} cols={HEADS.length} />}
                  </Fragment>
                )
              })}
          </tbody>
        </table>
        {!loading && error && <p className="px-4 py-6 text-center text-sm" style={{ color: CPAL.red }}>{error}</p>}
        {!loading && !error && rows.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">{all > 0 ? 'No rep needs action. Turn on “Show all” to see everyone.' : 'No reps for this selection.'}</p>}
      </div>
    </Section>
  )
}

export function FieldSection({ rows, fieldEmpty, loading }: { rows: ActionView[]; fieldEmpty: boolean; loading: boolean }) {
  const pts = useMemo(() => scatterPoints(rows), [rows])
  const mx = useMemo(() => median(pts.map((p) => p.x)), [pts])
  const my = useMemo(() => median(pts.map((p) => p.y)), [pts])
  const counts = useMemo(() => {
    const c = new Map<string, number>()
    if (mx !== null && my !== null) for (const p of pts) { const q = quadrantOf(p, mx, my); c.set(q, (c.get(q) ?? 0) + 1) }
    return c
  }, [pts, mx, my])
  return (
    <Section title="Field vs Sales" caption="Each dot is a rep: average visits per month (x) vs Ach % (y); dashed lines are the medians. High activity / low result = quality or targeting issue. Low activity / low result = activity issue.">
      {loading ? <Skeleton className="h-96" /> : fieldEmpty || pts.length === 0 ? <FieldlessNote text="Field activity not available for this period" /> : (
        <div className="rounded-card border bg-card p-3">
          <FieldScatter points={pts} medianX={mx} medianY={my} />
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {['High activity / low result', 'Low activity / low result', 'High activity / high result', 'Low activity / high result'].map((q) => (
              <span key={q} className="rounded-full border px-2.5 py-0.5" style={{ color: CPAL.navy }}>{q}: <b className="tnum">{counts.get(q) ?? 0}</b></span>
            ))}
          </div>
        </div>
      )}
    </Section>
  )
}

export function VacantSection({ rows, share, total, loading, error }: { rows: VacantRow[]; share: number | null; total: number; loading: boolean; error: string | null }) {
  const sorted = useMemo(() => sortVacant(rows), [rows])
  const heads = ['Territory', 'Line', 'Months vacant', 'Currently', 'Last rep', 'Sales', 'Target', 'Gap (lost)']
  return (
    <Section title="Vacant boxes" caption={`Sales in vacant boxes: ${fmtNum(total)} ${CURRENCY}${share === null ? '' : ` (${fmtPct(share)} of total)`}. Gap = sales − target.`}>
      <div className="max-h-[60vh] overflow-auto rounded-card border bg-card">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead><tr>{heads.map((h, i) => <th key={h} className={cn(TH, i < 2 || i === 4 ? 'text-left' : 'text-right')} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }, (_, r) => <tr key={r}>{heads.map((h) => <td key={h} className="h-9 border-b px-3"><Skeleton className="h-4" /></td>)}</tr>)
              : sorted.map((r, i) => (
                <tr key={`${r.territory_id}|${r.territory_name}`} style={i % 2 === 1 ? { backgroundColor: CPAL.zebra } : undefined}>
                  <td className="h-9 whitespace-nowrap border-b px-3 font-medium" style={tdBase}>{r.territory_name}</td>
                  <td className="whitespace-nowrap border-b px-3 text-muted-foreground" style={{ borderBottomColor: CPAL.rowLine }}>{r.line_name ?? '-'}</td>
                  <td className="tnum border-b px-3 text-right" style={tdBase}>{r.months_vacant} / {r.months_total}</td>
                  <td className="border-b px-3 text-right font-bold" style={{ borderBottomColor: CPAL.rowLine, color: r.currently_vacant ? CPAL.red : CPAL.grey }}>{r.currently_vacant ? 'Yes' : 'No'}</td>
                  <td className="whitespace-nowrap border-b px-3 text-muted-foreground" style={{ borderBottomColor: CPAL.rowLine }}>{r.last_rep ?? '-'}</td>
                  <td className="tnum border-b px-3 text-right font-semibold" style={tdBase}>{fmtNum(r.s_value)}</td>
                  <td className="tnum border-b px-3 text-right" style={tdBase}>{fmtNum(r.t_value)}</td>
                  <td className="tnum border-b px-3 text-right font-bold" style={{ ...tdBase, ...negStyle(r.gap) }}>{fmtSigned(r.gap)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {!loading && error && <p className="px-4 py-6 text-center text-sm" style={{ color: CPAL.red }}>{error}</p>}
        {!loading && !error && sorted.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No vacant boxes in this period.</p>}
      </div>
    </Section>
  )
}
