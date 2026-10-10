import { useMemo, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Badge, Card } from '../../components/ui/misc'
import { EmptyState } from '../../components/app/states'
import { AssignManagerDialog, HireDialog } from '../../components/app/PersonnelActions'
import type { Box, OrgView } from '../../lib/api/org'

type Dlg = { k: 'hire'; box: number } | { k: 'assign'; box: number } | null

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

export default function VacanciesTab({ org, reload }: { org: OrgView; reload: () => void }) {
  const [dlg, setDlg] = useState<Dlg>(null)
  const noRep = useMemo(() => org.boxes.filter((b) => !org.repOfBox.has(b.id)), [org])
  const noMgr = useMemo(() => org.boxes.filter((b) => !org.managerOfBox.has(b.id)), [org])
  const close = () => setDlg(null)
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <VacancyList title="Boxes with no rep" boxes={noRep} org={org} action="Hire rep" onAction={(b) => setDlg({ k: 'hire', box: b.id })} />
        <VacancyList title="Boxes with no manager" boxes={noMgr} org={org} action="Assign manager" onAction={(b) => setDlg({ k: 'assign', box: b.id })} />
      </div>
      {dlg?.k === 'hire' && <HireDialog org={org} open onOpenChange={close} onDone={reload} presetBox={dlg.box} />}
      {dlg?.k === 'assign' && <AssignManagerDialog org={org} open onOpenChange={close} onDone={reload} presetBox={dlg.box} />}
    </>
  )
}
