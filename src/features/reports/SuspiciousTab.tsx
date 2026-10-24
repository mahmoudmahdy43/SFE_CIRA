import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileSpreadsheet, MapPin, Moon, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Card, Input, Skeleton } from '../../components/ui/misc'
import { downloadXlsx } from '../../lib/xlsxExport'
import { fetchSuspiciousClusters, fetchSuspiciousDetail, fetchSuspiciousOrg } from '../../lib/api/suspicious'
import { cn } from '../../lib/utils'
import { useAsync } from '../dashboard/useAsync'
import {
  BUSY_DAY_VISITS, DEFAULT_MIN_CLINICS, DEFAULT_SEVERITIES, DISCLAIMER, NO_CASES, buildTimeline, clusterKey, defaultRange, detailRows, filterClusters, fmtDate, fmtPct, fmtPctPoints,
  mapsUrl, patternChip, rangeFromMonths, rangeLabel, readingNote, resignedBadge, severityChip, summarize, summaryRow,
  type ClinicRow, type Cluster, type Severity,
} from './suspiciousMath'

const SEVERITIES: Severity[] = ['High', 'Medium', 'Low']
const MIN_OPTIONS = [5, 8, 10, 15, 20, 30]
const SELECT = 'h-9 rounded-control border bg-card px-2 text-sm'
const CHIP: Record<'red' | 'amber' | 'grey', string> = { red: 'bg-red-100 text-red-900', amber: 'bg-amber-100 text-amber-900', grey: 'bg-gray-200 text-gray-800' }
const COLS = 12

interface DetailState { loading: boolean; error: string | null; data: ClinicRow[] | null }

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

function Timeline({ detail, from, to }: { detail: ClinicRow[]; from: string; to: string }) {
  const days = useMemo(() => buildTimeline(detail, from, to), [detail, from, to])
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">Visits at this point, day by day (amber: more than {BUSY_DAY_VISITS} in a day · moon: visits at night)</div>
      <div className="flex flex-wrap gap-1">
        {days.map((d) => (
          <div
            key={d.day}
            title={d.count === 0 ? `${fmtDate(d.day)}: none` : `${fmtDate(d.day)}: ${d.count} visit${d.count === 1 ? '' : 's'}\n${d.visits.map((v) => `${v.t ?? '--:--'}  ${v.clinic}`).join('\n')}`}
            className={cn('relative flex h-9 w-9 flex-col items-center justify-center rounded border text-[10px] leading-none',
              d.count === 0 && 'bg-card text-muted-foreground/60', d.count > 0 && !d.busy && 'bg-blue-50 text-blue-900', d.busy && 'border-amber-500 bg-amber-200 font-semibold text-amber-950')}
          >
            <span>{Number(d.day.slice(8, 10))}</span>
            <span className="tnum text-xs font-semibold">{d.count || ''}</span>
            {d.night > 0 && <Moon className="absolute -right-1 -top-1 h-3 w-3 text-indigo-700" aria-label="Night visits" />}
          </div>
        ))}
      </div>
    </div>
  )
}

function DetailPanel({ c, state, from, to, managerName }: { c: Cluster; state: DetailState | undefined; from: string; to: string; managerName: string }) {
  if (!state || state.loading) return <div className="space-y-2 p-3" aria-busy="true"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-24" /></div>
  if (state.error) return <div role="alert" className="p-3 text-sm text-red-700">Could not load the clinics: {state.error}</div>
  const data = state.data ?? []
  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold">{c.rep_name}</span><span className="text-muted-foreground">{c.rep_code}</span>
        <span className="text-muted-foreground">Manager: {managerName || '–'}</span>
        <span className="tnum text-muted-foreground">{c.cell_lat}, {c.cell_lng}</span>
        <a href={mapsUrl(c.cell_lat, c.cell_lng)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 rounded-control border bg-card px-2.5 py-1 text-sm font-medium hover:bg-muted"><MapPin className="h-4 w-4" aria-hidden /> Open in Google Maps</a>
      </div>
      <p className="text-sm">{readingNote(c, data)}</p>
      <div className="overflow-auto rounded-card border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs"><tr>
            <th className="px-2 py-1.5 text-left">Clinic</th><th className="px-2 py-1.5 text-left">Type</th><th className="px-2 py-1.5 text-right">Visits</th><th className="px-2 py-1.5 text-left">First visit</th>
            <th className="px-2 py-1.5 text-left">Last visit</th><th className="px-2 py-1.5 text-right">Avg deviation (m)</th><th className="px-2 py-1.5 text-left">Pattern</th><th className="px-2 py-1.5 text-left">Clinic coordinates</th>
          </tr></thead>
          <tbody>
            {data.map((d) => {
              const chip = patternChip(d.avg_deviation_m)
              return (
                <tr key={d.account} className="border-t">
                  <td className="px-2 py-1 font-medium">{d.account}</td><td className="px-2 py-1">{d.acc_type_code ?? ''}</td><td className="tnum px-2 py-1 text-right">{d.visits}</td>
                  <td className="px-2 py-1">{fmtDate(d.first_visit)}</td><td className="px-2 py-1">{fmtDate(d.last_visit)}</td>
                  <td className="tnum px-2 py-1 text-right">{d.avg_deviation_m === null ? '' : Math.round(d.avg_deviation_m).toLocaleString('en-US')}</td>
                  <td className="px-2 py-1"><span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', CHIP[chip.tone])}>{chip.label}</span></td>
                  <td className="tnum px-2 py-1 text-xs text-muted-foreground">{d.acc_lat !== null && d.acc_lng !== null ? <a className="underline" href={mapsUrl(d.acc_lat, d.acc_lng)} target="_blank" rel="noreferrer noopener">{d.acc_lat.toFixed(5)}, {d.acc_lng.toFixed(5)}</a> : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Timeline detail={data} from={from} to={to} />
    </div>
  )
}

export function SuspiciousTab() {
  const initial = useMemo(() => defaultRange(new Date()), [])
  const [fromMonth, setFromMonth] = useState(initial.from.slice(0, 7))
  const [toMonth, setToMonth] = useState(() => new Date(Date.parse(`${initial.to}T00:00:00Z`) - 86400000).toISOString().slice(0, 7))
  const [severities, setSeverities] = useState<Severity[]>(DEFAULT_SEVERITIES)
  const [minClinics, setMinClinics] = useState(DEFAULT_MIN_CLINICS)
  const [lineId, setLineId] = useState<number | null>(null)
  const [managerId, setManagerId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [details, setDetails] = useState<Map<string, DetailState>>(new Map())
  const [exporting, setExporting] = useState(false)

  const { from, to } = useMemo(() => (fromMonth <= toMonth ? rangeFromMonths(fromMonth, toMonth) : rangeFromMonths(toMonth, fromMonth)), [fromMonth, toMonth])
  const data = useAsync(`suspicious:${from}:${to}:${minClinics}`, () => fetchSuspiciousClusters(from, to, minClinics))
  const org = useAsync(`suspicious:org:${from}:${to}`, () => fetchSuspiciousOrg(from, to))
  const managers = org.data?.managers ?? new Map<number, string>()
  const mgrName = useCallback((id: number | null) => (id === null ? '' : managers.get(id) ?? `#${id}`), [managers])

  useEffect(() => { setOpen(null); setDetails(new Map()) }, [from, to, minClinics])

  const rows = useMemo(
    () => filterClusters(data.data ?? [], { severities, minClinics, search, lineId, managerId }, org.data?.lineOfRep ?? new Map()),
    [data.data, severities, minClinics, search, lineId, managerId, org.data],
  )
  const kpis = useMemo(() => summarize(rows), [rows])
  const managerOptions = useMemo(() => {
    const ids = new Set((data.data ?? []).map((r) => r.manager_id).filter((x): x is number => x !== null))
    return [...ids].map((id) => [id, mgrName(id)] as const).sort((a, b) => a[1].localeCompare(b[1]))
  }, [data.data, mgrName])

  const loadDetail = useCallback(async (c: Cluster): Promise<ClinicRow[]> => {
    const key = clusterKey(c)
    setDetails((m) => new Map(m).set(key, { loading: true, error: null, data: null }))
    try {
      const d = await fetchSuspiciousDetail(c.rep_id, c.cell_lat, c.cell_lng, from, to)
      setDetails((m) => new Map(m).set(key, { loading: false, error: null, data: d }))
      return d
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed'
      setDetails((m) => new Map(m).set(key, { loading: false, error: msg, data: null }))
      throw e
    }
  }, [from, to])

  const toggle = (c: Cluster) => {
    const key = clusterKey(c)
    if (open === key) { setOpen(null); return }
    setOpen(key)
    if (!details.has(key)) void loadDetail(c).catch(() => undefined)
  }

  const exportXlsx = async () => {
    setExporting(true)
    try {
      const detail: Record<string, string | number | null>[] = []
      const queue = [...rows]
      const worker = async () => {
        for (let c = queue.shift(); c; c = queue.shift()) {
          const cached = details.get(clusterKey(c))?.data
          const d = cached ?? (await fetchSuspiciousDetail(c.rep_id, c.cell_lat, c.cell_lng, from, to))
          detail.push(...detailRows(c, mgrName(c.manager_id), d))
        }
      }
      await Promise.all([worker(), worker(), worker()])
      const order = new Map(rows.map((r, i) => [r.rep_name + r.cell_lat + r.cell_lng, i]))
      detail.sort((a, b) => (order.get(String(a.Rep) + a['Cell lat'] + a['Cell lng']) ?? 0) - (order.get(String(b.Rep) + b['Cell lat'] + b['Cell lng']) ?? 0) || Number(b.Visits) - Number(a.Visits))
      await downloadXlsx(`Suspicious_Cases_${from}_${to}.xlsx`, 'Summary', rows.map((c) => summaryRow(c, mgrName(c.manager_id))), [{ name: 'Detail', rows: detail }])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const toggleSeverity = (s: Severity) => setSeverities((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))
  const loading = data.loading

  return (
    <div className="space-y-3">
      <div role="note" className="rounded-card border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{DISCLAIMER}</div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">From<input type="month" aria-label="From month" className={SELECT} value={fromMonth} max={toMonth} onChange={(e) => e.target.value && setFromMonth(e.target.value)} /></label>
        <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">To<input type="month" aria-label="To month" className={SELECT} value={toMonth} min={fromMonth} onChange={(e) => e.target.value && setToMonth(e.target.value)} /></label>
        <select aria-label="Line" className={SELECT} value={lineId ?? ''} onChange={(e) => setLineId(e.target.value === '' ? null : Number(e.target.value))}>
          <option value="">All lines</option>
          {(org.data?.lines ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select aria-label="Direct manager" className={cn(SELECT, 'max-w-[14rem]')} value={managerId ?? ''} onChange={(e) => setManagerId(e.target.value === '' ? null : Number(e.target.value))}>
          <option value="">All managers</option>
          {managerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <div role="group" aria-label="Severity" className="flex gap-1">
          {SEVERITIES.map((s) => (
            <button key={s} type="button" aria-pressed={severities.includes(s)} onClick={() => toggleSeverity(s)} className={cn('rounded-full border px-3 py-1 text-sm', severities.includes(s) ? `${severityChip(s).classes} border-transparent font-medium` : 'bg-card text-muted-foreground hover:bg-muted')}>{s}</button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">Min clinics
          <select aria-label="Minimum clinics" className={SELECT} value={minClinics} onChange={(e) => setMinClinics(Number(e.target.value))}>{MIN_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
        <div className="relative min-w-44 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input aria-label="Search rep" placeholder="Rep name or code…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Button size="sm" disabled={rows.length === 0 || exporting} onClick={() => void exportXlsx()}><FileSpreadsheet className="h-4 w-4" aria-hidden /> {exporting ? 'Preparing…' : 'Excel'}</Button>
      </div>
      <div className="text-sm text-muted-foreground">Period: <span className="font-medium text-foreground">{rangeLabel(from, to)}</span> · PM clinics (C and PC) · ~110 m cells of the device position</div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi loading={loading} label="Reps flagged" value={String(kpis.reps)} />
        <Kpi loading={loading} label="Clinics sharing a location" value={kpis.clinics.toLocaleString('en-US')} hint="clinics of one rep in one ~110 m cell, summed" />
        <Kpi loading={loading} label="Visits involved" value={kpis.visits.toLocaleString('en-US')} />
        <Kpi loading={loading} label="Share of those reps' PM visits" value={fmtPct(kpis.shareOfPmVisits)} />
      </div>

      {data.error ? (
        <div role="alert" className="rounded-card border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <div className="font-semibold">The report could not be loaded</div>
          <p className="mt-1 text-xs">{data.error}</p>
          <Button size="sm" className="mt-2" onClick={data.reload}>Retry</Button>
        </div>
      ) : loading ? (
        <div className="space-y-2" aria-busy="true"><Skeleton className="h-10" /><Skeleton className="h-40" /></div>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">{NO_CASES}</Card>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-card border bg-card">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-xs">
              <tr>
                <th className="w-6 px-1" /><th className="px-2 py-1.5 text-left">Rep</th><th className="px-2 py-1.5 text-left">Manager</th><th className="px-2 py-1.5 text-left">Severity</th>
                <th className="px-2 py-1.5 text-right">Clinics</th><th className="px-2 py-1.5 text-right">Visits</th><th className="px-2 py-1.5 text-right">Days</th><th className="px-2 py-1.5 text-left">% of rep&apos;s PM visits</th>
                <th className="px-2 py-1.5 text-right" title="Clinics registered at this point / clinics visited from far away">Registered here / from far</th><th className="px-2 py-1.5 text-right">Night visits</th>
                <th className="px-2 py-1.5 text-left">First visit</th><th className="px-2 py-1.5 text-left">Last visit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const key = clusterKey(c)
                const isOpen = open === key
                const rb = resignedBadge(c.rep_status, c.resign_date)
                const sev = severityChip(c.severity)
                return (
                  <Fragment key={key}>
                    <tr className={cn('cursor-pointer border-t hover:bg-muted/50', isOpen && 'bg-muted/50')} onClick={() => toggle(c)}>
                      <td className="px-1 text-muted-foreground">
                        <button type="button" aria-expanded={isOpen} aria-label={isOpen ? 'Hide the clinics' : 'Show the clinics'} onClick={(e) => { e.stopPropagation(); toggle(c) }}>{isOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}</button>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium leading-tight">{c.rep_name}{rb.show && <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-800">{rb.text}</span>}</div>
                        <div className="tnum text-[11px] text-muted-foreground">{c.rep_code}</div>
                      </td>
                      <td className="px-2 py-1.5">{mgrName(c.manager_id) || '–'}</td>
                      <td className="px-2 py-1.5"><span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', sev.classes)}>{sev.label}</span></td>
                      <td className="tnum px-2 py-1.5 text-right font-semibold">{c.clinics}</td>
                      <td className="tnum px-2 py-1.5 text-right">{c.visits}</td>
                      <td className="tnum px-2 py-1.5 text-right">{c.visit_days}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-20 overflow-hidden rounded bg-muted" role="img" aria-label={`${fmtPctPoints(c.pct_of_rep_pm_visits)} of the rep's PM visits`}><div className="h-full bg-red-500" style={{ width: `${Math.min(100, c.pct_of_rep_pm_visits)}%` }} /></div>
                          <span className="tnum text-xs">{fmtPctPoints(c.pct_of_rep_pm_visits)}</span>
                        </div>
                      </td>
                      <td className="tnum px-2 py-1.5 text-right">{c.clinics_registered_here} / {c.clinics_far}{c.visits_far > 0 && <span className="ml-1 text-xs text-muted-foreground">({c.visits_far} visits)</span>}</td>
                      <td className="tnum px-2 py-1.5 text-right">{c.night_visits || ''}</td>
                      <td className="px-2 py-1.5 text-xs">{fmtDate(c.first_visit)}</td>
                      <td className="px-2 py-1.5 text-xs">{fmtDate(c.last_visit)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t bg-muted/20"><td colSpan={COLS}><DetailPanel c={c} state={details.get(key)} from={from} to={to} managerName={mgrName(c.manager_id)} /></td></tr>
                    )}
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
