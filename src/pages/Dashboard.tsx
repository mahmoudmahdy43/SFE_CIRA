import { lazy, Suspense, useMemo, useRef, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, BarChart3, RefreshCw } from 'lucide-react'
import { PageHeader, EmptyState, ErrorState } from '../components/app/states'
import { KpiCard, StatGrid } from '../components/app/KpiCard'
import { Button } from '../components/ui/button'
import { Card, Skeleton } from '../components/ui/misc'
import { useDateRange } from '../context/DateRangeContext'
import { PeriodBanner } from '../components/app/PeriodBanner'
import {
  clearKpiCache, fetchCompanySeries, fetchLineSeries, fetchMonthDetail, fetchVacantBoxes, fetchWorkingDays,
} from '../lib/api/kpi'
import { fetchVisitMonths } from '../lib/api/visits'
import { kpiTone } from '../lib/kpi'
import { cn } from '../lib/utils'
import { KpiTreeTable } from '../features/dashboard/KpiTreeTable'
import { RepDrawer } from '../features/dashboard/RepDrawer'
import { CompanySkillsCard } from '../features/dashboard/CompanySkillsCard'
import SystemStatus from '../features/dashboard/SystemStatus'
import { useAsync } from '../features/dashboard/useAsync'
import {
  achCrAvailable, boxesMissingTargets, buildTree, deltaPts, fmtInt, fmtPct, fmtRate, latestMonth, share, sumNullable,
  type KpiNumbers, type TreeNode,
} from '../features/dashboard/kpiMath'

const DashboardCharts = lazy(() => import('../features/dashboard/DashboardCharts'))

const TIPS = {
  total: 'Total KPI = PCF × 50% + Coverage × 35% + Ach CR × 15%, recomputed from sums at every level.',
  coverage: 'Coverage = list doctors visited at least once ÷ list doctors.',
  pcf: 'PCF = Σ min(visits to a doctor, its frequency) ÷ all rep visits. Visits to doctors outside the list count in the denominator only.',
  achCr: 'Ach CR = total visits ÷ (target AM × actual AM days + target PM × actual PM days). Needs call-rate targets.',
  am: 'Call rate AM = AM visits ÷ actual AM days (working days − leave − office work − activity).',
  pm: 'Call rate PM = PM visits ÷ actual PM days.',
  visits: 'Rep visit rows in the month (Double visits count once for the rep).',
  unique: 'Company unique visits: a Double visit (rep row + manager row) counts once. Always company-wide.',
  planned: 'Planned visits ÷ (Planned + Direct), rep visits.',
  missing: 'Working slots (AM + PM) with no visit, leave, office work or activity.',
  absence: 'Slots taken by approved leave, office work and activities.',
} as const

const naPct = (v: number | null) => (v === null ? 'n/a' : fmtPct(v))
const toneOf = (v: number | null) => (v === null ? 'neutral' : kpiTone(v, 1))

export default function Dashboard() {
  const { month, setMonth, custom } = useDateRange()
  const [lineId, setLineId] = useState<number | null>(null)
  const [repNode, setRepNode] = useState<TreeNode | null>(null)

  const company = useAsync('kpi:company', fetchCompanySeries)
  const lineSeries = useAsync('kpi:lines', fetchLineSeries)
  const visitMonths = useAsync('visits:months', fetchVisitMonths)
  const detail = useAsync(`kpi:detail:${month}`, () => fetchMonthDetail(month))
  const working = useAsync(`wd:${month}`, () => fetchWorkingDays(month))
  const vacant = useAsync(`vacant:${month}`, () => fetchVacantBoxes(month))

  // Default month = latest month with KPIs (once, when the current calendar month has none).
  const initDone = useRef(false)
  useEffect(() => {
    if (initDone.current || !company.data) return
    initDone.current = true
    if (custom || company.data.some((r) => r.month === month)) return
    const latest = latestMonth(company.data.map((r) => r.month))
    if (latest) setMonth(latest)
  }, [company.data, month, setMonth, custom])

  const refreshAll = () => {
    clearKpiCache()
    company.reload(); lineSeries.reload(); visitMonths.reload(); detail.reload(); working.reload(); vacant.reload()
  }

  /* ------------------------------ scope: company or one line ------------------------------ */
  const series = useMemo<{ month: string; kpi: KpiNumbers }[]>(() => {
    if (lineId === null) return (company.data ?? []).map((r) => ({ month: r.month, kpi: r }))
    return (lineSeries.data ?? []).filter((r) => r.line_id === lineId).map((r) => ({ month: r.month, kpi: r }))
  }, [company.data, lineSeries.data, lineId])
  const cur = series.find((s) => s.month === month)?.kpi ?? null
  const prev = useMemo(() => [...series].filter((s) => s.month < month).sort((a, b) => b.month.localeCompare(a.month))[0]?.kpi ?? null, [series, month])
  const sparkOf = (pick: (k: KpiNumbers) => number | null) =>
    series.filter((s) => s.month <= month).slice(-6).map((s) => pick(s.kpi)).filter((v): v is number => v !== null).map((v) => v * 100)

  const unique = visitMonths.data?.find((m) => m.month === month)
  const visitDays = unique?.days ?? 0

  /* ------------------------------ banners ------------------------------ */
  const reps = useMemo(() => (detail.data?.reps ?? []).filter((r) => lineId === null || r.line_id === lineId), [detail.data, lineId])
  const noTargets = boxesMissingTargets(reps)
  const vacantCount = (vacant.data ?? []).filter((v) => lineId === null || v.line_id === lineId).length
  const partial = working.data !== null && cur !== null && visitDays < working.data

  /* ------------------------------ tree + charts ------------------------------ */
  const tree = useMemo(() => {
    const d = detail.data
    if (!d) return []
    const keep = (id: number | null) => lineId === null || id === lineId
    return buildTree(d.lines.filter((l) => keep(l.line_id)), d.managers.filter((m) => keep(m.line_id)), d.reps.filter((r) => keep(r.line_id)), d.names)
  }, [detail.data, lineId])

  const lineBars = useMemo(() => (detail.data?.lines ?? []).map((l) => ({ name: detail.data?.names.lines.get(l.line_id ?? -1) ?? 'No line', kpi: l })), [detail.data])
  const chips = [{ id: null as number | null, name: 'All' }, ...[...(detail.data?.names.lines ?? new Map<number, string>())].map(([id, name]) => ({ id: id as number | null, name }))]

  const loadingCards = company.loading || (lineId !== null && lineSeries.loading)
  const missing = sumNullable(cur?.missing_am ?? null, cur?.missing_pm ?? null)
  const planned = share(cur?.planned_visits ?? null, sumNullable(cur?.planned_visits ?? null, cur?.direct_visits ?? null))
  const achOk = cur !== null && achCrAvailable(cur)
  const fatal = company.error ?? detail.error

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`KPIs for ${month.slice(0, 7)} — every figure comes from the monthly database views (Coverage, PCF and Freq are monthly targets); with a day range the Dashboard shows the month of the To date.`}
        actions={<Button size="sm" onClick={refreshAll} aria-label="Reload KPI data"><RefreshCw className="h-4 w-4" aria-hidden /> Reload</Button>}
      />

      <PeriodBanner monthly className="-mt-3" />

      <div role="group" aria-label="Line filter" className="-mt-2 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c.name}
            aria-pressed={lineId === c.id}
            onClick={() => setLineId(c.id)}
            className={cn('rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted', lineId === c.id && 'border-primary bg-accent font-medium text-accent-foreground')}
          >
            {c.name}
          </button>
        ))}
      </div>

      {fatal && <Card><ErrorState message={fatal} onRetry={refreshAll} /></Card>}

      {partial && (
        <div role="status" className="flex items-start gap-2 rounded-card border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span><b>Partial month:</b> visits cover <span className="tnum">{visitDays}</span> of <span className="tnum">{working.data}</span> working days — KPIs are provisional.</span>
        </div>
      )}
      {cur !== null && noTargets > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-card border bg-muted px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>Ach CR needs targets for <b className="tnum">{noTargets}</b> box{noTargets > 1 ? 'es' : ''}. <Link to="/targets" className="font-medium text-accent-foreground underline underline-offset-2">Set targets</Link></span>
        </div>
      )}

      {!fatal && !loadingCards && cur === null ? (
        <Card>
          <EmptyState
            icon={BarChart3}
            title={`No KPI data for ${month.slice(0, 7)}`}
            description="KPIs appear once the Target List, visits and org exist for the month. Pick another month or upload data."
            action={<Link to="/uploads" className="text-sm font-medium text-accent-foreground underline underline-offset-2">Go to Uploads</Link>}
          />
        </Card>
      ) : (
        <>
          <StatGrid>
            <KpiCard loading={loadingCards} label="Total KPI" tooltip={TIPS.total} value={naPct(cur?.total_kpi ?? null)} tone={toneOf(cur?.total_kpi ?? null)} delta={deltaPts(cur?.total_kpi ?? null, prev?.total_kpi ?? null) ?? undefined} spark={sparkOf((k) => k.total_kpi)} />
            <KpiCard loading={loadingCards} label="Coverage" tooltip={TIPS.coverage} value={naPct(cur?.coverage ?? null)} tone={toneOf(cur?.coverage ?? null)} delta={deltaPts(cur?.coverage ?? null, prev?.coverage ?? null) ?? undefined} spark={sparkOf((k) => k.coverage)} hint={cur ? `${fmtInt(cur.covered_doctors)} of ${fmtInt(cur.list_doctors)} doctors` : undefined} />
            <KpiCard loading={loadingCards} label="PCF" tooltip={TIPS.pcf} value={naPct(cur?.pcf ?? null)} tone={toneOf(cur?.pcf ?? null)} delta={deltaPts(cur?.pcf ?? null, prev?.pcf ?? null) ?? undefined} spark={sparkOf((k) => k.pcf)} hint={cur ? `${fmtInt(cur.valid_visits)} valid of ${fmtInt(cur.total_visits)}` : undefined} />
            <KpiCard loading={loadingCards} label="Ach CR" tooltip={TIPS.achCr} value={achOk ? naPct(cur?.ach_cr ?? null) : 'n/a'} tone={achOk ? toneOf(cur?.ach_cr ?? null) : 'neutral'} delta={achOk ? deltaPts(cur?.ach_cr ?? null, prev?.ach_cr ?? null) ?? undefined : undefined} spark={sparkOf((k) => k.ach_cr)} hint={achOk ? undefined : 'Needs call-rate targets'} />
            <KpiCard loading={loadingCards} label="Call rate AM" tooltip={TIPS.am} value={cur?.call_rate_am == null ? 'n/a' : fmtRate(cur.call_rate_am)} hint={cur ? `${fmtInt(cur.visits_am)} visits ÷ ${fmtInt(cur.days_am)} days` : undefined} />
            <KpiCard loading={loadingCards} label="Call rate PM" tooltip={TIPS.pm} value={cur?.call_rate_pm == null ? 'n/a' : fmtRate(cur.call_rate_pm)} hint={cur ? `${fmtInt(cur.visits_pm)} visits ÷ ${fmtInt(cur.days_pm)} days` : undefined} />
            <KpiCard loading={loadingCards} label="Total visits (reps)" tooltip={TIPS.visits} value={fmtInt(cur?.total_visits ?? null)} hint={cur ? `${fmtInt(cur.reps)} reps with KPIs` : undefined} />
            <KpiCard loading={visitMonths.loading} label="Unique company visits" tooltip={TIPS.unique} value={unique ? fmtInt(unique.unique_visits) : 'n/a'} hint="Double visits counted once · company-wide" />
            <KpiCard loading={loadingCards} label="Planned share" tooltip={TIPS.planned} value={naPct(planned)} hint={cur ? `Planned ${fmtInt(cur.planned_visits)} · Direct ${fmtInt(cur.direct_visits)}` : undefined} />
            <KpiCard loading={loadingCards} label="Missing days (AM+PM)" tooltip={TIPS.missing} value={fmtInt(missing)} tone={missing === null ? 'neutral' : missing > 0 ? 'warning' : 'success'} hint={<Link to="/data-quality?section=missing" className="font-medium text-accent-foreground underline underline-offset-2">Review in Data Quality</Link>} />
            <KpiCard loading={loadingCards} label="Leave / OW / Activity days" tooltip={TIPS.absence} value={cur ? `${fmtInt(cur.leave_days)} / ${fmtInt(cur.ow_days)} / ${fmtInt(cur.activity_days)}` : 'n/a'} />
            <CompanySkillsCard />
          </StatGrid>

          <Suspense fallback={<div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-72 lg:col-span-2" /><Skeleton className="h-72" /></div>}>
            <DashboardCharts
              lines={lineBars}
              trend={series.map((s) => ({ month: s.month, kpi: s.kpi }))}
              planned={cur?.planned_visits ?? null}
              direct={cur?.direct_visits ?? null}
            />
          </Suspense>

          <section aria-labelledby="drill">
            <h2 id="drill" className="mb-3 text-base font-semibold">Drill-down: line → manager → rep</h2>
            {detail.error ? (
              <Card><ErrorState message={detail.error} onRetry={detail.reload} /></Card>
            ) : (
              <KpiTreeTable data={tree} loading={detail.loading} month={month} onRepClick={setRepNode} />
            )}
            {vacantCount > 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                <b className="tnum text-foreground">{vacantCount}</b> vacant box{vacantCount > 1 ? 'es have' : ' has'} no rep and therefore no KPI rows. <Link to="/personnel" className="font-medium text-accent-foreground underline underline-offset-2">See Personnel → Vacancies</Link>
              </p>
            )}
          </section>
        </>
      )}

      <SystemStatus />
      <RepDrawer node={repNode} month={month} onClose={() => setRepNode(null)} />
    </div>
  )
}
