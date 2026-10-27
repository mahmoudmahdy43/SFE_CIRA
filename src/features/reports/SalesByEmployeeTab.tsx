import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Input, Skeleton } from '../../components/ui/misc'
import { ErrorState } from '../../components/app/states'
import { downloadXlsxTables } from '../../lib/xlsxExport'
import { fetchSalesByEmployee, fetchSalesManagers, fetchSalesMonths, fetchSalesProducts } from '../../lib/api/sales'
import { cn } from '../../lib/utils'
import { useAsync } from '../dashboard/useAsync'
import { Seg } from './SalesUi'
import { loadedMonths, type ProductRow } from './salesMath'
import {
  achTone, collapseAll, defaultExpanded, expandAll, exportFileName, flatRows, flatten, figures, fmtNum, fmtPct, hierarchyRows, incompleteNote, monthCell, monthLong, monthShort, monthsInRange,
  productParam, quickOptions, quickPick, buildTree, type EmpRow, type Metric, type Node, type QuickKind, type QuickPick,
} from './salesEmployeeMath'

const SELECT = 'h-9 rounded-control border bg-card px-2 text-sm'
const TONE: Record<string, string> = { red: 'bg-red-100 text-red-900', amber: 'bg-amber-100 text-amber-900', green: 'bg-green-100 text-green-900', none: '' }
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

  if (!monthsQ.loading && !monthsQ.error && loaded.length === 0) return <div className="rounded-card border bg-card p-8 text-center text-sm text-muted-foreground">No sales data. Upload the Sales files.</div>

  const NUM = 'tnum whitespace-nowrap px-2 py-1.5 text-right'
  const cellOf = (n: Node, m: string) => {
    const c = n.months.get(m)
    if (!c) return <span className="text-muted-foreground">-</span>
    const ach = c.t > 0 ? c.s / c.t : null
    return (
      <div>
        <div>{fmtNum(c.s)}</div>
        {perMonth && <div className="text-[10px] font-normal text-muted-foreground">{c.t > 0 ? `${fmtNum(c.t)} · ` : ''}<span className={cn('rounded px-1', TONE[achTone(ach)])}>{fmtPct(ach)}</span></div>}
      </div>
    )
  }

  return (
    <div className="space-y-3">
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
        {QUICK.map((k) => (
          <select key={k.kind} aria-label={k.label} className={SELECT} value="" disabled={loaded.length === 0} onChange={(e) => e.target.value && quick(e.target.value)}>
            <option value="">{k.label}…</option>
            {quickOptions(k.kind, loaded).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
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
        <Button size="sm" variant="outline" onClick={() => setExpanded(expandAll(tree))}>Expand all</Button>
        <Button size="sm" variant="outline" onClick={() => setExpanded(collapseAll())}>Collapse all</Button>
        <Button size="sm" disabled={data.rows.length === 0 || exporting} onClick={() => void exportXlsx()}><FileSpreadsheet className="h-4 w-4" aria-hidden /> {exporting ? 'Preparing…' : 'Excel'}</Button>
      </div>
      {eff && <div className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{monthLong(eff.from)} – {monthLong(eff.to)}</span> · {columns.length} month{columns.length === 1 ? '' : 's'} · {unit}{pickNote && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{pickNote}</span>}{param && <span className="ml-2 text-xs">{param.length} product filter</span>}</div>}

      {fail ? (
        <div className="rounded-card border bg-card"><ErrorState title="The report could not be loaded" message={fail} onRetry={() => setNonce((n) => n + 1)} /></div>
      ) : loadingAll ? (
        <div className="space-y-2" aria-busy="true"><Skeleton className="h-10" /><Skeleton className="h-64" /></div>
      ) : data.rows.length === 0 ? (
        <div className="rounded-card border bg-card p-8 text-center text-sm text-muted-foreground">No sales for this selection.</div>
      ) : (
        <div className="max-h-[75vh] overflow-auto rounded-card border bg-card">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-xs">
                <th className="sticky left-0 top-0 z-30 min-w-64 bg-muted px-2 py-1.5 text-left">Employee</th>
                {columns.map((m) => <th key={m} className="sticky top-0 z-20 whitespace-nowrap bg-muted px-2 py-1.5 text-right">{monthShort(m)}</th>)}
                <th className="sticky top-0 z-20 bg-muted px-2 py-1.5 text-right">Total</th>
                <th className="sticky top-0 z-20 bg-muted px-2 py-1.5 text-right">Target</th>
                <th className="sticky top-0 z-20 bg-muted px-2 py-1.5 text-right">Ach %</th>
                <th className="sticky top-0 z-20 whitespace-nowrap bg-muted px-2 py-1.5 text-right">Avg per month</th>
              </tr>
            </thead>
            <tbody>
              {flat.map(({ node: n, open: isOpen, expandable }) => {
                const f = figures(n, columns.length)
                const bold = n.kind === 'company' || n.kind === 'line' || n.kind === 'manager'
                const bg = n.kind === 'company' ? 'bg-blue-50' : n.kind === 'line' ? 'bg-muted' : n.kind === 'manager' ? 'bg-muted/50' : 'bg-card'
                return (
                  <Fragment key={n.id}>
                    <tr className={cn(bold && 'font-semibold', n.kind === 'vacant' && 'italic text-gray-500', bg)}>
                      <td className={cn('sticky left-0 z-10 border-t px-2 py-1.5', bg)} style={{ paddingLeft: 8 + n.depth * 16 }}>
                        <span className="inline-flex items-center gap-1">
                          {expandable ? (
                            <button type="button" aria-label={isOpen ? `Collapse ${n.label}` : `Expand ${n.label}`} aria-expanded={isOpen} onClick={() => toggle(n.id)} className="rounded p-0.5 hover:bg-muted">
                              {isOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                            </button>
                          ) : <span className="inline-block w-5" />}
                          <span>{n.label}</span>
                          {n.since && <span className="ml-1 text-[11px] font-normal not-italic text-muted-foreground">since {monthShort(n.since)}</span>}
                        </span>
                      </td>
                      {columns.map((m) => <td key={m} className={cn(NUM, 'border-t')} title={monthCell(n, m)}>{cellOf(n, m)}</td>)}
                      <td className={cn(NUM, 'border-t font-semibold')}>{fmtNum(f.total)}</td>
                      <td className={cn(NUM, 'border-t')}>{f.target > 0 ? fmtNum(f.target) : '-'}</td>
                      <td className={cn(NUM, 'border-t')}>{f.ach === null ? '-' : <span className={cn('rounded px-1.5 py-0.5 font-medium', TONE[achTone(f.ach)])}>{fmtPct(f.ach)}</span>}</td>
                      <td className={cn(NUM, 'border-t')}>{fmtNum(f.avg)}</td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
