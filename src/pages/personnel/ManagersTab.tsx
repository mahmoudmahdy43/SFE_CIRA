import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Link2, LogOut, Plus, X } from 'lucide-react'
import { DataTable } from '../../components/app/DataTable'
import { Button } from '../../components/ui/button'
import { StatusPill } from '../../components/ui/misc'
import {
  AssignManagerDialog, CreateManagerDialog, ResignManagerDialog, UnassignManagerDialog,
} from '../../components/app/PersonnelActions'
import type { Manager, OrgView } from '../../lib/api/org'

interface Row { m: Manager; code: string; name: string; status: 'Active' | 'Resigned'; boxes: string; count: number }
type Dlg = { k: 'create' } | { k: 'assign'; m?: Manager } | { k: 'resign'; m: Manager } | { k: 'unassign'; box: number } | null

export default function ManagersTab({ org, reload }: { org: OrgView; reload: () => void }) {
  const [dlg, setDlg] = useState<Dlg>(null)
  const rows = useMemo<Row[]>(
    () =>
      org.managers.map((m) => {
        const b = org.boxesOfManager.get(m.id) ?? []
        return { m, code: m.code ?? '—', name: m.name, status: m.status, boxes: b.map((x) => x.name).join(', ') || '—', count: b.length }
      }),
    [org],
  )
  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      { accessorKey: 'name', header: 'Manager', enableHiding: false },
      { accessorKey: 'code', header: 'Code' },
      { accessorKey: 'status', header: 'Status', cell: (c) => <StatusPill status={c.row.original.status} /> },
      { accessorKey: 'count', header: '# Boxes' },
      {
        accessorKey: 'boxes',
        header: 'Boxes',
        cell: (c) => {
          const boxes = org.boxesOfManager.get(c.row.original.m.id) ?? []
          if (!boxes.length) return '—'
          return (
            <span className="flex max-w-md flex-wrap gap-1">
              {boxes.map((b) => (
                <span key={b.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                  {b.name}
                  <button aria-label={`Unassign ${b.name} from ${c.row.original.name}`} className="text-muted-foreground hover:text-danger" onClick={() => setDlg({ k: 'unassign', box: b.id })}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </span>
          )
        },
      },
      {
        id: 'actions', header: '', enableSorting: false, enableHiding: false,
        cell: (c) =>
          c.row.original.status === 'Active' ? (
            <span className="flex gap-1">
              <Button size="icon-sm" variant="ghost" aria-label={`Assign ${c.row.original.name} to boxes`} onClick={() => setDlg({ k: 'assign', m: c.row.original.m })}><Link2 className="h-4 w-4" /></Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Resign ${c.row.original.name}`} onClick={() => setDlg({ k: 'resign', m: c.row.original.m })}><LogOut className="h-4 w-4" /></Button>
            </span>
          ) : null,
      },
    ],
    [org],
  )
  const close = () => setDlg(null)
  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        csvName="managers"
        pageSize={15}
        emptyTitle="No managers yet"
        emptyDescription="Import the workbook from Org & Territories, or create a manager."
        toolbar={<Button size="sm" variant="primary" onClick={() => setDlg({ k: 'create' })}><Plus className="h-4 w-4" /> Create manager</Button>}
      />
      {dlg?.k === 'create' && <CreateManagerDialog open onOpenChange={close} onDone={reload} />}
      {dlg?.k === 'assign' && <AssignManagerDialog org={org} manager={dlg.m} open onOpenChange={close} onDone={reload} />}
      {dlg?.k === 'resign' && <ResignManagerDialog manager={dlg.m} open onOpenChange={close} onDone={reload} />}
      {dlg?.k === 'unassign' && <UnassignManagerDialog org={org} boxId={dlg.box} open onOpenChange={close} onDone={reload} />}
    </>
  )
}
