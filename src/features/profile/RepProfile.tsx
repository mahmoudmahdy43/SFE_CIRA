import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Badge, Card } from '../../components/ui/misc'
import { Button } from '../../components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/overlay'
import { KpiCard } from '../../components/app/KpiCard'
import { BarsChart, MiniLine } from '../../components/app/charts'
import { ProfileLink } from '../../components/app/ProfileLink'
import { StatusPill } from '../../components/ui/misc'
import type { OrgView } from '../../lib/api/org'
import { downloadCsv } from '../../lib/csv'
import { kpiTone } from '../../lib/kpi'
import {
  fetchOrgMonth, fetchRepCoaching, fetchRepDays, fetchRepKpiYear, fetchRepList, fetchRepSpecMix, fetchSalesCube, fetchJointFor, yearMonths, type DaySlot, type RepMonthKpi,
} from '../../lib/api/profile'
import { deltaPts, fmtInt, fmtPct, fmtRate } from '../dashboard/kpiMath'
import { useAsync } from '../dashboard/useAsync'
import { monthLong, monthShort, fmtNum } from '../reports/salesMath'
import { salesByMonth, salesByProduct } from './salesFold'
import { Fact, ProfileHeader, Section, SimpleTable, VacantPill } from './ui'
import { cn } from '../../lib/utils'

/* ------------------------------------------------ KPIs + trend ------------------------------------------------ */
interface KpiSpec { key: string; label: string; kind: 'pct' | 'rate' | 'int'; get: (k: RepMonthKpi) => number | null; tip?: string }
const KPIS: KpiSpec[] = [
  { key: 'cr_am', label: 'Call Rate AM', kind: 'rate', get: (k) => k.call_rate_am },
  { key: 'cr_pm', label: 'Call Rate PM', kind: 'rate', get: (k) => k.call_rate_pm },
  { key: 'pcf', label: 'PCF', kind: 'pct', get: (k) => k.pcf, tip: 'Valid visits / expected visits' },
  { key: 'cov', label: 'Coverage', kind: 'pct', get: (k) => k.coverage, tip: 'Covered list doctors / list doctors' },
  { key: 'tv', label: 'Total visits', kind: 'int', get: (k) => k.total_visits },
  { key: 'vv', label: 'Valid visits', kind: 'int', get: (k) => k.valid_visits },
  { key: 'fd', label: 'Field days', kind: 'int', get: (k) => k.field_days },
]
const fmtKpi = (s: KpiSpec, v: number | null) => (v === null ? '—' : s.kind === 'pct' ? fmtPct(v) : s.kind === 'rate' ? fmtRate(v) : fmtInt(v))

function KpiTab({ repId, month }: { repId: number; month: string }) {
  const q = useAsync(`prof:kpi:${repId}:${month.slice(0, 4)}`, () => fetchRepKpiYear(repId, month))
  const months = useMemo(() => yearMonths(month), [month])
  return (
    <Section state={q} title="KPIs and trend" description={`All months of ${month.slice(0, 4)}. Months where the rep did not occupy a box are blank.`} isEmpty={(d) => d.every((x) => x === null)} emptyTitle="No KPI rows" emptyText="This rep has no KPI rows in this year.">
      {(series) => {
        const idx = months.indexOf(month)
        const cur = series[idx] ?? null
        const prev = idx > 0 ? series[idx - 1] ?? null : null
        return (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {KPIS.map((s) => {
                const v = cur ? s.get(cur) : null
                const pv = prev ? s.get(prev) : null
                const delta = v === null || pv === null ? undefined : s.kind === 'pct' ? deltaPts(v, pv) ?? undefined : Math.round((v - pv) * 100) / 100
                return (
                  <KpiCard
                    key={s.key} label={s.label} tooltip={s.tip} empty={v === null} value={fmtKpi(s, v)} delta={delta}
                    deltaSuffix={s.kind === 'pct' ? ' pts' : ''} deltaDecimals={s.kind === 'int' ? 0 : s.kind === 'rate' ? 2 : 1}
                    tone={s.kind === 'pct' && v !== null ? kpiTone(v, 1) : 'neutral'}
                  />
                )
              })}
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {KPIS.map((s) => (
                <Card key={s.key} className="p-3">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">{s.label}</div>
                  <MiniLine
                    name={s.label} xKey="m" yKey="v" suffix={s.kind === 'pct' ? '%' : ''}
                    data={months.map((m, i) => {
                      const k = series[i]
                      const v = k ? s.get(k) : null
                      return { m: monthShort(m), v: v === null ? null : s.kind === 'pct' ? Math.round(v * 1000) / 10 : Math.round(v * 100) / 100 }
                    })}
                  />
                </Card>
              ))}
            </div>
          </div>
        )
      }}
    </Section>
  )
}

/* ------------------------------------------------ List + coverage ------------------------------------------------ */
const STATUS_TONE = { fully: 'success', partially: 'warning', not_visited: 'danger' } as const
const STATUS_TEXT = { fully: 'Fully', partially: 'Partially', not_visited: 'Not visited' } as const

function ListTab({ repId, month }: { repId: number; month: string }) {
  const list = useAsync(`prof:list:${repId}:${month}`, () => fetchRepList(repId, month))
  const mix = useAsync(`prof:mix:${repId}:${month}`, () => fetchRepSpecMix(repId, month))
  const [cls, setCls] = useState('')
  const [spec, setSpec] = useState('')
  const [status, setStatus] = useState('')
  const rows = (list.data ?? []).filter((d) => (!cls || d.class === cls) && (!spec || d.speciality === spec) && (!status || d.status === status))
  const classes = [...new Set((list.data ?? []).map((d) => d.class).filter((x): x is string => !!x))].sort()
  const specs = [...new Set((list.data ?? []).map((d) => d.speciality).filter((x): x is string => !!x))].sort()
  const count = (s: string) => rows.filter((d) => d.status === s).length
  const sel = 'h-9 rounded-control border bg-card px-2 text-sm'
  return (
    <div className="space-y-4">
      <Section
        state={list} title="List and coverage" description={`The rep's list for ${month.slice(0, 7)} and how each doctor was visited.`}
        isEmpty={(d) => d.length === 0} emptyTitle="No list for this month" emptyText="The rep has no list doctors in the selected month."
        actions={<Button size="sm" disabled={rows.length === 0} onClick={() => downloadCsv(`rep-${repId}-list-${month.slice(0, 7)}.csv`, rows.map((d) => ({ Doctor: d.doctor_name, Account: d.account_name, Speciality: d.speciality, Class: d.class, Freq: d.freq, Visits: d.visits, Status: STATUS_TEXT[d.status] })))}><Download className="h-4 w-4" aria-hidden /> CSV</Button>}
      >
        {() => (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Class" className={sel} value={cls} onChange={(e) => setCls(e.target.value)}><option value="">All classes</option>{classes.map((c) => <option key={c}>{c}</option>)}</select>
              <select aria-label="Speciality" className={sel} value={spec} onChange={(e) => setSpec(e.target.value)}><option value="">All specialities</option>{specs.map((c) => <option key={c}>{c}</option>)}</select>
              <select aria-label="Status" className={sel} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{Object.entries(STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <span className="tnum ml-auto text-xs text-muted-foreground">{rows.length} doctors · {count('fully')} fully · {count('partially')} partially · {count('not_visited')} not visited</span>
            </div>
            <SimpleTable
              rows={rows} rowKey={(d) => d.doctor_id}
              cols={[
                { h: 'Doctor', cell: (d) => d.doctor_name }, { h: 'Account', cell: (d) => d.account_name ?? '—' }, { h: 'Speciality', cell: (d) => d.speciality ?? '—' },
                { h: 'Class', cell: (d) => d.class ?? '—' }, { h: 'Freq', right: true, cell: (d) => d.freq ?? '—' }, { h: 'Visits', right: true, cell: (d) => d.visits },
                { h: 'Status', cell: (d) => <Badge tone={STATUS_TONE[d.status]}>{STATUS_TEXT[d.status]}</Badge> },
              ]}
            />
          </div>
        )}
      </Section>
      <Section
        state={mix} title="Speciality mix of the list" description="Share of the list per speciality against the line strategy (the Speciality Mix view)."
        isEmpty={(d) => d.length === 0} emptyText="No speciality mix for this rep and month."
      >
        {(rows) => (
          <SimpleTable
            rows={rows} rowKey={(r) => String(r.speciality)}
            cols={[
              { h: 'Speciality', cell: (r) => String(r.speciality ?? '—') }, { h: 'Doctors', right: true, cell: (r) => fmtInt(Number(r.doctors)) },
              { h: 'List share', right: true, cell: (r) => (r.share_pct == null ? '—' : `${Number(r.share_pct).toFixed(1)}%`) },
              { h: 'Strategy', right: true, cell: (r) => (r.strategy_pct == null ? '—' : `${Number(r.strategy_pct).toFixed(1)}%`) },
              { h: 'Diff (pts)', right: true, cell: (r) => <span className={cn(r.is_off === true && 'font-semibold text-danger')}>{r.diff_points == null ? '—' : `${Number(r.diff_points) > 0 ? '+' : ''}${Number(r.diff_points).toFixed(1)}`}</span> },
            ]}
          />
        )}
      </Section>
    </div>
  )
}

/* ------------------------------------------------ Sales ------------------------------------------------ */
export function SalesPanel({ by, id, month, note }: { by: 'rep_id' | 'box_id'; id: number; month: string; note: string }) {
  const q = useAsync(`prof:sales:${by}:${id}:${month.slice(0, 4)}`, () => fetchSalesCube(by, id, month))
  const months = useMemo(() => yearMonths(month), [month])
  return (
    <Section state={q} title="Sales" description={note} isEmpty={(d) => d.length === 0} emptyTitle="No sales" emptyText="No sales rows for this year.">
      {(rows) => {
        const monthly = salesByMonth(rows, months).filter((m) => m.hasData)
        const products = salesByProduct(rows, monthly.map((m) => m.month)).slice(0, 10)
        const ytdS = monthly.reduce((a, m) => a + m.sales, 0)
        const ytdT = monthly.reduce((a, m) => a + m.target, 0)
        return (
          <div className="space-y-5">
            <BarsChart xKey="m" suffix="" series={[{ key: 'sales', name: 'Sales' }, { key: 'target', name: 'Target' }]} data={monthly.map((m) => ({ m: monthShort(m.month), sales: Math.round(m.sales), target: Math.round(m.target) }))} />
            <SimpleTable
              rows={monthly} rowKey={(m) => m.month} maxHeight={320}
              cols={[
                { h: 'Month', cell: (m) => <>{monthLong(m.month)} {m.vacant && <VacantPill />}</> },
                { h: 'Sales', right: true, cell: (m) => fmtNum(m.sales) }, { h: 'Target', right: true, cell: (m) => fmtNum(m.target) },
                { h: 'Achievement', right: true, cell: (m) => fmtPct(m.ach) }, { h: 'Gap', right: true, cell: (m) => fmtNum(m.gap) },
              ]}
            />
            <p className="tnum text-xs text-muted-foreground">Year to date: sales {fmtNum(ytdS)} · target {fmtNum(ytdT)} · achievement {fmtPct(ytdT > 0 ? ytdS / ytdT : null)}</p>
            <div>
              <h4 className="mb-2 text-xs font-semibold text-muted-foreground">Top products (months above)</h4>
              <SimpleTable rows={products} rowKey={(p) => p.product} maxHeight={300} cols={[{ h: 'Product', cell: (p) => p.product }, { h: 'Sales', right: true, cell: (p) => fmtNum(p.sales) }, { h: 'Target', right: true, cell: (p) => fmtNum(p.target) }, { h: 'Achievement', right: true, cell: (p) => fmtPct(p.ach) }, { h: 'Gap', right: true, cell: (p) => fmtNum(p.gap) }]} />
            </div>
          </div>
        )
      }}
    </Section>
  )
}

/* ------------------------------------------------ Absence + coaching ------------------------------------------------ */
const DAY_TONE: Record<string, string> = {
  worked: 'bg-success-soft text-success', leave: 'bg-warning-soft text-warning', office_work: 'bg-accent text-accent-foreground',
  activity: 'bg-accent text-accent-foreground', missing: 'bg-danger-soft text-danger',
}
const DAY_TEXT: Record<string, string> = { worked: 'Worked', leave: 'Leave', office_work: 'Office work', activity: 'Activity', missing: 'Missing' }

function DayCalendar({ slots, month }: { slots: DaySlot[]; month: string }) {
  const days = [...new Set(slots.map((s) => s.day))].sort()
  const at = (d: string, sh: 'AM' | 'PM') => slots.find((s) => s.day === d && s.shift === sh)
  const first = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)).getUTCDay()
  const counts = (st: string) => slots.filter((s) => s.status === st).length
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {Object.entries(DAY_TEXT).map(([k, v]) => <span key={k} className="flex items-center gap-1.5"><span aria-hidden className={cn('h-2.5 w-2.5 rounded-sm', DAY_TONE[k].split(' ')[0])} />{v}: <b className="tnum">{counts(k)}</b> slots</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-center text-xs" role="grid" aria-label="Day calendar, AM and PM">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="text-muted-foreground">{d}</div>)}
        {Array.from({ length: first }, (_, i) => <div key={`b${i}`} />)}
        {days.map((d) => (
          <div key={d} className="rounded-control border p-1">
            <div className="tnum text-[11px] text-muted-foreground">{Number(d.slice(8))}</div>
            {(['AM', 'PM'] as const).map((sh) => {
              const s = at(d, sh)
              return <div key={sh} title={s ? `${d} ${sh}: ${DAY_TEXT[s.status] ?? s.status}${s.visits ? ` (${s.visits} visits)` : ''}` : `${sh}: no slot`} className={cn('mt-0.5 rounded px-1 py-0.5 text-[10px] font-medium', s ? DAY_TONE[s.status] ?? 'bg-muted' : 'bg-muted/40 text-muted-foreground')}>{sh}{s?.visits ? ` ${s.visits}` : ''}</div>
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function AbsenceTab({ repId, month }: { repId: number; month: string }) {
  const days = useAsync(`prof:days:${repId}:${month}`, () => fetchRepDays(repId, month))
  const joint = useAsync(`prof:joint:rep:${repId}:${month}`, () => fetchJointFor('rep', repId, month))
  const coach = useAsync(`prof:coach:${repId}:${month}`, () => fetchRepCoaching(repId, month))
  return (
    <div className="space-y-4">
      <Section state={days} title="Day calendar" description={`${month.slice(0, 7)} — worked, leave, office work, activity and missing days, AM and PM.`} isEmpty={(d) => d.length === 0} emptyText="No working slots for this rep in the month.">
        {(d) => <DayCalendar slots={d} month={month} />}
      </Section>
      <Section state={joint} title="Joint days" description="Days the rep worked with a manager, Field Trainer or other staff (Manager Joint Days data)." isEmpty={(d) => d.length === 0} emptyText="No joint days this month.">
        {(rows) => (
          <SimpleTable
            rows={rows} rowKey={(r, i) => `${r.manager_id}-${i}`}
            cols={[
              { h: 'With', cell: (r) => <ProfileLink type="manager" id={r.manager_id}>{r.manager ?? '—'}</ProfileLink> }, { h: 'Joint days', right: true, cell: (r) => r.joint_days ?? '—' },
              { h: 'Joint AM / PM', right: true, cell: (r) => `${r.joint_am} / ${r.joint_pm}` }, { h: 'Rep visits', right: true, cell: (r) => r.rep_total },
              { h: 'Joint visits', right: true, cell: (r) => r.joint_total }, { h: 'Cover', right: true, cell: (r) => fmtPct(r.cover_total) },
            ]}
          />
        )}
      </Section>
      <Section state={coach} title="Coaching" description={`Coaching visits and scores, January to ${monthShort(month)}.`} isEmpty={(d) => d.summary === null} emptyTitle="No coaching" emptyText="No coaching evaluations for this rep in the period.">
        {({ summary, visits }) => (
          <div className="space-y-3">
            <dl className="grid gap-3 sm:grid-cols-4">
              <Fact label="Coaching visits">{summary?.visits}</Fact><Fact label="Average score">{summary?.avg_score?.toFixed(2)}</Fact>
              <Fact label="Last score">{summary?.last_score?.toFixed(2)}</Fact><Fact label="Change">{summary?.change == null ? '—' : `${summary.change > 0 ? '+' : ''}${summary.change.toFixed(2)}`}</Fact>
            </dl>
            <SimpleTable rows={visits} rowKey={(v) => v.visit_id} maxHeight={280} cols={[{ h: 'Date', cell: (v) => v.visit_date ?? '—' }, { h: 'Evaluator', cell: (v) => v.evaluator ?? '—' }, { h: 'Group', cell: (v) => v.eval_group }, { h: 'Avg score', right: true, cell: (v) => v.avg_score?.toFixed(2) ?? '—' }]} />
          </div>
        )}
      </Section>
    </div>
  )
}

/* ------------------------------------------------ page ------------------------------------------------ */
export function RepProfile({ id, month, org }: { id: number; month: string; org: OrgView }) {
  const rep = org.repById.get(id)
  const om = useAsync(`prof:orgm:rep:${id}:${month}`, () => fetchOrgMonth('rep_id', id, month))
  if (!rep) return <Card className="p-6 text-sm">No rep with id {id}.</Card>
  const rows = om.data ?? []
  const box = rows[0] ? org.boxById.get(rows[0].box_id) : undefined
  const mgr = rows.find((r) => r.manager_id !== null)
  const manager = mgr?.manager_id != null ? org.managerById.get(mgr.manager_id) : undefined
  const nsm = rows.find((r) => r.nsm_id !== null)
  const nsmName = nsm?.nsm_id != null ? org.nsmById.get(nsm.nsm_id)?.name : undefined
  const territories = rows.map((r) => org.territoryById.get(r.territory_id)?.name).filter(Boolean).join(', ')
  return (
    <>
      <ProfileHeader name={rep.name} code={rep.code} role="Medical Rep" line={box ? org.lineById.get(box.line_id)?.name : null} status={<StatusPill status={rep.status} />}>
        <Fact label={`Box (${month.slice(0, 7)})`}>{box ? <ProfileLink type="box" id={box.id}>{box.name}</ProfileLink> : om.loading ? '…' : <VacantPill what="No box this month" />}</Fact>
        <Fact label="Territories">{territories || '—'}</Fact>
        <Fact label="Manager">{manager ? <ProfileLink type="manager" id={manager.id}>{manager.name}</ProfileLink> : om.loading ? '…' : <VacantPill what="Manager vacant" />}</Fact>
        <Fact label="NSM">{nsmName ?? '—'}</Fact>
        <Fact label="Hire date">{rep.hire_date ?? '—'}</Fact>
      </ProfileHeader>
      <Tabs defaultValue="kpi">
        <TabsList className="mb-4">
          <TabsTrigger value="kpi">KPIs + Trend</TabsTrigger><TabsTrigger value="list">List + Coverage</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger><TabsTrigger value="absence">Absence + Coaching</TabsTrigger>
        </TabsList>
        <TabsContent value="kpi"><KpiTab repId={id} month={month} /></TabsContent>
        <TabsContent value="list"><ListTab repId={id} month={month} /></TabsContent>
        <TabsContent value="sales"><SalesPanel by="rep_id" id={id} month={month} note="Sales belong to the box; shown for the months of this rep." /></TabsContent>
        <TabsContent value="absence"><AbsenceTab repId={id} month={month} /></TabsContent>
      </Tabs>
    </>
  )
}
