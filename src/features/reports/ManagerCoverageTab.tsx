import { Fragment, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Info, ListX } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input, Skeleton } from '../../components/ui/misc'
import { Tooltip } from '../../components/ui/overlay'
import { EmptyState, ErrorState } from '../../components/app/states'
import { downloadCsv } from '../../lib/csv'
import { downloadXlsxGrids } from '../../lib/xlsxExport'
import { fetchManagerCoverage, fetchManagerCoverageSpec, hasManagerCoverage } from '../../lib/api/reports'
import { addMonthsIso } from '../../lib/norm'
import { cn } from '../../lib/utils'
import { useAsync } from '../dashboard/useAsync'
import { CoverDoctorsModal } from './CoverDoctorsModal'
import {
  COVER_COLS, COVER_EMPTY_TEXT, COVER_EMPTY_TITLE, COVER_FOOTER, COVER_SUBTITLE, COVER_TITLE, CPAL, PERIODS,
  buildCoverGrid, buildSpecGrid, coverCards, coverManagers, filterCover, fmtNum, fmtPct, flattenGroups, groupCover, groupSpec,
  pairKey, periodRange, periodText, sumCover, topSpeciality,
  type ColId, type CoverRow, type CoverTotal, type PeriodMode, type SortState, type TopSpec,
} from './coverageMath'
import { ReportToolbar } from './ReportToolbar'
import type { ReportFilters } from './reportMath'

interface Props {
  month: string
  lines: { id: number; name: string }[]
  filters: ReportFilters
  onFilters: (f: ReportFilters) => void
}

function Logo() {
  const [failed, setFailed] = useState(false)
  return (
    <div className="flex h-12 w-32 shrink-0 items-center justify-start">
      {failed ? (
        <span className="text-2xl font-extrabold tracking-widest" style={{ color: CPAL.navy }}>CIRA</span>
      ) : (
        <img src={`${import.meta.env.BASE_URL}cira-logo.png`} alt="CIRA" className="max-h-12 max-w-full object-contain" onError={() => setFailed(true)} />
      )}
    </div>
  )
}

/** A 0..1 value as a number over a horizontal data bar (bar length = the value). null shows "-". */
function PctBar({ v, from = CPAL.barFrom, to = CPAL.barTo, width = 'w-28' }: { v: number | null; from?: string; to?: string; width?: string }) {
  if (v === null) return <span className="font-bold">-</span>
  const pct = Math.max(0, Math.min(1, v)) * 100
  return (
    <div className={cn('relative mx-auto h-5', width)}>
      <div aria-hidden className="absolute inset-y-0.5 left-0 rounded-sm" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${from}, ${to})` }} />
      <span className="relative z-10 flex h-full items-center justify-center font-bold" style={{ color: CPAL.navy, textShadow: '0 0 3px #fff, 0 0 3px #fff' }}>{fmtPct(v)}</span>
    </div>
  )
}

function PeriodControls({ mode, onMode, to, onTo }: { mode: PeriodMode; onMode: (m: PeriodMode) => void; to: string | null; onTo: (m: string) => void }) {
  return (
    <>
      <div role="group" aria-label="Period" className="inline-flex rounded-control border bg-card p-0.5">
        {PERIODS.map((p) => (
          <button
            key={p.id} aria-pressed={mode === p.id} onClick={() => onMode(p.id)}
            className={cn('rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors', mode === p.id && 'bg-accent font-medium text-accent-foreground')}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        Up to
        <Input
          type="month" aria-label="Up to month" value={to ? to.slice(0, 7) : ''} disabled={to === null}
          onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) onTo(`${e.target.value}-01`) }}
          className="h-9 w-40 text-foreground"
        />
      </label>
    </>
  )
}

function SpecPanel({ r, spec, colSpan }: { r: CoverRow; spec: ReturnType<typeof groupSpec>; colSpan: number }) {
  const list = spec.get(pairKey(r)) ?? []
  const top = topSpeciality(list)
  return (
    <tr>
      <td colSpan={colSpan} className="border-b px-4 py-3" style={{ backgroundColor: CPAL.totalBody, borderBottomColor: CPAL.rowLine }}>
        {list.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">No speciality data for this manager and rep.</p>
        ) : (
          <table className="w-full max-w-3xl border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {['Speciality', 'List doctors', 'Covered', 'Coverage %', 'Share %', 'Joint visits'].map((h, i) => (
                  <th key={h} className={cn('h-7 whitespace-nowrap px-3 text-xs font-bold text-white', i === 0 ? 'text-left' : 'text-center')} style={{ backgroundColor: CPAL.teal }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((x) => {
                const isTop = top !== null && x.speciality === top.speciality
                return (
                  <tr key={x.speciality} style={{ backgroundColor: isTop ? CPAL.topBody : CPAL.white }}>
                    <td className="h-8 whitespace-nowrap border-b px-3" style={{ color: CPAL.navy, borderBottomColor: CPAL.rowLine, fontWeight: isTop ? 700 : 400 }}>
                      {x.speciality}
                      {isTop && <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white" style={{ backgroundColor: CPAL.teal }}>Top</span>}
                    </td>
                    <td className="tnum border-b px-3 text-center font-bold" style={{ color: CPAL.navy, borderBottomColor: CPAL.rowLine }}>{fmtNum(x.list_doctors)}</td>
                    <td className="tnum border-b px-3 text-center font-bold" style={{ color: CPAL.navy, borderBottomColor: CPAL.rowLine }}>{fmtNum(x.covered_doctors)}</td>
                    <td className="tnum border-b px-3 text-center font-bold" style={{ color: CPAL.navy, borderBottomColor: CPAL.rowLine }}>{fmtPct(x.coverage_pct)}</td>
                    <td className="border-b px-3" style={{ borderBottomColor: CPAL.rowLine }}><PctBar v={x.share_pct} from="#8CCBBB" to={CPAL.teal} width="w-32" /></td>
                    <td className="tnum border-b px-3 text-center font-bold" style={{ color: CPAL.navy, borderBottomColor: CPAL.rowLine }}>{fmtNum(x.joint_visits)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </td>
    </tr>
  )
}

export function ManagerCoverageTab({ month, lines, filters, onFilters }: Props) {
  const [mode, setMode] = useState<PeriodMode>('month')
  /** The "up to" month (YYYY-MM-01); null until the latest month with data has been looked up. */
  const [to, setTo] = useState<string | null>(null)
  const [sort, setSort] = useState<SortState>({ id: 'rep', desc: false })
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<CoverRow | null>(null)

  // default month = the latest month with data: probe the top-bar month and the 5 before it
  useEffect(() => {
    let cancelled = false
    void (async () => {
      let found: string | null = null
      try {
        for (let i = 0; i < 6 && found === null; i++) {
          const m = addMonthsIso(month, -i)
          if (await hasManagerCoverage(m)) found = m
        }
      } catch {
        // the data hooks below show the real error; fall back to the top-bar month
      }
      if (!cancelled) setTo((cur) => cur ?? found ?? month)
    })()
    return () => { cancelled = true }
  }, [month])

  const range = useMemo(() => periodRange(mode, to ?? month), [mode, to, month])
  const label = periodText(range.from, range.to)
  const pending = to === null
  const cover = useAsync(pending ? 'report:cover:pending' : `report:cover:${range.from}:${range.to}`, () => (pending ? Promise.resolve([] as CoverRow[]) : fetchManagerCoverage(range.from, range.to)))
  const specQ = useAsync(pending ? 'report:cover-spec:pending' : `report:cover-spec:${range.from}:${range.to}`, () => (pending ? Promise.resolve([]) : fetchManagerCoverageSpec(range.from, range.to)))
  const loading = pending || cover.loading
  const allRows = useMemo(() => cover.data ?? [], [cover.data])
  const spec = useMemo(() => groupSpec(specQ.data ?? []), [specQ.data])
  const top = useMemo(() => {
    const m = new Map<string, TopSpec | null>()
    for (const [k, v] of spec) m.set(k, topSpeciality(v))
    return m
  }, [spec])

  const lineName = filters.lineId === null ? null : lines.find((l) => l.id === filters.lineId)?.name ?? null
  const managers = useMemo(() => coverManagers(allRows, lineName), [allRows, lineName])
  const manager = managers.includes(filters.manager) ? filters.manager : ''
  const rows = useMemo(() => filterCover(allRows, { line: lineName, manager, search: filters.search }), [allRows, lineName, manager, filters.search])
  const groups = useMemo(() => groupCover(rows, top, sort), [rows, top, sort])
  const total = useMemo(() => sumCover(rows), [rows])
  const cards = useMemo(() => coverCards(total), [total])
  useEffect(() => setOpen(new Set()), [range.from, range.to])

  const toggleSort = (id: ColId) => setSort((s) => (s.id === id ? { id, desc: !s.desc } : { id, desc: id !== 'rep' && id !== 'box' }))
  const toggleOpen = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const periodLine = `PERIOD: ${label.toUpperCase()}   |   ${lineName ? `LINE: ${lineName.toUpperCase()}   |   ` : ''}MANAGER: ${manager === '' ? 'ALL MANAGERS' : manager.toUpperCase()}`
  const fileName = `manager-coverage-${range.from.slice(0, 7)}_${range.to.slice(0, 7)}`

  const exportXlsx = () => {
    const ordered = flattenGroups(groups)
    void downloadXlsxGrids(`${fileName}.xlsx`, [
      buildCoverGrid({ groups, total, periodLine, top }),
      buildSpecGrid({ rows: ordered, spec, periodLine }),
    ])
  }
  const exportCsv = () =>
    downloadCsv(`${fileName}.csv`, flattenGroups(groups).map((r) => {
      const t = top.get(pairKey(r)) ?? null
      return {
        Line: r.line ?? '', Manager: r.manager ?? '', Rep: r.rep_name ?? '', 'Rep code': r.rep_code ?? '', Box: r.box ?? '',
        'List doctors': r.list_doctors, Covered: r.covered_doctors, 'Coverage %': r.coverage_pct === null ? '' : Number((r.coverage_pct * 100).toFixed(1)),
        'Repeat doctors': r.repeat_doctors, 'Joint visits': r.joint_visits, 'Off-list doctors': r.offlist_doctors, 'Off-list visits': r.offlist_visits,
        'Top speciality': t?.speciality ?? '', 'Top speciality share %': t ? Number((t.share * 100).toFixed(1)) : '',
      }
    }))

  const nCols = COVER_COLS.length + 1
  const sortIcon = (id: ColId) => (sort.id !== id ? <ArrowUpDown className="h-3 w-3 opacity-40" /> : sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)
  const numCell = 'tnum font-bold text-center'
  const countCells = (t: CoverTotal, style?: React.CSSProperties) => (
    <>
      <td className={cn(numCell, 'px-3')} style={style}>{fmtNum(t.list_doctors)}</td>
      <td className={cn(numCell, 'px-3')} style={style}>{fmtNum(t.covered_doctors)}</td>
      <td className="px-3" style={style}><PctBar v={t.coverage_pct} /></td>
      <td className={cn(numCell, 'px-3')} style={style}>{fmtNum(t.repeat_doctors)}</td>
      <td className={cn(numCell, 'px-3')} style={style}>{fmtNum(t.joint_visits)}</td>
      <td className={cn(numCell, 'px-3')} style={style} title={`${fmtNum(t.offlist_visits)} off-list visits`}>{fmtNum(t.offlist_doctors)}</td>
    </>
  )
  const noData = !loading && !cover.error && allRows.length === 0

  return (
    <div className="space-y-3 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]">
      {/* 1. header band */}
      <div className="overflow-hidden rounded-md border bg-white" style={{ borderColor: CPAL.navy }}>
        <div className="flex items-center gap-4 px-4 py-3">
          <Logo />
          <div className="min-w-0 flex-1 text-center">
            <h2 className="text-xl font-bold tracking-wide sm:text-[22px]" style={{ color: CPAL.navy }}>{COVER_TITLE}</h2>
            <p className="mt-0.5 text-sm italic" style={{ color: CPAL.grey }}>{COVER_SUBTITLE}</p>
          </div>
          <div aria-hidden className="hidden w-32 shrink-0 sm:block" />
        </div>
        <div className="px-4 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-white" style={{ backgroundColor: CPAL.green }}>
          {label}
          <span className="ml-3 normal-case">·  Manager: {manager === '' ? 'All managers' : manager}</span>
        </div>
      </div>

      {/* 2. filters */}
      <div className="print:hidden">
        <ReportToolbar
          lines={lines} filters={filters} onFilters={onFilters} managers={managers}
          columns={[]} hidden={new Set()} onToggleColumn={() => undefined}
          canExport={rows.length > 0} onXlsx={exportXlsx} onCsv={exportCsv}
          searchLabel="Search rep name or code" searchPlaceholder="Rep name or code…"
        >
          <PeriodControls mode={mode} onMode={setMode} to={to} onTo={setTo} />
        </ReportToolbar>
      </div>

      {/* 3. four KPI cards */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:grid-cols-4">
          {cards.map((c) => (
            <div key={c.id} className="overflow-hidden rounded-md border" style={{ borderColor: c.head }}>
              <div className="px-3 py-1.5 text-center text-xs font-bold tracking-wide text-white" style={{ backgroundColor: c.head }}>{c.title}</div>
              <div className="px-3 py-3 text-center" style={{ backgroundColor: c.body }}>
                <div className="tnum text-3xl font-bold" style={{ color: c.num }}>{c.value}</div>
                <div className="mt-1 text-xs italic" style={{ color: CPAL.grey }}>{c.caption}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <hr className="border-t" style={{ borderColor: CPAL.beige }} />

      {/* 4. table: Line -> Manager -> rep, manager subtotals, grand total */}
      {cover.error ? (
        <div className="rounded-card border bg-card"><ErrorState message={cover.error} onRetry={cover.reload} /></div>
      ) : (
        <div className="rounded-card border bg-card">
          <div className="max-h-[68vh] min-h-[360px] overflow-auto print:max-h-none print:overflow-visible">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  {COVER_COLS.map((c) => (
                    <th
                      key={c.id} aria-sort={sort.id === c.id ? (sort.desc ? 'descending' : 'ascending') : 'none'}
                      className={cn('sticky top-0 z-20 h-9 whitespace-nowrap border-b px-3 text-xs font-bold text-white', c.numeric ? 'text-center' : 'text-left')}
                      style={{ backgroundColor: CPAL.slate }}
                    >
                      <button onClick={() => toggleSort(c.id)} className="inline-flex items-center gap-1 hover:opacity-80">
                        {c.tip ? (
                          <Tooltip content={<span className="block max-w-64">{c.tip}</span>} side="bottom">
                            <span className="inline-flex items-center gap-1">{c.header}<Info className="h-3 w-3 opacity-60" aria-label={c.tip} /></span>
                          </Tooltip>
                        ) : c.header}
                        {sortIcon(c.id)}
                      </button>
                    </th>
                  ))}
                  <th className="sticky top-0 z-20 h-9 whitespace-nowrap border-b px-3 text-center text-xs font-bold text-white print:hidden" style={{ backgroundColor: CPAL.slate }}>Doctors</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 10 }, (_, r) => <tr key={r}>{Array.from({ length: nCols }, (_, c) => <td key={c} className="h-9 border-b px-3"><Skeleton className="h-4" /></td>)}</tr>)
                  : groups.map((l) => (
                      <Fragment key={l.line}>
                        <tr>
                          <td colSpan={nCols} className="h-8 px-3 text-xs font-bold uppercase tracking-wide text-white" style={{ backgroundColor: CPAL.navy }}>
                            {l.line}
                            <span className="ml-3 font-normal normal-case opacity-90">{fmtPct(l.total.coverage_pct)} coverage · {l.total.reps} reps</span>
                          </td>
                        </tr>
                        {l.managers.map((m) => (
                          <Fragment key={`${l.line}|${m.manager}`}>
                            <tr>
                              <td colSpan={nCols} className="h-7 px-3 text-xs font-bold text-white" style={{ backgroundColor: CPAL.green }}>Manager: {m.manager}</td>
                            </tr>
                            {m.reps.map((r, ri) => {
                              const k = pairKey(r)
                              const isOpen = open.has(k)
                              const t = top.get(k) ?? null
                              const bg = ri % 2 === 1 ? CPAL.zebra : undefined
                              const cell = { color: CPAL.navy, borderBottomColor: CPAL.rowLine, backgroundColor: bg }
                              return (
                                <Fragment key={k}>
                                  <tr
                                    className="cursor-pointer hover:bg-muted/60" tabIndex={0} aria-expanded={isOpen}
                                    onClick={() => toggleOpen(k)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) toggleOpen(k) }}
                                  >
                                    <td className="h-8 whitespace-nowrap border-b px-3 font-medium" style={cell}>
                                      <span className="inline-flex items-center gap-1.5">
                                        {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                                        {r.rep_name ?? '-'}
                                        {r.rep_code && <span className="text-xs font-normal text-muted-foreground">{r.rep_code}</span>}
                                      </span>
                                    </td>
                                    <td className="whitespace-nowrap border-b px-3" style={cell}>{r.box ?? '-'}</td>
                                    <td className={cn(numCell, 'border-b px-3')} style={cell}>{fmtNum(r.list_doctors)}</td>
                                    <td className={cn(numCell, 'border-b px-3')} style={cell}>{fmtNum(r.covered_doctors)}</td>
                                    <td className="border-b px-3" style={cell}><PctBar v={r.coverage_pct} /></td>
                                    <td className={cn(numCell, 'border-b px-3')} style={cell}>{fmtNum(r.repeat_doctors)}</td>
                                    <td className={cn(numCell, 'border-b px-3')} style={cell}>{fmtNum(r.joint_visits)}</td>
                                    <td className={cn(numCell, 'border-b px-3')} style={cell} title={`${fmtNum(r.offlist_visits)} off-list visits`}>{fmtNum(r.offlist_doctors)}</td>
                                    <td className="whitespace-nowrap border-b px-3 text-center" style={cell}>
                                      {t ? <><span className="font-medium">{t.speciality}</span> <span className="tnum font-bold">{fmtPct(t.share)}</span></> : <span className="font-bold">-</span>}
                                    </td>
                                    <td className="border-b px-3 text-center print:hidden" style={cell}>
                                      <Button
                                        size="sm" disabled={r.list_doctors === 0}
                                        onClick={(e) => { e.stopPropagation(); setModal(r) }}
                                        onKeyDown={(e) => e.stopPropagation()}
                                      >
                                        <ListX className="h-4 w-4" /> Not visited doctors
                                      </Button>
                                    </td>
                                  </tr>
                                  {isOpen && <SpecPanel r={r} spec={spec} colSpan={nCols} />}
                                </Fragment>
                              )
                            })}
                            <tr>
                              <td className="h-8 whitespace-nowrap px-3 font-bold" style={{ backgroundColor: CPAL.subBody, color: CPAL.navy }}>Subtotal · {m.manager} ({m.reps.length})</td>
                              <td style={{ backgroundColor: CPAL.subBody }} />
                              {countCells(m.total, { backgroundColor: CPAL.subBody, color: CPAL.navy })}
                              <td style={{ backgroundColor: CPAL.subBody }} />
                              <td className="print:hidden" style={{ backgroundColor: CPAL.subBody }} />
                            </tr>
                          </Fragment>
                        ))}
                      </Fragment>
                    ))}
              </tbody>
              {!loading && rows.length > 0 && (
                <tfoot>
                  <tr style={{ color: CPAL.white }}>
                    <td className="sticky bottom-0 z-10 h-10 whitespace-nowrap border-t-2 px-3 font-bold" style={{ backgroundColor: CPAL.navy, borderTopColor: CPAL.navy }}>TOTAL ({total.reps} reps)</td>
                    <td className="sticky bottom-0 z-10 border-t-2" style={{ backgroundColor: CPAL.navy, borderTopColor: CPAL.navy }} />
                    {[total.list_doctors, total.covered_doctors].map((v, i) => (
                      <td key={i} className={cn(numCell, 'sticky bottom-0 z-10 border-t-2 px-3')} style={{ backgroundColor: CPAL.navy, borderTopColor: CPAL.navy }}>{fmtNum(v)}</td>
                    ))}
                    <td className={cn(numCell, 'sticky bottom-0 z-10 border-t-2 px-3')} style={{ backgroundColor: CPAL.navy, borderTopColor: CPAL.navy }}>{fmtPct(total.coverage_pct)}</td>
                    {[total.repeat_doctors, total.joint_visits, total.offlist_doctors].map((v, i) => (
                      <td key={i} className={cn(numCell, 'sticky bottom-0 z-10 border-t-2 px-3')} style={{ backgroundColor: CPAL.navy, borderTopColor: CPAL.navy }}>{fmtNum(v)}</td>
                    ))}
                    <td className="sticky bottom-0 z-10 border-t-2" style={{ backgroundColor: CPAL.navy, borderTopColor: CPAL.navy }} />
                    <td className="sticky bottom-0 z-10 border-t-2 print:hidden" style={{ backgroundColor: CPAL.navy, borderTopColor: CPAL.navy }} />
                  </tr>
                </tfoot>
              )}
            </table>
            {!loading && rows.length === 0 && (
              <EmptyState
                title={noData ? COVER_EMPTY_TITLE : 'No reps match the filters'}
                description={noData ? COVER_EMPTY_TEXT : 'Clear the search or choose another line / manager.'}
              />
            )}
          </div>
        </div>
      )}

      <p className="text-xs italic" style={{ color: CPAL.grey }}>{COVER_FOOTER}</p>

      <CoverDoctorsModal target={modal} from={range.from} to={range.to} periodText={label} onClose={() => setModal(null)} />
    </div>
  )
}
