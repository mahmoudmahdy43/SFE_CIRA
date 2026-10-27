import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Card, Input, Skeleton } from '../../components/ui/misc'
import { EmptyState, ErrorState } from '../../components/app/states'
import { downloadXlsxTables } from '../../lib/xlsxExport'
import { fetchSalesByEmployee, fetchSalesManagers, fetchSalesMonths, fetchSalesProducts } from '../../lib/api/sales'
import { cn } from '../../lib/utils'
import { useAsync } from '../dashboard/useAsync'
import { AMBER, AMBER_BODY, Seg, TONE_COLOR, negStyle } from './SalesUi'
import { CPAL } from './coverageMath'
import { loadedMonths, type ProductRow } from './salesMath'
import {
  achTone, boxHint, collapseAll, fullLabel, groupText, territoryMissing, defaultExpanded, expandAll, exportFileName, flatRows, flatten, figures, fmtNum, fmtPct, hierarchyRows, incompleteNote, cellTitle, kpis, monthLong, monthShort, monthsInRange,
  productParam, rowHeat, quickOptions, quickPick, buildTree, type EmpRow, type Metric, type Node, type QuickKind, type QuickPick,
} from './salesEmployeeMath'

const SELECT = 'h-9 rounded-control border bg-card px-2 text-sm'
/** Ach % chip: the palette of the Sales tab (text colour + light body). */
const CHIP_BODY = { red: CPAL.redBody, amber: AMBER_BODY, green: CPAL.greenBody, none: 'transparent' } as const
const STRIPES = [CPAL.teal, '#3B6FB6', AMBER]   // CIRA 1, 2, 3 (muted)
const SUMMARY_BG = '#F8FAFC'
function AchChip({ ach }: { ach: number | null }) {
  if (ach === null) return <span className="text-gray-400">-</span>
  const tone = achTone(ach)
  return <span className="tnum inline-block rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ color: TONE_COLOR[tone], backgroundColor: CHIP_BODY[tone] }}>{fmtPct(ach)}</span>
}
function Kpi({ label, value, hint, loading }: { label: string; value: string; hint?: string; loading: boolean }) {
  if (loading) return <Card className="p-4" aria-busy="true"><Skeleton className="h-3 w-24" /><Skeleton className="mt-3 h-8 w-20" /></Card>
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="tnum mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  )
}
const METRICS: { id: Metric; label: string }[] = [{ id: 'value', label: 'Value (EGP)' }, { id: 'units', label: 'Units' }]
const QUICK: { kind: QuickKind; label: string }[] = [{ kind: 'quarter', label: 'Quarter' }, { kind: 'semester', label: 'Semester' }, { kind: 'ytd', label: 'YTD' }]

/** Multi-select of products, grouped by line, with search. Nothing selected = all products. */
function ProductFilter({ products, selected, onChange }: { products: ProductRow[]; selected: Set<number>; onChange: (s: Set<number>) => void }) {
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const by = new Map<string, ProductRow[]>()
    for (const p of products) if (q === '' || p.product_name.toLowerCase().includes(q.toLowerCase())) by.set(p.line_name ?? '-', [...(by.get(p.line_name ?? '-') ?? []), p])
    return [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([line, list]) => [line, [...list].sort((a, b) => a.product_name.localeCompare(b.product_name))] as const)
  }, [products, q])
  const toggle = (ids: number[], on: boolean) => { const next = new Set(selected); for (const id of ids) { if (on) next.add(id); else next.delete(id) } onChange(next) }
  return (
    <details className="relative">
      <summary className={cn(SELECT, 'flex cursor-pointer list-none items-center gap-1')}>{selected.size === 0 ? 'All products' : `${selected.size} product${selected.size === 1 ? '' : 's'}`}<ChevronDown className="h-4 w-4" aria-hidden /></summary>
      <div className="absolute z-30 mt-1 max-h-96 w-72 overflow-auto rounded-card border bg-card p-2 shadow-lg">
        <Input aria-label="Search product" placeholder="Search product…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" />
        <button type="button" className="mb-2 text-xs text-primary underline" onClick={() => onChange(new Set())}>All products (clear)</button>
        {groups.map(([line, list]) => (
          <div key={line} className="mb-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <input type="checkbox" checked={list.every((p) => selected.has(p.product_id))} onChange={(e) => toggle(list.map((p) => p.product_id), e.target.checked)} />{line}
            </label>
            {list.map((p) => (
              <label key={p.product_id} className="flex items-center gap-2 py-0.5 pl-4 text-sm">
                <input type="checkbox" checked={selected.has(p.product_id)} onChange={(e) => toggle([p.product_id], e.target.checked)} />{p.product_name}
              </label>
            ))}
          </div>
        ))}
        {groups.length === 0 && <div className="text-sm text-muted-foreground">No product matches.</div>}
      </div>
    </details>
  )
}

interface Loaded { rows: EmpRow[]; error: string | null; loading: boolean }

export function SalesByEmployeeTab({ lines }: { lines: { id: number; name: string }[] }) {
  const monthsQ = useAsync('sales:months', fetchSalesMonths)
  const managersQ = useAsync('sales:managers', fetchSalesManagers)
  const loaded = useMemo(() => loadedMonths(monthsQ.data ?? []), [monthsQ.data])
  const productsQ = useAsync('sales:by-employee:products', async () => {
    const all = (await fetchSalesMonths()).map((m) => m.month).filter(Boolean).sort()
    return all.length === 0 ? [] : fetchSalesProducts(all[0], all[all.length - 1], all[0], all[all.length - 1], { line: null, manager: null })
  })
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const [pickNote, setPickNote] = useState('')
  const [line, setLine] = useState<number | null>(null)
  const [manager, setManager] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [metric, setMetric] = useState<Metric>('value')
  const [perMonth, setPerMonth] = useState(false)
  const [expanded, setExpanded] = useState<Set<string> | null>(null)
  const [exporting, setExporting] = useState(false)
  const [data, setData] = useState<Loaded>({ rows: [], error: null, loading: true })
  const [nonce, setNonce] = useState(0)
  const [scrolled, setScrolled] = useState(false)

  // Default period: YTD of the latest loaded year.
  const eff = useMemo(() => {
    if (range) return range
    if (loaded.length === 0) return null
    const p = quickPick(`${loaded[loaded.length - 1].slice(0, 4)}-YTD`, loaded)
    return p ? { from: p.from, to: p.to } : null
  }, [range, loaded])
  const columns = useMemo(() => (eff ? monthsInRange(loaded, eff.from, eff.to) : []), [eff, loaded])
  const products = useMemo(() => productsQ.data ?? [], [productsQ.data])
  const productIds = useMemo(() => products.map((p) => p.product_id), [products])
  const param = useMemo(() => productParam(selected, productIds), [selected, productIds])

  useEffect(() => {
    if (!eff) return
    let cancelled = false
    setData((d) => ({ ...d, error: null, loading: true }))
    fetchSalesByEmployee(eff.from, eff.to, line, manager, param)
      .then((rows) => { if (!cancelled) { setData({ rows, error: null, loading: false }); setExpanded(null) } })
      .catch((e: unknown) => !cancelled && setData({ rows: [], error: e instanceof Error ? e.message : 'Failed to load', loading: false }))
    return () => { cancelled = true }
  }, [eff, line, manager, param, nonce])

  const tree = useMemo(() => buildTree(data.rows, columns, metric), [data.rows, columns, metric])
  const open = expanded ?? defaultExpanded(tree)
  const flat = useMemo(() => flatten(tree, open), [tree, open])
  const toggle = (id: string) => { const next = new Set(open); if (next.has(id)) next.delete(id); else next.add(id); setExpanded(next) }
  const setFrom = (m: string) => { setPickNote(''); setRange({ from: m, to: eff && eff.to >= m ? eff.to : m }) }
  const setTo = (m: string) => { setPickNote(''); setRange({ from: eff && eff.from <= m ? eff.from : m, to: m }) }
  const quick = (id: string) => { const p: QuickPick | null = quickPick(id, loaded); if (p) { setRange({ from: p.from, to: p.to }); setPickNote(incompleteNote(p)) } }

  const exportXlsx = async () => {
    if (!eff) return
    setExporting(true)
    try {
      await downloadXlsxTables(exportFileName(eff.from, eff.to), [{ name: 'Hierarchy', rows: hierarchyRows(tree, columns) }, { name: 'Flat', rows: flatRows(tree, columns) }])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const unit = metric === 'value' ? 'EGP' : 'units'
  const loadingAll = monthsQ.loading || data.loading
  const fail = monthsQ.error ?? data.error
  const k = useMemo(() => kpis(tree), [tree])

  if (!monthsQ.loading && !monthsQ.error && loaded.length === 0) return <div className="rounded-card border bg-card"><EmptyState title="No sales data" description="Upload the Sales files." /></div>

  const NUM = 'tnum whitespace-nowrap px-2 py-1.5 text-right'
  const shadow = scrolled ? 'shadow-[3px_0_5px_-3px_rgba(0,0,0,0.35)]' : ''
  const cellOf = (n: Node, m: string) => {
    const c = n.months.get(m)
    if (!c) return <span className="text-gray-400">-</span>
    const ach = c.t > 0 ? c.s / c.t : null
    return (
      <div>
        <div style={negStyle(c.s)}>{fmtNum(c.s)}</div>
        {perMonth && <div className="text-[10px] font-normal opacity-80">{c.t > 0 ? `${fmtNum(c.t)} · ` : ''}<AchChip ach={ach} /></div>}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border bg-card p-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-sm text-muted-foreground">From
            <select aria-label="From month" className={SELECT} value={eff?.from ?? ''} disabled={loaded.length === 0} onChange={(e) => setFrom(e.target.value)}>
              {loaded.map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 text-sm text-muted-foreground">To
            <select aria-label="To month" className={SELECT} value={eff?.to ?? ''} disabled={loaded.length === 0} onChange={(e) => setTo(e.target.value)}>
              {loaded.map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
            </select>
          </label>
          {QUICK.map((q) => (
            <select key={q.kind} aria-label={q.label} className={SELECT} value="" disabled={loaded.length === 0} onChange={(e) => e.target.value && quick(e.target.value)}>
              <option value="">{q.label}…</option>
              {quickOptions(q.kind, loaded).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          ))}
          <select aria-label="Line" className={SELECT} value={line ?? ''} onChange={(e) => setLine(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">All lines</option>
            {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select aria-label="Direct manager" className={cn(SELECT, 'max-w-[14rem]')} value={manager ?? ''} onChange={(e) => setManager(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">All managers</option>
            {(managersQ.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <ProductFilter products={products} selected={selected} onChange={setSelected} />
          <Seg label="Metric" value={metric} options={METRICS} onChange={setMetric} />
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={perMonth} onChange={(e) => setPerMonth(e.target.checked)} />Show Target and Ach % per month</label>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setExpanded(expandAll(tree))}>Expand all</Button>
          <Button size="sm" variant="outline" onClick={() => setExpanded(collapseAll())}>Collapse all</Button>
          <Button size="sm" disabled={data.rows.length === 0 || exporting} onClick={() => void exportXlsx()}><FileSpreadsheet className="h-4 w-4" aria-hidden /> {exporting ? 'Preparing…' : 'Excel'}</Button>
        </div>
      </div>
      {eff && <div className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{monthLong(eff.from)} - {monthLong(eff.to)}</span>, {columns.length} month{columns.length === 1 ? '' : 's'}, {unit}{pickNote && <span className="ml-2 rounded-full px-2 py-0.5 text-xs font-medium" style={{ color: AMBER, backgroundColor: AMBER_BODY }}>{pickNote}</span>}{param && <span className="ml-2 text-xs">{param.length} product filter</span>}</div>}

      {!fail && !loadingAll && territoryMissing(data.rows) && <div role="alert" className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">The function returned no territory names. Run supabase/92_sales_by_employee.sql again, then run notify pgrst, 'reload schema'; in Supabase.</div>}
      {!fail && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi loading={loadingAll} label="Company sales" value={fmtNum(k.sales)} hint={unit} />
          <Kpi loading={loadingAll} label="Target" value={k.target > 0 ? fmtNum(k.target) : '-'} hint={unit} />
          <Kpi loading={loadingAll} label="Ach %" value={fmtPct(k.ach)} hint="all sales / target" />
          <Kpi loading={loadingAll} label="Vacant sales" value={fmtNum(k.vacant)} hint={k.vacantShare === null ? unit : `${(k.vacantShare * 100).toFixed(1)}% of the total`} />
        </div>
      )}

      {fail ? (
        <div className="rounded-card border bg-card"><ErrorState title="The report could not be loaded" message={fail} onRetry={() => setNonce((n) => n + 1)} /></div>
      ) : loadingAll ? (
        <div className="space-y-2" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-8" />)}</div>
      ) : data.rows.length === 0 ? (
        <div className="rounded-card border bg-card"><EmptyState title="No sales for this selection" description="Try another period, line, manager or product." /></div>
      ) : (
        <div className="max-h-[75vh] overflow-auto rounded-card border bg-card print:max-h-none print:overflow-visible" onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 0)}>
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-xs">
                <th className={cn('sticky left-0 top-0 z-30 w-[340px] min-w-[340px] max-w-[340px] bg-muted px-2 py-2 text-left', shadow)}>Employee</th>
                {columns.map((m) => <th key={m} className="sticky top-0 z-20 whitespace-nowrap bg-muted px-2 py-2 text-right">{monthShort(m)}</th>)}
                <th className="sticky top-0 z-20 border-l bg-muted px-2 py-2 text-right">Total</th>
                <th className="sticky top-0 z-20 bg-muted px-2 py-2 text-right">Target</th>
                <th className="sticky top-0 z-20 bg-muted px-2 py-2 text-right">Ach %</th>
                <th className="sticky top-0 z-20 whitespace-nowrap bg-muted px-2 py-2 text-right">Avg / month</th>
              </tr>
            </thead>
            <tbody>
              {flat.map(({ node: n, open: isOpen, expandable }) => {
                const f = figures(n, columns.length)
                const heat = rowHeat(n)
                const dark = n.kind === 'company'
                const bg = dark ? CPAL.navy : n.kind === 'line' ? CPAL.subBody : n.kind === 'manager' ? CPAL.totalBody : '#FFFFFF'
                const sumBg = dark ? CPAL.navy : n.kind === 'line' ? CPAL.subBody : n.kind === 'manager' ? CPAL.totalBody : SUMMARY_BG
                const stripe = n.kind === 'line' ? STRIPES[((Number(/\d+/.exec(n.line)?.[0]) || 1) - 1) % STRIPES.length] : undefined
                const bold = n.kind === 'company' || n.kind === 'line' || n.kind === 'manager'
                const sep = { borderTop: `1px solid ${dark ? CPAL.navy : '#E8EBEF'}` }
                return (
                  <tr key={n.id} className={cn('print:break-inside-avoid', bold && 'font-semibold', (n.kind === 'vacant' || n.kind === 'vterr') && 'italic text-gray-500')} style={{ color: dark ? '#FFFFFF' : undefined }}>
                    <td className={cn('sticky left-0 z-10 w-[340px] min-w-[340px] max-w-[340px] py-1.5 pr-2', shadow)} title={fullLabel(n)} style={{ ...sep, backgroundColor: bg, paddingLeft: 8 + n.depth * 16, borderLeft: stripe ? `4px solid ${stripe}` : undefined }}>
                      <span className="flex min-w-0 items-center gap-1 whitespace-nowrap">
                        {expandable ? (
                          <button type="button" aria-label={isOpen ? `Collapse ${n.label}` : `Expand ${n.label}`} aria-expanded={isOpen} onClick={() => toggle(n.id)} className="shrink-0 rounded p-0.5 hover:bg-black/10">
                            {isOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                          </button>
                        ) : <span className="inline-block w-5 shrink-0" />}
                        {(n.kind === 'vacant' || n.kind === 'vterr') && <span className="shrink-0 rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold not-italic tracking-wide text-gray-600">VACANT</span>}
                        {(n.kind === 'vacant' || n.kind === 'vterr') && n.line && <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold not-italic text-gray-600">{n.line}</span>}
                        <span className="truncate">{n.kind === 'vacant' ? groupText(n) : n.label}</span>
                        {n.kind === 'vterr' && boxHint(n.territory, n.box) && <span className="truncate text-[11px] font-normal text-gray-400">· {boxHint(n.territory, n.box)}</span>}
                        {n.since && <span className="ml-1 shrink-0 text-[11px] font-normal not-italic text-muted-foreground">since {monthShort(n.since)}</span>}
                      </span>
                    </td>
                    {columns.map((m) => {
                      const h = heat.get(m)
                      return <td key={m} className={NUM} title={cellTitle(n, m)} style={{ ...sep, backgroundColor: h === undefined ? bg : `rgba(44,126,110,${(0.05 + 0.22 * h).toFixed(3)})` }}>{cellOf(n, m)}</td>
                    })}
                    <td className={cn(NUM, 'border-l font-bold')} style={{ ...sep, backgroundColor: sumBg }}><span style={negStyle(f.total)}>{fmtNum(f.total)}</span></td>
                    <td className={NUM} style={{ ...sep, backgroundColor: sumBg }}>{f.target > 0 ? fmtNum(f.target) : <span className="text-gray-400">-</span>}</td>
                    <td className={NUM} style={{ ...sep, backgroundColor: sumBg }}><AchChip ach={f.ach} /></td>
                    <td className={NUM} style={{ ...sep, backgroundColor: sumBg }}>{fmtNum(f.avg)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
