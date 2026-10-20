import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, BarChart3, RefreshCw } from 'lucide-react'
import { PageHeader, EmptyState, ErrorState } from '../components/app/states'
import { KpiCard, StatGrid } from '../components/app/KpiCard'
import { PeriodPicker } from '../components/app/PeriodPicker'
import { Button } from '../components/ui/button'
import { Card, Skeleton } from '../components/ui/misc'
import { useMonth } from '../context/MonthContext'
import { clearKpiCache, fetchCompanySeries, fetchLineSeries, fetchMonthDetail, fetchVacantBoxes, fetchWorkingDaysByMonth } from '../lib/api/kpi'
import { fetchKpiMonthsLines, fetchSalesYtd } from '../lib/api/dash'
import { fetchLineNames } from '../lib/api/reports'
import { fetchVisitMonths } from '../lib/api/visits'
import { kpiTone } from '../lib/kpi'
import { cn } from '../lib/utils'
import { KpiTreeTable } from '../features/dashboard/KpiTreeTable'
import { RepDrawer } from '../features/dashboard/RepDrawer'
import { CompanySkillsCard } from '../features/dashboard/CompanySkillsCard'
import { VisitsChart } from '../features/dashboard/VisitsChart'
import { SalesChart } from '../features/dashboard/SalesChart'
import SystemStatus from '../features/dashboard/SystemStatus'
import { PRIORITY, resetDashCache, useDash, useNearViewport } from '../features/dashboard/useDash'
import { boxesMissingTargets, buildTree, deltaPts, fmtInt, fmtPct, fmtRate, latestMonth, type TreeNode } from '../features/dashboard/kpiMath'
import { addYM, monthName, parsePeriod, periodLabel, resolvePeriod, withPeriodQuery, type Period } from '../features/dashboard/periodMath'
import { aggregate, companyMonths, comparable, fmtMoney, fmtSigned, hasData, lineMonths, ratiosOf, rowsIn, type KpiMonth } from '../features/dashboard/rangeKpi'

const DashboardCharts = lazy(() => import('../features/dashboard/DashboardCharts'))

const TIPS = {
  total: 'Total KPI = PCF × 50% + Coverage × 35% + Ach CR × 15%, recomputed from the sums of the whole period.',
  coverage: 'Coverage = list doctors visited at least once ÷ list doctors, summed over the months of the period.',
  pcf: 'PCF = Σ min(visits to a doctor, its frequency) ÷ target visits (Σ Freq of the Clinic + Poly Clinic list doctors), summed over the whole period.',
  achCr: 'Clinic + Poly Clinic visits ÷ (PM target × PM field days). AM Center and Pharmacy are not included.',
  am: 'Call rate AM = AM visits ÷ actual AM days (working days − leave − office work − activity).',
  pm: 'Call rate PM = PM visits ÷ actual PM days.',
  visits: 'Rep visit rows in the period (Double visits count once for the rep).',
  planned: 'Planned visits ÷ (Planned + Direct), rep visits.',
  missing: 'Working slots (AM + PM) with no visit, leave, office work or activity.',
  absence: 'Slots taken by approved leave, office work and activities.',
  ytd: 'Sales from Jan to the month shown. Months without an uploaded sales file are not included.',
} as const

const naPct = (v: number | null) => (v === null ? 'n/a' : fmtPct(v))
const toneOf = (v: number | null) => (v === null ? 'neutral' : kpiTone(v, 1))
/** Relative change in percent; null without a base. */
const relPct = (cur: number | null, prev: number | null): number | null => (cur === null || prev === null || prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100)
const NA_PREV = 'vs prev. period: n/a'

export default function Dashboard() {
  const { month, setMonth } = useMonth()
  const [params, setParams] = useSearchParams()
  const [repNode, setRepNode] = useState<TreeNode | null>(null)

  // ----- period + line live in the URL (?mode=quarter&from=2026-07&to=2026-09&line=1) -----
  const lineParam = Number(params.get('line'))
  const lineId = Number.isInteger(lineParam) && params.get('line') !== null && lineParam > 0 ? lineParam : null
  const write = useCallback((p: Period, line: number | null) => {
    setParams(withPeriodQuery(params.toString(), p, line), { replace: true })
    setMonth(`${p.toYM}-01`) // keep the top-bar month in sync for the other pages
  }, [params, setParams, setMonth])

  // Every call goes through one queue (3 in flight at most), is cancelled when stale and is cached by its parameters.
  const lines = useDash('lines:names', PRIORITY.kpi, () => fetchLineNames())
  const company = useDash('kpi:company', PRIORITY.kpi, () => fetchCompanySeries())
  const lineSeries = useDash(lineId !== null ? 'kpi:lines' : null, PRIORITY.other, () => fetchLineSeries())
  const visitMonths = useDash('visits:months', PRIORITY.other, () => fetchVisitMonths())

  // Default month = latest month with KPIs (when the URL has no period and the top-bar month has none).
  const urlHasPeriod = params.get('from') !== null
  const latestYM = company.data ? latestMonth(company.data.map((c) => c.month))?.slice(0, 7) ?? null : null
  const defaultYM = !urlHasPeriod && latestYM && company.data && !company.data.some((c) => c.month.slice(0, 7) === month.slice(0, 7)) ? latestYM : month.slice(0, 7)
  useEffect(() => {
    if (!urlHasPeriod && defaultYM !== month.slice(0, 7)) setMonth(`${defaultYM}-01`)
  }, [urlHasPeriod, defaultYM, month, setMonth])
  const ready = urlHasPeriod || company.data !== null || company.error !== null // do not ask for a month that is about to change

  const period = useMemo(() => parsePeriod((k) => params.get(k), defaultYM), [params, defaultYM])
  const r = useMemo(() => resolvePeriod(period), [period])
  const toMonth = `${period.toYM}-01`
  const prevFromYM = addYM(period.fromYM, -r.n)
  const prevToYM = addYM(period.fromYM, -1)

  // ONE KPI call for company, every line and the previous period (a lone month also gets the 5 months before it for the sparklines).
  const callFromYM = r.n === 1 ? addYM(period.toYM, -5) : prevFromYM
  const kpiAll = useDash(ready ? `dash:kpi-lines:${callFromYM}:${period.toYM}` : null, PRIORITY.kpi, (signal) => fetchKpiMonthsLines(`${callFromYM}-01`, r.to, signal))
  const ytd = useDash(ready ? `dash:ytd:${r.to}:${lineId ?? 'all'}` : null, PRIORITY.ytd, (signal) => fetchSalesYtd(r.to, lineId, signal))
  const working = useDash(kpiAll.data ? `dash:wd:${r.from}:${r.to}` : null, PRIORITY.other, (signal) => fetchWorkingDaysByMonth(r.from, r.to, signal))

  // the drill-down (7+ small calls) loads when it is about to be seen
  const [drillRef, drillSeen] = useNearViewport()
  const detail = useDash(drillSeen ? `kpi:detail:${toMonth}` : null, PRIORITY.lazy, () => fetchMonthDetail(toMonth))
  const vacant = useDash(drillSeen ? `vacant:${toMonth}` : null, PRIORITY.lazy, () => fetchVacantBoxes(toMonth))

  // company = sum of the lines; a Line filter = that line; previous period = its months; per-line charts = group by line
  const all = kpiAll.data
  const scope = useMemo(() => (all === null ? [] : lineId === null ? companyMonths(all) : lineMonths(all, lineId)), [all, lineId])
  const inRange = useMemo(() => rowsIn(scope, period.fromYM, period.toYM), [scope, period.fromYM, period.toYM])
  const cur = useMemo(() => (inRange.some(hasData) ? aggregate(inRange) : null), [inRange])
  const prev = useMemo(() => {
    const rows = rowsIn(scope, prevFromYM, prevToYM)
    return comparable(rows, r.n) ? aggregate(rows) : null
  }, [scope, prevFromYM, prevToYM, r.n])
  const sparkRows: KpiMonth[] = useMemo(() => (r.n === 1 ? rowsIn(scope, addYM(period.toYM, -5), period.toYM) : inRange).filter(hasData), [r.n, scope, period.toYM, inRange])
  const spark = (pick: (k: ReturnType<typeof ratiosOf>) => number | null, scale = 1) => sparkRows.map((m) => pick(ratiosOf(m))).filter((v): v is number => v !== null).map((v) => v * scale)
  const sparkRaw = (pick: (m: KpiMonth) => number) => sparkRows.map(pick)

  // ----- partial-month banner: a month of the range with visits on fewer days than working days -----
  const dataMonths = useMemo(() => inRange.filter(hasData).map((m) => m.month.slice(0, 7)), [inRange])
  const partial = useMemo(() => {
    const wd = working.data
    if (!wd) return []
    return dataMonths.flatMap((m) => {
      const days = visitMonths.data?.find((v) => v.month.slice(0, 7) === m)?.days ?? 0
      const need = wd.get(m) ?? 0
      return days < need ? [{ m, days, wd: need }] : []
    })
  }, [dataMonths, working.data, visitMonths.data])

  const reps = useMemo(() => (detail.data?.reps ?? []).filter((x) => lineId === null || x.line_id === lineId), [detail.data, lineId])
  const noTargets = boxesMissingTargets(reps)
  const vacantCount = (vacant.data ?? []).filter((v) => lineId === null || v.line_id === lineId).length
  const tree = useMemo(() => {
    const d = detail.data
    if (!d) return []
    const keep = (id: number | null) => lineId === null || id === lineId
    return buildTree(d.lines.filter((l) => keep(l.line_id)), d.managers.filter((m) => keep(m.line_id)), d.reps.filter((x) => keep(x.line_id)), d.names)
  }, [detail.data, lineId])

  // trend: every month with data, scoped to the line (existing KPI views)
  const trend = useMemo(() => {
    const src = lineId === null ? (company.data ?? []) : (lineSeries.data ?? []).filter((x) => x.line_id === lineId)
    return src.map((s) => ({ month: s.month, total_kpi: s.total_kpi, coverage: s.coverage, pcf: s.pcf, ach_cr: s.ach_cr }))
  }, [company.data, lineSeries.data, lineId])
  const lineBars = useMemo(
    () => (lines.data ?? []).flatMap((l) => {
      const rows = all === null ? [] : rowsIn(lineMonths(all, l.id), period.fromYM, period.toYM)
      return rows.some(hasData) && (lineId === null || l.id === lineId) ? [{ name: l.name, kpi: aggregate(rows) }] : []
    }),
    [lines.data, all, period.fromYM, period.toYM, lineId],
  )

  // Reload (the button) clears the cache and remounts the charts; "Try again" on an error retries only the call that failed.
  const [nonce, setNonce] = useState(0)
  const refreshAll = () => {
    clearKpiCache(); resetDashCache(); setNonce((n) => n + 1)
    lines.reload(); company.reload(); lineSeries.reload(); visitMonths.reload(); kpiAll.reload(); ytd.reload(); working.reload(); detail.reload(); vacant.reload()
  }
  const failed = [kpiAll, company, lines, detail].find((q) => q.error)

  const loading = kpiAll.loading
  const fatal = kpiAll.error ?? company.error ?? detail.error
  const achOk = cur !== null && cur.expected_visits > 0 && cur.ach_cr !== null
  const comparing = prev !== null
  const pts = (a: number | null | undefined, b: number | null | undefined) => (comparing ? deltaPts(a ?? null, b ?? null) ?? undefined : undefined)
  const pctChange = (a: number | null | undefined, b: number | null | undefined) => (comparing ? relPct(a ?? null, b ?? null) ?? undefined : undefined)
  const label = periodLabel(period)
  const chips = [{ id: null as number | null, name: 'All' }, ...(lines.data ?? []).map((l) => ({ id: l.id as number | null, name: l.name }))]

  const y = ytd.data
  const ytdEmpty = !ytd.loading && (!y || y.ytd_month === null || y.s_value === null)
  const gap = y && y.s_value !== null && y.t_value !== null ? y.s_value - y.t_value : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`${label}: sales and field KPIs for the whole company. Ranges are added up from totals, never averaged.`}
        actions={<Button size="sm" onClick={refreshAll} aria-label="Reload dashboard data"><RefreshCw className="h-4 w-4" aria-hidden /> Reload</Button>}
      />

      <div className="sticky top-14 z-20 -mx-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-b bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6" role="search" aria-label="Dashboard filters">
        <div role="group" aria-label="Line filter" className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button key={c.name} type="button" aria-pressed={lineId === c.id} onClick={() => write(period, c.id)}
              className={cn('h-8 rounded-full border px-3 text-13 transition-colors hover:bg-muted', lineId === c.id ? 'border-primary bg-accent font-medium text-accent-foreground' : 'text-muted-foreground')}>
              {c.name}
            </button>
          ))}
        </div>
        <PeriodPicker value={period} onChange={(p) => write(p, lineId)} />
      </div>

      {fatal && <Card><ErrorState title="Could not load the dashboard" message={fatal} onRetry={failed?.reload} /></Card>}

      {partial.length > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-card border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span><b>Partial month:</b> {partial.map((p) => `${monthName(p.m)} has visits on ${p.days} of ${p.wd} working days`).join('; ')}. KPIs of {partial.length > 1 ? 'those months' : 'that month'} are provisional.</span>
        </div>
      )}
      {cur !== null && noTargets > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-card border bg-muted px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>Ach CR needs targets for <b className="tnum">{noTargets}</b> box{noTargets > 1 ? 'es' : ''} in {monthName(period.toYM)}. <Link to="/targets" className="font-medium text-accent-foreground underline underline-offset-2">Set targets</Link></span>
        </div>
      )}

      {!fatal && !loading && cur === null ? (
        <Card>
          <EmptyState
            icon={BarChart3}
            title={`No KPI data for ${label}`}
            description="KPIs appear once the Target List, visits and org exist for the months. Pick another period or upload data."
            action={<Link to="/uploads" className="text-sm font-medium text-accent-foreground underline underline-offset-2">Go to Uploads</Link>}
          />
        </Card>
      ) : (
        <>
          <StatGrid>
            <KpiCard loading={loading} label="Total KPI" tooltip={TIPS.total} value={naPct(cur?.total_kpi ?? null)} tone={toneOf(cur?.total_kpi ?? null)} delta={pts(cur?.total_kpi, prev?.total_kpi)} deltaNa={NA_PREV} spark={spark((k) => k.total_kpi, 100)} />
            <KpiCard loading={loading} label="Coverage" tooltip={TIPS.coverage} value={naPct(cur?.coverage ?? null)} tone={toneOf(cur?.coverage ?? null)} delta={pts(cur?.coverage, prev?.coverage)} deltaNa={NA_PREV} spark={spark((k) => k.coverage, 100)} hint={cur ? `${fmtInt(cur.covered_doctors)} of ${fmtInt(cur.list_doctors)} doctors` : undefined} />
            <KpiCard loading={loading} label="PCF" tooltip={TIPS.pcf} value={naPct(cur?.pcf ?? null)} tone={toneOf(cur?.pcf ?? null)} delta={pts(cur?.pcf, prev?.pcf)} deltaNa={NA_PREV} spark={spark((k) => k.pcf, 100)} hint={cur ? `${fmtInt(cur.valid_visits)} valid of ${fmtInt(cur.target_visits)} target` : undefined} />
            <KpiCard loading={loading} label="Ach CR · PM only" tooltip={TIPS.achCr} value={achOk ? naPct(cur?.ach_cr ?? null) : 'n/a'} tone={achOk ? toneOf(cur?.ach_cr ?? null) : 'neutral'} delta={achOk ? pts(cur?.ach_cr, prev?.ach_cr) : undefined} deltaNa={NA_PREV} spark={spark((k) => k.ach_cr, 100)} hint={achOk ? undefined : 'Needs call-rate targets'} />
            <KpiCard loading={loading} label="Call rate AM" tooltip={TIPS.am} value={cur?.call_rate_am == null ? 'n/a' : fmtRate(cur.call_rate_am)} delta={pctChange(cur?.call_rate_am, prev?.call_rate_am)} deltaSuffix="%" deltaNa={NA_PREV} hint={cur ? `${fmtInt(cur.visits_am)} visits ÷ ${fmtInt(cur.days_am)} days` : undefined} />
            <KpiCard loading={loading} label="Call rate PM" tooltip={TIPS.pm} value={cur?.call_rate_pm == null ? 'n/a' : fmtRate(cur.call_rate_pm)} delta={pctChange(cur?.call_rate_pm, prev?.call_rate_pm)} deltaSuffix="%" deltaNa={NA_PREV} hint={cur ? `${fmtInt(cur.visits_pm)} visits ÷ ${fmtInt(cur.days_pm)} days` : undefined} />

            <KpiCard
              loading={ytd.loading}
              label={y?.ytd_month ? `YTD ${monthName(y.ytd_month.slice(0, 7))}` : 'YTD Sales'}
              tooltip={y?.ytd_month ? `Sales from Jan to ${monthName(y.ytd_month.slice(0, 7))}. Months without an uploaded sales file are not included.` : TIPS.ytd}
              empty={ytdEmpty} emptyText={<>No sales uploaded. <Link to="/uploads" className="font-medium text-accent-foreground underline underline-offset-2">Upload the sales file</Link></>}
              value={y?.s_value != null ? fmtMoney(y.s_value) : undefined}
              tone={toneOf(y?.ach ?? null)} progress={y?.ach ?? undefined}
              hint={y && y.ach !== null ? `Achievement ${fmtPct(y.ach)} · gap ${fmtSigned(gap)} vs target` : undefined}
              deltaNa="EGP, year to date"
            />
            <KpiCard loading={loading} label="Total visits (reps)" tooltip={TIPS.visits} value={fmtInt(cur?.total_visits ?? null)} delta={pctChange(cur?.total_visits, prev?.total_visits)} deltaSuffix="%" deltaNa={NA_PREV} spark={sparkRaw((m) => m.total_visits)} hint={cur ? `${fmtInt(cur.reps)} reps with KPIs` : undefined} />
            <KpiCard loading={loading} label="Planned share" tooltip={TIPS.planned} value={naPct(cur?.planned_share ?? null)} delta={pts(cur?.planned_share, prev?.planned_share)} deltaNa={NA_PREV} hint={cur ? `Planned ${fmtInt(cur.planned_visits)} · Direct ${fmtInt(cur.direct_visits)}` : undefined} />
            <KpiCard loading={loading} label="Missing days (AM+PM)" tooltip={TIPS.missing} value={fmtInt(cur?.missing_days ?? null)} tone={cur === null ? 'neutral' : cur.missing_days > 0 ? 'warning' : 'success'} delta={pctChange(cur?.missing_days, prev?.missing_days)} deltaSuffix="%" deltaNa={NA_PREV} hint={<Link to="/data-quality?section=missing" className="font-medium text-accent-foreground underline underline-offset-2">Review in Data Quality</Link>} />
            <KpiCard loading={loading} label="Leave / OW / Activity days" tooltip={TIPS.absence} value={cur ? `${fmtInt(cur.leave_days)} / ${fmtInt(cur.ow_days)} / ${fmtInt(cur.activity_days)}` : 'n/a'} deltaNa="Sum over the period" />
            <CompanySkillsCard upTo={toMonth} />
          </StatGrid>

          <div className="grid gap-6 xl:grid-cols-12">
            <VisitsChart key={`v${nonce}`} line={lineId} fromYM={period.fromYM} toYM={period.toYM} r={r} />
            <SalesChart key={`s${nonce}`} line={lineId} fromYM={period.fromYM} toYM={period.toYM} r={r} />
          </div>

          <Suspense fallback={<div className="grid gap-6 xl:grid-cols-12"><Skeleton className="h-72 xl:col-span-8" /><Skeleton className="h-72 xl:col-span-4" /></div>}>
            <DashboardCharts
              lines={lineBars}
              trend={trend}
              planned={cur?.planned_visits ?? null}
              direct={cur?.direct_visits ?? null}
              fromYM={period.fromYM}
              toYM={period.toYM}
            />
          </Suspense>

          <section aria-labelledby="drill" ref={drillRef}>
            <h2 id="drill" className="mb-1 text-base font-semibold">Drill-down: line → manager → rep</h2>
            <p className="mb-3 text-13 text-muted-foreground">Shows {monthName(period.toYM)} {period.toYM.slice(0, 4)}, the last month of the period.</p>
            {detail.error ? (
              <Card><ErrorState title="Could not load the drill-down" message={detail.error} onRetry={detail.reload} /></Card>
            ) : (
              <KpiTreeTable data={tree} loading={detail.loading} month={toMonth} onRepClick={setRepNode} />
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
      <RepDrawer node={repNode} month={toMonth} onClose={() => setRepNode(null)} />
    </div>
  )
}
