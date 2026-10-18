import { ProfileLink } from '../../components/app/ProfileLink'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Skeleton } from '../../components/ui/misc'
import { downloadCsv } from '../../lib/csv'
import { downloadXlsxGrid } from '../../lib/xlsxExport'
import { fetchJointDays, fetchJointMonth } from '../../lib/api/reports'
import { useDateRange } from '../../context/DateRangeContext'
import { PeriodBanner } from '../../components/app/PeriodBanner'
import { lastDayOf, periodLabel as rangePeriodLabel, rangeFileSlug } from '../../lib/dateRange'
import { cn } from '../../lib/utils'
import { useAsync } from '../dashboard/useAsync'
import { ReportTable, type ReportCol } from './ReportTable'
import { ReportToolbar } from './ReportToolbar'
import {
  EMPTY_TITLE, FOOTER_NOTE, GROUPS, HEADER_SUBTITLE, HEADER_TITLE, PAL,
  buildJointGrid, defaultManager, distinctDays, filterJoint, fmtCover, jointCards, jointColumns, jointFlatRows, jointFootText, jointManagers,
  jointText, jointValue, isNumericKind, monthBounds, orderJoint, periodLabel, totalJointRow,
  type JointMode, type JointRow,
} from './jointMath'
import type { ReportFilters } from './reportMath'

interface Props {
  month?: string
  lines: { id: number; name: string }[]
  filters: ReportFilters
  onFilters: (f: ReportFilters) => void
}

/** Coverage % as a number over a green horizontal data bar (bar length = the percentage). */
function CoverCell({ v }: { v: number | null }) {
  if (v === null) return <span className="font-bold">-</span>
  const pct = Math.max(0, Math.min(1, v)) * 100
  return (
    <div className="relative mx-auto h-5 w-28">
      <div
        aria-hidden className="absolute inset-y-0.5 left-0 rounded-sm"
        style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${PAL.barFrom}, ${PAL.barTo})` }}
      />
      <span className="relative z-10 flex h-full items-center justify-center font-bold" style={{ color: PAL.navy, textShadow: '0 0 3px #fff, 0 0 3px #fff' }}>
        {fmtCover(v)}
      </span>
    </div>
  )
}

function Logo() {
  const [failed, setFailed] = useState(false)
  return (
    <div className="flex h-12 w-32 shrink-0 items-center justify-start">
      {failed ? (
        <span className="text-2xl font-extrabold tracking-widest" style={{ color: PAL.navy }}>CIRA</span>
      ) : (
        <img src={`${import.meta.env.BASE_URL}cira-logo.png`} alt="CIRA" className="max-h-12 max-w-full object-contain" onError={() => setFailed(true)} />
      )}
    </div>
  )
}

function ModeToggle({ value, onChange }: { value: JointMode; onChange: (v: JointMode) => void }) {
  const views = [{ id: 'day', label: 'By day' }, { id: 'month', label: 'Summary' }] as const
  return (
    <div role="group" aria-label="View" className="inline-flex rounded-control border bg-card p-0.5">
      {views.map((v) => (
        <button
          key={v.id}
          aria-pressed={value === v.id}
          onClick={() => onChange(v.id)}
          className={cn('rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors', value === v.id && 'bg-accent font-medium text-accent-foreground')}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}

export function JointDaysTab({ lines, filters, onFilters }: Props) {
  const dr = useDateRange()
  const { month } = dr
  // By day follows the day range (v_manager_joint_days has a day column); the Summary view is monthly (v_manager_joint_month).
  const dayData = useAsync(`report:joint:day:${dr.from}:${dr.to}`, () => fetchJointDays(dr.from, dr.to))
  const monthData = useAsync(`report:joint:month:${month}`, () => fetchJointMonth(month))
  const [mode, setMode] = useState<JointMode>('day')
  /** null = not chosen yet -> the first manager with joint days; '' = All managers. */
  const [mgr, setMgr] = useState<string | null>(null)
  const [range, setRange] = useState({ from: '', to: '' })
  const [sorted, setSorted] = useState<JointRow[]>([])
  useEffect(() => { setMgr(null); setRange({ from: '', to: '' }) }, [dr.from, dr.to])

  const dayRows = useMemo(() => dayData.data ?? [], [dayData.data])
  const monthRows = useMemo(() => monthData.data ?? [], [monthData.data])
  const active = mode === 'day' ? dayData : monthData
  const allRows = mode === 'day' ? dayRows : monthRows

  const managers = useMemo(() => jointManagers([...dayRows, ...monthRows]), [dayRows, monthRows])
  const manager = mgr ?? defaultManager(dayRows.length > 0 ? dayRows : monthRows)
  const showManager = manager === ''
  const lineName = filters.lineId === null ? null : lines.find((l) => l.id === filters.lineId)?.name ?? null
  const [from, to] = range.from && range.to && range.from > range.to ? [range.to, range.from] : [range.from, range.to]
  const bounds = mode === 'day' ? { first: dr.from, last: dr.to } : monthBounds(month)

  const scope = { line: lineName, manager, search: filters.search }
  const rows = useMemo(
    () => orderJoint(filterJoint(allRows, { ...scope, from: mode === 'day' ? from : '', to: mode === 'day' ? to : '' }), mode),
    [allRows, lineName, manager, filters.search, from, to, mode], // eslint-disable-line react-hooks/exhaustive-deps
  )
  // "N Days" = distinct days of the filtered rows; the Summary view has no days, so it counts them from the day view.
  const nDays = useMemo(
    () => distinctDays(mode === 'day' ? rows : filterJoint(dayRows, { ...scope, from: '', to: '' })),
    [rows, dayRows, mode, lineName, manager, filters.search], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const total = useMemo(() => totalJointRow(rows, nDays), [rows, nDays])
  const cards = useMemo(() => jointCards(total), [total])
  const defs = useMemo(() => jointColumns(mode, showManager), [mode, showManager])
  const onRowsChange = useCallback((r: JointRow[]) => setSorted(r), [])

  const cols = useMemo<ReportCol<JointRow>[]>(
    () =>
      defs.map((d, i) => {
        const g = GROUPS[d.group]
        const numeric = isNumericKind(d.kind)
        const width = i < 2 ? (d.id === 'manager' ? 140 : d.id === 'rep' ? 180 : 90) : undefined
        return {
          id: d.id,
          header: d.header,
          group: g.label,
          numeric,
          align: numeric ? 'center' : 'left',
          sticky: i < 2,
          width,
          value: (r) => jointValue(d, r),
          render: (r) => (d.kind === 'cover' ? <CoverCell v={r.cover_total} /> : d.id === 'rep' ? <ProfileLink type="rep" id={r.rep_id}>{jointText(d, r)}</ProfileLink> : d.id === 'manager' ? <ProfileLink type="manager" id={r.manager_id}>{jointText(d, r)}</ProfileLink> : <span className={numeric ? 'font-bold' : undefined}>{jointText(d, r)}</span>),
          headStyle: { backgroundColor: g.sub, color: PAL.white, fontWeight: 700 },
          groupStyle: { backgroundColor: g.main, color: PAL.white, fontWeight: 700 },
          cellStyle: { color: PAL.navy },
          footRender: (t) => jointFootText(defs, d, t),
          footStyle: { backgroundColor: g.main, color: PAL.white, borderTopColor: g.main },
        }
      }),
    [defs],
  )

  const managerLabel = manager === '' ? 'All managers' : manager
  const periodText = mode === 'day' ? `PERIOD: ${rangePeriodLabel(dr.from, dr.to).toUpperCase()}` : periodLabel(month)
  const fileName = `manager-joint-days-${mode === 'day' ? 'by-day' : 'summary'}-${mode === 'day' ? rangeFileSlug(dr.from, dr.to) : rangeFileSlug(month, lastDayOf(month))}`
  const ordered = () => (sorted.length === rows.length ? sorted : rows)
  const noData = !active.loading && !active.error && allRows.length === 0

  return (
    <div className="space-y-3 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]">
      <div className="print:hidden"><PeriodBanner monthly={mode === 'month'} /></div>
      {/* 1. header band */}
      <div className="overflow-hidden rounded-md border bg-white" style={{ borderColor: PAL.navy }}>
        <div className="flex items-center gap-4 px-4 py-3">
          <Logo />
          <div className="min-w-0 flex-1 text-center">
            <h2 className="text-xl font-bold tracking-wide sm:text-[22px]" style={{ color: PAL.navy }}>{HEADER_TITLE}</h2>
            <p className="mt-0.5 text-sm italic" style={{ color: PAL.grey }}>{HEADER_SUBTITLE}</p>
          </div>
          <div aria-hidden className="hidden w-32 shrink-0 sm:block" />
        </div>
        <div className="px-4 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-white" style={{ backgroundColor: PAL.green }}>
          {periodText}
          <span className="ml-3 normal-case">·  Manager: {managerLabel}</span>
        </div>
      </div>

      {/* 2. manager selector + other filters */}
      <div className="space-y-3 print:hidden">
        <label className="inline-flex items-center gap-2 text-sm">
          <span className="font-medium">Manager</span>
          <select aria-label="Manager" value={manager} onChange={(e) => setMgr(e.target.value)} className="h-9 min-w-52 rounded-control border bg-card px-2 text-sm">
            <option value="">All managers</option>
            {managers.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <ReportToolbar
          lines={lines} filters={filters} onFilters={onFilters} managers={[]}
          columns={[]} hidden={new Set()} onToggleColumn={() => undefined}
          canExport={rows.length > 0}
          onXlsx={() => void downloadXlsxGrid(`${fileName}.xlsx`, { name: 'Manager Joint Days', ...buildJointGrid({ cols: defs, rows: ordered(), total, month, period: periodText, managerLabel }) })}
          onCsv={() => downloadCsv(`${fileName}.csv`, jointFlatRows(defs, ordered(), total))}
          roleSelect={<></>}
          searchLabel="Search rep name or code" searchPlaceholder="Rep name or code…"
        >
          <ModeToggle value={mode} onChange={(v) => { setMode(v); setSorted([]) }} />
          {mode === 'day' && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <label className="inline-flex items-center gap-1.5">
                From
                <input type="date" aria-label="From date" min={bounds.first} max={bounds.last} value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="h-9 rounded-control border bg-card px-2 text-sm text-foreground" />
              </label>
              <label className="inline-flex items-center gap-1.5">
                To
                <input type="date" aria-label="To date" min={bounds.first} max={bounds.last} value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="h-9 rounded-control border bg-card px-2 text-sm text-foreground" />
              </label>
            </div>
          )}
          <Button size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / PDF</Button>
        </ReportToolbar>
      </div>

      {/* 3. four KPI cards */}
      {active.loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:grid-cols-4">
          {cards.map((c) => (
            <div key={c.id} className="overflow-hidden rounded-md border" style={{ borderColor: c.head }}>
              <div className="px-3 py-1.5 text-center text-xs font-bold tracking-wide text-white" style={{ backgroundColor: c.head }}>{c.title}</div>
              <div className="px-3 py-3 text-center" style={{ backgroundColor: c.body }}>
                <div className="tnum text-3xl font-bold" style={{ color: c.num }}>{c.value}</div>
                <div className="mt-1 text-xs italic" style={{ color: PAL.grey }}>{c.caption}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 4. separator */}
      <hr className="border-t" style={{ borderColor: PAL.beige }} />

      {/* 5. table */}
      <ReportTable
        key={`${mode}|${showManager}`}
        cols={cols} rows={rows} total={total} loading={active.loading} error={active.error} onRetry={active.reload} onRowsChange={onRowsChange}
        initialSorting={mode === 'day' ? [{ id: 'day', desc: false }, { id: 'rep', desc: false }] : showManager ? [{ id: 'manager', desc: false }, { id: 'rep', desc: false }] : [{ id: 'rep', desc: false }]}
        compact zebra={PAL.zebra} rowBorder={PAL.rowLine}
        emptyTitle={manager === '' ? 'No joint days in this month' : EMPTY_TITLE}
        emptyDescription={
          noData
            ? 'Joint days appear once a manager has Double visits with a rep. Pick another month.'
            : 'Clear the search, the date range or choose another manager / line.'
        }
      />

      {/* 6. footer note */}
      <p className="text-xs italic" style={{ color: PAL.grey }}>{FOOTER_NOTE}</p>
    </div>
  )
}
