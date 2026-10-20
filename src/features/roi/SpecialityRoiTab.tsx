import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Download, Loader2, Settings2 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { ChartCard } from '../../components/app/ChartCard'
import { CHART, ChartTip, axisProps } from '../../components/app/charts'
import { Segmented } from '../../components/app/Controls'
import { PeriodPicker } from '../../components/app/PeriodPicker'
import { EmptyState, ErrorState } from '../../components/app/states'
import { buttonVariants, Button } from '../../components/ui/button'
import { Card, Skeleton } from '../../components/ui/misc'
import { useMonth } from '../../context/MonthContext'
import { fetchRoi, fetchRoiMonthly, fetchRoiQuality, fetchRoiTerritories, fetchVisitCosts, type RoiRow } from '../../lib/api/roi'
import { fetchLineNames } from '../../lib/api/reports'
import { cn } from '../../lib/utils'
import { fmtInt } from '../dashboard/kpiMath'
import { parsePeriod, periodLabel, periodQuery, resolvePeriod, type Period } from '../dashboard/periodMath'
import { dashQueued, PRIORITY, resetDashCache, useDash } from '../dashboard/useDash'
import { RoiBadge } from './RoiBadge'
import { RoiCostBox } from './RoiCostBox'
import { RoiDetail } from './RoiDetail'
import { RoiTable, type RoiCol } from './RoiTable'
import { buildMonthlyGrid, buildSummaryGrid, buildTerritoriesGrid, downloadRoiWorkbook } from './roiExport'
import { costFor, parseLine, parseShift, qualityText, summariseQuality, type Shift } from './roiMath'

export function SpecialityRoiTab() {
  const { month } = useMonth()
  const [params, setParams] = useSearchParams()
  const [rev, setRev] = useState(0)
  const [exporting, setExporting] = useState(false)

  const period = useMemo(() => parsePeriod((k) => params.get(k), month.slice(0, 7)), [params, month])
  const r = useMemo(() => resolvePeriod(period), [period])
  const lineId = parseLine(params.get('line'))
  const shift = parseShift(params.get('shift'))
  const groupId = parseLine(params.get('group'))

  const write = useCallback((p: Period, line: number | null, s: Shift, group: number | null) => {
    const q = new URLSearchParams(periodQuery(p, line))
    if (s !== 'ALL') q.set('shift', s)
    if (group !== null) q.set('group', String(group))
    setParams(q, { replace: true })
  }, [setParams])

  const lines = useDash('lines:names', PRIORITY.kpi, () => fetchLineNames())
  const base = `${rev}:${r.from}:${r.to}:${lineId ?? 'all'}`
  const quality = useDash(`roi:q:${base}`, PRIORITY.kpi, (s) => fetchRoiQuality(r.from, r.to, lineId, s))
  const summary = useDash(`roi:s:${base}:${shift}`, PRIORITY.kpi, (s) => fetchRoi(r.from, r.to, lineId, shift, s))
  const costs = useDash(`roi:costs:${rev}`, PRIORITY.other, (s) => fetchVisitCosts(s))

  const rows = useMemo(() => summary.data ?? [], [summary.data])
  const selected = rows.find((x) => x.group_id === groupId) ?? null
  const lineName = lineId === null ? 'All lines' : (lines.data ?? []).find((l) => l.id === lineId)?.name ?? `Line ${lineId}`
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
        Promise.all(rows.map(async (g) => ({ group: g, rows: await dashQueued(`roi:m:${k(g)}`, PRIORITY.lazy, (s) => fetchRoiMonthly(g.group_id, r.from, r.to, shift, s)) }))),
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
          <Segmented label="Line" value={lineId ?? 0} onChange={(v) => write(period, v === 0 ? null : v, shift, null)}
            options={[{ value: 0, label: 'All' }, ...(lines.data ?? []).map((l) => ({ value: l.id, label: l.name }))]} />
          <PeriodPicker value={period} onChange={(p) => write(p, lineId, shift, groupId)} />
          <Segmented label="Visits" value={shift} onChange={(s) => write(period, lineId, s, groupId)} options={[{ value: 'ALL' as Shift, label: 'All' }, { value: 'AM' as Shift, label: 'AM' }, { value: 'PM' as Shift, label: 'PM' }]} />
          <Button size="sm" disabled={exporting || rows.length === 0} onClick={() => void exportAll()}>
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />}Excel
          </Button>
        </div>
        <RoiCostBox history={costs.data ?? []} toYM={period.toYM} onSaved={afterCostSaved} />
      </div>
      <p className="text-xs text-muted-foreground">Cost per visit now: <span className="tnum font-medium">{costFor(costs.data ?? [], period.toYM).toLocaleString('en-US')}</span> EGP (month of the period end).</p>

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
              onRowClick={(x) => write(period, lineId, shift, x.group_id)} initial={{ id: 'roi', dir: 'desc' }} />
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

      {selected ? <RoiDetail group={selected} from={r.from} to={r.to} shift={shift} rev={rev} periodLine={periodLine} />
        : rows.length > 0 && <p className="text-sm text-muted-foreground">Click a group above to see its months, territories and the visits ↔ sales link.</p>}
    </div>
  )
}
