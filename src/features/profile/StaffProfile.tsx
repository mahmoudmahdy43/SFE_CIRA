import { Card } from '../../components/ui/misc'
import { fetchCoachingGiven, fetchStaffDetail, fetchStaffInfo, fetchStaffMonths, pick } from '../../lib/api/profile'
import { useAsync } from '../dashboard/useAsync'
import { monthShort } from '../reports/salesMath'
import { Fact, ProfileHeader, RawTable, Section, SimpleTable } from './ui'

/** NSM / FT / TM / PM / SD: one page, two cards (visits per month and the visits of the selected month); FT / TM also show their coaching. */
export function StaffProfile({ id, month }: { id: number; month: string }) {
  const info = useAsync(`prof:staff:${id}`, () => fetchStaffInfo(id))
  const months = useAsync(`prof:staffm:${id}:${month.slice(0, 4)}`, () => fetchStaffMonths(id, month))
  const detail = useAsync(`prof:staffd:${id}:${month}`, () => fetchStaffDetail(id, month))
  const name = info.data ? String(pick(info.data, ['name', 'staff_name', 'full_name']) ?? `Staff #${id}`) : `Staff #${id}`
  const role = info.data ? String(pick(info.data, ['title', 'role_type', 'role', 'position']) ?? 'Staff') : 'Staff'
  const code = info.data ? (pick(info.data, ['code', 'staff_code']) as string | undefined) ?? null : null
  const trainer = /\b(ft|tm)\b|train/i.test(role)
  const given = useAsync(`prof:staffcoach:${id}:${month}`, () => (trainer ? fetchCoachingGiven(name, month) : Promise.resolve([])))
  return (
    <>
      <ProfileHeader name={name} code={code} role={role} line={info.data ? (pick(info.data, ['line', 'line_name']) as string | undefined) ?? null : null}>
        <Fact label="Month">{month.slice(0, 7)}</Fact>
      </ProfileHeader>
      <div className="space-y-4">
        <Section period="monthly" state={months} title="Visits per month" description={`${month.slice(0, 4)} — visits, AM / PM and field days (v_staff_visits_month).`} isEmpty={(d) => d.length === 0} emptyText="No visits recorded for this staff member in the year.">
          {(rows) => <RawTable rows={rows} />}
        </Section>
        <Section period="monthly" state={detail} title={`Visits of ${monthShort(month)} ${month.slice(0, 4)}`} description="v_staff_visit_detail" isEmpty={(d) => d.length === 0} emptyText="No visits in the selected month.">
          {(rows) => <RawTable rows={rows} />}
        </Section>
        {trainer && (
          <Section period="monthly" state={given} title="Coaching data" description="Evaluations given, January to the selected month." isEmpty={(d) => d.length === 0} emptyText="No coaching evaluations given.">
            {(rows) => <SimpleTable rows={rows} rowKey={(r, i) => `${r.rep}-${i}`} cols={[{ h: 'Date', cell: (r) => r.visit_date ?? '—' }, { h: 'Rep', cell: (r) => r.rep }, { h: 'Avg score', right: true, cell: (r) => r.avg_score?.toFixed(2) ?? '—' }]} />}
          </Section>
        )}
        {info.error && <Card className="p-4 text-sm text-muted-foreground">Staff details could not be read: {info.error}</Card>}
      </div>
    </>
  )
}
