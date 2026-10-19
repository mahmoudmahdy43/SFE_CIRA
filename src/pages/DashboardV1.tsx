import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/app/states'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/overlay'
import { fetchLineNames } from '../lib/api/reports'
import { fetchLatestSalesMonth, type Range } from '../lib/api/dashV1'
import { useAsync } from '../features/dashboard/useAsync'
import { monthEnd } from '../features/dashv1/dashMath'
import { OverviewTab } from '../features/dashv1/OverviewTab'
import { EffortTab } from '../features/dashv1/EffortTab'
import { TerritoriesTab } from '../features/dashv1/TerritoriesTab'
import { MatrixTab } from '../features/dashv1/MatrixTab'
import { OpportunitiesTab } from '../features/dashv1/OpportunitiesTab'

const DEFAULT_FROM = '2026-01'
const selectCls = 'h-9 rounded-control border bg-card px-2 text-sm'

/** Dashboard V1: sales linked to field KPIs. Every number comes live from the dash_* RPCs (admin only, PM shift). */
export default function DashboardV1() {
  const lines = useAsync('lines:names', fetchLineNames)
  const latest = useAsync('dashv1:latest-sales-month', fetchLatestSalesMonth)
  const [line, setLine] = useState<number | null>(null)
  const [fromM, setFromM] = useState(DEFAULT_FROM)
  const [toM, setToM] = useState<string | null>(null)

  // default To = the latest month that has sales (until the user picks one)
  useEffect(() => {
    if (toM === null && !latest.loading) setToM((latest.data ?? new Date().toISOString().slice(0, 10)).slice(0, 7))
  }, [latest.loading, latest.data, toM])

  const bad = toM !== null && fromM > toM
  const range: Range | null = useMemo(
    () => (toM && fromM && !bad ? { from: `${fromM}-01`, to: monthEnd(`${toM}-01`), line } : null),
    [fromM, toM, bad, line],
  )
  const lineName = lines.data?.find((l) => l.id === line)?.name ?? null

  return (
    <div>
      <PageHeader title="Dashboard V1" description="Sales linked to field activity — PM shift (Clinic + Poly Clinic), money in EGP. Everything is computed live from the loaded sales, visits and list." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted-foreground">Line
          <select aria-label="Line" value={line ?? ''} onChange={(e) => setLine(e.target.value === '' ? null : Number(e.target.value))} className={`${selectCls} mt-1 block`}>
            <option value="">All lines</option>
            {(lines.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">From month
          <input type="month" aria-label="From month" value={fromM} max={toM ?? undefined} onChange={(e) => e.target.value && setFromM(e.target.value)} className={`${selectCls} mt-1 block`} />
        </label>
        <label className="text-xs text-muted-foreground">To month
          <input type="month" aria-label="To month" value={toM ?? ''} min={fromM} onChange={(e) => e.target.value && setToM(e.target.value)} className={`${selectCls} mt-1 block`} />
        </label>
        {bad && <p role="alert" className="text-xs text-danger">From must be on or before To.</p>}
      </div>

      {range === null ? null : (
        <Tabs defaultValue="overview">
          <TabsList className="mb-4 flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="effort">Effort → Sales</TabsTrigger>
            <TabsTrigger value="territories">Territories</TabsTrigger>
            <TabsTrigger value="matrix">Reps matrix</TabsTrigger>
            <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
          </TabsList>
          <TabsContent value="overview"><OverviewTab range={range} /></TabsContent>
          <TabsContent value="effort"><EffortTab range={range} lineName={lineName} /></TabsContent>
          <TabsContent value="territories"><TerritoriesTab range={range} /></TabsContent>
          <TabsContent value="matrix"><MatrixTab range={range} /></TabsContent>
          <TabsContent value="opportunities"><OpportunitiesTab range={range} /></TabsContent>
        </Tabs>
      )}
    </div>
  )
}
