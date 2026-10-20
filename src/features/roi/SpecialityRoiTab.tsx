import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Download, Loader2, Settings2 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { ChartCard } from '../../components/app/ChartCard'
import { CHART, ChartTip, axisProps } from '../../components/app/charts'
import { MultiSelect, Segmented } from '../../components/app/Controls'
import { EmptyState, ErrorState } from '../../components/app/states'
import { buttonVariants, Button } from '../../components/ui/button'
import { Card, Skeleton } from '../../components/ui/misc'
import { useDateRange } from '../../context/DateRangeContext'
import { fetchRoi, fetchRoiMonthly, fetchRoiProducts, fetchRoiQuality, fetchRoiTerritories, fetchVisitCosts, type RoiRow } from '../../lib/api/roi'
import { fetchLineNames } from '../../lib/api/reports'
import { cn } from '../../lib/utils'
import { fmtInt } from '../dashboard/kpiMath'
import { firstDay, lastDay, periodLabel, type Period } from '../dashboard/periodMath'
import { dashQueued, PRIORITY, resetDashCache, useDash } from '../dashboard/useDash'
import { RoiBadge } from './RoiBadge'
import { RoiCostBox } from './RoiCostBox'
import { RoiDetail } from './RoiDetail'
import { RoiScopeView } from './RoiScopeView'
import { RoiTable, type RoiCol } from './RoiTable'
import { buildMonthlyGrid, buildSummaryGrid, buildTerritoriesGrid, downloadRoiWorkbook } from './roiExport'
import { costFor, parseIds, parseLine, parseMeasure, parseMinVisits, parseShift, productsLabel, qualityText, summariseQuality, type Measure, type Selection, type Shift } from './roiMath'

export function SpecialityRoiTab() {
  const dr = useDateRange() // the period is the one in the top bar, widened to whole months
  const [params, setParams] = useSearchParams()
  const [rev, setRev] = useState(0)
  const [exporting, setExporting] = useState(false)

  const period: Period = useMemo(() => ({ mode: 'custom', fromYM: dr.from.slice(0, 7), toYM: dr.to.slice(0, 7) }), [dr.from, dr.to])
  const r = useMemo(() => ({ from: firstDay(period.fromYM), to: lastDay(period.toYM) }), [period])
  const lineId = parseLine(params.get('line'))
  const shift = parseShift(params.get('shift'))
  const groupId = parseLine(params.get('group'))
  const measure = parseMeasure(params.get('measure'))
  const minVisits = parseMinVisits(params.get('min'))

  // line / product / visits / measure / selected group live in the URL next to the top-bar range (?from=&to=), which is kept as it is
  const update = useCallback((patch: Record<string, string | number | null>) => {
    const q = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') q.delete(k); else q.set(k, String(v)) }
    setParams(q, { replace: true })
  }, [params, setParams])

  const lines = useDash('lines:names', PRIORITY.kpi, () => fetchLineNames())
  const base = `${rev}:${r.from}:${r.to}:${lineId ?? 'all'}`
  const quality = useDash(`roi:q:${base}`, PRIORITY.kpi, (s) => fetchRoiQuality(r.from, r.to, lineId, s))
  const summary = useDash(`roi:s:${base}:${shift}`, PRIORITY.kpi, (s) => fetchRoi(r.from, r.to, lineId, shift, s))
  const products = useDash(lineId !== null ? `roi:prod:${rev}:${lineId}` : null, PRIORITY.other, (s) => fetchRoiProducts(lineId as number, s))
  const costs = useDash(`roi:costs:${rev}`, PRIORITY.other, (s) => fetchVisitCosts(s))

  const rows = useMemo(() => summary.data ?? [], [summary.data])
  const selected = rows.find((x) => x.group_id === groupId) ?? null
  const wanted = parseIds(params.get('products'))
  const chosen = lineId === null ? [] : (products.data ?? []).filter((x) => wanted.includes(x.product_id))
  const sel: Selection = { group: selected?.group_id ?? null, line: lineId, products: chosen.map((x) => x.product_id) }
  const lineName = lineId === null ? 'All lines' : (lines.data ?? []).find((l) => l.id === lineId)?.name ?? `Line ${lineId}`
  const scopeName = chosen.length > 0 ? `${lineName} · ${productsLabel(chosen.map((x) => x.name))}` : lineId === null ? 'Whole company' : lineName
  const whole = dr.from !== r.from || dr.to !== r.to
  const periodLine = `${periodLabel(period)}  |  ${lineName}  |  Visits: ${shift === 'ALL' ? 'AM + PM' : shift}`
  const q = useMemo(() => summariseQuality(quality.data ?? []), [quality.data])
  const lineIdx = (id: number) => Math.max(0, (lines.data ?? []).findIndex((l) => l.id === id))

  const cols: RoiCol<RoiRow>[] = useMemo(() => [
    { id: 'line', header: 'Line', value: (x) => x.line_name },
    { id: 'group', header: 'Group', value: (x) => x.group_name, className: () => 'font-medium' },
    { id: 'spec', header: 'Specialities', value: (x) => x.specialities },
    { id: 'prod', header: 'Products', value: (x) => x.products },
    { id: 'docs', header: 'Doctors in list', numeric: true, value: (x) => x.list_doctors, render: (x) => fmtInt(x.list_doctors) },
    { id: 'visits', header: 'Visits', numeric: true, value: (x) => x.visits, render: (x) => fmtInt(x.visits) },
    { id: 'vpd', header: 'Visits / doctor', numeric: true, value: (x) => x.visits_per_doctor, render: (x) => x.visits_per_doctor?.toFixed(2) ?? '—' },
    { id: 'sales', header: 'Sales (EGP)', numeric: true, value: (x) => x.s_value, render: (x) => fmtInt(x.s_value) },
    { id: 'units', header: 'Units', numeric: true, value: (x) => x.s_units, render: (x) => fmtInt(x.s_units) },
    { id: 'cost', header: 'Visit cost', numeric: true, value: (x) => x.cost, render: (x) => fmtInt(x.cost) },
    { id: 'spv', header: 'Sales per visit', numeric: true, value: (x) => x.sales_per_visit, render: (x) => fmtInt(x.sales_per_visit) },
    { id: 'roi', header: 'ROI', numeric: true, value: (x) => x.roi, render: (x) => <RoiBadge roi={x.roi} /> },
  ], [])

  const ranking = useMemo(() => rows.filter((x) => x.sales_per_visit !== null).sort((a, b) => (b.sales_per_visit ?? 0) - (a.sales_per_visit ?? 0))
    .map((x) => ({ name: `${x.line_name} · ${x.group_name}`, spv: x.sales_per_visit as number, line_id: x.line_id })), [rows])

  const afterCostSaved = () => { resetDashCache(); setRev((n) => n + 1) }

  const exportAll = async () => {
    setExporting(true)
    try {
      const k = (g: RoiRow) => `${rev}:${g.group_id}:${r.from}:${r.to}:${shift}`
      const [terr, mon] = await Promise.all([
        Promise.all(rows.map(async (g) => ({ group: g, rows: await dashQueued(`roi:t:${k(g)}`, PRIORITY.lazy, (s) => fetchRoiTerritories(g.group_id, r.from, r.to, shift, s)) }))),
        Promise.all(rows.map(async (g) => ({ group: g, rows: await dashQueued(`roi:m:${k(g)}`, PRIORITY.lazy, (s) => fetchRoiMonthly({ group: g.group_id, line: null, products: [] }, r.from, r.to, shift, s)) }))),
      ])
      await downloadRoiWorkbook(`speciality-roi-${period.fromYM}_${period.toYM}.xlsx`, [buildSummaryGrid(rows, periodLine), buildTerritoriesGrid(terr, periodLine), buildMonthlyGrid(mon, periodLine)])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Line" value={lineId ?? 0} onChange={(v) => update({ line: v === 0 ? null : v, products: null, group: null })}
            options={[{ value: 0, label: 'All' }, ...(lines.data ?? []).map((l) => ({ value: l.id, label: l.name }))]} />
          <Segmented label="Visits" value={shift} onChange={(s) => update({ shift: s === 'ALL' ? null : s })} options={[{ value: 'ALL' as Shift, label: 'All' }, { value: 'AM' as Shift, label: 'AM' }, { value: 'PM' as Shift, label: 'PM' }]} />
          <Button size="sm" disabled={exporting || rows.length === 0} onClick={() => void exportAll()}>
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />}Excel
          </Button>
        </div>
        <RoiCostBox history={costs.data ?? []} toYM={period.toYM} onSaved={afterCostSaved} />
      </div>
      <p className="text-xs text-muted-foreground">Period: <span className="font-medium">{periodLabel(period)}</span> ({period.fromYM} → {period.toYM}), from the top bar{whole ? '; widened to whole months, because sales are monthly' : ''}. Cost per visit now: <span className="tnum font-medium">{costFor(costs.data ?? [], period.toYM).toLocaleString('en-US')}</span> EGP (month of the period end).</p>

      {quality.error ? <ErrorState title="Could not load the data-quality check" message={quality.error} onRetry={quality.reload} className="py-4" />
        : quality.data && q.visits > 0 && (
          <div role="status" className={cn('flex items-start gap-2 rounded-control border px-3 py-2 text-sm', q.warn ? 'border-warning bg-warning-soft text-warning' : 'bg-card text-muted-foreground')}>
            {q.warn && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            <span>{qualityText(q)}{q.warn && ' Less than 80% of the visits are classified, so the ROI below under-counts visits.'}</span>
          </div>
        )}

      <Card className="p-5">
        <h3 className="mb-3 text-sm font-semibold">Groups</h3>
        {summary.error ? <ErrorState title="Could not load the ROI" message={summary.error} onRetry={summary.reload} className="py-8" />
          : summary.loading ? <Skeleton className="h-40 w-full" />
          : rows.length === 0 ? (
            <EmptyState title="No groups yet — set up the speciality map" description="Group the specialities that share the same products, per line."
              action={<Link to="/org?tab=specmap" className={cn(buttonVariants({ variant: 'primary' }))}><Settings2 className="h-4 w-4" aria-hidden />Open the speciality map</Link>} />
          ) : (
            <RoiTable label="Speciality ROI" cols={cols} rows={rows} rowKey={(x) => x.group_id} selectedKey={groupId}
              onRowClick={(x) => update({ group: x.group_id })} initial={{ id: 'roi', dir: 'desc' }} />
          )}
      </Card>

      {ranking.length > 0 && (
        <ChartCard title="Sales per visit" description="EGP of group sales for each visit, best first. Colour = line."
          legend={(lines.data ?? []).filter((l) => ranking.some((x) => x.line_id === l.id)).map((l) => ({ label: l.name, color: CHART[lineIdx(l.id) % CHART.length] }))}>
          <div role="img" aria-label="Sales per visit by group" style={{ height: ranking.length * 30 + 40 }}>
            <ResponsiveContainer>
              <BarChart data={ranking} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
                <XAxis type="number" {...axisProps} tickFormatter={(v: number) => fmtInt(v)} />
                <YAxis type="category" dataKey="name" width={200} {...axisProps} />
                <Tooltip content={<ChartTip fmt={fmtInt} />} cursor={{ fill: 'hsl(var(--muted))' }} />
                <Bar dataKey="spv" name="Sales per visit" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
                  {ranking.map((x) => <Cell key={x.name} fill={CHART[lineIdx(x.line_id) % CHART.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Scope of the chart and the territories">
          <span className="text-13 font-medium text-muted-foreground">Scope</span>
          {selected ? (
            <>
              <span className="text-sm">Group: <span className="font-medium">{selected.line_name} · {selected.group_name}</span></span>
              <Button size="sm" onClick={() => update({ group: null })}><ArrowLeft className="h-3.5 w-3.5" aria-hidden />Back to company view</Button>
            </>
          ) : (
            <>
              <span className="text-sm">{lineName}</span>
              {lineId !== null && (
                <MultiSelect label="Products" options={(products.data ?? []).map((x) => ({ id: x.product_id, name: x.in_group ? x.name : `${x.name} (not in a group)` }))}
                  value={chosen.map((x) => x.product_id)} onChange={(ids) => update({ products: ids.length ? [...ids].sort((p, q) => p - q).join(',') : null })} allLabel="All products" loading={products.loading} showSelectAll />
              )}
            </>
          )}
          <Segmented label="Sales measure" value={measure} onChange={(m: Measure) => update({ measure: m === 'value' ? null : m })} options={[{ value: 'value' as Measure, label: 'Value' }, { value: 'units' as Measure, label: 'Units' }]} />
        </div>
      </Card>

      {selected
        ? <RoiDetail group={selected} from={r.from} to={r.to} shift={shift} rev={rev} periodLine={periodLine} measure={measure} />
        : <RoiScopeView sel={sel} chosen={chosen} from={r.from} to={r.to} shift={shift} measure={measure} minVisits={minVisits} onMinVisits={(t) => update({ min: parseMinVisits(t) === 10 ? null : parseMinVisits(t) })} rev={rev} periodLine={periodLine} scopeName={scopeName} />}
    </div>
  )
}
