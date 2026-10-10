import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '../../components/app/DataTable'
import { PagedTable, type PagedColumn } from '../../components/app/PagedTable'
import { ErrorState } from '../../components/app/states'
import { Combobox } from '../../components/ui/combobox'
import { Badge } from '../../components/ui/misc'
import { Dialog, DialogContent } from '../../components/ui/overlay'
import { fetchAll } from '../../lib/api/core'
import { fetchOrgForMonth, type OrgRepInfo } from '../../lib/api/dqVisits'
import { fetchNoBoxAll, fetchNoBoxPage, fetchSlots, type AbsenceNoBoxRow, type SlotRow, type SlotStatus } from '../../lib/api/dqAbsence'
import { cn } from '../../lib/utils'
import { Section } from './VisitsSections'

const STATUS_ORDER: SlotStatus[] = ['worked', 'leave', 'office_work', 'activity', 'missing']
const STATUS_LABEL: Record<SlotStatus, string> = { worked: 'Worked', leave: 'Leave', office_work: 'Office work', activity: 'Activity', missing: 'Missing' }
const STATUS_SHORT: Record<SlotStatus, string> = { worked: 'Worked', leave: 'Leave', office_work: 'OW', activity: 'Act.', missing: 'Missing' }
const STATUS_TONE: Record<SlotStatus, 'success' | 'warning' | 'info' | 'accent' | 'danger'> = {
  worked: 'success', leave: 'warning', office_work: 'info', activity: 'accent', missing: 'danger',
}

type Mix = Record<'AM' | 'PM', Record<SlotStatus, number>>
interface MixRow { rep_id: number; code: string; name: string; line: string; manager: string; mix: Mix; missing: number }

const emptyMix = (): Mix => ({
  AM: { worked: 0, leave: 0, office_work: 0, activity: 0, missing: 0 },
  PM: { worked: 0, leave: 0, office_work: 0, activity: 0, missing: 0 },
})

/** Per-rep status mix (AM and PM separately) with a day-by-day drill-down. Replaces the plain missing-days list. */
export function MissingDaysSection({ month }: { month: string }) {
  const [slots, setSlots] = useState<SlotRow[] | null>(null)
  const [orgInfo, setOrgInfo] = useState<Map<number, OrgRepInfo> | null>(null)
  const [reps, setReps] = useState<Map<number, { code: string; name: string }>>(new Map())
  const [lines, setLines] = useState<Map<number, string>>(new Map())
  const [managers, setManagers] = useState<Map<number, string>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [line, setLine] = useState<string | null>(null)
  const [mgr, setMgr] = useState<string | null>(null)
  const [detail, setDetail] = useState<number | null>(null)

  const load = useCallback(async () => {
    setError(null)
    setSlots(null)
    try {
      const [sl, o, l, mg, rp] = await Promise.all([
        fetchSlots(month),
        fetchOrgForMonth(month),
        fetchAll<{ id: number; name: string }>('lines', 'id,name', ['id']),
        fetchAll<{ id: number; name: string }>('managers', 'id,name', ['id']),
        fetchAll<{ id: number; code: string; name: string }>('reps', 'id,code,name', ['id']),
      ])
      setSlots(sl)
      setOrgInfo(o)
      setLines(new Map(l.map((x) => [x.id, x.name])))
      setManagers(new Map(mg.map((x) => [x.id, x.name])))
      setReps(new Map(rp.map((x) => [x.id, { code: x.code, name: x.name }])))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    }
  }, [month])
  useEffect(() => {
    void load()
  }, [load])

  const summary = useMemo<MixRow[]>(() => {
    const map = new Map<number, MixRow>()
    for (const r of slots ?? []) {
      const info = orgInfo?.get(r.rep_id)
      const rep = reps.get(r.rep_id)
      const row = map.get(r.rep_id) ?? {
        rep_id: r.rep_id,
        code: rep?.code ?? '—',
        name: rep?.name ?? `#${r.rep_id}`,
        line: info?.line_id ? lines.get(info.line_id) ?? '—' : '—',
        manager: info?.manager_id ? managers.get(info.manager_id) ?? '—' : 'Vacant',
        mix: emptyMix(),
        missing: 0,
      }
      row.mix[r.shift][r.status]++
      if (r.status === 'missing') row.missing++
      map.set(r.rep_id, row)
    }
    return [...map.values()]
      .filter((s) => (line ? orgInfo?.get(s.rep_id)?.line_id === Number(line) : true))
      .filter((s) => (mgr ? (mgr === 'vacant' ? !orgInfo?.get(s.rep_id)?.manager_id : orgInfo?.get(s.rep_id)?.manager_id === Number(mgr)) : true))
      .sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name))
  }, [slots, orgInfo, reps, lines, managers, line, mgr])

  const columns = useMemo<ColumnDef<MixRow, unknown>[]>(() => {
    const cols: ColumnDef<MixRow, unknown>[] = [
      { accessorKey: 'name', header: 'Rep', enableHiding: false },
      { accessorKey: 'code', header: 'Code' },
      { accessorKey: 'line', header: 'Line' },
      { accessorKey: 'manager', header: 'Manager' },
    ]
    for (const shift of ['AM', 'PM'] as const) {
      for (const st of STATUS_ORDER) {
        cols.push({
          id: `${shift}-${st}`,
          header: `${shift} ${STATUS_SHORT[st]}`,
          accessorFn: (r) => r.mix[shift][st],
          cell: (c) => {
            const v = c.row.original.mix[shift][st]
            return <span className={cn(v === 0 && 'text-muted-foreground/50', st === 'missing' && v > 0 && 'font-semibold text-danger')}>{v}</span>
          },
        })
      }
    }
    return cols
  }, [])
  const numericIds = useMemo(() => ['AM', 'PM'].flatMap((s) => STATUS_ORDER.map((st) => `${s}-${st}`)), [])

  const days = useMemo(() => {
    if (detail === null) return []
    const byDay = new Map<string, Partial<Record<'AM' | 'PM', SlotStatus>>>()
    for (const r of slots ?? []) {
      if (r.rep_id !== detail) continue
      byDay.set(r.day, { ...byDay.get(r.day), [r.shift]: r.status })
    }
    return [...byDay].sort(([a], [b]) => a.localeCompare(b))
  }, [slots, detail])
  const detailRep = detail === null ? undefined : reps.get(detail)

  return (
    <Section
      id="missing"
      title="Missing days and status mix"
      description="For every working slot: worked, leave, office work, activity or missing — AM and PM counted separately. Priority: leave > office work > activity > worked > missing. Click a rep for the day-by-day view."
    >
      <ul className="mb-3 flex flex-wrap gap-2 text-xs" aria-label="Status legend">
        {STATUS_ORDER.map((st) => <li key={st}><Badge tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Badge></li>)}
      </ul>
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        <DataTable
          data={summary}
          columns={columns}
          numericColumns={numericIds}
          loading={!slots}
          csvName={`status-mix-${month.slice(0, 7)}`}
          pageSize={15}
          onRowClick={(r) => setDetail(r.rep_id)}
          emptyTitle="No working slots for this month"
          emptyDescription="Slots appear once the org, calendar and uploads for the month are in place."
          toolbar={
            <>
              <Combobox label="Line" placeholder="All lines" className="h-8" options={[...lines].map(([id, n]) => ({ value: String(id), label: n }))} value={line} onChange={setLine} />
              <Combobox label="Manager" placeholder="All managers" className="h-8" options={[{ value: 'vacant', label: 'Vacant manager' }, ...[...managers].map(([id, n]) => ({ value: String(id), label: n }))]} value={mgr} onChange={setMgr} />
            </>
          }
        />
      )}
      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent title={detailRep?.name ?? 'Days'} side="right">
          <div className="h-full space-y-3 overflow-y-auto p-6">
            <h3 className="text-lg font-semibold">{detailRep?.name}</h3>
            <p className="tnum text-sm text-muted-foreground">{detailRep?.code} · {month.slice(0, 7)}</p>
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Day</th><th className="py-1.5 font-medium">AM</th><th className="py-1.5 font-medium">PM</th></tr></thead>
              <tbody>
                {days.map(([d, v]) => (
                  <tr key={d} className="border-b last:border-0">
                    <td className="tnum py-1.5">{d}</td>
                    {(['AM', 'PM'] as const).map((sh) => {
                      const st = v[sh]
                      return <td key={sh} className="py-1.5">{st ? <Badge tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </Section>
  )
}

/** Leave / office work / activity rows on a day the rep covers no box. */
export function NoBoxSection({ month }: { month: string }) {
  const columns: PagedColumn<AbsenceNoBoxRow>[] = [
    { header: 'Day', cell: (r) => <span className="tnum whitespace-nowrap">{r.day}</span> },
    { header: 'Kind', cell: (r) => <Badge tone="info">{r.kind.replace('_', ' ')}</Badge> },
    { header: 'Rep', cell: (r) => r.rep },
    { header: 'Shift', cell: (r) => r.shift },
    { header: 'Type', cell: (r) => r.type ?? '—' },
  ]
  return (
    <Section
      id="nobox"
      title="Absence without a box"
      description="Leave, office-work or activity rows for a rep who covers no box on that day (for example before hire or after resignation). They are stored but cannot affect any KPI."
    >
      <PagedTable
        key={month}
        columns={columns}
        csvName={`absence-without-box-${month.slice(0, 7)}`}
        emptyTitle="Nothing to review"
        emptyDescription="Every absence row falls on a day the rep covers a box."
        load={(p, s) => fetchNoBoxPage(month, p, s)}
        exportAll={async () => (await fetchNoBoxAll(month)).map((r) => ({ day: r.day, kind: r.kind, rep: r.rep, shift: r.shift, type: r.type ?? '' }))}
      />
    </Section>
  )
}
