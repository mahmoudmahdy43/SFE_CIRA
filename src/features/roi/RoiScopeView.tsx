import { useMemo, useState } from 'react'
import { AlertTriangle, Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, ErrorState } from '../../components/app/states'
import { Tooltip } from '../../components/ui/overlay'
import { Button } from '../../components/ui/button'
import { Card, Skeleton } from '../../components/ui/misc'
import { fetchRoiMonthly, fetchRoiScopeTerritories, type RoiProduct, type RoiScopeTerritory } from '../../lib/api/roi'
import { fmtInt } from '../dashboard/kpiMath'
import { PRIORITY, useDash } from '../dashboard/useDash'
import { RoiBadge, ToneBadge } from './RoiBadge'
import { RoiMonthlyChart } from './RoiMonthlyChart'
import { RoiTable, type RoiCol } from './RoiTable'
import { buildScopeTerritoriesGrid, downloadRoiWorkbook } from './roiExport'
import { callKey, DOCTORS_TIP, fmtPct1, fmtRoi, kpiRatio, KPI_TIP, monthlyCall, ratioTone, territoriesCall, type Measure, type Selection, type Shift } from './roiMath'

/** Chart + territories for the scope Line / Product (the whole company when both are empty). */
export function RoiScopeView({ sel, product, from, to, shift, measure, minVisits, onMinVisits, rev, periodLine, scopeName }: {
  sel: Selection; product: RoiProduct | null; from: string; to: string; shift: Shift; measure: Measure; minVisits: number
  onMinVisits: (n: string) => void; rev: number; periodLine: string; scopeName: string
}) {
  const mKey = `roi:sm:${rev}:${callKey(monthlyCall(sel, from, to, shift))}`
  const tKey = `roi:st:${rev}:${callKey(territoriesCall(sel, from, to, shift, minVisits))}`
  const monthly = useDash(mKey, PRIORITY.kpi, (s) => fetchRoiMonthly(sel, from, to, shift, s))
  const terr = useDash(tKey, PRIORITY.lazy, (s) => fetchRoiScopeTerritories(sel, from, to, shift, minVisits, s))
  const showLine = sel.line === null
  const rows = terr.data ?? []

  const [text, setText] = useState(String(minVisits))
  const [busy, setBusy] = useState(false)
  const cols = useMemo(() => {
    const dim = (r: RoiScopeTerritory) => (r.low_sample ? 'opacity-60' : undefined)
    const list: RoiCol<RoiScopeTerritory>[] = [
      ...(showLine ? [{ id: 'line', header: 'Line', value: (r: RoiScopeTerritory) => r.line_name, className: dim }] : []),
      { id: 'territory', header: 'Territory', value: (r) => r.territory_name, className: dim,
        render: (r) => (
          <span className="inline-flex items-center gap-1">
            {r.territory_name}
            {r.low_sample && <Tooltip content={`Fewer than ${minVisits} visits: too few to judge`} side="top"><AlertTriangle className="h-3.5 w-3.5 text-warning" aria-label={`Low sample: fewer than ${minVisits} visits`} /></Tooltip>}
          </span>
        ) },
      { id: 'rep', header: 'Rep', value: (r) => r.rep_name, render: (r) => r.rep_name ?? '—', className: dim },
      { id: 'manager', header: 'Manager', value: (r) => r.manager_name, render: (r) => r.manager_name ?? '—', className: dim },
      { id: 'docs', header: 'Doctors', tip: DOCTORS_TIP, numeric: true, value: (r) => r.list_doctors, render: (r) => fmtInt(r.list_doctors), className: dim },
      { id: 'visits', header: 'Visits', numeric: true, value: (r) => r.visits, render: (r) => fmtInt(r.visits), className: dim },
      { id: 'cost', header: 'Visit cost', numeric: true, value: (r) => r.cost, render: (r) => fmtInt(r.cost), className: dim },
      { id: 'sales', header: measure === 'value' ? 'Sales (EGP)' : 'Sales (units)', numeric: true, value: (r) => (measure === 'value' ? r.s_value : r.s_units), render: (r) => fmtInt(measure === 'value' ? r.s_value : r.s_units), className: dim },
      { id: 'spv', header: 'Sales per visit', numeric: true, value: (r) => r.sales_per_visit, render: (r) => fmtInt(r.sales_per_visit), className: dim },
      { id: 'roi', header: 'ROI', numeric: true, value: (r) => r.roi, render: (r) => (r.low_sample ? <span className="tnum">{fmtRoi(r.roi)}</span> : <RoiBadge roi={r.roi} />), className: dim },
      { id: 'coverage', header: 'Coverage', tip: KPI_TIP, numeric: true, value: (r) => kpiRatio(r.kpi_doctors, r.coverage), className: dim,
        render: (r) => { const v = kpiRatio(r.kpi_doctors, r.coverage); return <ToneBadge tone={ratioTone(v)} text={fmtPct1(v)} /> } },
      { id: 'pcf', header: 'PCF', tip: KPI_TIP, numeric: true, value: (r) => kpiRatio(r.kpi_doctors, r.pcf), className: dim,
        render: (r) => { const v = kpiRatio(r.kpi_doctors, r.pcf); return <ToneBadge tone={ratioTone(v)} text={fmtPct1(v)} /> } },
    ]
    return list
  }, [showLine, measure, minVisits])

  const exportXlsx = async () => {
    setBusy(true)
    try { await downloadRoiWorkbook(`territories-${scopeName.replace(/[^\w-]+/g, '_')}.xlsx`, [buildScopeTerritoriesGrid(rows, { measure, showLine, minVisits, periodLine: `${periodLine}  |  Scope: ${scopeName}` })]) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Export failed') }
    finally { setBusy(false) }
  }
  const unlinked = product !== null && !product.in_group

  return (
    <div className="space-y-4">
      <RoiMonthlyChart title={`Visits and sales by month — ${scopeName}`} rows={monthly.data} measure={measure} loading={monthly.loading} error={monthly.error} onRetry={monthly.reload}
        note={unlinked ? `${product.name} is not linked to a speciality in the Speciality map, so it has no visits (0).` : undefined} />
      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Territories — {scopeName}</h3>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-13 text-muted-foreground" title="Territories with fewer visits than this are greyed and listed last">Min visits
              <input aria-label="Min visits" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onMinVisits(text)} onKeyDown={(e) => e.key === 'Enter' && onMinVisits(text)}
                className="tnum h-8 w-16 rounded-control border bg-card px-2 text-13 text-foreground" />
            </label>
            <Button size="sm" disabled={busy || rows.length === 0} onClick={() => void exportXlsx()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />}Excel
            </Button>
          </div>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">Coverage and PCF: {KPI_TIP}. They always use the PM doctors, whatever the AM / PM filter.</p>
        {terr.error ? <ErrorState title="Could not load the territories" message={terr.error} onRetry={terr.reload} className="py-8" />
          : terr.loading ? <Skeleton className="h-40 w-full" />
          : rows.length === 0 ? <EmptyState title="No territory has visits or sales in this scope" className="py-8" />
          : <RoiTable label="Territories of the scope" cols={cols} rows={rows} rowKey={(r) => `${r.line_id}-${r.territory_id}`} pinLast={(r) => r.low_sample} rowClass={(r) => (r.low_sample ? 'bg-muted/40' : undefined)} />}
      </Card>
    </div>
  )
}
