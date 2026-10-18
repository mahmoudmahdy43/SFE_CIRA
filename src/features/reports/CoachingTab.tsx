import { lastDayOf, rangeFileSlug } from '../../lib/dateRange'
import { ProfileLink } from '../../components/app/ProfileLink'
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, Info, Minus, ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Input, Skeleton } from '../../components/ui/misc'
import { Tooltip } from '../../components/ui/overlay'
import { EmptyState, ErrorState } from '../../components/app/states'
import { downloadCsv } from '../../lib/csv'
import { downloadXlsxGrids } from '../../lib/xlsxExport'
import {
  fetchCoachingEffect, fetchCoachingRepMonths, fetchCoachingReps, fetchCoachingSkills, fetchCoachingTrend,
} from '../../lib/api/coaching'
import { cn } from '../../lib/utils'
import { useAsync } from '../dashboard/useAsync'
import { EffectCharts, SkillBars, Sparkline, TrendChart } from './CoachingCharts'
import { CoachingRepModal } from './CoachingRepModal'
import { buildRepsGrid, buildSkillsGrid } from './coachingExport'
import {
  COACH_EMPTY_TEXT, COACH_SUBTITLE, COACH_TITLE, DEFAULT_GAP, EVAL_OPTIONS, EVAL_TIP, NO_EVAL, REP_COLS,
  coachKpis, conflictSummary, defaultPeriod, filterReps, fmtInt, fmtScore, fmtShare, fmtSigned, groupRepMonths, higherSide, monthGrid,
  monthName, monthShort, monthsBetween, repManagers, scopeOptions, skillBars, skillCatalog, sortReps, totalReps, weakestByScope, weakestCompanySkill,
  type EvalGroup, type RepColId, type RepSort, type RepSummary, type ScopeType,
} from './coachingMath'
import { CPAL } from './coverageMath'
import { ReportToolbar } from './ReportToolbar'
import type { ReportFilters } from './reportMath'

interface Props {
  month?: string
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

function Section({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white" style={{ backgroundColor: CPAL.navy }}>{title}</h3>
      {caption && <p className="text-xs italic" style={{ color: CPAL.grey }}>{caption}</p>}
      {children}
    </section>
  )
}

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-control border bg-card p-0.5">
      {options.map((o) => (
        <button
          key={o.id} aria-pressed={value === o.id} onClick={() => onChange(o.id)}
          className={cn('rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors', value === o.id && 'bg-accent font-medium text-accent-foreground')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Change({ v }: { v: number | null }) {
  if (v === null) return <span className="text-muted-foreground">—</span>
  const Icon = v === 0 ? Minus : v > 0 ? ArrowUpRight : ArrowDownRight
  const color = v === 0 ? CPAL.grey : v > 0 ? CPAL.green : CPAL.red
  return <span className="tnum inline-flex items-center justify-center gap-0.5 font-bold" style={{ color }}><Icon className="h-4 w-4" aria-hidden />{fmtSigned(v)}</span>
}

const SCOPES: { id: ScopeType; label: string }[] = [{ id: 'COMPANY', label: 'Company' }, { id: 'LINE', label: 'Line' }, { id: 'MANAGER', label: 'Manager' }, { id: 'REP', label: 'Rep' }]
const SCOPE_LABEL: Record<ScopeType, string> = { COMPANY: 'Company', LINE: 'Line', MANAGER: 'Manager', REP: 'Rep' }

export function CoachingTab({ lines, filters, onFilters }: Props) {
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null)
  const [group, setGroup] = useState<EvalGroup>('ALL')
  const [gapText, setGapText] = useState(String(DEFAULT_GAP))
  const [gap, setGap] = useState(DEFAULT_GAP)
  const [scopeType, setScopeType] = useState<ScopeType>('COMPANY')
  const [scopeKey, setScopeKey] = useState('')
  const [scopeSearch, setScopeSearch] = useState('')
  const [sort, setSort] = useState<RepSort>({ id: 'rep', desc: false })
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<RepSummary | null>(null)

  // months that have coaching data -> default period (January of the first year with data -> latest month)
  const monthsQ = useAsync('coach:months', () => fetchCoachingTrend('2000-01-01', '2100-01-01'))
  useEffect(() => {
    const d = monthsQ.data
    if (d) setPeriod((cur) => cur ?? defaultPeriod(d))
  }, [monthsQ.data])

  const ready = period !== null
  const from = period?.from ?? ''
  const to = period?.to ?? ''
  const key = (n: string, extra = '') => (ready ? `coach:${n}:${from}:${to}${extra}` : `coach:${n}:pending`)
  const trendQ = useAsync(key('trend'), () => (ready ? fetchCoachingTrend(from, to) : Promise.resolve([])))
  const skillsQ = useAsync(key('skills', `:${group}`), () => (ready ? fetchCoachingSkills(from, to, group) : Promise.resolve([])))
  const repsQ = useAsync(key('reps', `:${group}:${gap}`), () => (ready ? fetchCoachingReps(from, to, group, gap) : Promise.resolve([])))
  const repMonthsQ = useAsync(key('repmonths', `:${group}`), () => (ready ? fetchCoachingRepMonths(from, to, group) : Promise.resolve([])))
  const effectQ = useAsync(key('effect', `:${group}`), () => (ready ? fetchCoachingEffect(from, to, group) : Promise.resolve([])))

  const loading = !ready || repsQ.loading || skillsQ.loading || trendQ.loading
  const error = monthsQ.error ?? repsQ.error ?? skillsQ.error ?? trendQ.error
  const trend = useMemo(() => trendQ.data ?? [], [trendQ.data])
  const skills = useMemo(() => skillsQ.data ?? [], [skillsQ.data])
  const reps = useMemo(() => repsQ.data ?? [], [repsQ.data])
  const noData = !error && ((monthsQ.data !== null && monthsQ.data.length === 0) || (!loading && trend.length === 0 && reps.every((r) => r.visits === 0)))

  const months = useMemo(() => (ready ? monthsBetween(from, to) : []), [ready, from, to])
  const byRep = useMemo(() => groupRepMonths(repMonthsQ.data ?? []), [repMonthsQ.data])
  const catalog = useMemo(() => skillCatalog(skills), [skills])
  const kpis = useMemo(() => coachKpis(reps), [reps])
  const weakest = useMemo(() => weakestCompanySkill(skills), [skills])

  const lineName = filters.lineId === null ? null : lines.find((l) => l.id === filters.lineId)?.name ?? null
  const managers = useMemo(() => repManagers(reps, lineName), [reps, lineName])
  const manager = managers.includes(filters.manager) ? filters.manager : ''
  const filtered = useMemo(() => filterReps(reps, { line: lineName, manager, search: filters.search }), [reps, lineName, manager, filters.search])
  const sorted = useMemo(() => sortReps(filtered, sort), [filtered, sort])
  const total = useMemo(() => totalReps(filtered), [filtered])
  const conflict = useMemo(() => conflictSummary(filtered), [filtered])
  const conflictRows = useMemo(() => filtered.filter((r) => r.conflict).sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0)), [filtered])
  useEffect(() => setOpen(new Set()), [from, to, group])

  // skills by scope
  const options = useMemo(() => scopeOptions(skills, scopeType, scopeSearch), [skills, scopeType, scopeSearch])
  const effectiveKey = scopeType === 'COMPANY' ? '' : options.some((o) => o.key === scopeKey) ? scopeKey : options[0]?.key ?? ''
  const bars = useMemo(() => skillBars(skills, scopeType, effectiveKey), [skills, scopeType, effectiveKey])
  const scopeTitle = scopeType === 'COMPANY' ? 'Company' : options.find((o) => o.key === effectiveKey)?.name ?? '—'
  const weakRows = useMemo(() => weakestByScope(skills, ['COMPANY', 'LINE', 'MANAGER', 'REP']), [skills])
  const [weakFilter, setWeakFilter] = useState('')
  const weakShown = useMemo(() => { const q = weakFilter.trim().toLowerCase(); return q === '' ? weakRows : weakRows.filter((w) => w.scope_name.toLowerCase().includes(q)) }, [weakRows, weakFilter])

  const periodText = ready ? (from === to ? monthName(from) : `${monthName(from)} – ${monthName(to)}`) : '…'
  const evalText = EVAL_OPTIONS.find((o) => o.id === group)?.label ?? 'All'
  const periodLine = `PERIOD: ${periodText.toUpperCase()}   |   EVALUATORS: ${evalText.toUpperCase()}${lineName ? `   |   LINE: ${lineName.toUpperCase()}` : ''}${manager ? `   |   MANAGER: ${manager.toUpperCase()}` : ''}`
  const fileName = `coaching-${rangeFileSlug(from, lastDayOf(to))}-${group.toLowerCase()}`

  const exportXlsx = () =>
    void downloadXlsxGrids(`${fileName}.xlsx`, [
      buildRepsGrid({ reps: sorted, total, months, byRep, periodLine }),
      buildSkillsGrid({ rows: skills, periodLine }),
    ])
  const exportCsv = () =>
    downloadCsv(`${fileName}.csv`, sorted.map((r) => ({
      Rep: r.rep_name, 'Rep code': r.rep_code ?? '', Line: r.line ?? '', Manager: r.manager ?? '', 'Coaching visits': r.visits,
      'Months evaluated': r.visits > 0 ? r.months_with_eval : '', First: r.first_score ?? '', Last: r.last_score ?? '', Change: r.change ?? '',
      'Training avg': r.training_avg ?? '', 'Manager avg': r.manager_avg ?? '', Gap: r.gap ?? '', Conflict: r.conflict ? 'Yes' : '',
      Evaluators: evalText, ...(r.visits === 0 ? { Note: NO_EVAL } : {}),
    })))

  const commitGap = () => {
    const v = Number(gapText)
    if (Number.isFinite(v) && v >= 0) setGap(v)
    else setGapText(String(gap))
  }
  const toggleSort = (id: RepColId) => setSort((s) => (s.id === id ? { id, desc: !s.desc } : { id, desc: id !== 'rep' && id !== 'line' && id !== 'manager' }))
  const toggleOpen = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const sortIcon = (id: RepColId) => (sort.id !== id ? <ArrowUpDown className="h-3 w-3 opacity-40" /> : sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)

  const cards = [
    { id: 'avg', title: 'COMPANY AVERAGE', head: CPAL.navy, body: CPAL.totalBody, num: CPAL.navy, value: kpis.avg === null ? '—' : `${fmtScore(kpis.avg)} / 5`, caption: `${evalText} evaluators` },
    { id: 'visits', title: 'COACHING VISITS', head: CPAL.teal, body: CPAL.tealBody, num: CPAL.teal, value: fmtInt(kpis.visits), caption: `${trend.length} month${trend.length === 1 ? '' : 's'} with coaching` },
    { id: 'reps', title: 'REPS COACHED', head: CPAL.green, body: CPAL.greenBody, num: CPAL.green, value: fmtInt(kpis.repsCoached), caption: `of ${fmtInt(reps.length)} reps` },
    { id: 'improving', title: '% OF REPS IMPROVING', head: CPAL.slate, body: CPAL.totalBody, num: CPAL.slate, value: fmtShare(kpis.pctImproving), caption: `${fmtInt(kpis.improving)} of ${fmtInt(kpis.eligible)} reps with ≥ 2 visits` },
    { id: 'weak', title: 'WEAKEST COMPANY SKILL', head: CPAL.red, body: CPAL.redBody, num: CPAL.red, value: weakest ? fmtScore(weakest.score) : '—', caption: weakest ? weakest.name : 'no data' },
  ]

  const textCell = { color: CPAL.navy, borderBottomColor: CPAL.rowLine }
  const nCols = REP_COLS.length

  return (
    <div className="space-y-4 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]">
      {/* header band */}
      <div className="overflow-hidden rounded-md border bg-white" style={{ borderColor: CPAL.navy }}>
        <div className="flex items-center gap-4 px-4 py-3">
          <Logo />
          <div className="min-w-0 flex-1 text-center">
            <h2 className="text-xl font-bold tracking-wide sm:text-[22px]" style={{ color: CPAL.navy }}>{COACH_TITLE}</h2>
            <p className="mt-0.5 text-sm italic" style={{ color: CPAL.grey }}>{COACH_SUBTITLE}</p>
          </div>
          <div aria-hidden className="hidden w-32 shrink-0 sm:block" />
        </div>
        <div className="px-4 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-white" style={{ backgroundColor: CPAL.green }}>
          {periodText}<span className="ml-3 normal-case">·  Evaluators: {evalText}</span>
        </div>
      </div>

      {/* controls */}
      <div className="print:hidden">
        <ReportToolbar
          lines={lines} filters={filters} onFilters={onFilters} managers={managers}
          columns={[]} hidden={new Set()} onToggleColumn={() => undefined}
          canExport={sorted.length > 0} onXlsx={exportXlsx} onCsv={exportCsv}
          searchLabel="Search rep name or code" searchPlaceholder="Rep name or code…"
        >
          <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            From
            <Input type="month" aria-label="From month" disabled={!ready} value={from.slice(0, 7)} className="h-9 w-40 text-foreground"
              onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setPeriod((p) => (p ? { from: `${e.target.value}-01`, to: p.to < `${e.target.value}-01` ? `${e.target.value}-01` : p.to } : p)) }} />
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            To
            <Input type="month" aria-label="To month" disabled={!ready} value={to.slice(0, 7)} className="h-9 w-40 text-foreground"
              onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setPeriod((p) => (p ? { from: p.from > `${e.target.value}-01` ? `${e.target.value}-01` : p.from, to: `${e.target.value}-01` } : p)) }} />
          </label>
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Tooltip content={<span className="block max-w-64">{EVAL_TIP}</span>} side="bottom"><span className="inline-flex items-center gap-1">Evaluators <Info className="h-3 w-3 opacity-60" aria-label={EVAL_TIP} /></span></Tooltip>
            <Seg label="Evaluators" value={group} options={EVAL_OPTIONS} onChange={setGroup} />
          </span>
          <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            Conflict gap
            <Input
              type="number" step="0.1" min="0" aria-label="Conflict threshold in points" value={gapText} className="h-9 w-20 text-foreground"
              onChange={(e) => setGapText(e.target.value)} onBlur={commitGap} onKeyDown={(e) => { if (e.key === 'Enter') commitGap() }}
            />
            pts
          </label>
        </ReportToolbar>
      </div>

      {error ? (
        <div className="rounded-card border bg-card"><ErrorState message={error} onRetry={() => { monthsQ.reload(); repsQ.reload(); skillsQ.reload(); trendQ.reload() }} /></div>
      ) : noData ? (
        <div className="rounded-card border bg-card"><EmptyState title="No coaching data" description={COACH_EMPTY_TEXT} /></div>
      ) : (
        <>
          {/* 1. KPI cards */}
          {loading ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-busy="true">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 print:grid-cols-5">
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

          {/* 2. company trend */}
          <Section title="Company trend" caption="Average score by month, all coaching visits (All) and by evaluator group. A month without coaching has no point.">
            {loading ? <Skeleton className="h-72" /> : <div className="rounded-card border bg-card p-3"><TrendChart rows={trend} /></div>}
          </Section>

          {/* 3. skills by scope */}
          <Section title="Skills by scope" caption="The 15 skills, lowest first; the 5 weakest are red; the dark tick on each bar is the company average of that skill.">
            <div className="rounded-card border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
                <Seg label="Scope" value={scopeType} options={SCOPES} onChange={(v) => { setScopeType(v); setScopeKey(''); setScopeSearch('') }} />
                {scopeType !== 'COMPANY' && (
                  <>
                    <Input aria-label={`Search ${SCOPE_LABEL[scopeType].toLowerCase()}`} placeholder={`Search ${SCOPE_LABEL[scopeType].toLowerCase()}…`} value={scopeSearch} onChange={(e) => setScopeSearch(e.target.value)} className="h-9 w-48" />
                    <select aria-label={SCOPE_LABEL[scopeType]} value={effectiveKey} onChange={(e) => setScopeKey(e.target.value)} className="h-9 min-w-52 max-w-xs rounded-control border bg-card px-2 text-sm">
                      {options.length === 0 && <option value="">No match</option>}
                      {options.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                    </select>
                  </>
                )}
              </div>
              <p className="mb-2 text-sm font-bold" style={{ color: CPAL.navy }}>{SCOPE_LABEL[scopeType]}{scopeType === 'COMPANY' ? '' : `: ${scopeTitle}`}</p>
              {loading ? <Skeleton className="h-64" /> : bars.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No skill scores for this selection.</p> : <SkillBars bars={bars} />}
            </div>

            <div className="rounded-card border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
                <h4 className="text-xs font-bold uppercase tracking-wide" style={{ color: CPAL.slate }}>Weakest 5 skills</h4>
                <Input aria-label="Filter weakest skills by name" placeholder="Filter by name…" value={weakFilter} onChange={(e) => setWeakFilter(e.target.value)} className="h-8 w-48 print:hidden" />
              </div>
              <div className="max-h-96 overflow-auto">
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>{['Scope', 'Name', 'Weakest 5 skills'].map((h) => <th key={h} className="sticky top-0 z-10 h-8 px-3 text-left text-xs font-bold text-white" style={{ backgroundColor: CPAL.slate }}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {weakShown.map((w, i) => (
                      <tr key={`${w.scope_type}|${w.scope_key}`} style={i % 2 === 1 ? { backgroundColor: CPAL.zebra } : undefined}>
                        <td className="whitespace-nowrap border-b px-3 py-1.5 text-xs font-bold uppercase" style={textCell}>{SCOPE_LABEL[w.scope_type]}</td>
                        <td className="whitespace-nowrap border-b px-3 py-1.5 font-medium" style={textCell}>{w.scope_name}</td>
                        <td className="border-b px-3 py-1.5" style={{ borderBottomColor: CPAL.rowLine }}>
                          <div className="flex flex-wrap gap-1">
                            {w.skills.map((s) => <span key={s.name} className="rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: CPAL.redBody, color: CPAL.red }}>{s.name} <b className="tnum">{fmtScore(s.score)}</b></span>)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!loading && weakShown.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">No scope matches.</p>}
              </div>
            </div>
          </Section>

          {/* 4. reps table */}
          <Section title="Reps" caption="Click the arrow to open the month grid, the rep name for the full drill-down. Totals are weighted by visits.">
            <div className="rounded-card border bg-card">
              <div className="max-h-[68vh] min-h-[280px] overflow-auto print:max-h-none print:overflow-visible">
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      {REP_COLS.map((c) => (
                        <th key={c.id} aria-sort={sort.id === c.id ? (sort.desc ? 'descending' : 'ascending') : 'none'} className={cn('sticky top-0 z-20 h-9 whitespace-nowrap px-3 text-xs font-bold text-white', c.numeric || c.id === 'trend' || c.id === 'conflict' ? 'text-center' : 'text-left')} style={{ backgroundColor: CPAL.slate }}>
                          {c.sortable ? (
                            <button onClick={() => toggleSort(c.id)} className="inline-flex items-center gap-1 hover:opacity-80">
                              {c.tip ? <Tooltip content={<span className="block max-w-64">{c.tip}</span>} side="bottom"><span className="inline-flex items-center gap-1">{c.header}<Info className="h-3 w-3 opacity-60" aria-label={c.tip} /></span></Tooltip> : c.header}
                              {sortIcon(c.id)}
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1">{c.header}{c.tip && <Tooltip content={<span className="block max-w-64">{c.tip}</span>} side="bottom"><Info className="h-3 w-3 opacity-60" aria-label={c.tip} /></Tooltip>}</span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading
                      ? Array.from({ length: 8 }, (_, r) => <tr key={r}>{Array.from({ length: nCols }, (_, c) => <td key={c} className="h-9 border-b px-3"><Skeleton className="h-4" /></td>)}</tr>)
                      : sorted.map((r, ri) => {
                          const coached = r.visits > 0
                          const isOpen = coached && open.has(r.rep_key)
                          const rm = byRep.get(r.rep_key) ?? []
                          const byMonth = new Map(rm.map((m) => [m.month, m.avg_score]))
                          const bg = ri % 2 === 1 ? CPAL.zebra : undefined
                          const cell = { ...textCell, backgroundColor: bg }
                          const side = higherSide(r)
                          return (
                            <Fragment key={r.rep_key}>
                              <tr className="hover:bg-muted/60">
                                <td className="h-9 whitespace-nowrap border-b px-3 font-medium" style={cell}>
                                  <span className="inline-flex items-center gap-1">
                                    {coached ? (
                                      <button aria-label={isOpen ? 'Hide months' : 'Show months'} aria-expanded={isOpen} onClick={() => toggleOpen(r.rep_key)} className="rounded p-0.5 hover:bg-muted">
                                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                      </button>
                                    ) : <span className="inline-block w-5" />}
                                    {coached ? <button onClick={() => setModal(r)} className="text-left underline-offset-2 hover:underline">{r.rep_name}</button> : r.rep_name}<ProfileLink type="rep" id={r.rep_id} className="ml-1 text-xs font-normal text-muted-foreground">360°</ProfileLink>
                                    {r.rep_code && <span className="text-xs font-normal text-muted-foreground">{r.rep_code}</span>}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap border-b px-3" style={cell}>{r.line ?? '—'}</td>
                                <td className="whitespace-nowrap border-b px-3" style={cell}>{r.manager ?? '—'}</td>
                                {coached ? (
                                  <>
                                    <td className="tnum border-b px-3 text-center font-bold" style={cell}>{fmtInt(r.visits)}</td>
                                    <td className="tnum border-b px-3 text-center font-bold" style={cell}>{fmtInt(r.months_with_eval)}</td>
                                    <td className="tnum border-b px-3 text-center font-bold" style={cell}>{fmtScore(r.first_score)}</td>
                                    <td className="tnum border-b px-3 text-center font-bold" style={cell}>{fmtScore(r.last_score)}</td>
                                    <td className="border-b px-3 text-center" style={cell}><Change v={r.change} /></td>
                                    <td className="border-b px-3" style={cell}><Sparkline months={months} byMonth={byMonth} /></td>
                                    <td className="tnum border-b px-3 text-center font-bold" style={cell}>{fmtScore(r.training_avg)}</td>
                                    <td className="tnum border-b px-3 text-center font-bold" style={cell}>{fmtScore(r.manager_avg)}</td>
                                    <td className="tnum border-b px-3 text-center font-bold" style={cell}>{fmtSigned(r.gap)}</td>
                                    <td className="border-b px-3 text-center" style={cell}>{r.conflict && <span className="rounded-full px-2 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: CPAL.red }} title={side ? `${side} scores higher` : undefined}>Conflict</span>}</td>
                                  </>
                                ) : (
                                  <td colSpan={nCols - 3} className="border-b px-3 text-center text-sm italic" style={{ ...cell, color: CPAL.grey }}>{NO_EVAL}</td>
                                )}
                              </tr>
                              {isOpen && (
                                <tr>
                                  <td colSpan={nCols} className="border-b px-4 py-3" style={{ backgroundColor: CPAL.totalBody, borderBottomColor: CPAL.rowLine }}>
                                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                                      {monthGrid(months, rm).map((m) => (
                                        <div key={m.month} className="rounded-md border bg-white px-2 py-1.5 text-center">
                                          <div className="text-[11px] font-bold uppercase" style={{ color: CPAL.slate }}>{monthShort(m.month)}</div>
                                          {m.score !== null ? (
                                            <><div className="tnum text-base font-bold" style={{ color: CPAL.navy }}>{fmtScore(m.score)}</div><div className="text-[11px] text-muted-foreground">{m.visits} visit{m.visits === 1 ? '' : 's'}</div></>
                                          ) : (
                                            <div className="py-1 text-xs italic text-muted-foreground">{NO_EVAL}</div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          )
                        })}
                  </tbody>
                  {!loading && sorted.length > 0 && (
                    <tfoot>
                      <tr style={{ color: CPAL.white }}>
                        {(() => {
                          const f = 'sticky bottom-0 z-10 h-10 whitespace-nowrap border-t-2 px-3 font-bold'
                          const st = { backgroundColor: CPAL.navy, borderTopColor: CPAL.navy }
                          const num = (v: string, k: string) => <td key={k} className={cn(f, 'tnum text-center')} style={st}>{v}</td>
                          return (
                            <>
                              <td className={f} style={st}>{total.rep_name}</td><td className={f} style={st} /><td className={f} style={st} />
                              {num(fmtInt(total.visits), 'v')}{num('', 'm')}{num(fmtScore(total.first_score), 'f')}{num(fmtScore(total.last_score), 'l')}{num(fmtSigned(total.change), 'c')}
                              <td className={f} style={st} />
                              {num(fmtScore(total.training_avg), 't')}{num(fmtScore(total.manager_avg), 'ma')}{num(fmtSigned(total.gap), 'g')}
                              <td className={f} style={st} />
                            </>
                          )
                        })()}
                      </tr>
                    </tfoot>
                  )}
                </table>
                {!loading && sorted.length === 0 && <EmptyState title="No reps match the filters" description="Clear the search or choose another line / manager." />}
              </div>
            </div>
          </Section>

          {/* 5. Training vs Manager */}
          <Section title="Training vs Manager" caption={`Conflict = Training and Manager averages differ by >= ${gap} points.`}>
            {group !== 'ALL' ? (
              <p className="rounded-card border bg-card px-4 py-6 text-center text-sm text-muted-foreground">Choose “All” evaluators to compare Training with Manager.</p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-[14rem_1fr]">
                <div className="overflow-hidden rounded-md border" style={{ borderColor: CPAL.red }}>
                  <div className="px-3 py-1.5 text-center text-xs font-bold tracking-wide text-white" style={{ backgroundColor: CPAL.red }}>REPS IN CONFLICT</div>
                  <div className="px-3 py-3 text-center" style={{ backgroundColor: CPAL.redBody }}>
                    <div className="tnum text-3xl font-bold" style={{ color: CPAL.red }}>{fmtInt(conflict.conflicts)}</div>
                    <div className="mt-1 text-xs italic" style={{ color: CPAL.grey }}>{fmtShare(conflict.pct)} of {fmtInt(conflict.comparable)} reps with both evaluator groups</div>
                  </div>
                </div>
                <div className="max-h-80 overflow-auto rounded-card border bg-card">
                  <table className="w-full border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr>{['Rep', 'Line', 'Manager', 'Training avg', 'Manager avg', 'Gap', 'Higher'].map((h, i) => <th key={h} className={cn('sticky top-0 z-10 h-8 whitespace-nowrap px-3 text-xs font-bold text-white', i >= 3 ? 'text-center' : 'text-left')} style={{ backgroundColor: CPAL.slate }}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {conflictRows.map((r, i) => (
                        <tr key={r.rep_key} style={i % 2 === 1 ? { backgroundColor: CPAL.zebra } : undefined}>
                          <td className="whitespace-nowrap border-b px-3 py-1.5 font-medium" style={textCell}><button onClick={() => setModal(r)} className="underline-offset-2 hover:underline">{r.rep_name}</button><ProfileLink type="rep" id={r.rep_id} className="ml-1 text-xs font-normal text-muted-foreground">360°</ProfileLink></td>
                          <td className="whitespace-nowrap border-b px-3" style={textCell}>{r.line ?? '—'}</td>
                          <td className="whitespace-nowrap border-b px-3" style={textCell}>{r.manager ?? '—'}</td>
                          <td className="tnum border-b px-3 text-center font-bold" style={textCell}>{fmtScore(r.training_avg)}</td>
                          <td className="tnum border-b px-3 text-center font-bold" style={textCell}>{fmtScore(r.manager_avg)}</td>
                          <td className="tnum border-b px-3 text-center font-bold" style={{ ...textCell, color: CPAL.red }}>{fmtSigned(r.gap)}</td>
                          <td className="border-b px-3 text-center font-bold" style={textCell}>{higherSide(r) ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!loading && conflictRows.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">No rep is in conflict at this threshold.</p>}
                </div>
              </div>
            )}
          </Section>

          {/* 6. does coaching improve reps? */}
          <Section title="Does coaching improve reps?" caption="Observational: reps coached more often tend to start lower, so a smaller gain does not mean coaching does not work.">
            {effectQ.error ? (
              <div className="rounded-card border bg-card"><ErrorState message={effectQ.error} onRetry={effectQ.reload} /></div>
            ) : effectQ.loading ? (
              <Skeleton className="h-40" />
            ) : (effectQ.data ?? []).length === 0 ? (
              <p className="rounded-card border bg-card px-4 py-6 text-center text-sm text-muted-foreground">Not enough data to compare.</p>
            ) : (
              <div className="grid gap-4 rounded-card border bg-card p-4 lg:grid-cols-2">
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>{['Visits per rep', 'Reps', 'Avg visits', 'Avg first', 'Avg last', 'Avg change', '% improved'].map((h, i) => <th key={h} className={cn('h-8 whitespace-nowrap px-2 text-xs font-bold text-white', i === 0 ? 'text-left' : 'text-center')} style={{ backgroundColor: CPAL.slate }}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {(effectQ.data ?? []).map((e, i) => (
                      <tr key={e.band} style={i % 2 === 1 ? { backgroundColor: CPAL.zebra } : undefined}>
                        <td className="h-8 border-b px-2 font-medium" style={textCell}>{e.band}</td>
                        <td className="tnum border-b px-2 text-center font-bold" style={textCell}>{fmtInt(e.reps)}</td>
                        <td className="tnum border-b px-2 text-center" style={textCell}>{e.avg_visits === null ? '—' : e.avg_visits.toFixed(1)}</td>
                        <td className="tnum border-b px-2 text-center" style={textCell}>{fmtScore(e.avg_first)}</td>
                        <td className="tnum border-b px-2 text-center" style={textCell}>{fmtScore(e.avg_last)}</td>
                        <td className="tnum border-b px-2 text-center font-bold" style={textCell}>{fmtSigned(e.avg_change)}</td>
                        <td className="tnum border-b px-2 text-center font-bold" style={textCell}>{fmtShare(e.pct_improved)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <EffectCharts rows={effectQ.data ?? []} />
              </div>
            )}
          </Section>
        </>
      )}

      <CoachingRepModal rep={modal} from={from} to={to} group={group} catalog={catalog} onClose={() => setModal(null)} />
    </div>
  )
}
