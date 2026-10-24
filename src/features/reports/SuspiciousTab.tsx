import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { FileSpreadsheet, MapPin, Moon, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Card, Input, Skeleton } from '../../components/ui/misc'
import { downloadXlsxTables } from '../../lib/xlsxExport'
import { fetchSuspiciousClusters, fetchSuspiciousDetail, fetchSuspiciousNames } from '../../lib/api/suspicious'
import { cn } from '../../lib/utils'
import { useAsync } from '../dashboard/useAsync'
import {
  BUSY_DAY_VISITS, CHIPS_BEFORE_TOGGLE, DEFAULT_SEVERITIES, DISCLAIMER, MIN_CLINICS, NO_CASES, STRIP_WEEKDAYS, buildDayStrip, clusterKey, detailRows, exportFileName, fmtDate, fmtPct, fmtPctPoints,
  filterClusters, latestClosedMonth, mapsUrl, monthLabel, monthRange, nameOrId, orderedVisits, patternChip, readingNote, resignedBadge, severityChip, severityReason, stripWeeks, summarize,
  summaryRow, visitChip, type ClinicRow, type Cluster, type Severity,
} from './suspiciousMath'

const SEVERITIES: Severity[] = ['High', 'Medium', 'Low']
const SELECT = 'h-9 rounded-control border bg-card px-2 text-sm'
const CHIP: Record<'red' | 'amber' | 'grey', string> = { red: 'bg-red-100 text-red-900', amber: 'bg-amber-100 text-amber-900', grey: 'bg-gray-200 text-gray-800' }
const COLS = 11

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

/** Every visit date and time of an account as small chips, ascending; "Show all" above 12. */
function VisitChips({ log }: { log: ClinicRow['visit_log'] }) {
  const [all, setAll] = useState(false)
  const list = orderedVisits(log)
  const shown = all || list.length <= CHIPS_BEFORE_TOGGLE ? list : list.slice(0, CHIPS_BEFORE_TOGGLE)
  return (
    <div>
      {list.length > CHIPS_BEFORE_TOGGLE && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mb-1 text-xs font-medium text-primary underline">{all ? 'Show fewer' : `Show all ${list.length}`}</button>
      )}
      <div className="flex flex-wrap gap-1">
        {shown.map((v, i) => <span key={`${v.d}-${v.t}-${i}`} className="tnum whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-[11px]">{visitChip(v)}</span>)}
        {shown.length < list.length && <span className="text-[11px] text-muted-foreground">+{list.length - shown.length} more</span>}
      </div>
    </div>
  )
}

/** The days of the selected month only, in weeks (Saturday first), weekday names on top. */
function DayStrip({ detail, month }: { detail: ClinicRow[]; month: string }) {
  const { from, to } = monthRange(month)
  const weeks = useMemo(() => stripWeeks(buildDayStrip(detail, from, to)), [detail, from, to])
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">Visits at this point, day by day, {monthLabel(month)} (amber: more than {BUSY_DAY_VISITS} in a day · moon: visits at night)</div>
      <div className="inline-grid grid-cols-7 gap-1">
        {STRIP_WEEKDAYS.map((w) => <div key={w} className="text-center text-[10px] font-medium text-muted-foreground">{w}</div>)}
        {weeks.flat().map((d, i) => d === null ? <div key={`b${i}`} /> : (
          <div
            key={d.day}
            title={d.count === 0 ? `${fmtDate(d.day)}: none` : `${fmtDate(d.day)}: ${d.count} visit${d.count === 1 ? '' : 's'}\n${d.visits.map((v) => `${v.t ?? '--:--'}  ${v.clinic}`).join('\n')}`}
            className={cn('relative flex h-10 w-12 flex-col items-center justify-center rounded border text-[10px] leading-none',
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

/** The card under a row: it carries the severity color on its left border and a header with the rep, so it cannot be mistaken for the next row. */
function DetailCard({ c, state, month, managerName, onClose }: { c: Cluster; state: DetailState | undefined; month: string; managerName: string; onClose: () => void }) {
  const sev = severityChip(c.severity)
  const data = useMemo(() => [...(state?.data ?? [])].sort((a, b) => b.visits - a.visits || a.account.localeCompare(b.account)), [state?.data])
  return (
    <div className={cn('rounded-card border border-l-4 bg-card shadow-sm', sev.border)}>
      <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2 text-sm">
        <span className="font-semibold">{c.rep_name}, {monthLabel(month)}</span>
        <span className="text-muted-foreground">{c.rep_code} · Manager: {managerName || '–'}</span>
        <span className="tnum text-muted-foreground">{c.cell_lat}, {c.cell_lng}</span>
        <a href={mapsUrl(c.cell_lat, c.cell_lng)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 rounded-control border bg-card px-2.5 py-1 text-sm font-medium hover:bg-muted"><MapPin className="h-4 w-4" aria-hidden /> Open in Google Maps</a>
        <button type="button" aria-label="Close" onClick={onClose} className="ml-auto inline-flex items-center gap-1 rounded-control border px-2 py-1 text-xs hover:bg-muted"><X className="h-3.5 w-3.5" aria-hidden /> Close</button>
      </div>
      {!state || state.loading ? (
        <div className="space-y-2 p-3" aria-busy="true"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-24" /></div>
      ) : state.error ? (
        <div role="alert" className="p-3 text-sm text-red-700">Could not load the accounts: {state.error}</div>
      ) : (
        <div className="space-y-4 p-3">
          <p className="text-sm">{readingNote(c, data)}</p>
          <div className="overflow-auto rounded-card border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs"><tr>
                <th className="px-2 py-1.5 text-left">Account</th><th className="px-2 py-1.5 text-left">Type</th><th className="px-2 py-1.5 text-right">Visits</th><th className="min-w-72 px-2 py-1.5 text-left">Visit dates</th>
                <th className="px-2 py-1.5 text-left">First visit</th><th className="px-2 py-1.5 text-left">Last visit</th><th className="px-2 py-1.5 text-right">Avg deviation (m)</th>
                <th className="px-2 py-1.5 text-left">Pattern</th><th className="px-2 py-1.5 text-left">Clinic coordinates</th>
              </tr></thead>
              <tbody>
                {data.map((d) => {
                  const chip = patternChip(d.avg_deviation_m)
                  return (
                    <tr key={d.account} className="border-t align-top">
                      <td className="px-2 py-1.5 font-medium">{d.account}</td><td className="px-2 py-1.5">{d.acc_type_code ?? ''}</td><td className="tnum px-2 py-1.5 text-right">{d.visits}</td>
                      <td className="px-2 py-1.5"><VisitChips log={d.visit_log} /></td>
                      <td className="whitespace-nowrap px-2 py-1.5">{fmtDate(d.first_visit)}</td><td className="whitespace-nowrap px-2 py-1.5">{fmtDate(d.last_visit)}</td>
                      <td className="tnum px-2 py-1.5 text-right">{d.avg_deviation_m === null ? '' : Math.round(d.avg_deviation_m).toLocaleString('en-US')}</td>
                      <td className="px-2 py-1.5"><span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', CHIP[chip.tone])}>{chip.label}</span></td>
                      <td className="tnum whitespace-nowrap px-2 py-1.5 text-xs text-muted-foreground">{d.acc_lat !== null && d.acc_lng !== null ? <a className="underline" href={mapsUrl(d.acc_lat, d.acc_lng)} target="_blank" rel="noreferrer noopener">{d.acc_lat.toFixed(5)}, {d.acc_lng.toFixed(5)}</a> : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <DayStrip detail={data} month={month} />
        </div>
      )}
    </div>
  )
}

export function SuspiciousTab() {
  const latest = useMemo(() => latestClosedMonth(new Date()), [])
  const [month, setMonth] = useState(latest)
  const [severities, setSeverities] = useState<Severity[]>(DEFAULT_SEVERITIES)
  const [lineId, setLineId] = useState<number | null>(null)
  const [managerId, setManagerId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [details, setDetails] = useState<Map<string, DetailState>>(new Map())
  const [exporting, setExporting] = useState(false)

  const { from, to } = useMemo(() => monthRange(month), [month])
  const data = useAsync(`suspicious:${from}:${to}`, () => fetchSuspiciousClusters(from, to, MIN_CLINICS))
  const names = useAsync('suspicious:names', fetchSuspiciousNames)
  const managers = useMemo(() => names.data?.managers ?? new Map<number, string>(), [names.data])
  const lines = useMemo(() => names.data?.lines ?? new Map<number, string>(), [names.data])
  const mgrName = useCallback((id: number | null) => nameOrId(id, managers), [managers])
  const lineName = useCallback((id: number | null) => nameOrId(id, lines), [lines])

  useEffect(() => { setOpen(null); setDetails(new Map()) }, [from, to])

  const all = useMemo(() => data.data ?? [], [data.data])
  const rows = useMemo(() => filterClusters(all, { severities, search, lineId, managerId }), [all, severities, search, lineId, managerId])
  const kpis = useMemo(() => summarize(rows), [rows])
  const lineOptions = useMemo(() => [...new Set(all.map((r) => r.line_id).filter((x): x is number => x !== null))].map((id) => [id, lineName(id)] as const).sort((a, b) => a[1].localeCompare(b[1])), [all, lineName])
  const managerOptions = useMemo(() => [...new Set(all.filter((r) => lineId === null || r.line_id === lineId).map((r) => r.manager_id).filter((x): x is number => x !== null))].map((id) => [id, mgrName(id)] as const).sort((a, b) => a[1].localeCompare(b[1])), [all, lineId, mgrName])

  const loadDetail = useCallback(async (c: Cluster): Promise<ClinicRow[]> => {
    const key = clusterKey(c)
    setDetails((m) => new Map(m).set(key, { loading: true, error: null, data: null }))
    try {
      const d = await fetchSuspiciousDetail(c.rep_id, c.cell_lat, c.cell_lng, from, to)
      setDetails((m) => new Map(m).set(key, { loading: false, error: null, data: d }))
      return d
    } catch (e) {
      setDetails((m) => new Map(m).set(key, { loading: false, error: e instanceof Error ? e.message : 'Failed', data: null }))
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
      const ordered = [...rows]
      const detailByKey = new Map<string, ClinicRow[]>()
      const queue = [...ordered]
      const worker = async () => {
        for (let c = queue.shift(); c; c = queue.shift()) detailByKey.set(clusterKey(c), details.get(clusterKey(c))?.data ?? (await fetchSuspiciousDetail(c.rep_id, c.cell_lat, c.cell_lng, from, to)))
      }
      await Promise.all([worker(), worker(), worker()])
      const nm = (c: Cluster) => ({ month, line: lineName(c.line_id), manager: mgrName(c.manager_id) })
      await downloadXlsxTables(exportFileName(month), [
        { name: 'Summary', rows: ordered.map((c) => summaryRow(c, nm(c))) },
        { name: 'Detail', rows: ordered.flatMap((c) => detailRows(c, nm(c), detailByKey.get(clusterKey(c)) ?? [])) },
      ])
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
        <input type="month" aria-label="Month" className={SELECT} value={month} max={latest} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <select aria-label="Line" className={SELECT} value={lineId ?? ''} onChange={(e) => { setLineId(e.target.value === '' ? null : Number(e.target.value)); setManagerId(null) }}>
          <option value="">All lines</option>
          {lineOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
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
        <div className="relative min-w-44 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input aria-label="Search rep" placeholder="Rep name or code…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Button size="sm" disabled={rows.length === 0 || exporting} onClick={() => void exportXlsx()}><FileSpreadsheet className="h-4 w-4" aria-hidden /> {exporting ? 'Preparing…' : 'Excel'}</Button>
      </div>
      <div className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{monthLabel(month)}</span> · PM clinics (C and PC) · {MIN_CLINICS}+ clinics sharing a ~110 m point of the device position</div>

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
        <div className="max-h-[75vh] overflow-auto rounded-card border bg-card">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-xs">
              <tr>
                <th className="px-2 py-1.5 text-left">Severity</th><th className="px-2 py-1.5 text-left">Line</th><th className="px-2 py-1.5 text-left">Manager</th><th className="px-2 py-1.5 text-left">Medical Rep</th>
                <th className="px-2 py-1.5 text-right">Clinics</th><th className="px-2 py-1.5 text-right">Visits</th><th className="px-2 py-1.5 text-right">Visit days</th><th className="px-2 py-1.5 text-left">% of rep&apos;s PM visits</th>
                <th className="px-2 py-1.5 text-left" title="Clinics and visits registered at the point / clinics and visits logged here with the clinic far away">Registered at the point / Visited from far</th>
                <th className="px-2 py-1.5 text-right">Night visits</th><th className="px-2 py-1.5 text-left">First / last visit</th>
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
                    <tr className={cn('cursor-pointer border-t hover:bg-muted/50', isOpen && 'bg-muted/40')} onClick={() => toggle(c)} aria-expanded={isOpen}>
                      <td className={cn('border-l-4 px-2 py-1.5', sev.border)}><span title={severityReason(c)} className={cn('cursor-help rounded-full px-2.5 py-0.5 text-xs font-semibold', sev.classes)}>{sev.label}</span></td>
                      <td className="px-2 py-1.5">{lineName(c.line_id) || '–'}</td>
                      <td className="px-2 py-1.5">{mgrName(c.manager_id) || '–'}</td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium leading-tight">{c.rep_name}{rb.show && <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-800">{rb.text}</span>}</div>
                        <div className="tnum text-[11px] text-muted-foreground">{c.rep_code}</div>
                      </td>
                      <td className="tnum px-2 py-1.5 text-right font-semibold">{c.clinics}</td>
                      <td className="tnum px-2 py-1.5 text-right">{c.visits}</td>
                      <td className="tnum px-2 py-1.5 text-right">{c.visit_days}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-20 overflow-hidden rounded bg-muted" role="img" aria-label={`${fmtPctPoints(c.pct_of_rep_pm_visits)} of the rep's PM visits`}><div className="h-full bg-red-500" style={{ width: `${Math.min(100, c.pct_of_rep_pm_visits)}%` }} /></div>
                          <span className="tnum text-xs">{fmtPctPoints(c.pct_of_rep_pm_visits)}</span>
                        </div>
                      </td>
                      <td className="tnum px-2 py-1.5 text-xs leading-tight">
                        <div>{c.clinics_registered_here} clinics · {c.visits - c.visits_far} visits</div>
                        <div className="text-amber-800">{c.clinics_far} clinics · {c.visits_far} visits</div>
                      </td>
                      <td className="tnum px-2 py-1.5 text-right">{c.night_visits || ''}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-xs leading-tight"><div>{fmtDate(c.first_visit)}</div><div className="text-muted-foreground">{fmtDate(c.last_visit)}</div></td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-muted/40"><td colSpan={COLS} className="px-3 pb-4 pt-1"><DetailCard c={c} state={details.get(key)} month={month} managerName={mgrName(c.manager_id)} onClose={() => setOpen(null)} /></td></tr>
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
