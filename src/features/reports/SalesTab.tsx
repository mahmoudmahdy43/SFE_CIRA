import { useEffect, useMemo, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input, Skeleton } from '../../components/ui/misc'
import { EmptyState, ErrorState } from '../../components/app/states'
import { downloadXlsxGrids } from '../../lib/xlsxExport'
import {
  fetchSalesActions, fetchSalesField, fetchSalesGap, fetchSalesManagers, fetchSalesMonthly, fetchSalesMonths, fetchSalesProducts, fetchSalesRepProduct, fetchSalesSummary,
  fetchSalesVacant,
} from '../../lib/api/sales'
import { cn } from '../../lib/utils'
import { useAsync } from '../dashboard/useAsync'
import { CPAL } from './coverageMath'
import { ActionSection, FieldSection, VacantSection } from './SalesActions'
import { GapSection, HeatSection } from './SalesGap'
import { GrowthSection, KpiCards, LinesTable, ProductsSection, PvmSection, TrendSection } from './SalesOverview'
import { Logo, Seg } from './SalesUi'
import { buildActionsGrid, buildGapGrid, buildLinesGrid, buildProductsGrid } from './salesExport'
import {
  COMPARE_MODES, DEFAULT_DOWN, DEFAULT_THRESHOLD, SALES_EMPTY_TEXT, SALES_SUBTITLE, SALES_TITLE, actionCounts, actionViews, companyRow, defaultPeriods, gapViews, lineRows,
  loadedMonths, periodOptions, productTotal, productViews, rangeText, repDeltas, resolvePeriods, salesKpi, sortActions,
  type CompareMode, type GapGroup, type Metric, type SalesKpi,
} from './salesMath'
import type { ReportFilters } from './reportMath'

interface Props {
  month?: string
  lines: { id: number; name: string }[]
  filters: ReportFilters
  onFilters: (f: ReportFilters) => void
}

function NumField({ label, value, onCommit, min, max, suffix }: { label: string; value: number; onCommit: (n: number) => void; min: number; max: number; suffix?: string }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = () => {
    const v = Number(text)
    if (Number.isFinite(v) && v >= min && v <= max) onCommit(Math.round(v))
    else setText(String(value))
  }
  return (
    <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      {label}
      <Input type="number" min={min} max={max} aria-label={label} value={text} className="h-9 w-20 text-foreground" onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit() }} />
      {suffix}
    </label>
  )
}

const METRICS: { id: Metric; label: string }[] = [{ id: 'value', label: 'Value' }, { id: 'units', label: 'Units' }]

export function SalesTab({ lines }: Props) {
  const [mode, setMode] = useState<CompareMode>('month')
  const [selId, setSelId] = useState<string | null>(null)
  const [cmpId, setCmpId] = useState<string | null>(null)
  const [line, setLine] = useState<number | null>(null)
  const [manager, setManager] = useState<number | null>(null)
  const [metric, setMetric] = useState<Metric>('value')
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
  const [down, setDown] = useState(DEFAULT_DOWN)
  const [gapTab, setGapTab] = useState<GapGroup>('line')
  const [heatLine, setHeatLine] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)

  /* ---- what is loaded -> periods ---- */
  const monthsQ = useAsync('sales:months', fetchSalesMonths)
  const managersQ = useAsync('sales:managers', fetchSalesManagers)
  const loaded = useMemo(() => loadedMonths(monthsQ.data ?? []), [monthsQ.data])
  const options = useMemo(() => periodOptions(mode, loaded), [mode, loaded])
  const defaults = useMemo(() => defaultPeriods(options), [options])
  const effSel = options.some((o) => o.id === selId) ? selId : defaults.sel
  const effCmp = cmpId === 'none' ? 'none' : cmpId !== null && options.some((o) => o.id === cmpId) ? cmpId : (() => { const i = options.findIndex((o) => o.id === effSel); return i > 0 ? options[i - 1].id : null })()
  const resolved = useMemo(() => resolvePeriods(mode, options, effSel, effCmp), [mode, options, effSel, effCmp])
  const ready = resolved !== null
  const from = resolved?.from ?? ''
  const to = resolved?.to ?? ''
  const cf = resolved?.cmpFrom ?? ''
  const ct = resolved?.cmpTo ?? ''
  const hasCmp = resolved?.hasCmp ?? false
  const trendFrom = loaded.length > 0 ? `${loaded[loaded.length - 1].slice(0, 4)}-01-01` : ''
  const trendTo = loaded.length > 0 ? loaded[loaded.length - 1] : ''
  const scope = useMemo(() => ({ line, manager }), [line, manager])
  const sk = `${line ?? ''}:${manager ?? ''}`
  const pk = (n: string, extra = '') => (ready ? `sales:${n}:${from}:${to}:${cf}:${ct}${extra}` : `sales:${n}:pending`)

  const summaryQ = useAsync(pk('summary'), () => (ready ? fetchSalesSummary(from, to, cf, ct) : Promise.resolve([])))
  const monthlyQ = useAsync(ready ? `sales:monthly:${trendFrom}:${trendTo}:${sk}` : 'sales:monthly:pending', () => (ready ? fetchSalesMonthly(trendFrom, trendTo, scope) : Promise.resolve([])))
  const productsQ = useAsync(pk('products', `:${sk}`), () => (ready ? fetchSalesProducts(from, to, cf, ct, scope) : Promise.resolve([])))
  const gapQ = useAsync(ready ? `sales:gap:${from}:${to}:${gapTab}:${sk}` : 'sales:gap:pending', () => (ready ? fetchSalesGap(from, to, gapTab, scope) : Promise.resolve([])))
  const repCurQ = useAsync(ready ? `sales:gap:${from}:${to}:rep:${sk}` : 'sales:gap:pending', () => (ready ? fetchSalesGap(from, to, 'rep', scope) : Promise.resolve([])))
  const repCmpQ = useAsync(ready && hasCmp ? `sales:gap:${cf}:${ct}:rep:${sk}` : 'sales:gap:pending', () => (ready && hasCmp ? fetchSalesGap(cf, ct, 'rep', scope) : Promise.resolve([])))
  const heatLineId = heatLine !== null && lines.some((l) => l.id === heatLine) ? heatLine : line ?? lines[0]?.id ?? null
  const heatLines = line !== null ? lines.filter((l) => l.id === line) : lines
  const heatQ = useAsync(ready && heatLineId !== null ? `sales:heat:${from}:${to}:${heatLineId}:${manager ?? ''}` : 'sales:heat:pending', () => (ready && heatLineId !== null ? fetchSalesRepProduct(from, to, { line: heatLineId, manager }) : Promise.resolve([])))
  const actionsQ = useAsync(ready ? `sales:actions:${from}:${to}:${threshold}:${down}:${sk}` : 'sales:actions:pending', () => (ready ? fetchSalesActions(from, to, threshold, down, scope) : Promise.resolve([])))
  const fieldQ = useAsync(ready ? `sales:field:${from}:${to}` : 'sales:field:pending', () => (ready ? fetchSalesField(from, to) : Promise.resolve([])))
  const vacantQ = useAsync(ready ? `sales:vacant:${from}:${to}:${line ?? ''}` : 'sales:vacant:pending', () => (ready ? fetchSalesVacant(from, to, line) : Promise.resolve([])))

  const unit = metric === 'value' ? 'EGP' : 'units'
  const lineName = (id: number) => lines.find((l) => l.id === id)?.name ?? `Line ${id}`
  const selectedLineName = line === null ? null : lineName(line)
  const managerName = manager === null ? null : managersQ.data?.find((m) => m.id === manager)?.name ?? null

  /* ---- derived ---- */
  const summary = useMemo(() => summaryQ.data ?? [], [summaryQ.data])
  const products = useMemo(() => productsQ.data ?? [], [productsQ.data])
  const lineTable = useMemo(() => lineRows(summary, metric, lineName), [summary, metric, lines]) // eslint-disable-line react-hooks/exhaustive-deps
  const kpi: SalesKpi | null = useMemo(() => {
    if (manager !== null) {
      // sales_summary has no manager filter: build the cards from the manager-filtered products
      const t = productTotal(products, metric)
      return { sales: t.sales, target: t.target, ach: t.ach, gap: t.gap, cmp: t.cmp, growth: t.growth, vacant: 0, vacantShare: null, noTarget: products.filter((p) => p.t_value === 0).reduce((a, p) => a + p.s_value, 0) }
    }
    const row = line !== null ? summary.find((r) => r.line_id === line) : companyRow(summary)
    return row ? salesKpi(row, metric) : null
  }, [manager, line, summary, products, metric])
  const fieldMap = useMemo(() => new Map((fieldQ.data ?? []).map((f) => [f.rep_id, f])), [fieldQ.data])
  const views = useMemo(() => sortActions(actionViews(actionsQ.data ?? [], fieldMap, threshold)), [actionsQ.data, fieldMap, threshold])
  const counts = useMemo(() => actionCounts(actionsQ.data ?? []), [actionsQ.data])
  const shownActions = useMemo(() => (showAll ? views : views.filter((v) => v.status !== 'OK')), [views, showAll])
  const gapRows = useMemo(() => gapViews(gapQ.data ?? []), [gapQ.data])
  const deltas = useMemo(() => repDeltas(repCurQ.data ?? [], repCmpQ.data ?? []), [repCurQ.data, repCmpQ.data])
  const vacantTotal = useMemo(() => (vacantQ.data ?? []).reduce((a, v) => a + v.s_value, 0), [vacantQ.data])
  const companyValue = useMemo(() => companyRow(summary)?.s_value ?? 0, [summary])
  const vacantShare = companyValue > 0 ? vacantTotal / companyValue : null
  const noData = monthsQ.data !== null && loaded.length === 0

  const lineIdsOf = (names: string | null): number[] => {
    const set = new Set((names ?? '').split(/[,;/]/).map((s) => s.trim()).filter(Boolean))
    const ids = lines.filter((l) => set.has(l.name)).map((l) => l.id)
    return ids.length > 0 ? ids : line !== null ? [line] : lines.map((l) => l.id)
  }

  const periodText = resolved ? `${rangeText(from, to)}${hasCmp ? `   vs   ${rangeText(cf, ct)}` : ''}` : '…'
  const periodLine = `PERIOD: ${periodText.toUpperCase()}   |   LINE: ${(selectedLineName ?? 'All').toUpperCase()}${managerName ? `   |   MANAGER: ${managerName.toUpperCase()}` : ''}   |   METRIC: ${metric.toUpperCase()}`
  const fileBase = `sales-${from.slice(0, 7)}_${to.slice(0, 7)}${selectedLineName ? `-${selectedLineName.replace(/\s+/g, '').toLowerCase()}` : ''}`

  const exportXlsx = () => {
    const pv = productViews(products, metric)
    void downloadXlsxGrids(`${fileBase}.xlsx`, [
      buildLinesGrid({ rows: lineTable, periodLine, unit, hasCmp, showVacant: metric === 'value' }),
      buildProductsGrid({ rows: pv.sort((a, b) => b.sales - a.sales), total: productTotal(products, metric), periodLine, unit }),
      buildGapGrid({ name: ({ line: 'Line', manager: 'Manager', rep: 'Rep', territory: 'Box', product: 'Product' } as const)[gapTab], rows: gapRows, periodLine }),
      buildActionsGrid({ rows: shownActions, periodLine }),
    ])
  }

  const error = monthsQ.error ?? summaryQ.error ?? productsQ.error
  const cardsLoading = !ready || summaryQ.loading || (manager !== null && productsQ.loading)
  const changeMode = (m: CompareMode) => { setMode(m); setSelId(null); setCmpId(null) }

  return (
    <div className="space-y-4 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]">
      {/* header band */}
      <div className="overflow-hidden rounded-md border bg-white" style={{ borderColor: CPAL.navy }}>
        <div className="flex items-center gap-4 px-4 py-3">
          <Logo />
          <div className="min-w-0 flex-1 text-center">
            <h2 className="text-xl font-bold tracking-wide sm:text-[22px]" style={{ color: CPAL.navy }}>{SALES_TITLE}</h2>
            <p className="mt-0.5 text-sm italic" style={{ color: CPAL.grey }}>{SALES_SUBTITLE}</p>
          </div>
          <div aria-hidden className="hidden w-32 shrink-0 sm:block" />
        </div>
        <div className="px-4 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-white" style={{ backgroundColor: CPAL.green }}>
          {periodText}<span className="ml-3 normal-case">·  {metric === 'value' ? 'Value (EGP)' : 'Units'}</span>
        </div>
      </div>

      {/* controls (sticky) */}
      <div className="sticky top-14 z-20 -mx-1 space-y-2 border-b bg-background/95 px-1 py-2 backdrop-blur print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <Seg label="Compare mode" value={mode} options={COMPARE_MODES} onChange={changeMode} />
          <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            Selected
            <select aria-label="Selected period" value={effSel ?? ''} disabled={options.length === 0} onChange={(e) => { setSelId(e.target.value); setCmpId(null) }} className="h-9 rounded-control border bg-card px-2 text-sm text-foreground">
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
          {mode !== 'ytd' && (
            <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              Comparison
              <select aria-label="Comparison period" value={effCmp ?? 'none'} disabled={options.length === 0} onChange={(e) => setCmpId(e.target.value)} className="h-9 rounded-control border bg-card px-2 text-sm text-foreground">
                <option value="none">None</option>
                {options.filter((o) => o.id !== effSel).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
          )}
          <span className="ml-auto" />
          <Button size="sm" onClick={exportXlsx} disabled={!ready || products.length === 0}><FileSpreadsheet className="h-4 w-4" /> Export Excel</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Line filter" className="flex flex-wrap gap-1.5">
            {[{ id: null as number | null, name: 'All' }, ...lines].map((c) => (
              <button
                key={c.name} aria-pressed={line === c.id} onClick={() => { setLine(c.id); setHeatLine(null) }}
                className={cn('rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted', line === c.id && 'border-primary bg-accent font-medium text-accent-foreground')}
              >
                {c.name}
              </button>
            ))}
          </div>
          <select aria-label="Direct manager" value={manager ?? ''} onChange={(e) => setManager(e.target.value === '' ? null : Number(e.target.value))} className="h-9 max-w-[14rem] rounded-control border bg-card px-2 text-sm">
            <option value="">All managers</option>
            {(managersQ.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <Seg label="Metric" value={metric} options={METRICS} onChange={setMetric} />
          <NumField label="Achievement below" value={threshold} onCommit={setThreshold} min={1} max={200} suffix="%" />
          <NumField label="Declining months" value={down} onCommit={setDown} min={1} max={12} />
        </div>
      </div>

      {resolved?.banner && (
        <p role="status" className="rounded-md border px-3 py-1.5 text-sm" style={{ borderColor: '#E8C77A', backgroundColor: '#FDF3E0', color: '#7A5410' }}>{resolved.banner}</p>
      )}

      {error ? (
        <div className="rounded-card border bg-card"><ErrorState message={error} onRetry={() => { monthsQ.reload(); summaryQ.reload(); productsQ.reload() }} /></div>
      ) : noData ? (
        <div className="rounded-card border bg-card"><EmptyState title="No sales data" description={SALES_EMPTY_TEXT} /></div>
      ) : monthsQ.loading ? (
        <div className="space-y-3" aria-busy="true"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>
      ) : (
        <>
          <KpiCards kpi={kpi} metric={metric} hasCmp={hasCmp} loading={cardsLoading} action={counts.action} watch={counts.watch} actionsLoading={actionsQ.loading} showVacant={manager === null} />
          <LinesTable rows={lineTable} threshold={threshold} hasCmp={hasCmp} showVacant={metric === 'value'} loading={!ready || summaryQ.loading} unit={unit} managerNote={manager !== null} />
          <TrendSection monthly={monthlyQ.data ?? []} lineId={line} lineLabel={selectedLineName ?? 'Company'} metric={metric} loading={!ready || monthlyQ.loading} />
          <ProductsSection rows={products} metric={metric} threshold={threshold} hasCmp={hasCmp} loading={!ready || productsQ.loading} />
          <PvmSection rows={products} hasCmp={hasCmp} cmpLabel={resolved?.cmpLabel ?? ''} selLabel={resolved?.selLabel ?? ''} loading={!ready || productsQ.loading} />
          <GrowthSection rows={products} deltas={deltas} hasCmp={hasCmp} cmpLabel={resolved?.cmpLabel ?? ''} selLabel={resolved?.selLabel ?? ''} loading={!ready || productsQ.loading || repCurQ.loading || repCmpQ.loading} />
          <GapSection tab={gapTab} onTab={setGapTab} rows={gapRows} threshold={threshold} loading={!ready || gapQ.loading} error={gapQ.error} />
          <HeatSection rows={heatQ.data ?? []} lines={heatLines} line={heatLineId} onLine={setHeatLine} loading={!ready || heatQ.loading} error={heatQ.error} />
          <ActionSection
            rows={shownActions} all={views.length} showAll={showAll} onShowAll={setShowAll} threshold={threshold} loading={!ready || actionsQ.loading} error={actionsQ.error}
            onExport={() => void downloadXlsxGrids(`${fileBase}-actions.xlsx`, [buildActionsGrid({ rows: shownActions, periodLine })])}
            from={from} to={to} lineIds={lineIdsOf} manager={manager}
          />
          <FieldSection rows={views} fieldEmpty={!fieldQ.loading && (fieldQ.data ?? []).length === 0} loading={!ready || fieldQ.loading || actionsQ.loading} />
          <VacantSection rows={vacantQ.data ?? []} share={vacantShare} total={vacantTotal} loading={!ready || vacantQ.loading} error={vacantQ.error} />
          <p className="text-xs italic" style={{ color: CPAL.grey }}>Achievement = sales of targeted rows ÷ target. Gap = targeted sales − target. Growth = (selected − comparison) ÷ comparison. Comparison is inside the loaded months only.</p>
        </>
      )}
    </div>
  )
}
