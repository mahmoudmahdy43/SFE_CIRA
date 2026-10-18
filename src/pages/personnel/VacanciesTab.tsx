import { useMemo, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Badge, Card, Skeleton } from '../../components/ui/misc'
import { EmptyState, ErrorState } from '../../components/app/states'
import { AssignManagerDialog, HireDialog } from '../../components/app/PersonnelActions'
import { useMonth } from '../../context/MonthContext'
import { useAsync, type AsyncState } from '../../features/dashboard/useAsync'
import { fetchVacantManagerBoxes, type Box, type OrgView, type VacantManagerBox } from '../../lib/api/org'
import { districtLabel, groupVacantManagerBoxes } from './vacantManagers'

type Dlg = { k: 'hire'; box: number } | { k: 'assign'; boxes: number[] } | null

function VacancyList({ title, boxes, org, action, onAction }: { title: string; boxes: Box[]; org: OrgView; action: string; onAction: (b: Box) => void }) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Badge tone={boxes.length ? 'warning' : 'success'}>{boxes.length}</Badge>
      </div>
      {boxes.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No vacancies" description="Every box is covered." className="py-10" />
      ) : (
        <ul className="max-h-[480px] divide-y overflow-auto">
          {boxes.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{b.name}</div>
                <div className="text-xs text-muted-foreground">{org.lineById.get(b.line_id)?.name} · <span className="tnum">{org.territoryCount.get(b.id) ?? 0}</span> territories</div>
              </div>
              <Button size="sm" onClick={() => onAction(b)}>{action}</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** "Boxes with no manager": a manager owns a whole district, so a box is listed with its district manager (or a vacant pill). */
function NoManagerList({ state: { data, error, loading, reload }, onAssign }: { state: AsyncState<VacantManagerBox[]>; onAssign: (boxIds: number[]) => void }) {
  const view = useMemo(() => (data ? groupVacantManagerBoxes(data) : null), [data])
  return (
    <Card>
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-sm font-semibold">Boxes with no manager</h2>
        {view && <Badge tone={view.total ? 'warning' : 'success'}>{view.total}</Badge>}
      </div>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading || !view ? (
        <div className="space-y-2 p-4" aria-busy="true"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
      ) : view.total === 0 ? (
        <EmptyState icon={CheckCircle2} title="No vacancies" description="Every box has a manager." className="py-10" />
      ) : (
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="sticky top-0 border-b bg-card text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Line</th><th className="py-2 font-medium">District</th><th className="py-2 font-medium">Box</th><th className="py-2 font-medium">District manager</th><th className="px-4 py-2"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {view.vacantDistricts.map((g) => (
                <VacantDistrictRows key={g.key} line={g.line} district={g.district} boxes={g.boxes} onAssign={onAssign} />
              ))}
              {view.withManager.map((r) => (
                <tr key={r.box_id} className="border-b last:border-0">
                  <td className="px-4 py-2">{r.line_name}</td>
                  <td className="py-2">{districtLabel(r.district)}</td>
                  <td className="py-2 font-medium">{r.box_name}</td>
                  <td className="py-2">{r.district_manager}</td>
                  <td className="px-4 py-2 text-right"><Button size="sm" onClick={() => onAssign([r.box_id])}>Assign manager</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/** A district whose manager is vacant: one header row (pill + quick action for the whole district), then its boxes. */
function VacantDistrictRows({ line, district, boxes, onAssign }: { line: string; district: string | null; boxes: { box_id: number; box_name: string }[]; onAssign: (boxIds: number[]) => void }) {
  return (
    <>
      <tr className="border-b bg-muted/50">
        <td className="px-4 py-2 font-medium">{line}</td>
        <td className="py-2 font-medium">{districtLabel(district)}</td>
        <td className="tnum py-2 text-muted-foreground">{boxes.length} box{boxes.length === 1 ? '' : 'es'}</td>
        <td className="py-2"><Badge tone="danger">District manager vacant</Badge></td>
        <td className="px-4 py-2 text-right"><Button size="sm" onClick={() => onAssign(boxes.map((b) => b.box_id))}>Assign manager to district</Button></td>
      </tr>
      {boxes.map((b) => (
        <tr key={b.box_id} className="border-b last:border-0">
          <td /><td />
          <td className="py-2 pl-3 font-medium">{b.box_name}</td>
          <td className="py-2 text-muted-foreground">—</td>
          <td />
        </tr>
      ))}
    </>
  )
}

export default function VacanciesTab({ org, reload }: { org: OrgView; reload: () => void }) {
  const { month } = useMonth()
  const [dlg, setDlg] = useState<Dlg>(null)
  const vacant = useAsync(`vacant-manager-boxes|${month}`, () => fetchVacantManagerBoxes(month))
  const noRep = useMemo(() => org.boxes.filter((b) => !org.repOfBox.has(b.id)), [org])
  const close = () => setDlg(null)
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <VacancyList title="Boxes with no rep" boxes={noRep} org={org} action="Hire rep" onAction={(b) => setDlg({ k: 'hire', box: b.id })} />
        <NoManagerList state={vacant} onAssign={(boxes) => setDlg({ k: 'assign', boxes })} />
      </div>
      {dlg?.k === 'hire' && <HireDialog org={org} open onOpenChange={close} onDone={reload} presetBox={dlg.box} />}
      {dlg?.k === 'assign' && <AssignManagerDialog org={org} open onOpenChange={close} onDone={() => { reload(); vacant.reload() }} presetBoxes={dlg.boxes} />}
    </>
  )
}
