import { Card } from '../../components/ui/misc'
import { StatusPill } from '../../components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/overlay'
import { BarsChart } from '../../components/app/charts'
import { ProfileLink } from '../../components/app/ProfileLink'
import { fetchMonthDetail } from '../../lib/api/kpi'
import type { OrgView } from '../../lib/api/org'
import {
  fetchBoxOverview, fetchCoachingGiven, fetchJointFor, fetchManagerCoverageFor, fetchManagerRow, fetchManagerSales, fetchManagerVisits, fetchOrgMonth,
} from '../../lib/api/profile'
import { fmtInt, fmtPct, fmtRate } from '../dashboard/kpiMath'
import { useAsync } from '../dashboard/useAsync'
import { achOf, fmtNum, monthLong, monthShort } from '../reports/salesMath'
import { Fact, ProfileHeader, Section, SimpleTable, VacantPill } from './ui'

function TeamTab({ managerId, month, org }: { managerId: number; month: string; org: OrgView }) {
  const q = useAsync(`prof:team:${managerId}:${month}`, () => fetchMonthDetail(month))
  const orgm = useAsync(`prof:orgm:manager:${managerId}:${month}`, () => fetchOrgMonth('manager_id', managerId, month))
  const vacant = [...new Set((orgm.data ?? []).filter((r) => r.rep_id === null).map((r) => r.box_id))]
  return (
    <div className="space-y-4">
      <Section period="monthly" state={q} title="Team and KPIs" description={`His reps for ${month.slice(0, 7)} with their KPIs (v_kpi_rep), and the manager's own roll-up from v_kpi_manager.`} isEmpty={(d) => !d.reps.some((r) => r.manager_id === managerId)} emptyText="No reps with KPIs under this manager in the month.">
        {(d) => {
          const reps = d.reps.filter((r) => r.manager_id === managerId)
          return (
            <SimpleTable
              rows={reps} rowKey={(r) => r.rep_id} maxHeight={480}
              cols={[
                { h: 'Rep', cell: (r) => <ProfileLink type="rep" id={r.rep_id}>{d.names.reps.get(r.rep_id)?.name ?? `#${r.rep_id}`}</ProfileLink> },
                { h: 'Box', cell: (r) => (r.box_id === null ? '—' : <ProfileLink type="box" id={r.box_id}>{d.names.boxes.get(r.box_id) ?? `#${r.box_id}`}</ProfileLink>) },
                { h: 'Call rate AM', right: true, cell: (r) => fmtRate(r.call_rate_am) }, { h: 'Call rate PM', right: true, cell: (r) => fmtRate(r.call_rate_pm) },
                { h: 'PCF', right: true, cell: (r) => fmtPct(r.pcf) }, { h: 'Coverage', right: true, cell: (r) => fmtPct(r.coverage) },
                { h: 'Valid visits', right: true, cell: (r) => fmtInt(r.valid_visits) }, { h: 'Total KPI', right: true, cell: (r) => <b>{fmtPct(r.total_kpi)}</b> },
              ]}
            />
          )
        }}
      </Section>
      <Section period="monthly" state={q} title="Team averages" description="Computed by the database for the manager (not an average of the rows above)." isEmpty={(d) => !d.managers.some((m) => m.manager_id === managerId)}>
        {(d) => {
          const a = d.managers.find((m) => m.manager_id === managerId)!
          return (
            <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Fact label="Reps">{fmtInt(a.reps)}</Fact><Fact label="Call rate AM">{fmtRate(a.call_rate_am)}</Fact><Fact label="Call rate PM">{fmtRate(a.call_rate_pm)}</Fact>
              <Fact label="PCF">{fmtPct(a.pcf)}</Fact><Fact label="Coverage">{fmtPct(a.coverage)}</Fact><Fact label="Total KPI">{fmtPct(a.total_kpi)}</Fact>
            </dl>
          )
        }}
      </Section>
      <Section period="monthly" state={orgm} title="Vacant boxes of the district" isEmpty={() => vacant.length === 0} emptyTitle="No vacant boxes" emptyText="Every box of this district has a rep in the month.">
        {() => <ul className="flex flex-wrap gap-2">{vacant.map((b) => <li key={b}><ProfileLink type="box" id={b}><VacantPill what={org.boxById.get(b)?.name ?? `Box #${b}`} /></ProfileLink></li>)}</ul>}
      </Section>
    </div>
  )
}

function JointTab({ managerId, month }: { managerId: number; month: string }) {
  const row = useAsync(`prof:mrow:${managerId}:${month}`, () => fetchManagerRow(managerId, month))
  const joint = useAsync(`prof:joint:mgr:${managerId}:${month}`, () => fetchJointFor('manager', managerId, month))
  const cov = useAsync(`prof:mcov:${managerId}:${month}`, () => fetchManagerCoverageFor(managerId, month))
  return (
    <div className="space-y-4">
      <Section period="monthly" state={row} title="Manager report" description="His row of the Manager report." isEmpty={(d) => d === null} emptyText="No Manager report row for this month.">
        {(r) => r && (
          <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Fact label="Field days">{r.field_days}</Fact><Fact label="Working days">{r.working_days}</Fact><Fact label="Single visits">{r.single_visits}</Fact>
            <Fact label="Double visits">{r.double_visits}</Fact><Fact label="Call rate AM">{fmtRate(r.call_rate_am)}</Fact><Fact label="Call rate PM">{fmtRate(r.call_rate_pm)}</Fact>
          </dl>
        )}
      </Section>
      <Section period="monthly" state={joint} title="Joint days per rep" isEmpty={(d) => d.length === 0} emptyText="No joint days this month.">
        {(rows) => (
          <SimpleTable
            rows={rows} rowKey={(r) => r.rep_id}
            cols={[
              { h: 'Rep', cell: (r) => <ProfileLink type="rep" id={r.rep_id}>{r.rep_name ?? '—'}</ProfileLink> }, { h: 'Box', cell: (r) => r.box ?? '—' },
              { h: 'Joint days', right: true, cell: (r) => r.joint_days ?? '—' }, { h: 'Rep visits', right: true, cell: (r) => r.rep_total },
              { h: 'Joint visits', right: true, cell: (r) => r.joint_total }, { h: 'Cover', right: true, cell: (r) => fmtPct(r.cover_total) },
            ]}
          />
        )}
      </Section>
      <Section period="monthly" state={cov} title="Manager coverage" description="How many of the team's list doctors he covered." isEmpty={(d) => d.length === 0} emptyText="No Manager Coverage rows for this month.">
        {(rows) => (
          <SimpleTable
            rows={rows} rowKey={(r) => r.rep_id}
            cols={[
              { h: 'Rep', cell: (r) => <ProfileLink type="rep" id={r.rep_id}>{r.rep_name ?? '—'}</ProfileLink> }, { h: 'List doctors', right: true, cell: (r) => r.list_doctors },
              { h: 'Covered', right: true, cell: (r) => r.covered_doctors }, { h: 'Coverage', right: true, cell: (r) => fmtPct(r.coverage_pct) },
              { h: 'Joint visits', right: true, cell: (r) => r.joint_visits }, { h: 'Off-list doctors', right: true, cell: (r) => r.offlist_doctors },
            ]}
          />
        )}
      </Section>
    </div>
  )
}

function SalesTab({ managerId, month }: { managerId: number; month: string }) {
  const q = useAsync(`prof:msales:${managerId}:${month}`, () => fetchManagerSales(managerId, month))
  return (
    <Section period="monthly" state={q} title="District sales" description={`Monthly sales against target for January to ${monthShort(month)}; reps, territories and products for ${monthLong(month)}.`} isEmpty={(d) => d.monthly.length === 0} emptyTitle="No sales" emptyText="No sales for this district in the period.">
      {(d) => (
        <div className="space-y-5">
          <BarsChart xKey="m" suffix="" series={[{ key: 's', name: 'Sales' }, { key: 't', name: 'Target' }]} data={d.monthly.map((m) => ({ m: monthShort(m.month), s: Math.round(m.s_value), t: Math.round(m.t_value) }))} />
          <SimpleTable rows={d.monthly} rowKey={(m) => m.month} maxHeight={300} cols={[{ h: 'Month', cell: (m) => monthLong(m.month) }, { h: 'Sales', right: true, cell: (m) => fmtNum(m.s_value) }, { h: 'Target', right: true, cell: (m) => fmtNum(m.t_value) }, { h: 'Achievement', right: true, cell: (m) => fmtPct(achOf(m.s_value_tgt, m.t_value)) }]} />
          <div className="grid gap-4 xl:grid-cols-2">
            <div><h4 className="mb-2 text-xs font-semibold text-muted-foreground">Per rep</h4>
              <SimpleTable rows={d.reps} rowKey={(r) => r.key_id} maxHeight={320} cols={[{ h: 'Rep', cell: (r) => <ProfileLink type="rep" id={Number(r.key_id)}>{r.key_name}</ProfileLink> }, { h: 'Sales', right: true, cell: (r) => fmtNum(r.s_value) }, { h: 'Target', right: true, cell: (r) => fmtNum(r.t_value) }, { h: 'Gap', right: true, cell: (r) => fmtNum(r.gap) }]} /></div>
            <div><h4 className="mb-2 text-xs font-semibold text-muted-foreground">Per territory</h4>
              <SimpleTable rows={d.territories} rowKey={(r) => r.key_id} maxHeight={320} cols={[{ h: 'Territory', cell: (r) => r.key_name }, { h: 'Sales', right: true, cell: (r) => fmtNum(r.s_value) }, { h: 'Target', right: true, cell: (r) => fmtNum(r.t_value) }, { h: 'Gap', right: true, cell: (r) => fmtNum(r.gap) }]} /></div>
          </div>
          <div><h4 className="mb-2 text-xs font-semibold text-muted-foreground">Per product</h4>
            <SimpleTable rows={d.products} rowKey={(p) => p.product_id} maxHeight={320} cols={[{ h: 'Product', cell: (p) => p.product_name }, { h: 'Sales', right: true, cell: (p) => fmtNum(p.s_value) }, { h: 'Target', right: true, cell: (p) => fmtNum(p.t_value) }, { h: 'Achievement', right: true, cell: (p) => fmtPct(achOf(p.s_value_tgt, p.t_value)) }]} /></div>
        </div>
      )}
    </Section>
  )
}

function OwnTab({ managerId, name, month }: { managerId: number; name: string; month: string }) {
  const given = useAsync(`prof:given:${managerId}:${month}`, () => fetchCoachingGiven(name, month))
  const visits = useAsync(`prof:mvisits:${managerId}:${month}`, () => fetchManagerVisits(managerId, month))
  return (
    <div className="space-y-4">
      <Section period="monthly" state={given} title="Coaching given" description={`Evaluations he gave as evaluator, January to ${monthShort(month)} (manager evaluations).`} isEmpty={(d) => d.length === 0} emptyText="No coaching evaluations given in the period.">
        {(rows) => <SimpleTable rows={rows} rowKey={(r, i) => `${r.rep}-${r.visit_date}-${i}`} maxHeight={300} cols={[{ h: 'Date', cell: (r) => r.visit_date ?? '—' }, { h: 'Rep', cell: (r) => r.rep }, { h: 'Avg score', right: true, cell: (r) => r.avg_score?.toFixed(2) ?? '—' }]} />}
      </Section>
      <Section period="monthly" state={visits} title="Own visits" description={`${month.slice(0, 7)} — visits recorded under his own code.`} isEmpty={(d) => d.length === 0} emptyText="No visits recorded for him in the month.">
        {(rows) => <SimpleTable rows={rows} rowKey={(_, i) => i} cols={[{ h: 'Date', cell: (v) => v.visit_date }, { h: 'Shift', cell: (v) => v.shift }, { h: 'Type', cell: (v) => v.visit_type ?? '—' }, { h: 'Doctor', cell: (v) => v.doctor ?? '—' }, { h: 'Account', cell: (v) => v.account ?? '—' }, { h: 'Territory', cell: (v) => v.territory ?? '—' }]} />}
      </Section>
    </div>
  )
}

export function ManagerProfile({ id, month, org }: { id: number; month: string; org: OrgView }) {
  const m = org.managerById.get(id)
  const orgm = useAsync(`prof:orgm:manager:${id}:${month}`, () => fetchOrgMonth('manager_id', id, month))
  const boxIds = [...new Set((orgm.data ?? []).map((r) => r.box_id))]
  const districts = useAsync(`prof:districts:${id}:${month}`, async () => {
    const ov = await Promise.all(boxIds.slice(0, 12).map((b) => fetchBoxOverview(b, month).catch(() => null)))
    return [...new Set(ov.flatMap((o) => (o?.district ? [o.district] : [])))]
  })
  if (!m) return <Card className="p-6 text-sm">No manager with id {id}.</Card>
  const reps = new Set((orgm.data ?? []).flatMap((r) => (r.rep_id === null ? [] : [r.rep_id])))
  const vacant = new Set((orgm.data ?? []).filter((r) => r.rep_id === null).map((r) => r.box_id))
  const line = orgm.data?.[0] ? org.lineById.get(orgm.data[0].line_id)?.name : null
  return (
    <>
      <ProfileHeader name={m.name} code={m.code} role="District Manager" line={line} status={<StatusPill status={m.status} />}>
        <Fact label="District(s)">{districts.data?.join(', ') || (districts.loading || orgm.loading ? '…' : '—')}</Fact>
        <Fact label="Boxes">{boxIds.length}</Fact>
        <Fact label="Reps">{orgm.loading ? '…' : reps.size}</Fact>
        <Fact label="Vacant boxes">{orgm.loading ? '…' : vacant.size > 0 ? <VacantPill what={`${vacant.size} vacant`} /> : 0}</Fact>
        <Fact label="Hire date">{m.hire_date ?? '—'}</Fact>
      </ProfileHeader>
      <Tabs defaultValue="team">
        <TabsList className="mb-4">
          <TabsTrigger value="team">Team + KPIs</TabsTrigger><TabsTrigger value="joint">Joint days + Coverage</TabsTrigger>
          <TabsTrigger value="sales">District sales</TabsTrigger><TabsTrigger value="own">Coaching + own visits</TabsTrigger>
        </TabsList>
        <TabsContent value="team"><TeamTab managerId={id} month={month} org={org} /></TabsContent>
        <TabsContent value="joint"><JointTab managerId={id} month={month} /></TabsContent>
        <TabsContent value="sales"><SalesTab managerId={id} month={month} /></TabsContent>
        <TabsContent value="own"><OwnTab managerId={id} name={m.name} month={month} /></TabsContent>
      </Tabs>
    </>
  )
}
