import { AlertTriangle } from 'lucide-react'
import { Card } from '../../components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/overlay'
import { BarsChart } from '../../components/app/charts'
import { ProfileLink } from '../../components/app/ProfileLink'
import type { OrgView } from '../../lib/api/org'
import { todayIso } from '../../lib/norm'
import { countListWithoutBox, fetchBoxCoverage, fetchBoxList, fetchBoxOverview, fetchBoxRepHistory, yearMonths, yearStart } from '../../lib/api/profile'
import { useAsync } from '../dashboard/useAsync'
import { fmtPct } from '../dashboard/kpiMath'
import { monthShort } from '../reports/salesMath'
import { boxSegments, vacancyGaps } from './boxHistory'
import { SalesPanel } from './RepProfile'
import { Fact, ProfileHeader, Section, SimpleTable, VacantPill } from './ui'
import { cn } from '../../lib/utils'

function HistoryTab({ boxId }: { boxId: number }) {
  const q = useAsync(`prof:boxhist:${boxId}`, () => fetchBoxRepHistory(boxId))
  return (
    <Section state={q} title="Reps history" description="Who covered the box and when. Gaps between periods are shown as Vacant." isEmpty={(d) => d.length === 0} emptyTitle="No history" emptyText="No rep has been assigned to this box yet.">
      {(periods) => {
        const today = todayIso()
        const segs = boxSegments(periods, today)
        const gaps = vacancyGaps(periods, today)
        const total = Math.max(1, segs.reduce((a, s) => a + (s.days ?? 1), 0))
        return (
          <div className="space-y-4">
            <p className="tnum text-sm text-muted-foreground">{periods.length} rep period{periods.length === 1 ? '' : 's'} · {gaps.length === 0 ? 'no vacant gaps' : `${gaps.length} vacant gap${gaps.length === 1 ? '' : 's'}, ${gaps.reduce((a, g) => a + g.days, 0)} days in total`}</p>
            <ol className="space-y-2">
              {segs.map((s, i) => {
                const pct = Math.max(6, Math.round(((s.days ?? 1) / total) * 100))
                return (
                  <li key={i} className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="tnum w-52 shrink-0 text-xs text-muted-foreground">{s.from} → {s.to ?? 'present'}</span>
                    <div className={cn('flex h-8 min-w-24 items-center rounded-control px-3 text-xs font-medium', s.type === 'vacant' ? 'bg-warning-soft text-warning' : 'bg-primary/15 text-foreground')} style={{ width: `${pct}%` }}>
                      {s.type === 'vacant' ? <>Vacant · {s.days} days</> : <span className="truncate"><ProfileLink type="rep" id={s.repId}>{s.name}</ProfileLink>{s.code ? ` (${s.code})` : ''}{s.days !== null ? ` · ${s.days} days` : ''}</span>}
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        )
      }}
    </Section>
  )
}

function ListTab({ boxId, month }: { boxId: number; month: string }) {
  const cov = useAsync(`prof:boxcov:${boxId}:${month.slice(0, 4)}`, () => fetchBoxCoverage(boxId, yearStart(month), month))
  const list = useAsync(`prof:boxlist:${boxId}:${month}`, () => fetchBoxList(boxId, month))
  const missing = useAsync(`prof:nobox:${month}`, () => countListWithoutBox(month))
  const noRowThisMonth = cov.data !== null && !cov.data.some((r) => r.month === month)
  return (
    <div className="space-y-4">
      {(missing.data ?? 0) > 0 && (
        <Card className="flex items-start gap-3 border-warning/40 bg-warning-soft p-4 text-sm" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <span><b className="tnum">{missing.data}</b> list rows of {month.slice(0, 7)} have no box yet, so this month can look incomplete. Run <code className="rounded bg-muted px-1">select backfill_list_box('{month}');</code> in the SQL Editor.</span>
        </Card>
      )}
      <Section state={cov} title="List and visits per month" description={`${month.slice(0, 4)} — whoever the rep was (box_coverage).`} isEmpty={(d) => d.length === 0} emptyTitle="No coverage rows" emptyText="No month of this year has a list linked to this box yet.">
        {(rows) => (
          <div className="space-y-4">
            <BarsChart xKey="m" suffix="" series={[{ key: 'list', name: 'List doctors' }, { key: 'visited', name: 'Visited' }, { key: 'full', name: 'Fully covered' }]} data={rows.map((r) => ({ m: monthShort(r.month), list: r.list_doctors, visited: r.visited, full: r.fully }))} />
            <SimpleTable
              rows={rows} rowKey={(r) => r.month}
              cols={[
                { h: 'Month', cell: (r) => r.month.slice(0, 7) }, { h: 'Rep', cell: (r) => r.rep ?? <VacantPill /> }, { h: 'List doctors', right: true, cell: (r) => r.list_doctors },
                { h: 'Visited', right: true, cell: (r) => r.visited }, { h: 'Fully covered', right: true, cell: (r) => r.fully }, { h: 'Target visits', right: true, cell: (r) => r.target_visits },
                { h: 'Visits', right: true, cell: (r) => r.visits }, { h: 'Coverage', right: true, cell: (r) => fmtPct(r.list_doctors > 0 ? r.visited / r.list_doctors : null) },
              ]}
            />
            {noRowThisMonth && <p className="text-xs text-muted-foreground">{month.slice(0, 7)} has no row: the list of that month has no box link yet.</p>}
          </div>
        )}
      </Section>
      <Section state={list} title={`List doctors of ${month.slice(0, 7)}`} description="Doctors of the month's list linked to this box, with the visits they received." isEmpty={(d) => d.length === 0} emptyText="No list doctors linked to this box in the selected month.">
        {(rows) => (
          <SimpleTable
            rows={rows} rowKey={(r) => r.doctor_id}
            cols={[
              { h: 'Doctor', cell: (r) => r.doctor }, { h: 'Account', cell: (r) => r.account ?? '—' }, { h: 'Rep', cell: (r) => r.rep ?? '—' }, { h: 'Class', cell: (r) => r.class ?? '—' },
              { h: 'Freq', right: true, cell: (r) => r.freq }, { h: 'Visits', right: true, cell: (r) => r.visits },
            ]}
          />
        )}
      </Section>
    </div>
  )
}

export function BoxProfile({ id, month, org }: { id: number; month: string; org: OrgView }) {
  const box = org.boxById.get(id)
  const ov = useAsync(`prof:boxov:${id}:${month}`, () => fetchBoxOverview(id, month))
  if (!box) return <Card className="p-6 text-sm">No box with id {id}.</Card>
  const o = ov.data
  const mgrId = o?.manager_id ?? [...org.managers].find((m) => m.name === o?.manager)?.id ?? null
  const siblings = mgrId === null ? [] : (org.boxesOfManager.get(mgrId) ?? []).filter((b) => b.id !== id)
  const territoryNames = o?.territories.length ? o.territories : [...org.boxTerritory].filter((bt) => bt.box_id === id && bt.valid_to === null).map((bt) => org.territoryById.get(bt.territory_id)?.name ?? '')
  const line = o?.line ?? org.lineById.get(box.line_id)?.name
  const months = yearMonths(month)
  return (
    <>
      <ProfileHeader name={box.name} role="Box" line={line} status={ov.loading ? null : o?.rep ? null : <VacantPill />}>
        <Fact label="District">{o?.district ?? '—'}</Fact>
        <Fact label="District manager">{ov.loading ? '…' : o?.district_manager ?? <VacantPill what="Vacant" />}</Fact>
        <Fact label="Manager">{ov.loading ? '…' : o?.manager ? (mgrId ? <ProfileLink type="manager" id={mgrId}>{o.manager}</ProfileLink> : o.manager) : <VacantPill what="Vacant" />}</Fact>
        <Fact label="NSM">{o?.nsm ?? '—'}</Fact>
        <Fact label={`Rep (${month.slice(0, 7)})`}>{ov.loading ? '…' : o?.rep ? <ProfileLink type="rep" id={o.rep_id}>{o.rep}</ProfileLink> : <VacantPill />}</Fact>
        <Fact label="Territories">{territoryNames.filter(Boolean).join(', ') || '—'}</Fact>
      </ProfileHeader>
      {ov.error && <Card className="mb-4 p-4 text-sm text-danger" role="alert">Box overview failed: {ov.error}</Card>}
      <Tabs defaultValue="history">
        <TabsList className="mb-4">
          <TabsTrigger value="history">Reps history</TabsTrigger><TabsTrigger value="list">List + Visits</TabsTrigger>
          <TabsTrigger value="sales">Sales history</TabsTrigger><TabsTrigger value="district">Manager + District</TabsTrigger>
        </TabsList>
        <TabsContent value="history"><HistoryTab boxId={id} /></TabsContent>
        <TabsContent value="list"><ListTab boxId={id} month={month} /></TabsContent>
        <TabsContent value="sales"><SalesPanel by="box_id" id={id} month={month} note={`Sales of the box for ${months[0].slice(0, 4)}; months with no rep are marked Vacant.`} /></TabsContent>
        <TabsContent value="district">
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">District</h3>
            <dl className="mb-5 grid gap-3 sm:grid-cols-4">
              <Fact label="District">{o?.district ?? '—'}</Fact><Fact label="District manager">{o?.district_manager ?? '—'}</Fact><Fact label="Manager">{o?.manager ?? '—'}</Fact><Fact label="NSM">{o?.nsm ?? '—'}</Fact>
            </dl>
            <h4 className="mb-2 text-xs font-semibold text-muted-foreground">Other boxes of the same manager (today)</h4>
            {siblings.length === 0 ? <p className="text-sm text-muted-foreground">No other boxes found for this manager.</p> : (
              <SimpleTable rows={siblings} rowKey={(b) => b.id} cols={[{ h: 'Box', cell: (b) => <ProfileLink type="box" id={b.id}>{b.name}</ProfileLink> }, { h: 'Rep', cell: (b) => { const r = org.repOfBox.get(b.id); return r ? <ProfileLink type="rep" id={r.id}>{r.name}</ProfileLink> : <VacantPill /> } }]} />
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </>
  )
}
